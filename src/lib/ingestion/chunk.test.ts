import { describe, expect, it } from "vitest";
import { chunkPages, estimateTokens, type ExtractedPage } from "./chunk";

const page = (pageNumber: number, text: string): ExtractedPage => ({ pageNumber, text });

describe("chunkPages", () => {
  it("keeps a short document as a single chunk citing one page", () => {
    const chunks = chunkPages([page(1, "Un avis court.\n\nDeux paragraphes seulement.")]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].pageFrom).toBe(1);
    expect(chunks[0].pageTo).toBe(1);
  });

  it("records the full page range when a chunk spans a page break", () => {
    const chunks = chunkPages(
      [page(4, "A".repeat(900)), page(5, "B".repeat(400))],
      { targetChars: 2000, overlapChars: 0 },
    );
    expect(chunks[0].pageFrom).toBe(4);
    expect(chunks[0].pageTo).toBe(5);
  });

  it("splits on paragraph boundaries rather than mid-sentence", () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) => `Paragraphe ${i} qui contient du texte.`);
    const chunks = chunkPages([page(1, paragraphs.join("\n\n"))], { targetChars: 80, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.text).toMatch(/\.$/);
  });

  it("hard-splits a paragraph that exceeds the ceiling", () => {
    const chunks = chunkPages([page(1, "x".repeat(5000))], { targetChars: 1000, maxChars: 1200, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(1200);
  });

  it("numbers chunks consecutively from zero", () => {
    const chunks = chunkPages(
      [page(1, Array.from({ length: 10 }, (_, i) => `Bloc ${i}.`).join("\n\n"))],
      { targetChars: 30, overlapChars: 0 },
    );
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it("detects a numbered or shouted heading and ignores prose", () => {
    const [withHeading] = chunkPages([page(1, "SECTION A\n\nDu texte ensuite.")], { overlapChars: 0 });
    expect(withHeading.heading).toBe("SECTION A");
    const [withoutHeading] = chunkPages([page(1, "Une phrase ordinaire qui se termine ainsi.")], { overlapChars: 0 });
    expect(withoutHeading.heading).toBeNull();
  });

  it("ignores blank pages", () => {
    const chunks = chunkPages([page(1, "   \n\n  "), page(2, "Du contenu réel.")], { overlapChars: 0 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].pageFrom).toBe(2);
  });

  it("estimates tokens as a positive number", () => {
    expect(estimateTokens("bonjour")).toBeGreaterThan(0);
    expect(estimateTokens("a".repeat(380))).toBeGreaterThan(90);
  });
});
