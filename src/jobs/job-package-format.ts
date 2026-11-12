import { createHash } from "node:crypto";

export const jobPackageSchemaVersion = "1.0";
export const manifestName = "job_package_manifest.json";
export const jobPackageEntries = ["jd.json", "sources.json", "original_message.txt", "summary.md", "company.md"] as const;
export const jobZipLimit = 5 * 1024 * 1024;
export const jobGuideLimit = 64_000;
export const jobIdentityPattern = /^JOB-[A-F0-9]{16}$/u;
export const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

type Identity = { job_id: string; job_version: number; generated_at: string };
export type JobPackageManifest = Identity & {
  package_schema_version: string;
  artifact_type: "source_package";
  files: { filename: string; sha256: string }[];
  initial_call_guide: { artifact_type: "initial_call_guide"; body_sha256: string };
};

export function guideHeader(identity: Identity, zipHash: string): string {
  const { job_id, job_version, generated_at } = identity;
  return `<!-- job-package ${JSON.stringify({
    job_id, job_version, generated_at, package_schema_version: jobPackageSchemaVersion,
    artifact_type: "initial_call_guide", source_zip_sha256: zipHash,
  })} -->\n`;
}

export function createJobManifest(identity: Identity, entries: Record<string, Uint8Array>, guideBody: string): JobPackageManifest {
  return {
    ...identity, package_schema_version: jobPackageSchemaVersion, artifact_type: "source_package",
    files: Object.entries(entries).map(([filename, bytes]) => ({ filename, sha256: sha256(bytes) })),
    initial_call_guide: { artifact_type: "initial_call_guide", body_sha256: sha256(guideBody) },
  };
}

export class JobImportError extends Error {
  constructor(readonly code: string) { super(code); }
}
