// server/services/embedder.js
// Embeds a query text using Google text-embedding-004 (768-dim).
// Used by vectorSearch.js when semantic search is re-enabled.

import { GoogleGenerativeAI } from "@google/generative-ai";

const EMBED_MODEL = "text-embedding-004";

let _model = null;

function getModel() {
  if (!_model) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is required for embedder.");
    const genai = new GoogleGenerativeAI(apiKey);
    _model = genai.getGenerativeModel({ model: EMBED_MODEL });
  }
  return _model;
}

/**
 * Embed a single text query into a float[] vector (768-dim).
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embedQuery(text) {
  const model = getModel();
  const result = await model.embedContent({
    content: { parts: [{ text }] },
    taskType: "RETRIEVAL_QUERY",
  });
  return result.embedding.values;
}
