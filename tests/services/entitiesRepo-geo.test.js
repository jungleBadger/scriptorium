// Unit tests for entitiesRepo geo + related entities — pool is mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("../../server/services/pool.js", () => ({
  getPool: () => ({ query: mockQuery }),
}));

const { getGeoEntities, getEntityById } = await import(
  "../../server/services/entitiesRepo.js"
);

beforeEach(() => mockQuery.mockReset());

// ── getGeoEntities ──────────────────────────────────────────────

describe("getGeoEntities", () => {
  it("queries entities with coordinates", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getGeoEntities();

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("lon IS NOT NULL");
    expect(sql).toContain("lat IS NOT NULL");
    expect(params).toEqual([]);
  });

  it("adds type filter when provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getGeoEntities({ type: "place.settlement" });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("ILIKE $1");
    expect(params).toEqual(["place.settlement%"]);
  });

  it("returns rows from query", async () => {
    const fakeRows = [
      { id: 1, canonical_name: "Jerusalem", type: "place.settlement", lon: 35.23, lat: 31.78 },
    ];
    mockQuery.mockResolvedValueOnce({ rows: fakeRows });

    const result = await getGeoEntities();
    expect(result).toEqual(fakeRows);
  });
});

// ── getEntityById (related entities) ────────────────────────────

describe("getEntityById with related entities", () => {
  it("resolves related entity IDs from llm_enrichment", async () => {
    const entityRow = {
      id: 1,
      canonical_name: "Jerusalem",
      type: "place.settlement",
      metadata: { llm_enrichment: { related_entities: [42, 43] } },
      aliases: ["Jerusalem"],
    };
    const verseRows = [{ book_id: "GEN", chapter: 14, verse: 18 }];
    const relatedRows = [
      { id: 42, canonical_name: "Bethlehem", type: "place.settlement" },
      { id: 43, canonical_name: "Judah", type: "place.region" },
    ];

    mockQuery
      .mockResolvedValueOnce({ rows: [entityRow] })
      .mockResolvedValueOnce({ rows: verseRows })
      .mockResolvedValueOnce({ rows: relatedRows });

    const result = await getEntityById(1);

    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(result.related).toEqual(relatedRows);

    // Verify the ANY($1::int[]) query
    const [sql, params] = mockQuery.mock.calls[2];
    expect(sql).toContain("ANY($1::int[])");
    expect(params).toEqual([[42, 43]]);
  });

  it("returns empty related array when no llm_enrichment", async () => {
    const entityRow = {
      id: 2,
      canonical_name: "Adam",
      type: "person",
      metadata: {},
      aliases: ["Adam"],
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [entityRow] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getEntityById(2);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(result.related).toEqual([]);
  });
});
