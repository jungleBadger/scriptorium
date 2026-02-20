// server/services/askService.js
// Retrieval + prompt composition + Ollama answer generation for /api/ask.

import { getPool } from "./pool.js";
import { searchEntities } from "./entitiesRepo.js";
import { embedQuery } from "./embedder.js";
import { searchChunks } from "./vectorSearch.js";
import { fetchChunksByIds } from "./chunksRepo.js";
import { rerank } from "./rerank.js";
import { generateOllamaText } from "./ollamaClient.js";
import { getVerseRange } from "./versesRepo.js";

const ENTITY_STOPWORDS = new Set([
  "about", "after", "also", "been", "being", "from", "have", "into", "that", "their",
  "them", "then", "there", "these", "this", "those", "what", "when", "where", "which",
  "with", "would", "your", "como", "quando", "onde", "sobre", "qual", "quais", "para",
  "com", "dos", "das", "uma", "um", "uns", "umas", "isso", "isto", "esse", "essa", "que",
  "quem", "foi", "sao",
]);

const MAX_ENTITY_TERMS = 8;
const ENTITY_SEARCH_LIMIT = 30;
const ENTITY_REFS_PER_ENTITY = 8;
const MAX_RELEVANT_PASSAGES_RESPONSE = 3;

function normalizeToken(value) {
  return String(value || "").trim().toLowerCase();
}

function extractEntityTerms(question, activeEntityIds = []) {
  const words = String(question || "")
    .split(/[^\p{L}\p{N}]+/u)
    .map(normalizeToken)
    .filter((token) => token.length >= 3 && !ENTITY_STOPWORDS.has(token));

  for (const id of activeEntityIds || []) {
    const value = normalizeToken(id);
    if (!value) continue;
    const parts = value.split(":").filter(Boolean);
    const tail = parts[parts.length - 1] || value;
    if (tail.length >= 3 && !ENTITY_STOPWORDS.has(tail)) words.push(tail);
  }

  const seen = new Set();
  const unique = [];
  for (const term of words) {
    if (seen.has(term)) continue;
    seen.add(term);
    unique.push(term);
    if (unique.length >= MAX_ENTITY_TERMS) break;
  }
  return unique;
}

function normalizeActiveEntityId(value) {
  return normalizeToken(value).replace(/\s+/g, "");
}

function scoreEntityCandidate(entity, term, termIndex, rowIndex, activeBoostKeys) {
  const canonical = normalizeToken(entity?.canonical_name);
  const sourceId = normalizeToken(entity?.source_id);
  const entityId = String(entity?.id ?? "");

  let score = Math.max(0, 120 - termIndex * 20 - rowIndex);
  if (canonical.startsWith(term)) score += 45;
  if (canonical.includes(term)) score += 15;
  if (sourceId && sourceId.includes(term)) score += 15;

  const candidateKeys = new Set([
    normalizeActiveEntityId(entityId),
    normalizeActiveEntityId(`entity:${entityId}`),
    sourceId ? normalizeActiveEntityId(sourceId) : "",
    sourceId ? normalizeActiveEntityId(`${entity?.source || ""}:${sourceId}`) : "",
  ]);
  for (const key of candidateKeys) {
    if (!key) continue;
    if (activeBoostKeys.has(key)) {
      score += 1000;
      break;
    }
  }

  return score;
}

