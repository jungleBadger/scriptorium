// server/services/vectorSearch.js
// pgvector-based semantic search for bible chunks.

import { getPool } from "./pool.js";

/**
 * Search for nearest chunks to the given embedding vector using pgvector.
 * @param {number[]} vector - query embedding (384-dim)
 * @param {number} limit - max results
 * @param {string[]} [translations] - optional translation filter
 * @returns {Promise<Array<{chunk_id:string, translation:string, book_id:string, chapter:number, verse_start:number, verse_end:number, ref_start:string, ref_end:string, score:number}>>}
 */
export async function searchChunks(vector, limit = 30, translations = undefined) {
  const pool = getPool();

  const vectorParam = JSON.stringify(vector);

  let query;
  let params;

  if (translations && translations.length > 0) {
    query = `
      SELECT chunk_id, translation, book_id, chapter,
             verse_start, verse_end, ref_start, ref_end,
             1 - (embedding <=> $1::vector) AS score
      FROM chunks
      WHERE embedding IS NOT NULL
        AND translation = ANY($3::text[])
      ORDER BY embedding <=> $1::vector
      LIMIT $2`;
    params = [vectorParam, limit, translations];
  } else {
    query = `
      SELECT chunk_id, translation, book_id, chapter,
             verse_start, verse_end, ref_start, ref_end,
             1 - (embedding <=> $1::vector) AS score
      FROM chunks
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $2`;
    params = [vectorParam, limit];
  }

  const { rows } = await pool.query(query, params);
  return rows;
}
