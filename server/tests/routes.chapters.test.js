// server/tests/routes.chapters.test.js
// HTTP-level tests for GET /api/chapters/:bookId/:chapter and /context — repos are fully mocked.

import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";

vi.mock("../services/versesRepo.js", () => ({
  getChapter: vi.fn(),
  getVerseRange: vi.fn(),
  getMaxChapter: vi.fn(),
  computeNav: vi.fn(),
}));

vi.mock("../services/chaptersRepo.js", () => ({
  getChapterExplanation: vi.fn(),
  getChapterEntities: vi.fn(),
}));

const { getChapter, getMaxChapter, computeNav } = await import("../services/versesRepo.js");
const { getChapterExplanation, getChapterEntities } = await import("../services/chaptersRepo.js");
const chapterRoutes = (await import("../routes/chapters.js")).default;

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { max: 1000, timeWindow: "1 minute" });
  await app.register(chapterRoutes);
  return app;
}

describe("GET /api/chapters/:bookId/:chapter", () => {
  it("returns verses and nav on success", async () => {
    const verses = [{ verse: 1, text: "In the beginning." }];
    getChapter.mockResolvedValueOnce(verses);
    getMaxChapter.mockResolvedValueOnce(50);
    computeNav.mockReturnValueOnce({ prev: null, next: { book_id: "GEN", chapter: 2 } });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/chapters/GEN/1?translation=WEBU" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.book_id).toBe("GEN");
    expect(body.chapter).toBe(1);
    expect(body.verses).toEqual(verses);
    expect(body.next).toEqual({ book_id: "GEN", chapter: 2 });
  });

  it("returns 404 when no verses are found for the chapter", async () => {
    getChapter.mockResolvedValueOnce([]);
    getMaxChapter.mockResolvedValueOnce(50);

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/chapters/GEN/999?translation=WEBU" });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe("CHAPTER_NOT_FOUND");
  });

  it("returns 500 with CHAPTER_ERROR on repo failure", async () => {
    getChapter.mockRejectedValueOnce(new Error("DB down"));
    getMaxChapter.mockResolvedValueOnce(50);

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/chapters/GEN/1" });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("CHAPTER_ERROR");
    expect(body.retryable).toBe(true);
  });
});

describe("GET /api/chapters/:bookId/:chapter/context", () => {
  it("returns explanation and entities on success", async () => {
    getChapterExplanation.mockResolvedValueOnce("Chapter 1 overview.");
    getChapterEntities.mockResolvedValueOnce([{ id: 1, name: "Adam" }]);

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/chapters/GEN/1/context?translation=WEBU" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.explanation).toBe("Chapter 1 overview.");
    expect(body.entities).toHaveLength(1);
  });

  it("returns 500 with CHAPTER_CONTEXT_ERROR on repo failure", async () => {
    getChapterExplanation.mockRejectedValueOnce(new Error("DB down"));
    getChapterEntities.mockResolvedValueOnce([]);

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/chapters/GEN/1/context" });

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).code).toBe("CHAPTER_CONTEXT_ERROR");
  });
});
