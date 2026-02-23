// server/routes/tts.js
// GET  /api/tts/voices   - list available voices
// POST /api/tts/verse    - generate (or serve cached) verse audio + word timings
// POST /api/tts/chapter  - generate/sign a verse-range manifest for chapter playback
// POST /api/tts          - legacy alias of /api/tts/verse

import { generateVerseAudio, generateChapterAudioManifest, listVoices } from "../services/ttsService.js";

const ttsSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["translation", "bookId", "chapter", "verse"],
    properties: {
      translation: { type: "string", minLength: 1, maxLength: 16 },
      bookId:      { type: "string", minLength: 1, maxLength: 8 },
      chapter:     { type: "integer", minimum: 1 },
      verse:       { type: "integer", minimum: 1 },
      voiceId:     { type: "string", maxLength: 128, default: "" },
    },
  },
};

const ttsChapterSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["translation", "bookId", "chapter", "startVerse", "endVerse"],
    properties: {
      translation: { type: "string", minLength: 1, maxLength: 16 },
      bookId:      { type: "string", minLength: 1, maxLength: 8 },
      chapter:     { type: "integer", minimum: 1 },
      startVerse:  { type: "integer", minimum: 1 },
      endVerse:    { type: "integer", minimum: 1 },
      voiceId:     { type: "string", maxLength: 128, default: "" },
    },
  },
};

function sendTtsError(req, reply, err, fallbackMessage) {
  req.log.error(err);
  const status =
    Number.isInteger(err?.statusCode) && err.statusCode >= 400 && err.statusCode < 600
      ? err.statusCode
      : 500;
  reply.status(status).send({ error: err.message || fallbackMessage });
}

async function ttsHandler(req, reply) {
  const { translation, bookId, chapter, verse, voiceId = "" } = req.body;
  try {
    return await generateVerseAudio(translation, bookId, chapter, verse, voiceId);
  } catch (err) {
    sendTtsError(req, reply, err, "TTS generation failed");
  }
}

async function ttsChapterHandler(req, reply) {
  const { translation, bookId, chapter, startVerse, endVerse, voiceId = "" } = req.body;
  if (startVerse > endVerse) {
    return reply.status(400).send({ error: "startVerse must be less than or equal to endVerse" });
  }

  try {
    return await generateChapterAudioManifest(
      translation,
      bookId,
      chapter,
      startVerse,
      endVerse,
      voiceId
    );
  } catch (err) {
    sendTtsError(req, reply, err, "TTS chapter manifest generation failed");
  }
}

export default async function ttsRoutes(app) {
  app.get("/api/tts/voices", () => listVoices());
  app.post("/api/tts/verse", { schema: ttsSchema }, ttsHandler);
  app.post("/api/tts/chapter", { schema: ttsChapterSchema }, ttsChapterHandler);
  app.post("/api/tts", { schema: ttsSchema }, ttsHandler);
}
