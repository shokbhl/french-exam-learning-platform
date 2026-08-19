/**
 * Turning an uploaded file into page-level text.
 *
 * `document_pages` distinguishes `native` extraction from `ocr` because the two
 * are not equally trustworthy: a text layer is exact, a model reading a scan is
 * an estimate, and a question grounded in a bad reading is worse than no
 * question. The extractor therefore always reports which method produced a
 * page, and model-read pages carry a confidence the caller can filter on.
 *
 * Local extraction is tried first for every format that has a text layer,
 * because it is exact, free and instant. The model is a fallback for scans and
 * images, not the default path.
 */

import { fileURLToPath } from "node:url";

import type { ExtractedPage } from "./chunk.ts";

export type ExtractionMethod = "native" | "ocr" | "manual";

export type ExtractedDocument = {
  pages: (ExtractedPage & { method: ExtractionMethod; confidence: number | null })[];
  /** True when local extraction found too little text to be a real text layer. */
  needsModelReading: boolean;
  /** Set when the format cannot be read at all without a provider. */
  unsupported?: string;
};

/** Characters per page below which a PDF is treated as scanned rather than empty. */
const SCANNED_THRESHOLD = 40;

export function isPdf(mimeType: string, filename: string) {
  return mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
}

export function isImage(mimeType: string) {
  return mimeType.startsWith("image/");
}

export function isAudio(mimeType: string) {
  return mimeType.startsWith("audio/");
}

function plainTextDocument(text: string): ExtractedDocument {
  return {
    // A text file has no pages to lose, so page 1 is the honest answer rather
    // than inventing page breaks the source does not have.
    pages: [{ pageNumber: 1, text, method: "native", confidence: null }],
    needsModelReading: text.trim().length === 0,
  };
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractedDocument> {
  // The legacy build is the one that runs outside a browser.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: bytes,
    // Workers and system fonts are browser concerns; disabling them keeps the
    // extractor usable from a plain Node process. The standard fonts still have
    // to be locatable, or every page logs a warning while decoding text.
    useWorkerFetch: false,
    useSystemFonts: false,
    standardFontDataUrl: fileURLToPath(
      new URL("../../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url),
    ),
  });
  const document = await task.promise;
  const pages: ExtractedDocument["pages"] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    // pdfjs emits one item per text run, with `hasEOL` marking a line break.
    // Joining without honouring it welds the last word of a line to the first
    // word of the next, which destroys both readability and heading detection.
    const text = content.items
      .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
      .join("")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    pages.push({ pageNumber, text, method: "native", confidence: null });
  }
  await document.cleanup();

  const totalChars = pages.reduce((sum, page) => sum + page.text.length, 0);
  return {
    pages,
    needsModelReading: pages.length > 0 && totalChars / pages.length < SCANNED_THRESHOLD,
  };
}

async function extractDocx(bytes: Uint8Array): Promise<ExtractedDocument> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  // DOCX carries no reliable page breaks — pagination is decided at render
  // time — so claiming page numbers here would be fiction.
  return plainTextDocument(result.value ?? "");
}

/**
 * Reads a file locally, without any model.
 *
 * Returns `needsModelReading` rather than throwing when a PDF turns out to be
 * scanned, so the caller decides whether spending a model call is wanted.
 */
export async function extractLocally(
  bytes: Uint8Array,
  mimeType: string,
  filename: string,
): Promise<ExtractedDocument> {
  const lower = filename.toLowerCase();

  if (isPdf(mimeType, filename)) return extractPdf(bytes);

  if (
    mimeType.startsWith("text/") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".markdown")
  ) {
    return plainTextDocument(new TextDecoder("utf-8").decode(bytes));
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    return extractDocx(bytes);
  }

  // Nothing to read locally in a picture; the model reads it.
  if (isImage(mimeType)) return { pages: [], needsModelReading: true };

  if (isAudio(mimeType)) {
    return {
      pages: [],
      needsModelReading: false,
      unsupported:
        "l’audio nécessite un fournisseur de transcription (speech-to-text), qui n’est pas configuré.",
    };
  }

  return { pages: [], needsModelReading: false, unsupported: `format non pris en charge : ${mimeType}` };
}
