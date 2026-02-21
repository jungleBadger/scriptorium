// Integration tests for health route — pool is mocked.

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";

const { mockQuery, mockCheckOllamaHealth } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockCheckOllamaHealth: vi.fn(),
}));

vi.mock("../../server/services/pool.js", () => ({
  getPool: () => ({ query: mockQuery }),
}));
vi.mock("../../server/services/ollamaClient.js", () => ({
  checkOllamaHealth: mockCheckOllamaHealth,
  getOllamaConfig: () => ({ host: "http://127.0.0.1:11434", model: "qwen3:8b" }),
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
  it("returns 200 and ok when Postgres and Ollama are healthy", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
    mockCheckOllamaHealth.mockResolvedValueOnce({
      reachable: true,
      model_available: true,
      model: "qwen3:8b",
      code: "OLLAMA_OK",
      message: "ok",
    });

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.postgres).toBe(true);
    expect(body.ollama.reachable).toBe(true);
    expect(body.ollama.model_available).toBe(true);
  });

  it("returns 503 and degraded when Postgres is unreachable", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection refused"));
    mockCheckOllamaHealth.mockResolvedValueOnce({
      reachable: true,
      model_available: true,
      model: "qwen3:8b",
      code: "OLLAMA_OK",
      message: "ok",
    });

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe("degraded");
    expect(body.postgres).toBe(false);
    expect(body.ollama.reachable).toBe(true);
  });

  it("returns 503 and degraded when Ollama model is missing", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
    mockCheckOllamaHealth.mockResolvedValueOnce({
      reachable: true,
      model_available: false,
      model: "qwen3:8b",
      code: "OLLAMA_MODEL_MISSING",
      message: "missing model",
    });

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe("degraded");
    expect(body.postgres).toBe(true);
    expect(body.ollama.reachable).toBe(true);
    expect(body.ollama.model_available).toBe(false);
    expect(body.ollama.code).toBe("OLLAMA_MODEL_MISSING");
  });

  it("exposes the same payload on /api/health", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
    mockCheckOllamaHealth.mockResolvedValueOnce({
      reachable: true,
      model_available: true,
      model: "qwen3:8b",
      code: "OLLAMA_OK",
      message: "ok",
    });

    const res = await app.inject({ method: "GET", url: "/api/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });
});
