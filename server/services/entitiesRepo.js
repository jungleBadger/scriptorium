// server/services/entitiesRepo.js
// Query entities, aliases, and verse references from Postgres.

import { getPool } from "./pool.js";

/**
 * Search entities by name prefix using ILIKE on entity_aliases.name_form.
 * Returns entities with aggregated aliases.
 */
export async function searchEntities(query, { type, limit = 20, offset = 0 } = {}) {
  const pool = getPool();
  const prefix = `${query}%`;
  const whereClauses = [
    `(e.canonical_name ILIKE $1 OR EXISTS (
      SELECT 1 FROM entity_aliases a2
      WHERE a2.entity_id = e.id AND a2.name_form ILIKE $1
    ))`,
  ];
  const whereParams = [prefix];
  if (type) {
    whereParams.push(`${type}%`);
    whereClauses.push(`e.type ILIKE $${whereParams.length}`);
  }
  const whereSql = whereClauses.join(" AND ");

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM entities e
    WHERE ${whereSql}
  `;

  const dataParams = [...whereParams, limit, offset];
  const limitParam = `$${whereParams.length + 1}`;
  const offsetParam = `$${whereParams.length + 2}`;
  const dataSql = `
    SELECT e.id, e.canonical_name, e.type, e.disambiguator, e.description,
           e.lon, e.lat, e.source, e.metadata,
           COALESCE(array_remove(array_agg(DISTINCT a.name_form), NULL), '{}') AS aliases
    FROM entities e
    LEFT JOIN entity_aliases a ON a.entity_id = e.id
    WHERE ${whereSql}
    GROUP BY e.id
    ORDER BY e.canonical_name
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `;

  const [countRes, rowsRes] = await Promise.all([
    pool.query(countSql, whereParams),
    pool.query(dataSql, dataParams),
  ]);

  return {
    total: countRes.rows[0]?.total ?? 0,
    results: rowsRes.rows,
  };
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
              COALESCE(array_remove(array_agg(DISTINCT a.name_form), NULL), '{}') AS aliases,
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
       FROM entities e
       LEFT JOIN entity_aliases a ON a.entity_id = e.id
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

  const entity = entityRes.rows[0];

  // Resolve related entity IDs from LLM enrichment to { id, canonical_name, type }
  let related = [];
  const relatedIds = entity.metadata?.llm_enrichment?.related_entities;
  if (Array.isArray(relatedIds) && relatedIds.length > 0) {
    const { rows } = await pool.query(
      `SELECT id, canonical_name, type FROM entities WHERE id = ANY($1::int[])`,
      [relatedIds]
    );
    related = rows;
  }

  return {
    ...entity,
    verses: versesRes.rows,
    related,
  };
}

/**
 * Get all entities with geo coordinates (for map layer).
 * Optional type/bounding-box filter plus pagination.
 */
export async function getGeoEntities({
  type,
  minLon,
  maxLon,
  minLat,
  maxLat,
  limit = 1000,
  offset = 0,
} = {}) {
  const pool = getPool();
  const params = [];
  const whereClauses = ["lon IS NOT NULL", "lat IS NOT NULL"];

  if (type) {
    params.push(`${type}%`);
    whereClauses.push(`type ILIKE $${params.length}`);
  }

  const hasBounds =
    Number.isFinite(minLon) &&
    Number.isFinite(maxLon) &&
    Number.isFinite(minLat) &&
    Number.isFinite(maxLat);
  if (hasBounds) {
    params.push(minLon, maxLon, minLat, maxLat);
    whereClauses.push(`lon BETWEEN $${params.length - 3} AND $${params.length - 2}`);
    whereClauses.push(`lat BETWEEN $${params.length - 1} AND $${params.length}`);
  }

  const whereSql = whereClauses.join(" AND ");
  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM entities
    WHERE ${whereSql}
  `;

  const dataParams = [...params, limit, offset];
  const limitParam = `$${params.length + 1}`;
  const offsetParam = `$${params.length + 2}`;
  const dataSql = `
    SELECT id, canonical_name, type, lon, lat
    FROM entities
    WHERE ${whereSql}
    ORDER BY id
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `;

  const [countRes, rowsRes] = await Promise.all([
    pool.query(countSql, params),
    pool.query(dataSql, dataParams),
  ]);

  return {
    total: countRes.rows[0]?.total ?? 0,
    results: rowsRes.rows,
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
            COALESCE(array_remove(array_agg(DISTINCT a.name_form), NULL), '{}') AS aliases,
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
     WHERE ev.book_id = $1 AND ev.chapter = $2 AND ev.verse = $3
     GROUP BY e.id
     ORDER BY e.canonical_name`,
    [bookId, chapter, verse]
  );
  return rows;
}
