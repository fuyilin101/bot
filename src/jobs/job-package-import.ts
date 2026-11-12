import type { Job } from "./artifacts.js";
import { analysisSchema } from "./analysis.js";
import { guideHeader, JobImportError, jobGuideLimit, jobIdentityPattern, jobPackageEntries,
  jobPackageSchemaVersion, manifestName, sha256 } from "./job-package-format.js";
import { jobSnapshot } from "./job-snapshot.js";
import { readJobZip } from "./job-zip.js";

const invalidMetadata = () => { throw new JobImportError("job_import_invalid_metadata"); };
const hashPattern = /^[a-f0-9]{64}$/u;
const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalidMetadata();
  return value as Record<string, unknown>;
}

function decode(bytes: Uint8Array): string {
  try { return textDecoder.decode(bytes); } catch { return invalidMetadata(); }
}

function json(text: string): Record<string, unknown> {
  try { return object(JSON.parse(text)); } catch { return invalidMetadata(); }
}

export function verifyJobPackage(zipBytes: Uint8Array, guideBytes: Uint8Array) {
  if (!guideBytes.length || guideBytes.length > jobGuideLimit) throw new JobImportError("job_import_file_too_large");
  const { files, unparsed } = readJobZip(zipBytes);
  const rawManifest = files.get(manifestName);
  const guide = decode(guideBytes);
  const metadata = /^<!-- job-package (\{[^\r\n]+\}) -->\n/u.exec(guide);
  if (!rawManifest || !metadata) throw new JobImportError("job_import_manifest_missing");
  const manifest = json(decode(rawManifest));
  const header = json(metadata[1]);
  if (manifest.package_schema_version !== jobPackageSchemaVersion || header.package_schema_version !== jobPackageSchemaVersion
    || manifest.artifact_type !== "source_package" || header.artifact_type !== "initial_call_guide") {
    throw new JobImportError("job_import_unsupported_package");
  }
  const { job_id, job_version, generated_at } = manifest;
  if (typeof job_id !== "string" || !jobIdentityPattern.test(job_id) || typeof job_version !== "number"
    || !Number.isSafeInteger(job_version) || job_version < 1 || typeof generated_at !== "string"
    || !Number.isFinite(Date.parse(generated_at)) || new Date(generated_at).toISOString() !== generated_at) return invalidMetadata();
  if (header.job_id !== job_id) throw new JobImportError("job_import_job_mismatch");
  if (header.job_version !== job_version) throw new JobImportError("job_import_version_mismatch");
  const zipHash = sha256(zipBytes);
  const guideHash = sha256(guideBytes);
  if (header.source_zip_sha256 !== zipHash) throw new JobImportError("job_import_zip_hash_mismatch");
  if (metadata[0] !== guideHeader({ job_id, job_version, generated_at }, zipHash)) return invalidMetadata();

  const guideBody = guide.slice(metadata[0].length);
  const guideManifest = object(manifest.initial_call_guide);
  if (guideManifest.artifact_type !== "initial_call_guide" || typeof guideManifest.body_sha256 !== "string"
    || !hashPattern.test(guideManifest.body_sha256)) return invalidMetadata();
  if (guideManifest.body_sha256 !== sha256(guideBody)) throw new JobImportError("job_import_guide_hash_mismatch");
  if (!guideBody.startsWith(`# 电话沟通指南\n\n岗位 ${job_id} · v${job_version}\n\n生成时间 ${generated_at}\n`)) return invalidMetadata();

  if (!Array.isArray(manifest.files) || manifest.files.length !== jobPackageEntries.length) return invalidMetadata();
  const hashes = new Map<string, string>();
  for (const entry of manifest.files) {
    const row = object(entry);
    if (typeof row.filename !== "string" || typeof row.sha256 !== "string" || !hashPattern.test(row.sha256)
      || hashes.has(row.filename)) return invalidMetadata();
    hashes.set(row.filename, row.sha256);
  }
  for (const name of jobPackageEntries) {
    const content = files.get(name);
    if (!content || !hashes.has(name)) throw new JobImportError("job_import_zip_entry_missing");
    if (sha256(content) !== hashes.get(name)) throw new JobImportError("job_import_entry_hash_mismatch");
  }

  const jd = json(decode(files.get("jd.json")!));
  const sources = json(decode(files.get("sources.json")!));
  const original = decode(files.get("original_message.txt")!);
  if (jd.job_id !== job_id || sources.job_id !== job_id) throw new JobImportError("job_import_job_mismatch");
  if (jd.version !== job_version || sources.version !== job_version) throw new JobImportError("job_import_version_mismatch");
  if (jd.created_at !== generated_at || sources.generated_at !== generated_at || typeof jd.updated_at !== "string"
    || !Number.isFinite(Date.parse(jd.updated_at)) || !original.trim() || original.length > 12000
    || !Array.isArray(sources.sources) || sources.sources.length !== 1) return invalidMetadata();
  const source = object(sources.sources[0]);
  if (typeof source.message_id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/u.test(source.message_id)
    || typeof source.sent_at !== "string" || !/^\d{1,17}$/u.test(source.sent_at)) return invalidMetadata();
  const reference = { message_id: source.message_id, sent_at: source.sent_at };
  if (JSON.stringify(jd.source_references) !== JSON.stringify([reference])
    || JSON.stringify(jd.source_message_ids) !== JSON.stringify([reference.message_id])) return invalidMetadata();
  if (!Array.isArray(jd.missing_information) || jd.missing_information.some((item: unknown) => typeof item !== "string")
    || (jd.semantic_notes !== undefined && !Array.isArray(jd.semantic_notes))) return invalidMetadata();
  if (Object.keys(analysisSchema.properties).some((field) => field !== "salary_months_text" && !Object.hasOwn(jd, field))) return invalidMetadata();
  // Preserve R0.1 uncertainty, with only source-backed notes forwarded to the call workflow.
  const notes = (jd.semantic_notes ?? []) as unknown[];
  for (const value of notes) {
    const note = object(value);
    if (!Array.isArray(note.evidence) || note.evidence.some((entry: unknown) => typeof entry !== "string" || !original.includes(entry))
      || (note.field === "requirements"
        ? typeof note.term !== "string" || !original.includes(note.term) || !["hard", "preferred", "not_required", "unclear", "conflict"].includes(String(note.outcome))
        : note.field !== "company_industry" || !["corrected", "unverified", "conflict"].includes(String(note.outcome)))) return invalidMetadata();
  }
  let job: Job;
  try {
    job = jobSnapshot(jd as unknown as Job, original, { messageId: reference.message_id, sentAt: reference.sent_at });
  } catch { return invalidMetadata(); }
  if (job.event !== "JOB_CREATE" || !job.job_title) return invalidMetadata();
  return { job, schemaVersion: jobPackageSchemaVersion, zipHash, guideHash, unparsed };
}

export type VerifiedJobPackage = ReturnType<typeof verifyJobPackage>;
