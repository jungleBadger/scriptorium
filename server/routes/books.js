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
  app.get("/api/books", { schema }, async (req) => {
    const { translation } = req.query;
    const books = await getBooks(translation);
    return { total: books.length, books };
  });
}
