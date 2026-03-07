// server/tests/routes.entities.test.js
// HTTP-level tests for entity routes — entitiesRepo is fully mocked.

import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";

vi.mock("../services/entitiesRepo.js", () => ({
  searchEntities: vi.fn(),
  getEntityById: vi.fn(),
  getEntitiesByVerse: vi.fn(),
  getGeoEntities: vi.fn(),
}));

const { searchEntities, getEntityById, getEntitiesByVerse, getGeoEntities } =
  await import("../services/entitiesRepo.js");
const entityRoutes = (await import("../routes/entities.js")).default;

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { max: 1000, timeWindow: "1 minute" });
  await app.register(entityRoutes);
  return app;
}

describe("GET /api/entities", () => {
  it("returns search results with pagination metadata", async () => {
    searchEntities.mockResolvedValueOnce({ total: 1, results: [{ id: 1, name: "Moses" }] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/entities?q=Moses" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.query).toBe("Moses");
    expect(body.total).toBe(1);
    expect(body.results).toHaveLength(1);
    expect(body.has_more).toBe(false);
  });

  it("returns 400 when required param q is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/entities" });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/entities/by-verse/:bookId/:chapter/:verse", () => {
  it("returns entities for the given verse", async () => {
    getEntitiesByVerse.mockResolvedValueOnce([{ id: 1, name: "Moses" }]);

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/entities/by-verse/EXO/3/1" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.book_id).toBe("EXO");
    expect(body.chapter).toBe(3);
    expect(body.verse).toBe(1);
    expect(body.total).toBe(1);
  });
});

describe("GET /api/entities/:id", () => {
  it("returns the entity when found", async () => {
    getEntityById.mockResolvedValueOnce({ id: 1, name: "Moses", type: "person" });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/entities/1" });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).name).toBe("Moses");
  });

  it("returns 404 with ENTITY_NOT_FOUND when entity does not exist", async () => {
    getEntityById.mockResolvedValueOnce(null);

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/entities/9999" });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe("ENTITY_NOT_FOUND");
  });
});

describe("GET /api/entities/geo", () => {
  it("returns geo entities on success", async () => {
    getGeoEntities.mockResolvedValueOnce({ total: 2, results: [{ id: 1 }, { id: 2 }] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/entities/geo" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(2);
  });

  it("returns 400 when only some bounding-box params are provided", async () => {
    const app = await buildApp();
    // minLon provided but maxLon, minLat, maxLat omitted
    const res = await app.inject({ method: "GET", url: "/api/entities/geo?minLon=30" });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when bounding-box values are inverted (minLon > maxLon)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/entities/geo?minLon=50&maxLon=10&minLat=10&maxLat=50",
    });

    expect(res.statusCode).toBe(400);
  });
});
