// Integration tests for ask route - ask service mocked.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";

vi.mock("../../server/services/askService.js", () => ({
  askQuestion: vi.fn(),
}));

import askRoutes from "../../server/routes/ask.js";
import { askQuestion } from "../../server/services/askService.js";

let app;

beforeAll(async () => {
  app = Fastify();
  await app.register(askRoutes);
  await app.ready();
});

afterAll(() => app.close());

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/ask", () => {
  it("returns the expected success payload shape", async () => {
    askQuestion.mockResolvedValueOnce({
      raw_response_text: "Answer text",
      found_entities: [{ id: 1, type: "place.city", name: "Jerusalem", appears_in: [] }],
      relevant_passages: [{ id: "c1", source: "verse", ref: "PSA 122:6", snippet: "Pray for...", score: 0.9 }],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/ask",
      payload: {
        question: "Tell me about Jerusalem",
        translation: "WEBU",
        book: "PSA",
        chapter: 122,
        verse: 6,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      raw_response_text: "Answer text",
      found_entities: [{ id: 1, type: "place.city", name: "Jerusalem", appears_in: [] }],
      relevant_passages: [{ id: "c1", source: "verse", ref: "PSA 122:6", snippet: "Pray for...", score: 0.9 }],
    });
  });

  it("trims question before passing to service", async () => {
    askQuestion.mockResolvedValueOnce({
      raw_response_text: "ok",
      found_entities: [],
      relevant_passages: [],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/ask",
      payload: {
        question: "   what is this?   ",
        translation: "WEBU",
        book: "GEN",
        chapter: 1,
        verse: 1,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(askQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "what is this?",
      })
    );
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ask",
      payload: {
        question: "test",
        translation: "WEBU",
        chapter: 1,
        verse: 1,
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns service status code when provided", async () => {
    const err = new Error("Could not reach local Ollama.");
    err.statusCode = 503;
    askQuestion.mockRejectedValueOnce(err);

    const res = await app.inject({
      method: "POST",
      url: "/api/ask",
      payload: {
        question: "test",
        translation: "WEBU",
        book: "GEN",
        chapter: 1,
        verse: 1,
      },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain("Ollama");
  });
});
