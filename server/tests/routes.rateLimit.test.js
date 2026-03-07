// server/tests/routes.rateLimit.test.js
// Verifies @fastify/rate-limit middleware behaviour: error shape contract,
// route-level override precedence, and per-route enforcement on /api/ask.

import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";

vi.mock("../services/askService.js", () => ({
  askQuestion: vi.fn(),
}));

const { askQuestion } = await import("../services/askService.js");
const askRoutes = (await import("../routes/ask.js")).default;

// Same errorResponseBuilder used in production (server/index.js).
// @fastify/rate-limit v10 requires statusCode in the returned object to set
// the HTTP response status; without it, Fastify falls back to 500.
const errorResponseBuilder = (_req, context) => ({
  statusCode: 429,
  error: `Too many requests. Please try again in ${context.after}.`,
  code: "RATE_LIMIT_EXCEEDED",
  retryable: true,
});

const validAskBody = {
  question: "Who is Moses?",
  translation: "WEBU",
  book: "GEN",
  chapter: 1,
  verse: 1,
};


// ------------------------------------------------------------------
// 1. Error shape contract
// ------------------------------------------------------------------
describe("Rate limit error shape", () => {
  it("returns RATE_LIMIT_EXCEEDED with retryable:true when the global limit is hit", async () => {
    const app = Fastify({ logger: false });
    await app.register(rateLimit, { max: 2, timeWindow: "1 minute", errorResponseBuilder });
    app.get("/ping", async () => ({ ok: true }));

    await app.inject({ method: "GET", url: "/ping" });
    await app.inject({ method: "GET", url: "/ping" });

    const res = await app.inject({ method: "GET", url: "/ping" });
    expect(res.statusCode).toBe(429);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(body.retryable).toBe(true);
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------
// 2. Route-level override beats global cap
// ------------------------------------------------------------------
describe("Route-level rate limit override", () => {
  it("allows more than the global max when the route config raises the limit", async () => {
    askQuestion.mockResolvedValue({
      raw_response_text: "Moses was a leader.",
      found_entities: [],
      relevant_passages: [],
    });

    const app = Fastify({ logger: false });
    // Global max of 1 would block the second request if the route override weren't applied.
    await app.register(rateLimit, { max: 1, timeWindow: "1 minute", errorResponseBuilder });
    await app.register(askRoutes); // declares config.rateLimit: { max: 10, timeWindow: "5 minutes" }

    const res1 = await app.inject({ method: "POST", url: "/api/ask", payload: validAskBody });
    const res2 = await app.inject({ method: "POST", url: "/api/ask", payload: validAskBody });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200); // Would be 429 if the global max:1 applied instead.
  });
});

// ------------------------------------------------------------------
// 3. Ask route enforces its own cap (max: 10 per 5 minutes)
// ------------------------------------------------------------------
describe("Ask route enforcement", () => {
  it("blocks the 11th request with RATE_LIMIT_EXCEEDED, not GEMINI_RATE_LIMITED", async () => {
    askQuestion.mockResolvedValue({
      raw_response_text: "answer",
      found_entities: [],
      relevant_passages: [],
    });

    const app = Fastify({ logger: false });
    await app.register(rateLimit, { max: 1000, timeWindow: "1 minute", errorResponseBuilder });
    await app.register(askRoutes);

    // First 10 requests must all succeed (within the route-level cap).
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ method: "POST", url: "/api/ask", payload: validAskBody });
      expect(res.statusCode).toBe(200);
    }

    // 11th is blocked by the route-level limit, not the global one.
    const blocked = await app.inject({ method: "POST", url: "/api/ask", payload: validAskBody });
    expect(blocked.statusCode).toBe(429);
    const body = JSON.parse(blocked.body);
    expect(body.code).toBe("RATE_LIMIT_EXCEEDED");  // middleware, not upstream Gemini
    expect(body.retryable).toBe(true);
    expect(body.code).not.toBe("GEMINI_RATE_LIMITED");
  });
});
