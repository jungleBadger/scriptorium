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

function normalizeAskError(err) {
  const statusCandidate = Number(err?.statusCode);
  const statusCode =
    Number.isInteger(statusCandidate) && statusCandidate >= 400 && statusCandidate < 600
      ? statusCandidate
      : 500;
  const code =
    typeof err?.code === "string" && err.code.trim()
      ? err.code.trim()
      : statusCode >= 500
        ? "ASK_INTERNAL_ERROR"
        : "ASK_BAD_REQUEST";
  const retryable = statusCode >= 500;

  if (code === "OLLAMA_UNREACHABLE") {
    return {
      statusCode: 503,
      code,
      retryable: true,
      message: "Local Ollama is unavailable. Start `ollama serve` and try again.",
    };
  }
  if (code === "OLLAMA_MODEL_MISSING") {
    return {
      statusCode: 503,
      code,
      retryable: false,
      message: "Ollama model qwen3:8b is missing. Run `ollama pull qwen3:8b`.",
    };
  }
  if (code === "OLLAMA_TIMEOUT") {
    return {
      statusCode: 504,
      code,
      retryable: true,
      message: "Ollama timed out while generating an answer. Please retry.",
    };
  }

  const fallbackMessage = statusCode >= 500
    ? "Ask request failed due to a server error."
    : "Ask request failed.";

  return {
    statusCode,
    code,
    retryable,
    message: String(err?.message || "").trim() || fallbackMessage,
  };
}

async function askHandler(req, reply) {
  const payload = req.body || {};
  const question = String(payload.question || "").trim();
  if (!question) {
    reply.status(400).send({
      error: "Question is required.",
      code: "ASK_BAD_REQUEST",
      retryable: false,
    });
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
    const normalized = normalizeAskError(err);
    reply.status(normalized.statusCode).send({
      error: normalized.message,
      code: normalized.code,
      retryable: normalized.retryable,
    });
  }
}

export default async function askRoutes(app) {
  app.post("/api/ask", { schema: askSchema }, askHandler);
}
