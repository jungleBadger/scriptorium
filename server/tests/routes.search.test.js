// server/tests/routes.search.test.js
// Tests that /api/search is stubbed as 503 until re-ingest is complete.

import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import searchRoutes from "../routes/search.js";

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { max: 1000, timeWindow: "1 minute" });
  await app.register(searchRoutes);
  return app;
}

describe("POST /api/search", () => {
  it("returns 503 SEARCH_UNAVAILABLE", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/search",
      payload: { query: "love" },
    });
    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("SEARCH_UNAVAILABLE");
    expect(body.retryable).toBe(false);
  });
});