async function fetchActiveEntityRows(activeEntityIds) {
  const ids = Array.isArray(activeEntityIds) ? activeEntityIds : [];
  if (!ids.length) return [];

  const numericIds = [];
  const sourceIds = [];
  for (const raw of ids) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) continue;
    if (/^\d+$/.test(trimmed)) {
      numericIds.push(Number(trimmed));
      continue;
    }
    const parts = trimmed.split(":").filter(Boolean);
    const sourceId = parts[parts.length - 1] || trimmed;
    if (sourceId) sourceIds.push(sourceId.toLowerCase());
  }

  if (!numericIds.length && !sourceIds.length) return [];

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
       e.id, e.canonical_name, e.type, e.lon, e.lat, e.source, e.source_id,
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
     WHERE e.id = ANY($1::int[]) OR lower(coalesce(e.source_id, '')) = ANY($2::text[])`,
    [numericIds, sourceIds]
  );
  return rows;
}

async function hydrateEntities(entityIds) {
  if (!entityIds.length) return [];
  const pool = getPool();

  const [entityRows, refsRows] = await Promise.all([
    pool.query(
      `SELECT
         e.id, e.canonical_name, e.type, e.lon, e.lat, e.source, e.source_id,
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
       WHERE e.id = ANY($1::int[])
       ORDER BY array_position($1::int[], e.id)`,
      [entityIds]
    ),
    pool.query(
      `SELECT entity_id, book_id, chapter, verse
       FROM (
         SELECT
           ev.entity_id, ev.book_id, ev.chapter, ev.verse,
           ROW_NUMBER() OVER (
             PARTITION BY ev.entity_id
             ORDER BY ev.book_id, ev.chapter, ev.verse
           ) AS rn
         FROM entity_verses ev
         WHERE ev.entity_id = ANY($1::int[])
       ) ranked
       WHERE rn <= $2
       ORDER BY entity_id, rn`,
      [entityIds, ENTITY_REFS_PER_ENTITY]
    ),
  ]);

  const refsByEntity = new Map();
  for (const row of refsRows.rows) {
    const list = refsByEntity.get(row.entity_id) || [];
    list.push({
      book_id: row.book_id,
      chapter: row.chapter,
      verse: row.verse,
      ref: `${row.book_id} ${row.chapter}:${row.verse}`,
    });
    refsByEntity.set(row.entity_id, list);
  }

  return entityRows.rows.map((row) => {
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);
    return {
      id: row.id,
      type: row.type,
      name: row.canonical_name,
      appears_in: refsByEntity.get(row.id) || [],
      ...(hasCoords ? { lat, lon } : {}),
      ...(row.thumbnail ? { thumbnail: row.thumbnail } : {}),
      ...(row.source ? { source: row.source } : {}),
      ...(row.source_id ? { source_id: row.source_id } : {}),
    };
  });
}

export async function retrieveFoundEntities({
  question,
  activeEntityIds = [],
  kEntities = 12,
} = {}) {
  const terms = extractEntityTerms(question, activeEntityIds);
  const activeBoostKeys = new Set(
    (activeEntityIds || []).map(normalizeActiveEntityId).filter(Boolean)
  );

  const ranked = new Map();

  for (const [termIndex, term] of terms.entries()) {
    const result = await searchEntities(term, { limit: ENTITY_SEARCH_LIMIT, offset: 0 });
    const rows = Array.isArray(result?.results) ? result.results : [];
    for (const [rowIndex, row] of rows.entries()) {
      const current = ranked.get(row.id);
      const score = scoreEntityCandidate(row, term, termIndex, rowIndex, activeBoostKeys);
      if (!current || score > current.score) {
        ranked.set(row.id, { score });
      }
    }
  }

  const activeRows = await fetchActiveEntityRows(activeEntityIds);
  for (const row of activeRows) {
    const current = ranked.get(row.id);
    const boostedScore = 5000;
    if (!current || boostedScore > current.score) {
      ranked.set(row.id, { score: boostedScore });
    }
  }

  const orderedIds = [...ranked.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[0] - b[0])
    .slice(0, Math.max(1, kEntities))
    .map(([entityId]) => entityId);

  if (!orderedIds.length) return [];
  return hydrateEntities(orderedIds);
}

export async function retrieveRelevantPassages({
  question,
  translation,
  book,
  chapter,
  verse,
  kPassages = 10,
} = {}) {
  const requested = Math.max(1, Math.trunc(Number(kPassages) || 10));
  const limit = Math.min(MAX_RELEVANT_PASSAGES_RESPONSE, requested);
  const passages = [];
  const seenRanges = new Set();

  const bookId = String(book || "").trim().toUpperCase();
  const chapterNumber = Number(chapter);
  const verseNumber = Number(verse);
  const hasValidAnchor =
    bookId &&
    Number.isFinite(chapterNumber) &&
    chapterNumber > 0 &&
    Number.isFinite(verseNumber) &&
    verseNumber > 0;

  if (hasValidAnchor) {
    const currentVerse = await getVerseRange(
      translation,
      bookId,
      chapterNumber,
      verseNumber,
      verseNumber
    );
    const verseText = String(currentVerse?.[0]?.text || "").trim();
    if (verseText) {
      passages.push({
        id: `anchor:${translation}:${bookId}:${chapterNumber}:${verseNumber}`,
        ref: `${bookId} ${chapterNumber}:${verseNumber}`,
        source: "verse",
        snippet: verseText,
        score: 1,
        book_id: bookId,
        chapter: chapterNumber,
        verse_start: verseNumber,
        verse_end: verseNumber,
        translation,
      });
      seenRanges.add(`${bookId}:${chapterNumber}:${verseNumber}:${verseNumber}`);
    }
  }

  if (passages.length >= limit) return passages.slice(0, limit);

  const vector = await embedQuery(question);
  const candidateLimit = Math.max(limit * 3, 30);
  const candidates = await searchChunks(vector, candidateLimit, [translation]);
  if (!candidates.length) return passages;

  const ids = candidates.map((row) => row.chunk_id);
  const chunks = await fetchChunksByIds(ids);
  const chunkById = new Map(chunks.map((row) => [row.chunk_id, row]));

  const hydrated = candidates
    .filter((row) => chunkById.has(row.chunk_id))
    .map((row) => ({
      ...row,
      text_clean: chunkById.get(row.chunk_id).text_clean,
    }));

  const ranked = rerank(hydrated, question, "explorer");
  for (const row of ranked) {
    if (passages.length >= limit) break;
    const sameRef = row.ref_start && row.ref_end && row.ref_start === row.ref_end;
    const source =
      Number.isFinite(row.verse_start) &&
      Number.isFinite(row.verse_end) &&
      row.verse_start === row.verse_end
        ? "verse"
        : "chunk";
    const rangeKey = `${row.book_id}:${row.chapter}:${row.verse_start}:${row.verse_end}`;
    if (seenRanges.has(rangeKey)) continue;
    seenRanges.add(rangeKey);

    passages.push({
      id: row.chunk_id,
      ref: sameRef ? row.ref_start : `${row.ref_start} - ${row.ref_end}`,
      source,
      snippet: row.text_clean,
      score: row.final_score,
      book_id: row.book_id,
      chapter: row.chapter,
      verse_start: row.verse_start,
      verse_end: row.verse_end,
      translation: row.translation,
    });
  }

  return passages;
}

export function buildAskPrompt({
  question,
  translation,
  book,
  chapter,
  verse,
  anchorPassage = null,
} = {}) {
  const location = `${translation} ${book} ${chapter}:${verse}`;
  const anchorRef = String(anchorPassage?.ref || location).trim();
  const anchorText = String(anchorPassage?.snippet || "").trim();
  const anchorLine = anchorText ? `${anchorRef} - ${anchorText}` : `${anchorRef} - (text unavailable)`;

  return [
    "You are a Bible study assistant.",
    "Answer the user's question as directly and helpfully as possible.",
    "The reader location is optional context, not a hard constraint.",
    "The user may ask about any biblical topic beyond the selected passage.",
    "Use your broader biblical knowledge when needed.",
    "Do not default to saying context is missing when you can answer.",
    "Treat spelling variants like Caim/Cain as likely equivalents when appropriate.",
    "If uncertain, give your best effort and note uncertainty briefly.",
    "Output plain text only.",
    "Do not use Markdown formatting (no headings, bullet lists, numbered lists, bold, italics, or code fences).",
    "Do not output JSON.",
    "",
    "[READER_LOCATION]",
    location,
    "",
    "[READER_CONTEXT_VERSE]",
    anchorLine,
    "",
    "[QUESTION]",
    question,
  ].join("\n");
}

export async function askQuestion({
  question,
  translation,
  book,
  chapter,
  verse,
  activeEntityIds = [],
  kEntities = 12,
  kPassages = 10,
} = {}) {
  const cleanQuestion = String(question || "").trim();
  if (!cleanQuestion) throw new Error("Question cannot be empty.");

  const [foundEntities, relevantPassages] = await Promise.all([
    retrieveFoundEntities({ question: cleanQuestion, activeEntityIds, kEntities }),
    retrieveRelevantPassages({ question: cleanQuestion, translation, book, chapter, verse, kPassages }),
  ]);

  const normalizedBook = String(book || "").trim().toUpperCase();
  const normalizedChapter = Number(chapter);
  const normalizedVerse = Number(verse);
  const anchorPassage = relevantPassages.find((passage) => (
    String(passage?.book_id || "").trim().toUpperCase() === normalizedBook &&
    Number(passage?.chapter) === normalizedChapter &&
    Number(passage?.verse_start) === normalizedVerse &&
    Number(passage?.verse_end) === normalizedVerse
  )) || null;

  const prompt = buildAskPrompt({
    question: cleanQuestion,
    translation,
    book,
    chapter,
    verse,
    anchorPassage,
  });

  const rawResponseText = await generateOllamaText({
    prompt,
    model: "qwen3:8b",
    temperature: 0.2,
    maxTokens: 700,
  });

  return {
    raw_response_text: rawResponseText,
    found_entities: foundEntities,
    relevant_passages: relevantPassages,
  };
}
