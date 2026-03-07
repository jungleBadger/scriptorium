// server/tests/routes.ask.test.js
// HTTP-level tests for POST /api/ask — askService is fully mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";

// Mock askService before the route module imports it.
vi.mock("../services/askService.js", () => ({
  askQuestion: vi.fn(),
}));

const { askQuestion } = await import("../services/askService.js");
const askRoutes = (await import("../routes/ask.js")).default;

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { max: 1000, timeWindow: "1 minute" });
  await app.register(askRoutes);
  return app;
}

const validBody = {
  question: "Who is Moses?",
  translation: "WEBU",
  book: "GEN",
  chapter: 1,
  verse: 1,
};

describe("POST /api/ask", () => {
  let app;
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await app.inject({ method: "POST", url: "/api/ask", payload: { question: "hello" } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when question is empty string", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ask",
      payload: { ...validBody, question: "   " },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe("ASK_BAD_REQUEST");
  });

  it("returns 200 with answer on success", async () => {
    askQuestion.mockResolvedValueOnce({
      raw_response_text: "Moses was a prophet.",
      found_entities: [],
      relevant_passages: [],
    });
    const res = await app.inject({ method: "POST", url: "/api/ask", payload: validBody });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).raw_response_text).toBe("Moses was a prophet.");
  });

  it("returns 503 when Gemini is not configured", async () => {
    const err = Object.assign(new Error("not configured"), { code: "GEMINI_NOT_CONFIGURED", statusCode: 503 });
    askQuestion.mockRejectedValueOnce(err);
    const res = await app.inject({ method: "POST", url: "/api/ask", payload: validBody });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).code).toBe("GEMINI_NOT_CONFIGURED");
  });

  it("returns 429 when Gemini is rate limited", async () => {
    const err = Object.assign(new Error("rate limited"), { code: "GEMINI_RATE_LIMITED", statusCode: 429 });
    askQuestion.mockRejectedValueOnce(err);
    const res = await app.inject({ method: "POST", url: "/api/ask", payload: validBody });
    expect(res.statusCode).toBe(429);
    expect(JSON.parse(res.body).code).toBe("GEMINI_RATE_LIMITED");
  });

  it("returns 422 when Gemini blocks for safety", async () => {
    const err = Object.assign(new Error("safety"), { code: "GEMINI_SAFETY_BLOCK", statusCode: 422 });
    askQuestion.mockRejectedValueOnce(err);
    const res = await app.inject({ method: "POST", url: "/api/ask", payload: validBody });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe("GEMINI_SAFETY_BLOCK");
  });

  it("returns 503 on Gemini auth error", async () => {
    const err = Object.assign(new Error("auth"), { code: "GEMINI_AUTH_ERROR", statusCode: 503 });
    askQuestion.mockRejectedValueOnce(err);
    const res = await app.inject({ method: "POST", url: "/api/ask", payload: validBody });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).code).toBe("GEMINI_AUTH_ERROR");
  });

  it("returns 500 on unexpected server error", async () => {
    askQuestion.mockRejectedValueOnce(new Error("something broke"));
    const res = await app.inject({ method: "POST", url: "/api/ask", payload: validBody });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).retryable).toBe(true);
  });
});
