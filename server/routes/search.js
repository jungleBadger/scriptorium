// server/routes/search.js
// POST /api/search — semantic search across Bible translations.
//
// NOTE: Semantic search is temporarily disabled. The embedding pipeline needs
// to be re-run with the new embedding model before this can be re-enabled.
// The /api/ask endpoint (Gemini) remains fully functional for AI questions.

export default async function searchRoutes(app) {
  app.post(
    "/api/search",
    { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
    async (_req, reply) => {
      reply.status(503).send({
        error: "Semantic search is not available in this version.",
        code: "SEARCH_UNAVAILABLE",
        retryable: false,
      });
    }
  );
}
