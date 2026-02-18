// server/services/entitiesRepo.js
// Query entities, aliases, and verse references from Postgres.

import { getPool } from "./pool.js";

/**
 * Search entities by name prefix using ILIKE on entity_aliases.name_form.
 * Returns entities with aggregated aliases.
 */
export async function searchEntities(query, { type, limit = 20, offset = 0 } = {}) {
  const pool = getPool();
  const params = [`${query}%`, limit, offset];
  let typeClause = "";
  if (type) {
    typeClause = `AND e.type ILIKE $4`;
    params.push(`${type}%`);
  }

  const { rows } = await pool.query(
    `SELECT e.id, e.canonical_name, e.type, e.disambiguator, e.description,
            e.lon, e.lat, e.source, e.metadata,
            array_agg(DISTINCT a.name_form) AS aliases
     FROM entities e
     JOIN entity_aliases a ON a.entity_id = e.id
     WHERE a.name_form ILIKE $1 ${typeClause}
     GROUP BY e.id
     ORDER BY e.canonical_name
     LIMIT $2 OFFSET $3`,
    params
  );
  return rows;
}

/**
 * Get a single entity by ID with all aliases and verse references.
 */
export async function getEntityById(id) {
  const pool = getPool();

  const [entityRes, versesRes] = await Promise.all([
    pool.query(
      `SELECT e.id, e.canonical_name, e.type, e.disambiguator, e.description,
              e.lon, e.lat, e.source, e.source_id, e.metadata,
              array_agg(DISTINCT a.name_form) AS aliases
       FROM entities e
       JOIN entity_aliases a ON a.entity_id = e.id
       WHERE e.id = $1
       GROUP BY e.id`,
      [id]
    ),
    pool.query(
      `SELECT book_id, chapter, verse
       FROM entity_verses
       WHERE entity_id = $1
       ORDER BY book_id, chapter, verse`,
      [id]
    ),
  ]);

  if (!entityRes.rows.length) return null;

  return {
    ...entityRes.rows[0],
    verses: versesRes.rows,
  };
}

/**
 * Get all entities linked to a specific verse location.
 */
export async function getEntitiesByVerse(bookId, chapter, verse) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT e.id, e.canonical_name, e.type, e.disambiguator, e.description,
            e.lon, e.lat, e.source, e.metadata,
            array_agg(DISTINCT a.name_form) AS aliases
     FROM entity_verses ev
     JOIN entities e ON e.id = ev.entity_id
     JOIN entity_aliases a ON a.entity_id = e.id
     WHERE ev.book_id = $1 AND ev.chapter = $2 AND ev.verse = $3
     GROUP BY e.id
     ORDER BY e.canonical_name`,
    [bookId, chapter, verse]
  );
  return rows;
}
