// server/services/chaptersRepo.js
// Chapter-level enrichment queries: explanation and entities.

import { getPool } from "./pool.js";

/**
 * Get the best available chapter explanation (most recent ready record).
 * Returns null if no explanation has been generated yet.
 */
export async function getChapterExplanation(translation, bookId, chapter) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT chapter_explanation AS text, model, prompt_version, generated_at
     FROM chapter_explanations
     WHERE translation = $1 AND book_id = $2 AND chapter = $3 AND status = 'ready'
     ORDER BY generated_at DESC
     LIMIT 1`,
    [translation, bookId, chapter]
  );
  return rows[0] ?? null;
}

/**
 * Get all distinct entities that appear in any verse of a chapter.
 * Includes thumbnail (thumbnail-role image preferred), aliases, and which
 * verse numbers within the chapter each entity appears in.
 * Results are ordered by verse frequency (most prominent entities first).
 */
export async function getChapterEntities(bookId, chapter) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
       e.id, e.canonical_name, e.type, e.disambiguator, e.description,
       e.lon, e.lat, e.source,
       COALESCE(
         array_agg(DISTINCT a.name_form) FILTER (WHERE a.name_form IS NOT NULL),
         '{}'
       ) AS aliases,
       array_agg(DISTINCT ev.verse ORDER BY ev.verse) AS chapter_verses,
       (
         SELECT jsonb_build_object(
           'image_id',   oi.id,
           'url',        oi.image_url,
           'credit',     oi.credit,
           'credit_url', oi.credit_url,
           'license',    oi.license
         )
         FROM entity_image_links eil
         JOIN openbible_images oi ON oi.id = eil.image_id
         WHERE eil.entity_id = e.id
         ORDER BY CASE WHEN lower(eil.role) LIKE '%thumbnail%' THEN 0 ELSE 1 END, eil.image_id
         LIMIT 1
       ) AS thumbnail
     FROM entity_verses ev
     JOIN entities e ON e.id = ev.entity_id
     LEFT JOIN entity_aliases a ON a.entity_id = e.id
     WHERE ev.book_id = $1 AND ev.chapter = $2
     GROUP BY e.id
     ORDER BY count(DISTINCT ev.verse) DESC, e.canonical_name`,
    [bookId, chapter]
  );
  return rows;
}
