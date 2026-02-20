// server/routes/ask.js
// POST /api/ask - retrieval + local Ollama answer generation.

import { askQuestion } from "../services/askService.js";

const askSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    properties: {
      question: { type: "string", minLength: 1, maxLength: 2000 },
      translation: { type: "string", minLength: 1, maxLength: 16, default: "WEBU" },
      book: { type: "string", minLength: 1, maxLength: 8 },
      chapter: { type: "integer", minimum: 1 },
      verse: { type: "integer", minimum: 1 },
      active_entity_ids: {
        type: "array",
        items: { type: "string", maxLength: 128 },
        maxItems: 200,
        default: [],
      },
      k_entities: { type: "integer", minimum: 1, maximum: 50, default: 12 },
      k_passages: { type: "integer", minimum: 1, maximum: 50, default: 10 },
    },
    required: ["question", "translation", "book", "chapter", "verse"],
  },
};

async function askHandler(req, reply) {
  const payload = req.body || {};
  const question = String(payload.question || "").trim();
  if (!question) {
    reply.status(400).send({ error: "Question is required." });
    return;
  }

  try {
    return await askQuestion({
      question,
      translation: payload.translation,
      book: payload.book,
      chapter: payload.chapter,
      verse: payload.verse,
      activeEntityIds: payload.active_entity_ids || [],
      kEntities: payload.k_entities,
      kPassages: payload.k_passages,
    });
  } catch (err) {
    req.log.error(err);
    const statusCode = Number(err?.statusCode);
    if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600) {
      reply.status(statusCode).send({ error: err.message || "Ask request failed." });
      return;
    }
    reply.status(500).send({ error: "Ask request failed." });
  }
}

export default async function askRoutes(app) {
  app.post("/api/ask", { schema: askSchema }, askHandler);
}
