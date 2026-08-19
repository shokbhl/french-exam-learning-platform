/**
 * Splitting extracted pages into citable chunks.
 *
 * A chunk is the unit a drafted question is grounded in, so the page range has
 * to survive the split: `document_chunks` records page_from..page_to precisely
 * because a passage that spans a page break is still one passage, and a
 * citation that rounded it to a single page would send a reader to the wrong
 * place.
 *
 * Splitting happens on paragraph boundaries wherever possible. A paragraph cut
 * in half reads as a fragment to the model and produces questions about
 * sentences that do not exist.
 */

export type ExtractedPage = {
  pageNumber: number;
  text: string;
};

export type Chunk = {
  chunkIndex: number;
  pageFrom: number;
  pageTo: number;
  heading: string | null;
  text: string;
  tokenCount: number;
};

export type ChunkOptions = {
  /** Characters per chunk before a paragraph boundary is sought. */
  targetChars?: number;
  /** Hard ceiling; a single paragraph longer than this is split mid-text. */
  maxChars?: number;
  /** Trailing context repeated into the next chunk, to keep references intact. */
  overlapChars?: number;
};

/** Rough token estimate. French prose runs a little under four characters per token. */
export function estimateTokens(text: string) {
  return Math.max(1, Math.round(text.length / 3.8));
}

/**
 * Detects a heading so a chunk can say where in the document it came from.
 *
 * Deliberately conservative: an ALL-CAPS or numbered line under 80 characters
 * with no terminal punctuation. Anything cleverer starts inventing structure
 * that the source does not have.
 */
function detectHeading(text: string): string | null {
  const first = text.split("\n").map((line) => line.trim()).find((line) => line.length > 0);
  if (!first || first.length > 80) return null;
  if (/[.!?…]$/.test(first)) return null;
  const numbered = /^(\d+[.)]|chapitre|partie|section|unité|exercice)\b/i.test(first);
  const shouted = first === first.toUpperCase() && /\p{L}/u.test(first);
  return numbered || shouted ? first : null;
}

type Paragraph = { text: string; page: number };

/** Flattens pages into paragraphs, each remembering the page it came from. */
function paragraphsOf(pages: ExtractedPage[]): Paragraph[] {
  const result: Paragraph[] = [];
  for (const page of pages) {
    const parts = page.text
      .split(/\n\s*\n/)
      .map((part) => part.replace(/[ \t]+\n/g, "\n").trim())
      .filter((part) => part.length > 0);
    for (const part of parts) result.push({ text: part, page: page.pageNumber });
  }
  return result;
}

/** Splits an oversized paragraph on sentence boundaries, then hard-wraps. */
function splitLongParagraph(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const sentences = text.match(/[^.!?…]+[.!?…]+[\s]*|[^.!?…]+$/g) ?? [text];
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChars && current.length > 0) {
      parts.push(current.trim());
      current = "";
    }
    if (sentence.length > maxChars) {
      for (let at = 0; at < sentence.length; at += maxChars) {
        parts.push(sentence.slice(at, at + maxChars).trim());
      }
      continue;
    }
    current += sentence;
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts.filter((part) => part.length > 0);
}

export function chunkPages(pages: ExtractedPage[], options: ChunkOptions = {}): Chunk[] {
  const targetChars = options.targetChars ?? 1800;
  const maxChars = options.maxChars ?? 3200;
  const overlapChars = options.overlapChars ?? 180;

  const paragraphs = paragraphsOf(pages);
  const chunks: Chunk[] = [];

  let buffer = "";
  let pageFrom = 0;
  let pageTo = 0;

  const flush = () => {
    const text = buffer.trim();
    if (text.length === 0) return;
    chunks.push({
      chunkIndex: chunks.length,
      pageFrom,
      pageTo,
      heading: detectHeading(text),
      text,
      tokenCount: estimateTokens(text),
    });
    // The overlap keeps a pronoun or a reference at a chunk boundary readable,
    // but is dropped when it would be most of the next chunk.
    buffer = overlapChars > 0 && text.length > overlapChars ? `${text.slice(-overlapChars)}\n\n` : "";
    pageFrom = 0;
  };

  for (const paragraph of paragraphs) {
    for (const part of splitLongParagraph(paragraph.text, maxChars)) {
      if (buffer.trim().length > 0 && buffer.length + part.length > targetChars) flush();
      if (pageFrom === 0) pageFrom = paragraph.page;
      pageTo = paragraph.page;
      buffer += (buffer.length > 0 && !buffer.endsWith("\n\n") ? "\n\n" : "") + part;
      if (buffer.length >= maxChars) flush();
    }
  }
  flush();

  // The trailing overlap can leave a final chunk that is only repeated text.
  return chunks.filter((chunk, index) => index === 0 || chunk.text.length > overlapChars);
}
