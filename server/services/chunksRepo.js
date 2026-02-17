// server/services/chunksRepo.js
// Fetch chunk text from Postgres by chunk_id.

import { getPool } from "./pool.js";

/**
 * Fetch chunks from Postgres by an array of chunk_ids,
 * preserving the input order.
 * @param {string[]} ids
 * @returns {Promise<Array<{chunk_id:string, text_clean:string, book_id:string, chapter:number, verse_start:number, verse_end:number, ref_start:string, ref_end:string}>>}
 */
export async function fetchChunksByIds(ids) {
  if (!ids.length) return [];
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT chunk_id, text_clean, book_id, chapter,
            verse_start, verse_end, ref_start, ref_end
     FROM chunks
     WHERE chunk_id = ANY($1::text[])
     ORDER BY array_position($1::text[], chunk_id)`,
    [ids]
  );
  return rows;
}

/**
 * Run trigram similarity search on chunks matching the given IDs,
 * returning similarity scores. Returns empty array if pg_trgm is unavailable.
 * @param {string[]} ids - chunk IDs to scope the search
 * @param {string} query - text to compare against text_clean
 * @returns {Promise<Map<string,number>>} chunk_id -> trigram similarity
 */
export async function trigramSimilarity(ids, query) {
  if (!ids.length) return new Map();
  const pool = getPool();
  try {
    const { rows } = await pool.query(
      `SELECT chunk_id, similarity(text_clean, $2) AS sim
       FROM chunks
       WHERE chunk_id = ANY($1::text[])`,
      [ids, query]
    );
    return new Map(rows.map((r) => [r.chunk_id, parseFloat(r.sim)]));
  } catch {
    // pg_trgm extension not available — skip
    return new Map();
  }
}

