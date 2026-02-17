// Unit tests for vectorSearch — pool is mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("../../server/services/pool.js", () => ({
  getPool: () => ({ query: mockQuery }),
}));

const { searchChunks } = await import(
  "../../server/services/vectorSearch.js"
);

beforeEach(() => mockQuery.mockReset());

describe("searchChunks", () => {
  const fakeVector = [0.1, 0.2, 0.3];

  it("queries without translation filter by default", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await searchChunks(fakeVector, 10);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([JSON.stringify(fakeVector), 10]);
    expect(sql).not.toContain("ANY($3::text[])");
  });

  it("adds translation filter when provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await searchChunks(fakeVector, 10, ["WEBU", "PT1911"]);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([JSON.stringify(fakeVector), 10, ["WEBU", "PT1911"]]);
    expect(sql).toContain("ANY($3::text[])");
  });

  it("does not filter when translations is empty array", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await searchChunks(fakeVector, 10, []);

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain("ANY($3::text[])");
  });

  it("uses default limit of 30", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await searchChunks(fakeVector);

    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe(30);
  });

  it("returns rows from the query", async () => {
    const fakeRows = [
      { chunk_id: "c1", score: 0.95, book_id: "GEN" },
    ];
    mockQuery.mockResolvedValueOnce({ rows: fakeRows });

    const result = await searchChunks(fakeVector, 5);
    expect(result).toEqual(fakeRows);
  });
});
