// Integration tests for TTS routes - service layer mocked.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";

vi.mock("../../server/services/ttsService.js", () => ({
  generateVerseAudio: vi.fn(),
  listVoices: vi.fn(),
}));

import ttsRoutes from "../../server/routes/tts.js";
import { generateVerseAudio, listVoices } from "../../server/services/ttsService.js";

let app;

beforeAll(async () => {
  app = Fastify();
  await app.register(ttsRoutes);
  await app.ready();
});

afterAll(() => app.close());

beforeEach(() => vi.clearAllMocks());

// ── GET /api/tts/voices ──────────────────────────────────────────────────────

describe("GET /api/tts/voices", () => {
  it("returns the voices array from the service", async () => {
    const voices = [
      { id: "", label: "Default (English)", language: "en" },
      { id: "abc-123", label: "Vladimir Putin", language: "en" },
      { id: "def-456", label: "Cristiano Ronaldo", language: "pt" },
    ];
    listVoices.mockReturnValueOnce(voices);

    const res = await app.inject({ method: "GET", url: "/api/tts/voices" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(voices);
  });
});

// ── POST /api/tts ────────────────────────────────────────────────────────────

describe("POST /api/tts", () => {
  it("returns audioUrl, words and cached flag on success", async () => {
    generateVerseAudio.mockResolvedValueOnce({
      audioUrl: "https://r2.example.com/GEN/1/1/WEBU/default.mp3?signed=1",
      words: [
        { word: "In",        startMs: 0,   endMs: 150 },
        { word: "the",       startMs: 150, endMs: 280 },
        { word: "beginning", startMs: 280, endMs: 600 },
      ],
      cached: false,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/tts",
      payload: { translation: "WEBU", bookId: "GEN", chapter: 1, verse: 1, voiceId: "" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.audioUrl).toContain("r2.example.com");
    expect(body.words).toHaveLength(3);
    expect(body.words[0]).toEqual({ word: "In", startMs: 0, endMs: 150 });
    expect(body.cached).toBe(false);
  });

  it("passes voiceId through to the service", async () => {
    generateVerseAudio.mockResolvedValueOnce({ audioUrl: "https://x", words: [], cached: true });

    await app.inject({
      method: "POST",
      url: "/api/tts",
      payload: { translation: "WEBU", bookId: "GEN", chapter: 1, verse: 1, voiceId: "abc-123" },
    });

    expect(generateVerseAudio).toHaveBeenCalledWith("WEBU", "GEN", 1, 1, "abc-123");
  });

  it("defaults voiceId to empty string when omitted", async () => {
    generateVerseAudio.mockResolvedValueOnce({ audioUrl: "https://x", words: [], cached: true });

    await app.inject({
      method: "POST",
      url: "/api/tts",
      payload: { translation: "WEBU", bookId: "GEN", chapter: 1, verse: 1 },
    });

    expect(generateVerseAudio).toHaveBeenCalledWith("WEBU", "GEN", 1, 1, "");
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tts",
      payload: { translation: "WEBU", bookId: "GEN", chapter: 1 }, // verse missing
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 404 when verse does not exist", async () => {
    const err = new Error("Verse not found: GEN 999:1 (WEBU)");
    err.statusCode = 404;
    generateVerseAudio.mockRejectedValueOnce(err);

    const res = await app.inject({
      method: "POST",
      url: "/api/tts",
      payload: { translation: "WEBU", bookId: "GEN", chapter: 999, verse: 1 },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("Verse not found");
  });

  it("returns 502 when voice.ai returns an error", async () => {
    const err = new Error("voice.ai TTS failed (502): Bad Gateway");
    err.statusCode = 502;
    generateVerseAudio.mockRejectedValueOnce(err);

    const res = await app.inject({
      method: "POST",
      url: "/api/tts",
      payload: { translation: "WEBU", bookId: "GEN", chapter: 1, verse: 1 },
    });

    expect(res.statusCode).toBe(502);
  });

  it("returns 500 for unexpected service errors", async () => {
    generateVerseAudio.mockRejectedValueOnce(new Error("Unexpected failure"));

    const res = await app.inject({
      method: "POST",
      url: "/api/tts",
      payload: { translation: "WEBU", bookId: "GEN", chapter: 1, verse: 1 },
    });

    expect(res.statusCode).toBe(500);
  });
});
