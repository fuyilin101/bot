import { parentPort, workerData } from "node:worker_threads";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { checkCvText, CvInputError, cvLines, type CvLimits, type CvLine } from "./cv-input.js";

const { bytes, limits } = workerData as { bytes: Uint8Array; limits: CvLimits };
globalThis.fetch = async () => { throw new Error("cv_network_disabled"); };
const loading = getDocument({ data: bytes, enableXfa: false, useSystemFonts: false, useWasm: false,
  disableFontFace: true, useWorkerFetch: false, stopAtErrors: true, verbosity: 0 });
try {
  const pdf = await loading.promise;
  if (pdf.numPages > limits.maxPages) throw new CvInputError("cv_pdf_too_many_pages");
  const lines: CvLine[] = [];
  let text = "";
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("");
    lines.push(...cvLines(pageText, pageNumber, lines.length));
    text += pageText + "\n";
    if (text.length > limits.maxChars) throw new CvInputError("cv_text_too_long");
    page.cleanup();
  }
  checkCvText(text, limits);
  parentPort?.postMessage({ cv: { text, lines } });
} catch (error) {
  const name = error instanceof Error ? error.name : "";
  const code = error instanceof CvInputError ? error.code : name === "PasswordException" ? "cv_encrypted_pdf" : "cv_pdf_parse_failed";
  parentPort?.postMessage({ error: code });
} finally {
  await loading.destroy();
}
