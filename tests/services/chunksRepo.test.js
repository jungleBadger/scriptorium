// Unit tests for chunksRepo — pool is mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("../../server/services/pool.js", () => ({
  getPool: () => ({ query: mockQuery }),
}));

const { fetchChunksByIds, trigramSimilarity } = await import(
  "../../server/services/chunksRepo.js"
);

beforeEach(() => mockQuery.mockReset());

// ── fetchChunksByIds ────────────────────────────────────────────

describe("fetchChunksByIds", () => {
  it("returns empty array for empty input", async () => {
    const result = await fetchChunksByIds([]);
    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("queries with array_position ordering", async () => {
    const fakeRows = [
      { chunk_id: "a", text_clean: "In the beginning" },
      { chunk_id: "b", text_clean: "God created" },
    ];
    mockQuery.mockResolvedValueOnce({ rows: fakeRows });

    const result = await fetchChunksByIds(["a", "b"]);

    expect(result).toEqual(fakeRows);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([["a", "b"]]);
    expect(sql).toContain("array_position");
    expect(sql).toContain("ANY($1::text[])");
  });
});

// ── trigramSimilarity ───────────────────────────────────────────

describe("trigramSimilarity", () => {
  it("returns empty Map for empty input", async () => {
    const result = await trigramSimilarity([], "test");
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns a Map of chunk_id -> similarity", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { chunk_id: "a", sim: "0.85" },
        { chunk_id: "b", sim: "0.42" },
      ],
    });

    const result = await trigramSimilarity(["a", "b"], "love");

    expect(result).toBeInstanceOf(Map);
    expect(result.get("a")).toBe(0.85);
    expect(result.get("b")).toBe(0.42);
  });

  it("returns empty Map when pg_trgm is unavailable", async () => {
    mockQuery.mockRejectedValueOnce(new Error("function similarity does not exist"));

    const result = await trigramSimilarity(["a"], "love");
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });
});
