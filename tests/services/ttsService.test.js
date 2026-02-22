// Unit tests for ttsService — versesRepo, r2, and fetch are all mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../server/services/versesRepo.js", () => ({
  getVerseRange: vi.fn(),
}));

vi.mock("../../server/services/r2.js", () => ({
  r2Exists:       vi.fn(),
  r2Upload:       vi.fn(),
  r2GetSignedUrl: vi.fn(),
}));

// Stub the VOICES data so tests are independent of the real config file.
vi.mock("../../server/data/voices.js", () => ({
  VOICES: [
    { id: "",             label: "Default",    language: "en" },
    { id: "voice-en-1",  label: "EN Voice 1", language: "en" },
    { id: "voice-pt-1",  label: "PT Voice 1", language: "pt" },
  ],
}));

const { generateVerseAudio, listVoices } = await import("../../server/services/ttsService.js");
const { getVerseRange }                   = await import("../../server/services/versesRepo.js");
const { r2Exists, r2Upload, r2GetSignedUrl } = await import("../../server/services/r2.js");

const SIGNED_URL  = "https://bucket.r2.example.com/GEN/1/1/WEBU/default.mp3?X-Amz-Signature=abc";
const VERSE_TEXT  = "In the beginning God created the heavens and the earth.";
const AUDIO_BYTES = Buffer.from("fake-mp3-data");

function mockFetch(status = 200, body = AUDIO_BYTES) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: () => Promise.resolve(body.buffer),
    text:        () => Promise.resolve("error body"),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  r2GetSignedUrl.mockResolvedValue(SIGNED_URL);
  r2Upload.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── listVoices ───────────────────────────────────────────────────────────────

describe("listVoices", () => {
  it("returns an array of voice objects", () => {
    const voices = listVoices();
    expect(Array.isArray(voices)).toBe(true);
    expect(voices.length).toBeGreaterThan(0);
  });

  it("each voice has id, label and language fields", () => {
    for (const v of listVoices()) {
      expect(typeof v.id).toBe("string");
      expect(typeof v.label).toBe("string");
      expect(typeof v.language).toBe("string");
    }
  });
});

// ── generateVerseAudio — cache hit ──────────────────────────────────────────

describe("generateVerseAudio — cache hit", () => {
  beforeEach(() => {
    getVerseRange.mockResolvedValue([{ verse: 1, text: VERSE_TEXT }]);
    r2Exists.mockResolvedValue(true);
  });

  it("returns cached: true and skips voice.ai and upload", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateVerseAudio("WEBU", "GEN", 1, 1, "");

    expect(result.cached).toBe(true);
    expect(r2Upload).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the pre-signed URL from R2", async () => {
    vi.stubGlobal("fetch", mockFetch());

    const result = await generateVerseAudio("WEBU", "GEN", 1, 1, "");

    expect(result.audioUrl).toBe(SIGNED_URL);
  });
});

// ── generateVerseAudio — cache miss ─────────────────────────────────────────

