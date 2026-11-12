import { Worker } from "node:worker_threads";

export type CvLimits = { maxBytes: number; minChars: number; maxChars: number; maxPages: number; pdfTimeoutMs: number };
export const defaultCvLimits: CvLimits = { maxBytes: 5 * 1024 * 1024, minChars: 60, maxChars: 24000, maxPages: 30, pdfTimeoutMs: 15000 };
export type CvLine = { line: number; page: number | null; text: string };
export type ExtractedCv = { text: string; lines: CvLine[] };
export class CvInputError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function cvLines(text: string, page: number | null = null, offset = 0): CvLine[] {
  return text.replace(/\r\n?/g, "\n").split("\n").filter((line) => line.trim())
    .map((line, index) => ({ line: offset + index + 1, page, text: line.trim() }));
}

export function checkCvText(text: string, limits: CvLimits): void {
  if (text.replace(/\s/g, "").length < limits.minChars) throw new CvInputError("cv_too_little_text");
  if (text.length > limits.maxChars) throw new CvInputError("cv_text_too_long");
}

export async function extractCv(kind: string, bytes: Uint8Array, filename: string | null, limits: CvLimits): Promise<ExtractedCv> {
  if (!bytes.length) throw new CvInputError("cv_empty_file");
  if (bytes.length > limits.maxBytes) throw new CvInputError("cv_file_too_large");
  if (kind === "text") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    checkCvText(text, limits);
    return { text, lines: cvLines(text) };
  }
  if (kind !== "file" || !filename?.toLowerCase().endsWith(".pdf")) throw new CvInputError("cv_unsupported_format");
  if (Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-") throw new CvInputError("cv_invalid_pdf");
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./cv-pdf-worker.js", import.meta.url), {
      workerData: { bytes, limits }, resourceLimits: { maxOldGenerationSizeMb: 192 },
    });
    const timer = setTimeout(() => { void worker.terminate(); reject(new CvInputError("cv_pdf_timeout")); }, limits.pdfTimeoutMs);
    worker.once("message", (result: { cv?: ExtractedCv; error?: string }) => {
      clearTimeout(timer);
      void worker.terminate();
      if (result.cv) resolve(result.cv);
      else reject(new CvInputError(result.error ?? "cv_pdf_parse_failed"));
    });
    worker.once("error", () => { clearTimeout(timer); reject(new CvInputError("cv_pdf_parse_failed")); });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      reject(new CvInputError("cv_pdf_parse_failed"));
    });
  });
}
