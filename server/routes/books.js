// server/routes/books.js
// Books / Table of Contents endpoint.

import { getBooks } from "../services/booksRepo.js";

const schema = {
  querystring: {
    type: "object",
    properties: {
      translation: { type: "string", maxLength: 10, default: "WEBU" },
    },
  },
};

export default async function bookRoutes(app) {
  // GET /api/books?translation=WEBU
  app.get("/api/books", { schema }, async (req, reply) => {
    const { translation } = req.query;
    try {
      const books = await getBooks(translation);
      return { total: books.length, books };
    } catch (err) {
      req.log.error(err, "Failed to load books");
      reply.status(500).send({ error: "Could not load books.", code: "BOOKS_ERROR", retryable: true });
    }
  });
}
