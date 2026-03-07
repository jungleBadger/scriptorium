// server/tests/routes.tts.test.js
// HTTP-level tests for TTS routes — ttsService is fully mocked.

import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";

vi.mock("../services/ttsService.js", () => ({
  generateVerseAudio: vi.fn(),
  generateChapterAudioManifest: vi.fn(),
  listVoices: vi.fn(),
  checkVoiceAIHealth: vi.fn(),
  getVoiceAIConfig: vi.fn(),
}));

const { generateVerseAudio, listVoices } = await import("../services/ttsService.js");
const ttsRoutes = (await import("../routes/tts.js")).default;

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { max: 1000, timeWindow: "1 minute" });
  await app.register(ttsRoutes);
  return app;
}

const validVerseBody = { translation: "WEBU", bookId: "GEN", chapter: 1, verse: 1 };

describe("GET /api/tts/voices", () => {
  it("returns the voice list", async () => {
    listVoices.mockReturnValueOnce([{ id: "v1", name: "Voice 1" }]);

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/tts/voices" });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([{ id: "v1", name: "Voice 1" }]);
  });
});

describe("POST /api/tts/verse", () => {
  it("returns 400 when required fields are missing", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/tts/verse", payload: { translation: "WEBU" } });
    expect(res.statusCode).toBe(400);
  });

  it("returns the audio result on success", async () => {
    const audio = { url: "https://cdn.example.com/gen-1-1.mp3", word_timings: [] };
    generateVerseAudio.mockResolvedValueOnce(audio);

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/tts/verse", payload: validVerseBody });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).url).toBe(audio.url);
  });
});

describe("POST /api/tts/chapter", () => {
  it("returns 400 when startVerse is greater than endVerse", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/tts/chapter",
      payload: { translation: "WEBU", bookId: "GEN", chapter: 1, startVerse: 5, endVerse: 3 },
    });

    expect(res.statusCode).toBe(400);
  });
});
