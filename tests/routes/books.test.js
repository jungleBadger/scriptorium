// Integration tests for book routes — uses Fastify inject, repo is mocked.

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";

vi.mock("../../server/services/booksRepo.js", () => ({
  getBooks: vi.fn(),
}));

import bookRoutes from "../../server/routes/books.js";
import { getBooks } from "../../server/services/booksRepo.js";

let app;

beforeAll(async () => {
  app = Fastify();
  await app.register(bookRoutes);
  await app.ready();
});

afterAll(() => app.close());

describe("GET /api/books", () => {
  it("returns books with total count", async () => {
    const fakeBooks = [
      { book_id: "GEN", name: "Genesis", chapters: 50, testament: "OT" },
      { book_id: "EXO", name: "Exodus", chapters: 40, testament: "OT" },
    ];
    getBooks.mockResolvedValueOnce(fakeBooks);

    const res = await app.inject({ method: "GET", url: "/api/books" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.books).toEqual(fakeBooks);
    expect(getBooks).toHaveBeenCalledWith("WEBU");
  });

  it("passes translation query param to repo", async () => {
    getBooks.mockResolvedValueOnce([]);

    await app.inject({ method: "GET", url: "/api/books?translation=KJV" });

    expect(getBooks).toHaveBeenCalledWith("KJV");
  });
});
