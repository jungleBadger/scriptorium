// server/routes/tts.js
// GET  /api/tts/voices  - list available voices
// POST /api/tts         - generate (or serve cached) verse audio + word timings

import { generateVerseAudio, listVoices } from "../services/ttsService.js";

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

async function ttsHandler(req, reply) {
  const { translation, bookId, chapter, verse, voiceId = "" } = req.body;
  try {
    return await generateVerseAudio(translation, bookId, chapter, verse, voiceId);
  } catch (err) {
    req.log.error(err);
    const status =
      Number.isInteger(err?.statusCode) && err.statusCode >= 400 && err.statusCode < 600
        ? err.statusCode
        : 500;
    reply.status(status).send({ error: err.message || "TTS generation failed" });
  }
}

export default async function ttsRoutes(app) {
  app.get("/api/tts/voices", () => listVoices());
  app.post("/api/tts", { schema: ttsSchema }, ttsHandler);
}
