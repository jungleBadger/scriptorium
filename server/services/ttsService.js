// server/services/ttsService.js
// Verse TTS: voice.ai generation + Cloudflare R2 cache + word timing estimation.

import { getVerseRange } from "./versesRepo.js";
import { r2Exists, r2Upload, r2GetSignedUrl } from "./r2.js";
import { VOICES } from "../data/voices.js";

const VOICE_AI_ENDPOINT = "https://dev.voice.ai/api/v1/tts/speech";

function readIntEnv(name, fallback, min) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.trunc(parsed));
}

const VOICE_AI_MAX_CONCURRENT = readIntEnv("VOICE_AI_MAX_CONCURRENT", 1, 1);
const VOICE_AI_CONCURRENCY_RETRIES = readIntEnv("VOICE_AI_CONCURRENCY_RETRIES", 4, 0);
const VOICE_AI_RETRY_BASE_MS = readIntEnv("VOICE_AI_RETRY_BASE_MS", 300, 50);

// Average TTS speaking rate: ~130 WPM ≈ 14 chars/sec.
// Used to estimate total audio duration for word timing distribution.
const CHARS_PER_SEC = 14;

let activeVoiceAICalls = 0;
const voiceAISlotQueue = [];
const inFlightGenerations = new Map();

// Map translation codes to voice.ai language codes.
const TRANSLATION_LANGUAGE = {
  PT1911: "pt",
  ARC:    "pt",
};

function translationToLanguage(translation) {
  return TRANSLATION_LANGUAGE[String(translation).toUpperCase()] ?? "en";
}

function r2Key(translation, bookId, chapter, verse, voiceId) {
  const safeVoiceId = (voiceId || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${bookId}/${chapter}/${verse}/${translation}/${safeVoiceId}.mp3`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withVoiceAISlot(task) {
  if (activeVoiceAICalls >= VOICE_AI_MAX_CONCURRENT) {
    await new Promise((resolve) => voiceAISlotQueue.push(resolve));
  }

  activeVoiceAICalls += 1;
  try {
    return await task();
  } finally {
    activeVoiceAICalls -= 1;
    const next = voiceAISlotQueue.shift();
    if (next) next();
  }
}

function isVoiceAIConcurrencyLimit(statusCode, message) {
  if (statusCode !== 400 && statusCode !== 429) return false;
  return /too many concurrent tts generations/i.test(String(message));
}

function makeVoiceAIError(statusCode, bodyText) {
  const err = new Error(`voice.ai TTS failed (${statusCode}): ${bodyText}`);
  err.statusCode = statusCode;
  err.retryable = isVoiceAIConcurrencyLimit(statusCode, bodyText);
  return err;
}

/**
 * Estimate per-word timings from verse text using char-proportional distribution.
 */
function computeWordTimings(text) {
  const totalMs = (text.length / CHARS_PER_SEC) * 1000;
  const words = [];
  const wordRegex = /\S+/g;
  let match;
  while ((match = wordRegex.exec(text)) !== null) {
    const charStart = match.index;
    const charEnd   = match.index + match[0].length;
    words.push({
      word:    match[0],
      startMs: Math.round((charStart / text.length) * totalMs),
      endMs:   Math.round((charEnd   / text.length) * totalMs),
    });
  }
  return words;
}

async function callVoiceAI(text, voiceId, language) {
  return withVoiceAISlot(async () => {
    const body = { text, model: "voiceai-tts-v1-latest", language };
    if (voiceId) body.voice_id = voiceId;

    for (let attempt = 0; ; attempt++) {
      const response = await fetch(VOICE_AI_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.VOICE_AI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        return Buffer.from(await response.arrayBuffer());
      }

      const msg = await response.text().catch(() => "");
      const err = makeVoiceAIError(response.status, msg);
      if (!err.retryable || attempt >= VOICE_AI_CONCURRENCY_RETRIES) {
        throw err;
      }

      const jitterMs = Math.floor(Math.random() * 150);
      const backoffMs = VOICE_AI_RETRY_BASE_MS * (attempt + 1) + jitterMs;
      await sleep(backoffMs);
    }
  });
}

async function ensureVerseAudioInCache(key, text, voiceId, language) {
  const existing = inFlightGenerations.get(key);
  if (existing) {
    await existing;
    return;
  }

  const generationPromise = (async () => {
    if (await r2Exists(key)) return;
    const audioBuffer = await callVoiceAI(text, voiceId, language);
    await r2Upload(key, audioBuffer);
  })();

  inFlightGenerations.set(key, generationPromise);
  try {
    await generationPromise;
  } finally {
    inFlightGenerations.delete(key);
  }
}

export async function generateVerseAudio(translation, bookId, chapter, verse, voiceId) {
  const rows = await getVerseRange(translation, bookId, chapter, verse, verse);
  if (!rows.length) {
    const err = new Error(`Verse not found: ${bookId} ${chapter}:${verse} (${translation})`);
    err.statusCode = 404;
    throw err;
  }

  const text = rows[0].text;
  const key  = r2Key(translation, bookId, chapter, verse, voiceId);

  const cached = await r2Exists(key);
  if (!cached) {
    const language    = translationToLanguage(translation);
    await ensureVerseAudioInCache(key, text, voiceId, language);
  }

  const audioUrl = await r2GetSignedUrl(key);
  const words    = computeWordTimings(text);

  return { audioUrl, words, cached };
}

export function listVoices() {
  return VOICES;
}
