// server/routes/search.js
// POST /api/search — semantic search across Bible translations.

import { embedQuery } from "../services/embedder.js";
import { searchChunks } from "../services/vectorSearch.js";
import { fetchChunksByIds, trigramSimilarity } from "../services/chunksRepo.js";
import { rerank, DEUTERO_BOOKS } from "../services/rerank.js";

const searchSchema = {
  body: {
    type: "object",
    properties: {
      q: { type: "string", maxLength: 2000 },
      topk: { type: "integer", minimum: 1, maximum: 100, default: 10 },
      mode: { type: "string", enum: ["explorer", "exact"], default: "explorer" },
      includeDeutero: { type: "boolean", default: true },
      translations: {
        type: "array",
        items: { type: "string", maxLength: 16 },
        minItems: 1,
        maxItems: 10,
        description: "Filter results to specific translations (e.g. [\"WEBU\", \"PT1911\"])",
      },
    },
    required: ["q"],
  },
};

async function searchHandler(req, reply) {
  try {
    const { q, topk = 10, mode = "explorer", includeDeutero = true, translations } = req.body;
    const candidateLimit = Math.max(topk * 3, 30);

    // Step A: embed query
    const vector = await embedQuery(q);

    // Step B: pgvector search (with optional translation filter)
    let candidates = await searchChunks(vector, candidateLimit, translations);

    // Filter deuterocanonical if requested
    if (!includeDeutero) {
      candidates = candidates.filter((c) => !DEUTERO_BOOKS.has(c.book_id));
    }

    // Step C: hydrate from Postgres (fetch text_clean)
    const ids = candidates.map((c) => c.chunk_id);
    const chunks = await fetchChunksByIds(ids);
    const chunkMap = new Map(chunks.map((c) => [c.chunk_id, c]));

    // Merge text_clean into candidates
    const hydrated = candidates
      .filter((c) => chunkMap.has(c.chunk_id))
      .map((c) => ({
        ...c,
        text_clean: chunkMap.get(c.chunk_id).text_clean,
      }));

    // Step D (optional): trigram similarity for exact mode
    let trigramScores = null;
    if (mode === "exact") {
      trigramScores = await trigramSimilarity(ids, q);
    }

    // Step E: rerank
    const ranked = rerank(hydrated, q, mode, trigramScores);

    return {
      query: q,
      mode,
      includeDeutero,
      translations: translations ?? null,
      total: ranked.length,
      results: ranked.slice(0, topk),
    };
  } catch (err) {
    req.log.error(err);
    reply.status(500).send({ error: "Search failed" });
  }
}

export default async function searchRoutes(app) {
  app.post("/api/search", { schema: searchSchema }, searchHandler);
}
