// Integration tests for entity routes — uses Fastify inject, repo is mocked.

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";

// Mock the repo module so no DB is needed
vi.mock("../../server/services/entitiesRepo.js", () => ({
  searchEntities: vi.fn(),
  getEntityById: vi.fn(),
  getEntitiesByVerse: vi.fn(),
  getGeoEntities: vi.fn(),
}));

import entityRoutes from "../../server/routes/entities.js";
import {
  searchEntities,
  getEntityById,
  getEntitiesByVerse,
} from "../../server/services/entitiesRepo.js";

let app;

beforeAll(async () => {
  app = Fastify();
  await app.register(entityRoutes);
  await app.ready();
});

afterAll(() => app.close());

// ── GET /api/entities ───────────────────────────────────────────

describe("GET /api/entities", () => {
  it("returns search results", async () => {
    const fakeResults = [
      { id: 1, canonical_name: "Jerusalem", aliases: ["Jerusalem"] },
    ];
    searchEntities.mockResolvedValueOnce({ total: 1, results: fakeResults });

    const res = await app.inject({
      method: "GET",
      url: "/api/entities?q=Jeru",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.query).toBe("Jeru");
    expect(body.total).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
    expect(body.has_more).toBe(false);
    expect(body.results).toEqual(fakeResults);
    expect(searchEntities).toHaveBeenCalledWith("Jeru", {
      type: undefined,
      limit: 20,
      offset: 0,
    });
  });

  it("passes type, limit, offset to repo", async () => {
    searchEntities.mockResolvedValueOnce({ total: 0, results: [] });

    await app.inject({
      method: "GET",
      url: "/api/entities?q=Ab&type=person&limit=5&offset=10",
    });

    expect(searchEntities).toHaveBeenCalledWith("Ab", {
      type: "person",
      limit: 5,
      offset: 10,
    });
  });

  it("returns 400 when q is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/entities",
    });

    expect(res.statusCode).toBe(400);
  });
});

// ── GET /api/entities/:id ───────────────────────────────────────

describe("GET /api/entities/:id", () => {
  it("returns entity detail", async () => {
    const fakeEntity = {
      id: 42,
      canonical_name: "Jordan",
      type: "place.river",
      aliases: ["Jordan"],
      verses: [{ book_id: "GEN", chapter: 13, verse: 10 }],
    };
    getEntityById.mockResolvedValueOnce(fakeEntity);

    const res = await app.inject({
      method: "GET",
      url: "/api/entities/42",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(fakeEntity);
  });

  it("returns 404 for unknown entity", async () => {
    getEntityById.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "GET",
      url: "/api/entities/99999",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Entity not found");
  });
});

// ── GET /api/entities/by-verse/:bookId/:chapter/:verse ──────────

describe("GET /api/entities/by-verse/:bookId/:chapter/:verse", () => {
  it("returns entities for a verse", async () => {
    const fakeResults = [
      { id: 5, canonical_name: "Eden", type: "place", aliases: ["Eden"] },
    ];
    getEntitiesByVerse.mockResolvedValueOnce(fakeResults);

    const res = await app.inject({
      method: "GET",
      url: "/api/entities/by-verse/GEN/2/8",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.book_id).toBe("GEN");
    expect(body.chapter).toBe(2);
    expect(body.verse).toBe(8);
    expect(body.total).toBe(1);
    expect(body.results).toEqual(fakeResults);
  });

  it("returns empty array when no entities match", async () => {
    getEntitiesByVerse.mockResolvedValueOnce([]);

    const res = await app.inject({
      method: "GET",
      url: "/api/entities/by-verse/REV/22/21",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
    expect(res.json().results).toEqual([]);
  });
});
