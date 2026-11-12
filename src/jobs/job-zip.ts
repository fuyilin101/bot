import { crc32, inflateRawSync } from "node:zlib";
import { JobImportError, jobPackageEntries, jobZipLimit, manifestName } from "./job-package-format.js";

const maxEntries = 32;
const maxEntryBytes = 1024 * 1024;
const maxTotalBytes = 4 * 1024 * 1024;
const maxRatio = 100;
const recognized = new Set<string>([manifestName, ...jobPackageEntries]);
const invalid = () => { throw new JobImportError("job_import_invalid_zip"); };

function validateName(name: string): void {
  const segments = name.split("/");
  if (name.length > 200 || segments.some((part) => !/^[A-Za-z0-9_][A-Za-z0-9_. -]*$/u.test(part)
    || /[. ]$/u.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(part))) {
    throw new JobImportError("job_import_unsafe_zip_name");
  }
}

export function readJobZip(bytes: Uint8Array): { files: Map<string, Buffer>; unparsed: string[] } {
  if (bytes.length > jobZipLimit) throw new JobImportError("job_import_file_too_large");
  const zip = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The producer emits a single-disk ZIP without comments, ZIP64 or data descriptors.
  const end = zip.length - 22;
  if (end < 0 || zip.readUInt32LE(end) !== 0x06054b50 || zip.readUInt16LE(end + 20) !== 0) return invalid();
  if (zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6)) throw new JobImportError("job_import_unsupported_zip");
  const entries = zip.readUInt16LE(end + 10);
  if (entries !== zip.readUInt16LE(end + 8) || !entries) return invalid();
  if (entries > maxEntries) throw new JobImportError("job_import_zip_limits");
  const directory = zip.readUInt32LE(end + 16);
  if (directory + zip.readUInt32LE(end + 12) !== end) return invalid();
  let offset = directory;
  let total = 0;
  const names = new Set<string>();
  const members: { name: string; offset: number; start: number; end: number; size: number; crc: number; method: number }[] = [];
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > end || zip.readUInt32LE(offset) !== 0x02014b50) return invalid();
    const flags = zip.readUInt16LE(offset + 8);
    const method = zip.readUInt16LE(offset + 10);
    const crc = zip.readUInt32LE(offset + 16);
    const compressed = zip.readUInt32LE(offset + 20);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const disk = zip.readUInt16LE(offset + 34);
    const local = zip.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > end || !nameLength) return invalid();
    const nameBytes = zip.subarray(offset + 46, offset + 46 + nameLength);
    if (nameBytes.some((value) => value > 127)) throw new JobImportError("job_import_unsafe_zip_name");
    const name = nameBytes.toString("ascii");
    validateName(name);
    const key = name.toLowerCase();
    if (names.has(key)) throw new JobImportError("job_import_duplicate_zip_name");
    names.add(key);
    if ((flags & ~0x0800) || (method !== 0 && method !== 8) || disk || [size, compressed, local].includes(0xffffffff)) {
      throw new JobImportError("job_import_unsupported_zip");
    }
    total += size;
    if (size > maxEntryBytes || total > maxTotalBytes || size > Math.max(compressed, 1) * maxRatio) {
      throw new JobImportError("job_import_zip_limits");
    }
    if (local + 30 > directory || zip.readUInt32LE(local) !== 0x04034b50) return invalid();
    const localNameLength = zip.readUInt16LE(local + 26);
    const start = local + 30 + localNameLength + zip.readUInt16LE(local + 28);
    if (start + compressed > directory || localNameLength !== nameLength
      || !zip.subarray(local + 30, local + 30 + localNameLength).equals(nameBytes)
      || zip.readUInt16LE(local + 6) !== flags || zip.readUInt16LE(local + 8) !== method
      || zip.readUInt32LE(local + 14) !== crc || zip.readUInt32LE(local + 18) !== compressed
      || zip.readUInt32LE(local + 22) !== size || (method === 0 && compressed !== size)) return invalid();
    members.push({ name, offset: local, start, end: start + compressed, size, crc, method });
    offset = next;
  }
  if (offset !== end) return invalid();
  let position = 0;
  for (const member of members.sort((a, b) => a.offset - b.offset)) {
    if (member.offset !== position) return invalid();
    position = member.end;
  }
  if (position !== directory) return invalid();
  const files = new Map<string, Buffer>();
  const unparsed: string[] = [];
  for (const member of members) {
    if (!recognized.has(member.name)) {
      unparsed.push(member.name);
      continue;
    }
    const payload = zip.subarray(member.start, member.end);
    let content: Buffer;
    try {
      if (member.method === 0) {
        content = payload;
      } else {
        // Node returns the engine alongside the output for info=true. The bundled typings omit that overload.
        const inflated = inflateRawSync(payload, { maxOutputLength: member.size + 1, info: true }) as unknown as {
          buffer: Buffer; engine: { bytesWritten: number };
        };
        if (inflated.engine.bytesWritten !== payload.length) return invalid();
        content = inflated.buffer;
      }
    } catch { return invalid(); }
    if (content.length !== member.size || crc32(content) !== member.crc) return invalid();
    files.set(member.name, content);
  }
  return { files, unparsed };
}
