// server/services/embedder.js
// Loads the multilingual embedding model once, exports embedQuery().

import { pipeline } from "@xenova/transformers";

const MODEL = process.env.EMBED_MODEL || "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

let _pipeline = null;

async function getPipeline() {
  if (!_pipeline) {
    console.log(`[embedder] Loading model: ${MODEL}`);
    _pipeline = await pipeline("feature-extraction", MODEL);
    console.log("[embedder] Model ready.");
  }
  return _pipeline;
}

/**
 * Embed a single text query into a float[] vector.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embedQuery(text) {
  const pipe = await getPipeline();
  const output = await pipe([text], { pooling: "mean", normalize: true });
  return output.tolist()[0];
}
