// Integration tests for search route — all services mocked.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";

// Mock all service dependencies
vi.mock("../../server/services/embedder.js", () => ({
  embedQuery: vi.fn(),
}));
vi.mock("../../server/services/vectorSearch.js", () => ({
  searchChunks: vi.fn(),
}));
vi.mock("../../server/services/chunksRepo.js", () => ({
  fetchChunksByIds: vi.fn(),
  trigramSimilarity: vi.fn(),
}));

import searchRoutes from "../../server/routes/search.js";
import { embedQuery } from "../../server/services/embedder.js";
import { searchChunks } from "../../server/services/vectorSearch.js";
import { fetchChunksByIds, trigramSimilarity } from "../../server/services/chunksRepo.js";

let app;

beforeAll(async () => {
  app = Fastify();
  await app.register(searchRoutes);
  await app.ready();
});

afterAll(() => app.close());

beforeEach(() => {
  vi.clearAllMocks();
});

// Helper to set up the full happy-path mock chain
function setupMocks({ candidates = [], chunks = [], trigramMap = new Map() } = {}) {
  embedQuery.mockResolvedValue([0.1, 0.2, 0.3]);
  searchChunks.mockResolvedValue(candidates);
  fetchChunksByIds.mockResolvedValue(chunks);
  trigramSimilarity.mockResolvedValue(trigramMap);
}

function makeCandidate(id, bookId = "GEN") {
  return {
    chunk_id: id,
    translation: "WEBU",
    book_id: bookId,
    chapter: 1,
    verse_start: 1,
    verse_end: 5,
    ref_start: `${bookId} 1:1`,
    ref_end: `${bookId} 1:5`,
    score: 0.9,
  };
}

describe("POST /api/search", () => {
  it("returns search results for a valid query", async () => {
    const candidate = makeCandidate("c1");
    setupMocks({
      candidates: [candidate],
      chunks: [{ chunk_id: "c1", text_clean: "In the beginning" }],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/search",
      payload: { q: "beginning" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.query).toBe("beginning");
    expect(body.mode).toBe("explorer");
    expect(body.results.length).toBe(1);
    expect(body.results[0].chunk_id).toBe("c1");
  });

  it("returns 400 when q is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/search",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("respects topk parameter", async () => {
    const candidates = Array.from({ length: 5 }, (_, i) => makeCandidate(`c${i}`));
    const chunks = candidates.map((c) => ({ chunk_id: c.chunk_id, text_clean: "some text" }));
    setupMocks({ candidates, chunks });

    const res = await app.inject({
      method: "POST",
      url: "/api/search",
      payload: { q: "test", topk: 2 },
    });

    const body = res.json();
    expect(body.results.length).toBe(2);
  });

  it("filters deuterocanonical books when includeDeutero is false", async () => {
    const candidates = [
      makeCandidate("c1", "GEN"),
      makeCandidate("c2", "TOB"),  // deuterocanonical
    ];
    const chunks = candidates.map((c) => ({ chunk_id: c.chunk_id, text_clean: "text" }));
    setupMocks({ candidates, chunks });

    const res = await app.inject({
      method: "POST",
      url: "/api/search",
      payload: { q: "test", includeDeutero: false },
    });

    const body = res.json();
    expect(body.includeDeutero).toBe(false);
    const bookIds = body.results.map((r) => r.book_id);
    expect(bookIds).not.toContain("TOB");
  });

  it("passes translations filter to searchChunks", async () => {
    setupMocks({ candidates: [], chunks: [] });

    await app.inject({
      method: "POST",
      url: "/api/search",
      payload: { q: "test", translations: ["WEBU"] },
    });

    expect(searchChunks).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Number),
      ["WEBU"]
    );
  });

  it("uses trigram similarity in exact mode", async () => {
    const candidate = makeCandidate("c1");
    setupMocks({
      candidates: [candidate],
      chunks: [{ chunk_id: "c1", text_clean: "love one another" }],
      trigramMap: new Map([["c1", 0.75]]),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/search",
      payload: { q: "love", mode: "exact" },
    });

    expect(res.statusCode).toBe(200);
    expect(trigramSimilarity).toHaveBeenCalled();
    expect(res.json().mode).toBe("exact");
  });

  it("does not call trigramSimilarity in explorer mode", async () => {
    setupMocks({ candidates: [], chunks: [] });

    await app.inject({
      method: "POST",
      url: "/api/search",
      payload: { q: "test", mode: "explorer" },
    });

    expect(trigramSimilarity).not.toHaveBeenCalled();
  });

  it("returns 500 when an internal error occurs", async () => {
    embedQuery.mockRejectedValueOnce(new Error("model failed"));

    const res = await app.inject({
      method: "POST",
      url: "/api/search",
      payload: { q: "test" },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("Search failed");
  });
});
