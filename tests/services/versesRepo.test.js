// Unit tests for versesRepo — pool is mocked, no real DB needed.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("../../server/services/pool.js", () => ({
  getPool: () => ({ query: mockQuery }),
}));

const { getChapter, getVerseRange, getMaxChapter, computeNav } = await import(
  "../../server/services/versesRepo.js"
);

beforeEach(() => mockQuery.mockReset());

describe("getChapter", () => {
  it("passes translation, bookId, chapter as params", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getChapter("WEBU", "GEN", 1);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(["WEBU", "GEN", 1]);
    expect(sql).toContain("translation = $1");
    expect(sql).toContain("book_id = $2");
    expect(sql).toContain("chapter = $3");
  });

  it("returns rows from the query", async () => {
    const fakeRows = [
      { verse: 1, text: "In the beginning..." },
      { verse: 2, text: "The earth was formless..." },
    ];
    mockQuery.mockResolvedValueOnce({ rows: fakeRows });

    const result = await getChapter("WEBU", "GEN", 1);
    expect(result).toEqual(fakeRows);
  });
});

describe("getVerseRange", () => {
  it("passes all five params", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getVerseRange("WEBU", "GEN", 1, 1, 3);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(["WEBU", "GEN", 1, 1, 3]);
    expect(sql).toContain("BETWEEN $4 AND $5");
  });
});

describe("getMaxChapter", () => {
  it("returns the max chapter number", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ max_chapter: "50" }] });

    const result = await getMaxChapter("WEBU", "GEN");
    expect(result).toBe(50);
  });

  it("returns null when book not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ max_chapter: null }] });

    const result = await getMaxChapter("WEBU", "XXX");
    expect(result).toBeNull();
  });
});

describe("computeNav", () => {
  it("returns prev and next for a mid-book chapter", () => {
    const { prev, next } = computeNav("GEN", 25, 50);
    expect(prev).toEqual({ book_id: "GEN", chapter: 24 });
    expect(next).toEqual({ book_id: "GEN", chapter: 26 });
  });

  it("returns prev as previous book at chapter 1", () => {
    const { prev } = computeNav("EXO", 1, 40);
    expect(prev).toEqual({ book_id: "GEN", chapter: null });
  });

  it("returns next as next book at last chapter", () => {
    const { next } = computeNav("GEN", 50, 50);
    expect(next).toEqual({ book_id: "EXO", chapter: null });
  });

  it("returns null prev for Genesis chapter 1", () => {
    const { prev } = computeNav("GEN", 1, 50);
    expect(prev).toBeNull();
  });

  it("returns null next for Revelation last chapter", () => {
    const { next } = computeNav("REV", 22, 22);
    expect(next).toBeNull();
  });
});
