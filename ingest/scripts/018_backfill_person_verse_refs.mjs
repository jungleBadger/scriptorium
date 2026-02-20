// ingest/scripts/018_backfill_person_verse_refs.mjs
// Additive backfill for missing person verse anchors.
//
// This script only inserts rows into entity_verses for person entities that
// currently have no verse links. It does not update or delete existing data.
//
// Usage:
//   node ingest/scripts/018_backfill_person_verse_refs.mjs --translation WEBU
//   node ingest/scripts/018_backfill_person_verse_refs.mjs --translation WEBU --apply

import pg from "pg";

const { Client } = pg;

function getArg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTerm(raw) {
  const value = String(raw || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  return value.replace(/^[`"'([{]+|[`"')\]}.,;:!?]+$/g, "").trim();
}

function isLikelySingleTokenName(term) {
  return /^[A-Z][A-Za-z0-9']{2,}$/.test(term);
}

function buildBoundedRegex(term) {
  const escaped = escapeRegex(term).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`);
}

function chunksOf(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function main() {
  const translation = String(getArg("--translation", "WEBU") || "WEBU").trim();
  const apply = hasFlag("--apply");
  const onlySource = String(getArg("--source", "hitchcock") || "hitchcock").trim();
  const batchSize = Math.max(200, Number.parseInt(getArg("--batch-size", "1000"), 10) || 1000);

  const client = new Client({
    host: process.env.PGHOST || "localhost",
    port: Number.parseInt(process.env.PGPORT || "5432", 10),
    user: process.env.PGUSER || "bible",
    password: process.env.PGPASSWORD || "bible",
    database: process.env.PGDATABASE || "bible",
  });

  await client.connect();

  try {
    const peopleSql = `
      SELECT
        e.id,
        e.canonical_name,
        COALESCE(
          array_agg(DISTINCT a.name_form) FILTER (WHERE a.name_form IS NOT NULL),
          '{}'
        ) AS aliases
      FROM entities e
      LEFT JOIN entity_aliases a ON a.entity_id = e.id
      WHERE e.type = 'person'
        AND e.source = $1
        AND NOT EXISTS (
          SELECT 1
          FROM entity_verses ev
          WHERE ev.entity_id = e.id
        )
      GROUP BY e.id, e.canonical_name
      ORDER BY e.id
    `;

    const nonPersonTermsSql = `
      SELECT DISTINCT lower(trim(term)) AS term
      FROM (
        SELECT e.canonical_name AS term
        FROM entities e
        WHERE e.type <> 'person'

        UNION ALL

        SELECT a.name_form AS term
        FROM entity_aliases a
        JOIN entities e ON e.id = a.entity_id
        WHERE e.type <> 'person'
      ) t
      WHERE term IS NOT NULL
        AND trim(term) <> ''
    `;

    const versesSql = `
      SELECT book_id, chapter, verse, text_clean
      FROM verses
      WHERE translation = $1
      ORDER BY ordinal NULLS LAST, book_id, chapter, verse
    `;

    const [peopleRes, versesRes, nonPersonTermsRes] = await Promise.all([
      client.query(peopleSql, [onlySource]),
      client.query(versesSql, [translation]),
      client.query(nonPersonTermsSql),
    ]);

    const people = peopleRes.rows;
    const verses = versesRes.rows;
    const nonPersonTerms = new Set(
      nonPersonTermsRes.rows.map((r) => String(r.term || "").trim().toLowerCase()).filter(Boolean)
    );

    const entityTerms = new Map();
    const singleTokenTermMap = new Map(); // exact token -> entity ids
    const patternMatchers = []; // multi-token or punctuation-sensitive terms
    let skippedAmbiguousTerms = 0;

    for (const person of people) {
      const terms = new Set();
      const rawCandidates = [person.canonical_name, ...(person.aliases || [])];

      for (const candidate of rawCandidates) {
        const term = normalizeTerm(candidate);
        if (!term) continue;
        if (term.length < 3) continue;
        if (!/[A-Za-z]/.test(term)) continue;
        if (nonPersonTerms.has(term.toLowerCase())) {
          skippedAmbiguousTerms += 1;
          continue;
        }
        terms.add(term);
      }

      if (!terms.size) continue;
      entityTerms.set(person.id, terms);

      for (const term of terms) {
        if (isLikelySingleTokenName(term)) {
          if (!singleTokenTermMap.has(term)) singleTokenTermMap.set(term, new Set());
          singleTokenTermMap.get(term).add(person.id);
          continue;
        }

        patternMatchers.push({
          entityId: person.id,
          regex: buildBoundedRegex(term),
        });
      }
    }

    const proposedRows = [];
    const proposedPerEntity = new Map();
    const seenKey = new Set();

    for (const verseRow of verses) {
      const text = String(verseRow.text_clean || "");
      if (!text) continue;

      const matchedEntities = new Set();

      const tokens = text.match(/\b[A-Z][A-Za-z0-9']*\b/g) || [];
      for (const token of tokens) {
        const entityIds = singleTokenTermMap.get(token);
        if (!entityIds) continue;
        for (const entityId of entityIds) {
          matchedEntities.add(entityId);
        }
      }

      for (const matcher of patternMatchers) {
        if (matcher.regex.test(text)) matchedEntities.add(matcher.entityId);
      }

      if (!matchedEntities.size) continue;

      for (const entityId of matchedEntities) {
        const key = `${entityId}|${verseRow.book_id}|${verseRow.chapter}|${verseRow.verse}`;
        if (seenKey.has(key)) continue;
        seenKey.add(key);
        proposedRows.push({
          entity_id: entityId,
          book_id: verseRow.book_id,
          chapter: Number(verseRow.chapter),
          verse: Number(verseRow.verse),
        });
        proposedPerEntity.set(entityId, (proposedPerEntity.get(entityId) || 0) + 1);
      }
    }

    let inserted = 0;

    if (apply && proposedRows.length) {
      await client.query("BEGIN");
      try {
        for (const chunk of chunksOf(proposedRows, batchSize)) {
          const entityIds = chunk.map((r) => r.entity_id);
          const bookIds = chunk.map((r) => r.book_id);
          const chapters = chunk.map((r) => r.chapter);
          const versesArr = chunk.map((r) => r.verse);

          const insertSql = `
            INSERT INTO entity_verses (entity_id, book_id, chapter, verse)
            SELECT * FROM unnest($1::int[], $2::text[], $3::int[], $4::int[])
            ON CONFLICT DO NOTHING
          `;
          const result = await client.query(insertSql, [entityIds, bookIds, chapters, versesArr]);
          inserted += result.rowCount || 0;
        }

        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }

    const matchedEntityCount = proposedPerEntity.size;
    const unmatchedEntities = people.length - matchedEntityCount;
    const topEntities = [...proposedPerEntity.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([entityId, refs]) => {
        const person = people.find((p) => p.id === entityId);
        return {
          entity_id: entityId,
          canonical_name: person?.canonical_name || null,
          refs,
        };
      });

    console.log(
      JSON.stringify(
        {
          mode: apply ? "apply" : "dry-run",
          source: onlySource,
          translation,
          scanned_person_entities_without_refs: people.length,
          skipped_ambiguous_terms: skippedAmbiguousTerms,
          scanned_verses: verses.length,
          proposed_entity_verse_rows: proposedRows.length,
          inserted_entity_verse_rows: inserted,
          matched_person_entities: matchedEntityCount,
          unmatched_person_entities: unmatchedEntities,
          top_matched_entities: topEntities,
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
