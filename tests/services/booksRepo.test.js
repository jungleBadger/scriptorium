// Unit tests for booksRepo — pool is mocked, no real DB needed.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("../../server/services/pool.js", () => ({
  getPool: () => ({ query: mockQuery }),
}));

const { getBooks } = await import("../../server/services/booksRepo.js");

beforeEach(() => mockQuery.mockReset());

describe("getBooks", () => {
  it("returns books in canonical order with chapter counts", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { book_id: "EXO", chapters: "40" },
        { book_id: "GEN", chapters: "50" },
        { book_id: "REV", chapters: "22" },
      ],
    });

    const result = await getBooks("WEBU");

    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(["WEBU"]);
    expect(sql).toContain("translation = $1");

    // GEN should come before EXO (canonical order), REV at end
    expect(result[0].book_id).toBe("GEN");
    expect(result[0].chapters).toBe(50);
    expect(result[0].name).toBe("Genesis");
    expect(result[0].testament).toBe("OT");

    expect(result[1].book_id).toBe("EXO");
    expect(result[1].chapters).toBe(40);

    expect(result[2].book_id).toBe("REV");
    expect(result[2].testament).toBe("NT");
  });

  it("omits books not present in the DB", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ book_id: "GEN", chapters: "50" }],
    });

    const result = await getBooks("WEBU");
    expect(result).toHaveLength(1);
    expect(result[0].book_id).toBe("GEN");
  });
});
