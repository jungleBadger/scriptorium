// server/tests/routes.books.test.js
// HTTP-level tests for GET /api/books — booksRepo is fully mocked.

import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";

vi.mock("../services/booksRepo.js", () => ({
  getBooks: vi.fn(),
}));

const { getBooks } = await import("../services/booksRepo.js");
const bookRoutes = (await import("../routes/books.js")).default;

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { max: 1000, timeWindow: "1 minute" });
  await app.register(bookRoutes);
  return app;
}

describe("GET /api/books", () => {
  it("returns total and books array on success", async () => {
    const books = [{ book_id: "GEN", name: "Genesis" }, { book_id: "EXO", name: "Exodus" }];
    getBooks.mockResolvedValueOnce(books);

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/books?translation=WEBU" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(2);
    expect(body.books).toEqual(books);
  });

  it("passes the translation query param to the repo", async () => {
    getBooks.mockResolvedValueOnce([]);

    const app = await buildApp();
    await app.inject({ method: "GET", url: "/api/books?translation=PT1911" });

    expect(getBooks).toHaveBeenCalledWith("PT1911");
  });

  it("returns 500 with BOOKS_ERROR on repo failure", async () => {
    getBooks.mockRejectedValueOnce(new Error("DB down"));

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/books" });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("BOOKS_ERROR");
    expect(body.retryable).toBe(true);
  });

  it("does not include Access-Control-Allow-Origin header (CORS disabled)", async () => {
    getBooks.mockResolvedValueOnce([]);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/books",
      headers: { Origin: "http://evil.example.com" },
    });

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
