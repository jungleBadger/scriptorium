// Unit tests for entitiesRepo — pool is mocked, no real DB needed.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pool.js before importing the repo
const mockQuery = vi.fn();
vi.mock("../../server/services/pool.js", () => ({
  getPool: () => ({ query: mockQuery }),
}));

const { searchEntities, getEntityById, getEntitiesByVerse } = await import(
  "../../server/services/entitiesRepo.js"
);

beforeEach(() => mockQuery.mockReset());

// ── searchEntities ──────────────────────────────────────────────

describe("searchEntities", () => {
  it("passes ILIKE prefix and default limit/offset", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await searchEntities("Jeru");

    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(["Jeru%", 20, 0]);
    expect(sql).toContain("ILIKE $1");
    expect(sql).not.toContain("$4"); // no type filter
  });

  it("adds type filter when type is provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await searchEntities("Ab", { type: "person", limit: 5, offset: 10 });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(["Ab%", 5, 10, "person%"]);
    expect(sql).toContain("ILIKE $4");
  });

  it("returns rows from the query", async () => {
    const fakeRows = [
      { id: 1, canonical_name: "Jerusalem", aliases: ["Jerusalem", "Jebus"] },
    ];
    mockQuery.mockResolvedValueOnce({ rows: fakeRows });

    const result = await searchEntities("Jeru");
    expect(result).toEqual(fakeRows);
  });
});

// ── getEntityById ───────────────────────────────────────────────

describe("getEntityById", () => {
  it("runs two parallel queries and merges verses", async () => {
    const entityRow = {
      id: 42,
      canonical_name: "Jordan",
      type: "place.river",
      aliases: ["Jordan", "Yarden"],
    };
    const verseRows = [
      { book_id: "GEN", chapter: 13, verse: 10 },
      { book_id: "JOS", chapter: 3, verse: 17 },
    ];

    mockQuery
      .mockResolvedValueOnce({ rows: [entityRow] })
      .mockResolvedValueOnce({ rows: verseRows });

    const result = await getEntityById(42);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ...entityRow, verses: verseRows });
  });

  it("returns null when entity does not exist", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getEntityById(99999);
    expect(result).toBeNull();
  });
});

// ── getEntitiesByVerse ──────────────────────────────────────────

describe("getEntitiesByVerse", () => {
  it("passes bookId, chapter, verse as params", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getEntitiesByVerse("GEN", 1, 1);

    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(["GEN", 1, 1]);
  });

  it("returns matching entities", async () => {
    const fakeRows = [{ id: 5, canonical_name: "Eden", type: "place" }];
    mockQuery.mockResolvedValueOnce({ rows: fakeRows });

    const result = await getEntitiesByVerse("GEN", 2, 8);
    expect(result).toEqual(fakeRows);
  });
});
