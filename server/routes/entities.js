// server/routes/entities.js
// Entity lookup and search endpoints.

import { searchEntities, getEntityById, getEntitiesByVerse, getGeoEntities } from "../services/entitiesRepo.js";

const searchSchema = {
  querystring: {
    type: "object",
    properties: {
      q: { type: "string", maxLength: 200 },
      type: { type: "string", maxLength: 50 },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      offset: { type: "integer", minimum: 0, default: 0 },
    },
    required: ["q"],
  },
};

const geoSchema = {
  querystring: {
    type: "object",
    properties: {
      type: { type: "string", maxLength: 50 },
      minLon: { type: "number", minimum: -180, maximum: 180 },
      maxLon: { type: "number", minimum: -180, maximum: 180 },
      minLat: { type: "number", minimum: -90, maximum: 90 },
      maxLat: { type: "number", minimum: -90, maximum: 90 },
      limit: { type: "integer", minimum: 1, maximum: 5000, default: 1000 },
      offset: { type: "integer", minimum: 0, default: 0 },
    },
  },
};

const byVerseSchema = {
  params: {
    type: "object",
    properties: {
      bookId: { type: "string" },
      chapter: { type: "integer", minimum: 1 },
      verse: { type: "integer", minimum: 1 },
    },
    required: ["bookId", "chapter", "verse"],
  },
};

const byIdSchema = {
  params: {
    type: "object",
    properties: {
      id: { type: "integer", minimum: 1 },
    },
    required: ["id"],
  },
};

export default async function entityRoutes(app) {
  // GET /api/entities?q=&type=&limit=20&offset=0
  app.get("/api/entities", { schema: searchSchema }, async (req, reply) => {
    const { q, type, limit, offset } = req.query;
    const { total, results } = await searchEntities(q, { type, limit, offset });
    return {
      query: q,
      total,
      limit,
      offset,
      has_more: offset + results.length < total,
      results,
    };
  });

  // GET /api/entities/geo?type=&minLon=&maxLon=&minLat=&maxLat=&limit=&offset=
  app.get("/api/entities/geo", { schema: geoSchema }, async (req, reply) => {
    const { type, minLon, maxLon, minLat, maxLat, limit, offset } = req.query;

    const bounds = [minLon, maxLon, minLat, maxLat];
    const hasAnyBounds = bounds.some((value) => value != null);
    const hasAllBounds = bounds.every((value) => value != null);
    if (hasAnyBounds && !hasAllBounds) {
      reply.status(400).send({
        error: "Bounding-box filter requires minLon, maxLon, minLat, and maxLat.",
      });
      return;
    }
    if (hasAllBounds && (minLon > maxLon || minLat > maxLat)) {
      reply.status(400).send({
        error: "Bounding-box values must satisfy minLon <= maxLon and minLat <= maxLat.",
      });
      return;
    }

    const { total, results } = await getGeoEntities({
      type,
      minLon,
      maxLon,
      minLat,
      maxLat,
      limit,
      offset,
    });
    return {
      total,
      limit,
      offset,
      has_more: offset + results.length < total,
      results,
    };
  });

  // GET /api/entities/by-verse/:bookId/:chapter/:verse
  // Registered before :id to avoid route conflict
  app.get("/api/entities/by-verse/:bookId/:chapter/:verse", { schema: byVerseSchema }, async (req, reply) => {
    const { bookId, chapter, verse } = req.params;
    const results = await getEntitiesByVerse(bookId, chapter, verse);
    return { book_id: bookId, chapter, verse, total: results.length, results };
  });

  // GET /api/entities/:id
  app.get("/api/entities/:id", { schema: byIdSchema }, async (req, reply) => {
    const entity = await getEntityById(req.params.id);
    if (!entity) {
      reply.status(404).send({ error: "Entity not found" });
      return;
    }
    return entity;
  });
}
