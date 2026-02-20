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
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    await getGeoEntities();

    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("lon IS NOT NULL");
    expect(sql).toContain("lat IS NOT NULL");
    expect(sql).toContain("LIMIT $1 OFFSET $2");
    expect(params).toEqual([1000, 0]);
  });

  it("adds type and bbox filters when provided", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    await getGeoEntities({
      type: "place.settlement",
      minLon: 35,
      maxLon: 36,
      minLat: 31,
      maxLat: 32,
      limit: 50,
      offset: 10,
    });

    const [countSql, countParams] = mockQuery.mock.calls[0];
    const [dataSql, dataParams] = mockQuery.mock.calls[1];
    expect(countSql).toContain("type ILIKE $1");
    expect(dataSql).toContain("lon BETWEEN $2 AND $3");
    expect(dataSql).toContain("lat BETWEEN $4 AND $5");
    expect(countParams).toEqual(["place.settlement%", 35, 36, 31, 32]);
    expect(dataParams).toEqual(["place.settlement%", 35, 36, 31, 32, 50, 10]);
  });

  it("returns rows from query", async () => {
    const fakeRows = [
      { id: 1, canonical_name: "Jerusalem", type: "place.settlement", lon: 35.23, lat: 31.78 },
    ];
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: fakeRows });

    const result = await getGeoEntities();
    expect(result).toEqual({ total: 1, results: fakeRows });
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
