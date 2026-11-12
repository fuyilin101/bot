import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { ValidatedAnalysis } from "./analysis.js";
import { artifactNames, createJob, writeArtifacts } from "./artifacts.js";
import { buildCallPackage, callDraftSchema, callInstructions, callPrompt, renderCallPackage } from "./call-package.js";
import { createJobAnalyzer, createStructuredRunner } from "./codex.js";
import { defaultCvLimits, extractCv } from "./cv-input.js";
import { jobGuideLimit, jobZipLimit, sha256 } from "./job-package-format.js";
import { verifyJobPackage } from "./job-package-import.js";

const newId = (bytes: number) => randomBytes(bytes).toString("hex").toUpperCase();

function readLocalFile(path: string, maxBytes: number): Buffer {
  const fd = openSync(path, "r");
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) throw new Error("local_input_not_file");
    const { size } = info;
    if (size > maxBytes) throw new Error("local_input_too_large");
    const buffer = Buffer.allocUnsafe(size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset !== size) throw new Error("local_input_changed");
    return buffer.subarray(0, offset);
  } finally { closeSync(fd); }
}

function outputRoot(path: string): string {
  const root = resolve(path);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return realpathSync(root);
}

function publish(root: string, folder: string, write: (stage: string) => void): string {
  const target = join(root, folder);
  if (existsSync(target)) throw new Error("local_output_exists");
  const staging = mkdtempSync(join(root, ".local-recruiting-"));
  try {
    write(staging);
    renameSync(join(staging, folder), target);
    return target;
  } finally {
    if (dirname(staging) === root && basename(staging).startsWith(".local-recruiting-")) {
      rmSync(staging, { recursive: true, force: true });
    }
  }
}

export async function runLocalJob({ input, out }: { input: string; out: string },
  analyze?: (source: string) => Promise<ValidatedAnalysis>) {
  const maxLength = 12_000;
  const inputBytes = readLocalFile(input, maxLength * 4);
  let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(inputBytes).trim(); }
  catch { throw new Error("local_job_input_not_utf8"); }
  if (!source || source.length > maxLength) throw new Error("local_job_input_invalid_length");

  const root = outputRoot(out);
  const analysis = await (analyze ?? createJobAnalyzer())(source);
  if (analysis.event !== "JOB_CREATE" || !analysis.job_title) throw new Error("local_job_create_required");
  const suffix = newId(8);
  const job = createJob(analysis, { messageId: `local-${suffix}`, sentAt: String(Date.now()) }, `JOB-${suffix}`);
  const jobRoot = publish(root, job.job_id, (stage) => {
    writeArtifacts(job, stage, source);
    const directory = join(stage, job.job_id, `v${job.version}`);
    verifyJobPackage(readLocalFile(join(directory, artifactNames[1]), jobZipLimit),
      readLocalFile(join(directory, artifactNames[2]), jobGuideLimit));
  });
  const directory = join(jobRoot, `v${job.version}`);
  return { job_id: job.job_id, job_version: job.version, output_directory: directory,
    files: artifactNames.map((name) => join(directory, name)) };
}

export async function runLocalCall({ zip, guide, cv, out }: { zip: string; guide: string; cv: string; out: string },
  analyze?: (prompt: string) => Promise<string>) {
  const zipBytes = readLocalFile(zip, jobZipLimit);
  const guideBytes = readLocalFile(guide, jobGuideLimit);
  const verified = verifyJobPackage(zipBytes, guideBytes);
  const extension = extname(cv).toLowerCase();
  if (extension !== ".txt" && extension !== ".pdf") throw new Error("cv_unsupported_format");
  const extracted = await extractCv(extension === ".pdf" ? "file" : "text", readLocalFile(cv, defaultCvLimits.maxBytes), cv, defaultCvLimits);
  const guideText = guideBytes.toString("utf8");
  const body = guideText.slice(guideText.indexOf("\n") + 1);
  const root = outputRoot(out);
  const suffix = newId(12);
  const identity = {
    requestId: `CALLREQ-${suffix}`, cvId: `CV-${suffix}`, packageId: `CALLPKG-${suffix}`,
    jobPackageId: `JOBPKG-${sha256(`${verified.zipHash}:${verified.guideHash}`).slice(0, 24).toUpperCase()}`,
    generatedAt: new Date().toISOString(),
  };
  const prompt = callPrompt(verified.job, body, extracted);
  const raw = await (analyze ?? createStructuredRunner(callInstructions, callDraftSchema))(prompt);
  const pack = buildCallPackage(raw, verified.job, extracted, identity);
  const filenames = [`${pack.package_id}.json`, `${pack.package_id}.md`];
  const directory = publish(root, pack.package_id, (stage) => {
    const folder = join(stage, pack.package_id);
    mkdirSync(folder, { mode: 0o700 });
    writeFileSync(join(folder, filenames[0]), JSON.stringify(pack, null, 2), { encoding: "utf8", mode: 0o600 });
    writeFileSync(join(folder, filenames[1]), renderCallPackage(pack), { encoding: "utf8", mode: 0o600 });
  });
  return { request_id: pack.request_id, package_id: pack.package_id, job_id: pack.job_id, job_version: pack.job_version,
    job_package_id: identity.jobPackageId, output_directory: directory, files: filenames.map((name) => join(directory, name)) };
}
