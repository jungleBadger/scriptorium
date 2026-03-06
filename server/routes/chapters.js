// server/routes/chapters.js
// Chapter reader and verse range endpoints.

import { getChapter, getVerseRange, getMaxChapter, computeNav } from "../services/versesRepo.js";
import { getChapterExplanation, getChapterEntities } from "../services/chaptersRepo.js";

const chapterSchema = {
  params: {
    type: "object",
    properties: {
      bookId: { type: "string" },
      chapter: { type: "integer", minimum: 1 },
    },
    required: ["bookId", "chapter"],
  },
  querystring: {
    type: "object",
    properties: {
      translation: { type: "string", maxLength: 10, default: "WEBU" },
    },
  },
};

const verseRangeSchema = {
  params: {
    type: "object",
    properties: {
      bookId: { type: "string" },
      chapter: { type: "integer", minimum: 1 },
      startVerse: { type: "integer", minimum: 1 },
      endVerse: { type: "integer", minimum: 1 },
    },
    required: ["bookId", "chapter", "startVerse", "endVerse"],
  },
  querystring: {
    type: "object",
    properties: {
      translation: { type: "string", maxLength: 10, default: "WEBU" },
    },
  },
};

const chapterContextSchema = {
  params: {
    type: "object",
    properties: {
      bookId: { type: "string" },
      chapter: { type: "integer", minimum: 1 },
    },
    required: ["bookId", "chapter"],
  },
  querystring: {
    type: "object",
    properties: {
      translation: { type: "string", maxLength: 10, default: "WEBU" },
    },
  },
};

export default async function chapterRoutes(app) {
  // GET /api/chapters/:bookId/:chapter/context
  // Returns enriched chapter data: LLM explanation, linked entities (with
  // thumbnails and per-verse presence), and related verse cross-references.
  // Registered before :bookId/:chapter to avoid route shadowing.
  app.get("/api/chapters/:bookId/:chapter/context", { schema: chapterContextSchema }, async (req, reply) => {
    const { bookId, chapter } = req.params;
    const { translation } = req.query;

    try {
      const [explanation, entities] = await Promise.all([
        getChapterExplanation(translation, bookId, chapter),
        getChapterEntities(bookId, chapter),
      ]);

      return { book_id: bookId, chapter, translation, explanation, entities };
    } catch (err) {
      req.log.error(err, "Failed to load chapter context");
      reply.status(500).send({ error: "Could not load chapter context.", code: "CHAPTER_CONTEXT_ERROR", retryable: true });
    }
  });

  // GET /api/chapters/:bookId/:chapter
  app.get("/api/chapters/:bookId/:chapter", { schema: chapterSchema }, async (req, reply) => {
    const { bookId, chapter } = req.params;
    const { translation } = req.query;

    try {
      const [verses, maxChapter] = await Promise.all([
        getChapter(translation, bookId, chapter),
        getMaxChapter(translation, bookId),
      ]);

      if (!verses.length) {
        reply.status(404).send({ error: "Chapter not found", code: "CHAPTER_NOT_FOUND", retryable: false });
        return;
      }

      const { prev, next } = computeNav(bookId, chapter, maxChapter);
      return { book_id: bookId, chapter, translation, verses, prev, next };
    } catch (err) {
      req.log.error(err, "Failed to load chapter");
      reply.status(500).send({ error: "Could not load chapter.", code: "CHAPTER_ERROR", retryable: true });
    }
  });

  // GET /api/verses/:bookId/:chapter/:startVerse/:endVerse
  app.get("/api/verses/:bookId/:chapter/:startVerse/:endVerse", { schema: verseRangeSchema }, async (req, reply) => {
    const { bookId, chapter, startVerse, endVerse } = req.params;
    const { translation } = req.query;

    try {
      const verses = await getVerseRange(translation, bookId, chapter, startVerse, endVerse);

      if (!verses.length) {
        reply.status(404).send({ error: "Verses not found", code: "VERSES_NOT_FOUND", retryable: false });
        return;
      }

      return { book_id: bookId, chapter, translation, verses };
    } catch (err) {
      req.log.error(err, "Failed to load verse range");
      reply.status(500).send({ error: "Could not load verses.", code: "VERSES_ERROR", retryable: true });
    }
  });
}
