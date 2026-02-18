// server/routes/chapters.js
// Chapter reader and verse range endpoints.

import { getChapter, getVerseRange, getMaxChapter, computeNav } from "../services/versesRepo.js";

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

export default async function chapterRoutes(app) {
  // GET /api/chapters/:bookId/:chapter
  app.get("/api/chapters/:bookId/:chapter", { schema: chapterSchema }, async (req, reply) => {
    const { bookId, chapter } = req.params;
    const { translation } = req.query;

    const [verses, maxChapter] = await Promise.all([
      getChapter(translation, bookId, chapter),
      getMaxChapter(translation, bookId),
    ]);

    if (!verses.length) {
      reply.status(404).send({ error: "Chapter not found" });
      return;
    }

    const { prev, next } = computeNav(bookId, chapter, maxChapter);

    return {
      book_id: bookId,
      chapter,
      translation,
      verses,
      prev,
      next,
    };
  });

  // GET /api/verses/:bookId/:chapter/:startVerse/:endVerse
  app.get("/api/verses/:bookId/:chapter/:startVerse/:endVerse", { schema: verseRangeSchema }, async (req, reply) => {
    const { bookId, chapter, startVerse, endVerse } = req.params;
    const { translation } = req.query;

    const verses = await getVerseRange(translation, bookId, chapter, startVerse, endVerse);

    if (!verses.length) {
      reply.status(404).send({ error: "Verses not found" });
      return;
    }

    return {
      book_id: bookId,
      chapter,
      translation,
      verses,
    };
  });
}
