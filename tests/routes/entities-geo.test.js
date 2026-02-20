// Integration tests for geo entities + enhanced entity detail.

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";

vi.mock("../../server/services/entitiesRepo.js", () => ({
  searchEntities: vi.fn(),
  getEntityById: vi.fn(),
  getEntitiesByVerse: vi.fn(),
  getGeoEntities: vi.fn(),
}));

import entityRoutes from "../../server/routes/entities.js";
import {
  getGeoEntities,
  getEntityById,
} from "../../server/services/entitiesRepo.js";

let app;

beforeAll(async () => {
  app = Fastify();
  await app.register(entityRoutes);
  await app.ready();
});

afterAll(() => app.close());

// ── GET /api/entities/geo ───────────────────────────────────────

describe("GET /api/entities/geo", () => {
  it("returns geo entities", async () => {
    const fakeResults = [
      { id: 1, canonical_name: "Jerusalem", type: "place.settlement", lon: 35.23, lat: 31.78 },
    ];
    getGeoEntities.mockResolvedValueOnce({ total: 1, results: fakeResults });

    const res = await app.inject({ method: "GET", url: "/api/entities/geo" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.limit).toBe(1000);
    expect(body.offset).toBe(0);
    expect(body.has_more).toBe(false);
    expect(body.results).toEqual(fakeResults);
    expect(getGeoEntities).toHaveBeenCalledWith({
      type: undefined,
      minLon: undefined,
      maxLon: undefined,
      minLat: undefined,
      maxLat: undefined,
      limit: 1000,
      offset: 0,
    });
  });

  it("passes type and bbox filters to repo", async () => {
    getGeoEntities.mockResolvedValueOnce({ total: 0, results: [] });

    await app.inject({
      method: "GET",
      url: "/api/entities/geo?type=place.settlement&minLon=35&maxLon=36&minLat=31&maxLat=32&limit=50&offset=10",
    });

    expect(getGeoEntities).toHaveBeenCalledWith({
      type: "place.settlement",
      minLon: 35,
      maxLon: 36,
      minLat: 31,
      maxLat: 32,
      limit: 50,
      offset: 10,
    });
  });

  it("returns 400 when bbox is incomplete", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/entities/geo?minLon=35&maxLon=36",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Bounding-box filter requires");
  });
});

// ── GET /api/entities/:id (enhanced with related) ───────────────

describe("GET /api/entities/:id (related entities)", () => {
  it("returns entity with resolved related entities", async () => {
    const fakeEntity = {
      id: 1,
      canonical_name: "Jerusalem",
      type: "place.settlement",
      metadata: { llm_enrichment: { related_entities: [42, 43] } },
      verses: [],
      related: [
        { id: 42, canonical_name: "Bethlehem", type: "place.settlement" },
        { id: 43, canonical_name: "Judah", type: "place.region" },
      ],
    };
    getEntityById.mockResolvedValueOnce(fakeEntity);

    const res = await app.inject({ method: "GET", url: "/api/entities/1" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.related).toHaveLength(2);
    expect(body.related[0].canonical_name).toBe("Bethlehem");
  });
});
