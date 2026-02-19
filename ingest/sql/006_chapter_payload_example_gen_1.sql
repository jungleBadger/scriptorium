-- Example chapter payload query for WEBU Genesis 1 (includes verse 1:1).
-- Output: one JSON object with verses, chapter entities, and entities grouped by verse.

WITH params AS (
  SELECT
    'WEBU'::text AS translation,
    'GEN'::text AS book_id,
    4::int AS chapter
),
chapter_verses AS (
  SELECT
    v.translation,
    v.book_id,
    v.chapter,
    v.verse,
    v.verse_raw,
    v.ref,
    v.text_clean
  FROM verses v
  JOIN params p ON true
  WHERE v.translation = p.translation
    AND v.book_id = p.book_id
    AND v.chapter = p.chapter
),
entity_aliases_agg AS (
  SELECT
    a.entity_id,
    COALESCE(array_agg(DISTINCT a.name_form ORDER BY a.name_form), '{}') AS aliases
  FROM entity_aliases a
  GROUP BY a.entity_id
),
chapter_entities AS (
  SELECT
    e.id,
    e.canonical_name,
    e.type,
    e.disambiguator,
    e.description,
    e.lon,
    e.lat,
    COALESCE(aa.aliases, '{}') AS aliases,
    array_agg(DISTINCT ev.verse ORDER BY ev.verse) AS verses_in_chapter,
    COUNT(DISTINCT ev.verse) AS verse_hits
  FROM entity_verses ev
  JOIN entities e ON e.id = ev.entity_id
  LEFT JOIN entity_aliases_agg aa ON aa.entity_id = e.id
  JOIN params p ON true
  WHERE ev.book_id = p.book_id
    AND ev.chapter = p.chapter
  GROUP BY
    e.id, e.canonical_name, e.type, e.disambiguator, e.description, e.lon, e.lat, aa.aliases
),
entities_by_verse AS (
  SELECT
    ev.verse,
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'canonical_name', e.canonical_name,
        'type', e.type
      )
      ORDER BY e.canonical_name
    ) AS entities
  FROM entity_verses ev
  JOIN entities e ON e.id = ev.entity_id
  JOIN params p ON true
  WHERE ev.book_id = p.book_id
    AND ev.chapter = p.chapter
  GROUP BY ev.verse
)
SELECT jsonb_build_object(
  'translation', (SELECT translation FROM params),
  'book_id', (SELECT book_id FROM params),
  'chapter', (SELECT chapter FROM params),
  'verse_count', (SELECT COUNT(*) FROM chapter_verses),
  'entity_count', (SELECT COUNT(*) FROM chapter_entities),
  'verses', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'verse', v.verse,
        'verse_raw', v.verse_raw,
        'ref', v.ref,
        'text', v.text_clean
      )
      ORDER BY v.verse, v.verse_raw
    )
    FROM chapter_verses v
  ), '[]'::jsonb),
  'entities', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'canonical_name', e.canonical_name,
        'type', e.type,
        'disambiguator', e.disambiguator,
        'description', e.description,
        'lon', e.lon,
        'lat', e.lat,
        'aliases', to_jsonb(e.aliases),
        'verses_in_chapter', to_jsonb(e.verses_in_chapter),
        'verse_hits', e.verse_hits
      )
      ORDER BY e.verse_hits DESC, e.canonical_name
    )
    FROM chapter_entities e
  ), '[]'::jsonb),
  'entities_by_verse', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'verse', ebv.verse,
        'entities', ebv.entities
      )
      ORDER BY ebv.verse
    )
    FROM entities_by_verse ebv
  ), '[]'::jsonb)
) AS chapter_payload;
