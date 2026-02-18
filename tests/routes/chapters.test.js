// Integration tests for chapter routes — uses Fastify inject, repos are mocked.

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";

vi.mock("../../server/services/versesRepo.js", () => ({
  getChapter: vi.fn(),
  getVerseRange: vi.fn(),
  getMaxChapter: vi.fn(),
  computeNav: vi.fn(),
}));

import chapterRoutes from "../../server/routes/chapters.js";
import {
  getChapter,
  getVerseRange,
  getMaxChapter,
  computeNav,
} from "../../server/services/versesRepo.js";

let app;

beforeAll(async () => {
  app = Fastify();
  await app.register(chapterRoutes);
  await app.ready();
});

afterAll(() => app.close());

// ── GET /api/chapters/:bookId/:chapter ──────────────────────────

describe("GET /api/chapters/:bookId/:chapter", () => {
  it("returns chapter with verses and navigation", async () => {
    const fakeVerses = [
      { verse: 1, text: "In the beginning..." },
      { verse: 2, text: "The earth was formless..." },
    ];
    getChapter.mockResolvedValueOnce(fakeVerses);
    getMaxChapter.mockResolvedValueOnce(50);
    computeNav.mockReturnValueOnce({
      prev: null,
      next: { book_id: "GEN", chapter: 2 },
    });

    const res = await app.inject({ method: "GET", url: "/api/chapters/GEN/1" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.book_id).toBe("GEN");
    expect(body.chapter).toBe(1);
    expect(body.translation).toBe("WEBU");
    expect(body.verses).toEqual(fakeVerses);
    expect(body.prev).toBeNull();
    expect(body.next).toEqual({ book_id: "GEN", chapter: 2 });
  });

  it("returns 404 for nonexistent chapter", async () => {
    getChapter.mockResolvedValueOnce([]);
    getMaxChapter.mockResolvedValueOnce(50);

    const res = await app.inject({ method: "GET", url: "/api/chapters/GEN/999" });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Chapter not found");
  });

  it("passes translation query param", async () => {
    getChapter.mockResolvedValueOnce([{ verse: 1, text: "test" }]);
    getMaxChapter.mockResolvedValueOnce(1);
    computeNav.mockReturnValueOnce({ prev: null, next: null });

    const res = await app.inject({
      method: "GET",
      url: "/api/chapters/GEN/1?translation=KJV",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().translation).toBe("KJV");
    expect(getChapter).toHaveBeenCalledWith("KJV", "GEN", 1);
  });
});

// ── GET /api/verses/:bookId/:chapter/:startVerse/:endVerse ──────

describe("GET /api/verses/:bookId/:chapter/:startVerse/:endVerse", () => {
  it("returns verse range", async () => {
    const fakeVerses = [
      { verse: 1, text: "In the beginning..." },
      { verse: 2, text: "The earth was formless..." },
      { verse: 3, text: "God said..." },
    ];
    getVerseRange.mockResolvedValueOnce(fakeVerses);

    const res = await app.inject({
      method: "GET",
      url: "/api/verses/GEN/1/1/3",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.book_id).toBe("GEN");
    expect(body.chapter).toBe(1);
    expect(body.translation).toBe("WEBU");
    expect(body.verses).toEqual(fakeVerses);
  });

  it("returns 404 when no verses found", async () => {
    getVerseRange.mockResolvedValueOnce([]);

    const res = await app.inject({
      method: "GET",
      url: "/api/verses/GEN/1/999/1000",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Verses not found");
  });
});
