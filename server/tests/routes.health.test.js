// server/tests/routes.health.test.js
// HTTP-level tests for GET /health and GET /api/health — all external deps mocked.

import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";

vi.mock("../services/pool.js", () => ({
  getPool: vi.fn(),
  closePool: vi.fn(),
}));

vi.mock("../services/geminiClient.js", () => ({
  checkGeminiHealth: vi.fn(),
  generateGeminiText: vi.fn(),
}));

vi.mock("../services/ttsService.js", () => ({
  checkVoiceAIHealth: vi.fn(),
  getVoiceAIConfig: vi.fn(),
  generateVerseAudio: vi.fn(),
  generateChapterAudioManifest: vi.fn(),
  listVoices: vi.fn(),
}));

const { getPool } = await import("../services/pool.js");
const { checkGeminiHealth } = await import("../services/geminiClient.js");
const { checkVoiceAIHealth, getVoiceAIConfig } = await import("../services/ttsService.js");
const healthRoutes = (await import("../routes/health.js")).default;

const GEMINI_OK = { configured: true, ready: true, code: "GEMINI_OK", message: "Gemini is ready." };
const GEMINI_NOT_CONFIGURED = { configured: false, ready: false, code: "GEMINI_NOT_CONFIGURED", message: "GEMINI_API_KEY not set." };
const VOICE_AI_OK = { configured: true, reachable: true, ready: true, code: "VOICE_AI_OK", message: "voice.ai is ready.", endpoint: "https://api.voice.ai" };
const VOICE_AI_NOT_CONFIGURED = { configured: false, reachable: false, ready: false, code: "VOICE_AI_NOT_CONFIGURED", message: "VOICE_AI_API_KEY not set.", endpoint: null };

function mockPool(healthy) {
  const query = healthy ? vi.fn().mockResolvedValue({}) : vi.fn().mockRejectedValue(new Error("DB down"));
  getPool.mockReturnValue({ query });
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(healthRoutes);
  return app;
}

describe("GET /api/health", () => {
  it("returns 200 with status ok when all services are healthy", async () => {
    mockPool(true);
    checkGeminiHealth.mockReturnValue(GEMINI_OK);
    checkVoiceAIHealth.mockResolvedValue(VOICE_AI_OK);
    getVoiceAIConfig.mockReturnValue({ endpoint: "https://api.voice.ai" });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("ok");
    expect(body.postgres).toBe(true);
    expect(body.features.explore.available).toBe(true);
    expect(body.features.read_aloud.available).toBe(true);
  });

  it("returns 503 with status degraded when postgres is down", async () => {
    mockPool(false);
    checkGeminiHealth.mockReturnValue(GEMINI_OK);
    checkVoiceAIHealth.mockResolvedValue(VOICE_AI_OK);
    getVoiceAIConfig.mockReturnValue({ endpoint: "https://api.voice.ai" });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health" });

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).postgres).toBe(false);
  });

  it("returns 200 with status degraded when gemini is not configured", async () => {
    mockPool(true);
    checkGeminiHealth.mockReturnValue(GEMINI_NOT_CONFIGURED);
    checkVoiceAIHealth.mockResolvedValue(VOICE_AI_OK);
    getVoiceAIConfig.mockReturnValue({ endpoint: null });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("degraded");
    expect(body.features.explore.available).toBe(false);
  });

  it("returns 200 with status degraded when voice_ai is not configured", async () => {
    mockPool(true);
    checkGeminiHealth.mockReturnValue(GEMINI_OK);
    checkVoiceAIHealth.mockResolvedValue(VOICE_AI_NOT_CONFIGURED);
    getVoiceAIConfig.mockReturnValue({ endpoint: null });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("degraded");
    expect(body.features.read_aloud.available).toBe(false);
  });
});
