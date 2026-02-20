// Unit tests for askService relevant passage retrieval behavior.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/services/entitiesRepo.js", () => ({
  searchEntities: vi.fn(),
}));
vi.mock("../../server/services/embedder.js", () => ({
  embedQuery: vi.fn(),
}));
vi.mock("../../server/services/vectorSearch.js", () => ({
  searchChunks: vi.fn(),
}));
vi.mock("../../server/services/chunksRepo.js", () => ({
  fetchChunksByIds: vi.fn(),
}));
vi.mock("../../server/services/rerank.js", () => ({
  rerank: vi.fn(),
}));
vi.mock("../../server/services/ollamaClient.js", () => ({
  generateOllamaText: vi.fn(),
}));
vi.mock("../../server/services/versesRepo.js", () => ({
  getVerseRange: vi.fn(),
}));
vi.mock("../../server/services/pool.js", () => ({
  getPool: () => ({ query: vi.fn() }),
}));

const { buildAskPrompt, retrieveRelevantPassages } = await import("../../server/services/askService.js");
const { embedQuery } = await import("../../server/services/embedder.js");
const { searchChunks } = await import("../../server/services/vectorSearch.js");
const { fetchChunksByIds } = await import("../../server/services/chunksRepo.js");
const { rerank } = await import("../../server/services/rerank.js");
const { getVerseRange } = await import("../../server/services/versesRepo.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("retrieveRelevantPassages", () => {
  it("always includes the current anchor verse when available", async () => {
    getVerseRange.mockResolvedValueOnce([
      { verse: 1, text: "In the beginning God created the heavens and the earth." },
    ]);
    embedQuery.mockResolvedValueOnce([0.1, 0.2, 0.3]);
    searchChunks.mockResolvedValueOnce([]);

    const passages = await retrieveRelevantPassages({
      question: "what does this prove?",
      translation: "WEBU",
      book: "GEN",
      chapter: 1,
      verse: 1,
      kPassages: 5,
    });

    expect(passages.length).toBe(1);
    expect(passages[0]).toEqual(
      expect.objectContaining({
        ref: "GEN 1:1",
        source: "verse",
        snippet: "In the beginning God created the heavens and the earth.",
        book_id: "GEN",
        chapter: 1,
        verse_start: 1,
        verse_end: 1,
      })
    );
  });

  it("dedupes vector results that overlap the anchor verse range", async () => {
    getVerseRange.mockResolvedValueOnce([{ verse: 1, text: "Anchor verse text" }]);
    embedQuery.mockResolvedValueOnce([0.1, 0.2, 0.3]);
    searchChunks.mockResolvedValueOnce([
      { chunk_id: "c1", translation: "WEBU", book_id: "GEN", chapter: 1, verse_start: 1, verse_end: 1, ref_start: "GEN 1:1", ref_end: "GEN 1:1", score: 0.9 },
      { chunk_id: "c2", translation: "WEBU", book_id: "GEN", chapter: 1, verse_start: 2, verse_end: 3, ref_start: "GEN 1:2", ref_end: "GEN 1:3", score: 0.8 },
    ]);
    fetchChunksByIds.mockResolvedValueOnce([
      { chunk_id: "c1", text_clean: "Anchor verse from chunks" },
      { chunk_id: "c2", text_clean: "Another passage" },
    ]);
    rerank.mockReturnValueOnce([
      {
        chunk_id: "c1",
        translation: "WEBU",
        book_id: "GEN",
        chapter: 1,
        verse_start: 1,
        verse_end: 1,
        ref_start: "GEN 1:1",
        ref_end: "GEN 1:1",
        final_score: 0.99,
        text_clean: "Anchor verse from chunks",
      },
      {
        chunk_id: "c2",
        translation: "WEBU",
        book_id: "GEN",
        chapter: 1,
        verse_start: 2,
        verse_end: 3,
        ref_start: "GEN 1:2",
        ref_end: "GEN 1:3",
        final_score: 0.77,
        text_clean: "Another passage",
      },
    ]);

    const passages = await retrieveRelevantPassages({
      question: "tell me about creation",
      translation: "WEBU",
      book: "GEN",
      chapter: 1,
      verse: 1,
      kPassages: 2,
    });

    expect(passages).toHaveLength(2);
    expect(passages[0].ref).toBe("GEN 1:1");
    expect(passages[1].ref).toBe("GEN 1:2 - GEN 1:3");
  });

  it("caps returned passages to 3 max for UI payload", async () => {
    getVerseRange.mockResolvedValueOnce([]);
    embedQuery.mockResolvedValueOnce([0.1, 0.2, 0.3]);
    searchChunks.mockResolvedValueOnce([
      { chunk_id: "c1", translation: "WEBU", book_id: "GEN", chapter: 1, verse_start: 1, verse_end: 1, ref_start: "GEN 1:1", ref_end: "GEN 1:1", score: 0.95 },
      { chunk_id: "c2", translation: "WEBU", book_id: "GEN", chapter: 1, verse_start: 2, verse_end: 2, ref_start: "GEN 1:2", ref_end: "GEN 1:2", score: 0.94 },
      { chunk_id: "c3", translation: "WEBU", book_id: "GEN", chapter: 1, verse_start: 3, verse_end: 3, ref_start: "GEN 1:3", ref_end: "GEN 1:3", score: 0.93 },
      { chunk_id: "c4", translation: "WEBU", book_id: "GEN", chapter: 1, verse_start: 4, verse_end: 4, ref_start: "GEN 1:4", ref_end: "GEN 1:4", score: 0.92 },
    ]);
    fetchChunksByIds.mockResolvedValueOnce([
      { chunk_id: "c1", text_clean: "p1" },
      { chunk_id: "c2", text_clean: "p2" },
      { chunk_id: "c3", text_clean: "p3" },
      { chunk_id: "c4", text_clean: "p4" },
    ]);
    rerank.mockReturnValueOnce([
      { chunk_id: "c1", translation: "WEBU", book_id: "GEN", chapter: 1, verse_start: 1, verse_end: 1, ref_start: "GEN 1:1", ref_end: "GEN 1:1", final_score: 0.95, text_clean: "p1" },
      { chunk_id: "c2", translation: "WEBU", book_id: "GEN", chapter: 1, verse_start: 2, verse_end: 2, ref_start: "GEN 1:2", ref_end: "GEN 1:2", final_score: 0.94, text_clean: "p2" },
      { chunk_id: "c3", translation: "WEBU", book_id: "GEN", chapter: 1, verse_start: 3, verse_end: 3, ref_start: "GEN 1:3", ref_end: "GEN 1:3", final_score: 0.93, text_clean: "p3" },
      { chunk_id: "c4", translation: "WEBU", book_id: "GEN", chapter: 1, verse_start: 4, verse_end: 4, ref_start: "GEN 1:4", ref_end: "GEN 1:4", final_score: 0.92, text_clean: "p4" },
    ]);

    const passages = await retrieveRelevantPassages({
      question: "creation",
      translation: "WEBU",
      book: "GEN",
      chapter: 1,
      verse: 1,
      kPassages: 10,
    });

    expect(passages).toHaveLength(3);
    expect(passages.map((p) => p.ref)).toEqual(["GEN 1:1", "GEN 1:2", "GEN 1:3"]);
  });
});

describe("buildAskPrompt", () => {
  it("treats selected verse as optional context and allows broader questions", () => {
    const prompt = buildAskPrompt({
      question: "Why did Cain kill Abel?",
      translation: "WEBU",
      book: "GEN",
      chapter: 1,
      verse: 1,
      anchorPassage: {
        ref: "GEN 1:1",
        snippet: "In the beginning God created the heavens and the earth.",
      },
    });

    expect(prompt).toContain("optional context");
    expect(prompt).toContain("may ask about any biblical topic");
    expect(prompt).toContain("Output plain text only.");
    expect(prompt).toContain("Do not use Markdown formatting");
    expect(prompt).toContain("GEN 1:1");
    expect(prompt).toContain("Why did Cain kill Abel?");
    expect(prompt).not.toContain("[CONTEXT_ENTITIES]");
    expect(prompt).not.toContain("[CONTEXT_PASSAGES]");
  });
});
