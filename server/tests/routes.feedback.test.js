// server/tests/routes.feedback.test.js
// HTTP-level tests for POST /api/feedback with repo helpers fully mocked.

import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";

vi.mock("../services/feedbackRepo.js", () => ({
  createFeedbackReport: vi.fn(),
  hasFeedbackInCooldownWindow: vi.fn(),
  hasRecentDuplicateFeedback: vi.fn(),
}));

const {
  createFeedbackReport,
  hasFeedbackInCooldownWindow,
  hasRecentDuplicateFeedback,
} = await import("../services/feedbackRepo.js");
const feedbackRoutes = (await import("../routes/feedback.js")).default;

const errorResponseBuilder = (_req, context) => ({
  statusCode: 429,
  error: `Too many requests. Please try again in ${context.after}.`,
  code: "RATE_LIMIT_EXCEEDED",
  retryable: true,
});

const validPayload = {
  kind: "content_report",
  target_type: "chapter_summary",
  translation: "WEBU",
  book_id: "GEN",
  chapter: 1,
  verse_start: 1,
  verse_end: 3,
  entity_id: null,
  user_message: "This summary mixes up the order of events.",
  suggested_fix: "It should mention the light before the sky.",
  content_snapshot: "The chapter says the sky came before the light.",
  generation_metadata: { model: "qwen3:8b", generated_at: "2026-03-08T12:00:00.000Z" },
  page_context: { surface: "chapter_summary", reference: "GEN 1" },
  contact_email: "reader@example.com",
};

async function buildApp({ withRateLimit = false } = {}) {
  const app = Fastify({ logger: false });
  if (withRateLimit) {
    await app.register(rateLimit, {
      max: 1000,
      timeWindow: "1 minute",
      errorResponseBuilder,
    });
  }
  await app.register(feedbackRoutes);
  return app;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("POST /api/feedback", () => {
  it("stores trimmed feedback and returns a clean success payload", async () => {
    vi.stubEnv("FEEDBACK_IP_HASH_SECRET", "test-feedback-secret");
    hasFeedbackInCooldownWindow.mockResolvedValueOnce(false);
    hasRecentDuplicateFeedback.mockResolvedValueOnce(false);
    createFeedbackReport.mockResolvedValueOnce({ id: "f1" });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/feedback",
      payload: {
        ...validPayload,
        user_message: "   This summary mixes up the order of events.   ",
        suggested_fix: "   It should mention the light before the sky.   ",
        contact_email: "   reader@example.com   ",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(createFeedbackReport).toHaveBeenCalledWith(expect.objectContaining({
      kind: "content_report",
      target_type: "chapter_summary",
      translation: "WEBU",
      book_id: "GEN",
      chapter: 1,
      verse_start: 1,
      verse_end: 3,
      user_message: "This summary mixes up the order of events.",
      suggested_fix: "It should mention the light before the sky.",
      contact_email: "reader@example.com",
      ip_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it("returns 400 when the trimmed message is too short", async () => {
    vi.stubEnv("FEEDBACK_IP_HASH_SECRET", "test-feedback-secret");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/feedback",
      payload: {
        ...validPayload,
        user_message: "   short   ",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe("FEEDBACK_BAD_REQUEST");
    expect(createFeedbackReport).not.toHaveBeenCalled();
  });

  it("returns 400 for schema-invalid payloads", async () => {
    vi.stubEnv("FEEDBACK_IP_HASH_SECRET", "test-feedback-secret");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/feedback",
      payload: {
        user_message: validPayload.user_message,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: "Invalid feedback payload.",
      code: "FEEDBACK_BAD_REQUEST",
      retryable: false,
    });
  });

  it("silently drops honeypot submissions", async () => {
    vi.stubEnv("FEEDBACK_IP_HASH_SECRET", "test-feedback-secret");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/feedback",
      payload: {
        ...validPayload,
        website: "https://spam.example",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(hasFeedbackInCooldownWindow).not.toHaveBeenCalled();
    expect(hasRecentDuplicateFeedback).not.toHaveBeenCalled();
    expect(createFeedbackReport).not.toHaveBeenCalled();
  });

  it("returns 429 during the short cooldown window", async () => {
    vi.stubEnv("FEEDBACK_IP_HASH_SECRET", "test-feedback-secret");
    hasFeedbackInCooldownWindow.mockResolvedValueOnce(true);
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/feedback",
      payload: validPayload,
    });

    expect(res.statusCode).toBe(429);
    expect(JSON.parse(res.body)).toEqual({
      error: "Please wait a moment before sending another message.",
      code: "FEEDBACK_COOLDOWN",
      retryable: true,
    });
    expect(createFeedbackReport).not.toHaveBeenCalled();
  });

  it("no-ops recent exact duplicates from the same IP hash", async () => {
    vi.stubEnv("FEEDBACK_IP_HASH_SECRET", "test-feedback-secret");
    hasFeedbackInCooldownWindow.mockResolvedValueOnce(false);
    hasRecentDuplicateFeedback.mockResolvedValueOnce(true);
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/feedback",
      payload: validPayload,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(createFeedbackReport).not.toHaveBeenCalled();
  });

  it("returns 503 when IP hashing is not configured", async () => {
    vi.stubEnv("FEEDBACK_IP_HASH_SECRET", "");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/feedback",
      payload: validPayload,
    });

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual({
      error: "Feedback is temporarily unavailable.",
      code: "FEEDBACK_UNAVAILABLE",
      retryable: false,
    });
    expect(createFeedbackReport).not.toHaveBeenCalled();
  });
});

describe("POST /api/feedback rate limiting", () => {
  it("blocks the 6th request with RATE_LIMIT_EXCEEDED", async () => {
    vi.stubEnv("FEEDBACK_IP_HASH_SECRET", "test-feedback-secret");
    hasFeedbackInCooldownWindow.mockResolvedValue(false);
    hasRecentDuplicateFeedback.mockResolvedValue(false);
    createFeedbackReport.mockResolvedValue({ id: "f1" });
    const app = await buildApp({ withRateLimit: true });

    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: "/api/feedback",
        payload: {
          ...validPayload,
          user_message: `This is feedback message number ${i} for the route-level cap.`,
        },
      });
      expect(res.statusCode).toBe(200);
    }

    const blocked = await app.inject({
      method: "POST",
      url: "/api/feedback",
      payload: {
        ...validPayload,
        user_message: "This is feedback message number 5 for the route-level cap.",
      },
    });

    expect(blocked.statusCode).toBe(429);
    expect(JSON.parse(blocked.body).code).toBe("RATE_LIMIT_EXCEEDED");
    expect(JSON.parse(blocked.body).retryable).toBe(true);
  });
});