describe("generateVerseAudio — cache miss", () => {
  beforeEach(() => {
    getVerseRange.mockResolvedValue([{ verse: 1, text: VERSE_TEXT }]);
    r2Exists.mockResolvedValue(false);
  });

  it("calls voice.ai and uploads audio to R2 on cache miss", async () => {
    vi.stubGlobal("fetch", mockFetch());

    const result = await generateVerseAudio("WEBU", "GEN", 1, 1, "voice-en-1");

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      "https://dev.voice.ai/api/v1/tts/speech",
      expect.objectContaining({ method: "POST" })
    );
    expect(r2Upload).toHaveBeenCalledOnce();
    expect(result.cached).toBe(false);
  });

  it("includes voice_id in voice.ai request when provided", async () => {
    vi.stubGlobal("fetch", mockFetch());

    await generateVerseAudio("WEBU", "GEN", 1, 1, "voice-en-1");

    const [, { body }] = fetch.mock.calls[0];
    expect(JSON.parse(body).voice_id).toBe("voice-en-1");
  });

  it("omits voice_id from voice.ai request when empty", async () => {
    vi.stubGlobal("fetch", mockFetch());

    await generateVerseAudio("WEBU", "GEN", 1, 1, "");

    const [, { body }] = fetch.mock.calls[0];
    expect(JSON.parse(body)).not.toHaveProperty("voice_id");
  });

  it("sends language pt for PT1911 translation", async () => {
    vi.stubGlobal("fetch", mockFetch());

    await generateVerseAudio("PT1911", "GEN", 1, 1, "");

    const [, { body }] = fetch.mock.calls[0];
    expect(JSON.parse(body).language).toBe("pt");
  });

  it("sends language en for WEBU translation", async () => {
    vi.stubGlobal("fetch", mockFetch());

    await generateVerseAudio("WEBU", "GEN", 1, 1, "");

    const [, { body }] = fetch.mock.calls[0];
    expect(JSON.parse(body).language).toBe("en");
  });

  it("encodes voiceId with special chars safely in the R2 key", async () => {
    vi.stubGlobal("fetch", mockFetch());

    await generateVerseAudio("WEBU", "GEN", 1, 1, "voice/with spaces&special");

    const [key] = r2Upload.mock.calls[0];
    expect(key).not.toMatch(/[/\s&]/g.source.slice(1, -1));
    expect(key).toMatch(/\.mp3$/);
  });

  it("throws when voice.ai returns a non-ok response", async () => {
    vi.stubGlobal("fetch", mockFetch(503));

    await expect(generateVerseAudio("WEBU", "GEN", 1, 1, "")).rejects.toThrow("503");
  });
});

// ── generateVerseAudio — verse not found ────────────────────────────────────

describe("generateVerseAudio — verse not found", () => {
  it("throws an error with statusCode 404", async () => {
    getVerseRange.mockResolvedValue([]);
    vi.stubGlobal("fetch", mockFetch());

    const err = await generateVerseAudio("WEBU", "GEN", 999, 1, "").catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(404);
  });
});

// ── Word timings ─────────────────────────────────────────────────────────────

describe("word timings", () => {
  beforeEach(() => {
    getVerseRange.mockResolvedValue([{ verse: 1, text: VERSE_TEXT }]);
    r2Exists.mockResolvedValue(true); // use cache hit to avoid fetch
  });

  it("returns one timing entry per whitespace-separated word", async () => {
    const { words } = await generateVerseAudio("WEBU", "GEN", 1, 1, "");
    const expectedCount = VERSE_TEXT.trim().split(/\s+/).length;
    expect(words).toHaveLength(expectedCount);
  });

  it("each timing has word, startMs and endMs as numbers", async () => {
    const { words } = await generateVerseAudio("WEBU", "GEN", 1, 1, "");
    for (const w of words) {
      expect(typeof w.word).toBe("string");
      expect(typeof w.startMs).toBe("number");
      expect(typeof w.endMs).toBe("number");
    }
  });

  it("first word starts at 0ms", async () => {
    const { words } = await generateVerseAudio("WEBU", "GEN", 1, 1, "");
    expect(words[0].startMs).toBe(0);
  });

  it("timings are in strictly ascending order", async () => {
    const { words } = await generateVerseAudio("WEBU", "GEN", 1, 1, "");
    for (let i = 1; i < words.length; i++) {
      expect(words[i].startMs).toBeGreaterThan(words[i - 1].startMs);
    }
  });

  it("endMs is greater than startMs for every word", async () => {
    const { words } = await generateVerseAudio("WEBU", "GEN", 1, 1, "");
    for (const w of words) {
      expect(w.endMs).toBeGreaterThan(w.startMs);
    }
  });

  it("word text matches the corresponding token in the verse", async () => {
    const { words } = await generateVerseAudio("WEBU", "GEN", 1, 1, "");
    const tokens = VERSE_TEXT.match(/\S+/g);
    expect(words.map((w) => w.word)).toEqual(tokens);
  });
});
