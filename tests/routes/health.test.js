// Integration tests for health route — pool is mocked.

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";

const mockQuery = vi.fn();
vi.mock("../../server/services/pool.js", () => ({
  getPool: () => ({ query: mockQuery }),
}));

import healthRoutes from "../../server/routes/health.js";

let app;

beforeAll(async () => {
  app = Fastify();
  await app.register(healthRoutes);
  await app.ready();
});

afterAll(() => app.close());

describe("GET /health", () => {
  it("returns 200 and ok when Postgres is reachable", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.postgres).toBe(true);
  });

  it("returns 503 and degraded when Postgres is unreachable", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection refused"));

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe("degraded");
    expect(body.postgres).toBe(false);
  });
});
