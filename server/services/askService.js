// server/services/askService.js
// Retrieval + prompt composition + Gemini answer generation for /api/ask.
// Vector/semantic search is intentionally omitted in this version;
// context is built from chapter text + entity lookup instead.

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { searchEntities } from "./entitiesRepo.js";
import { generateGeminiText } from "./geminiClient.js";
import { getChapter } from "./versesRepo.js";
import { getPool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASK_PROMPT_TEMPLATE = readFileSync(join(__dirname, "../prompts/ask.txt"), "utf-8").trimEnd();

const TRANSLATION_LANGUAGE_NAME = {
  PT1911: "Portuguese",
  ARC:    "Portuguese",
};

function translationLanguageName(translation) {
  return TRANSLATION_LANGUAGE_NAME[String(translation || "").toUpperCase()] ?? "English";
}

const ENTITY_STOPWORDS = new Set([
  "about", "after", "also", "been", "being", "from", "have", "into", "that", "their",
  "them", "then", "there", "these", "this", "those", "what", "when", "where", "which",
  "with", "would", "your", "como", "quando", "onde", "sobre", "qual", "quais", "para",
  "com", "dos", "das", "uma", "um", "uns", "umas", "isso", "isto", "esse", "essa", "que",
  "quem", "foi", "sao",
]);

const MAX_ENTITY_TERMS      = 8;
const ENTITY_SEARCH_LIMIT   = 30;
const ENTITY_REFS_PER_ENTITY = 8;

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
    const tail  = parts[parts.length - 1] || value;
    if (tail.length >= 3 && !ENTITY_STOPWORDS.has(tail)) words.push(tail);
  }

  const seen   = new Set();
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
  const sourceId  = normalizeToken(entity?.source_id);
  const entityId  = String(entity?.id ?? "");

  let score = Math.max(0, 120 - termIndex * 20 - rowIndex);
  if (canonical.startsWith(term)) score += 45;
  if (canonical.includes(term))   score += 15;
  if (sourceId && sourceId.includes(term)) score += 15;

  const candidateKeys = new Set([
    normalizeActiveEntityId(entityId),
    normalizeActiveEntityId(`entity:${entityId}`),
    sourceId ? normalizeActiveEntityId(sourceId) : "",
    sourceId ? normalizeActiveEntityId(`${entity?.source || ""}:${sourceId}`) : "",
  ]);
  for (const key of candidateKeys) {
    if (!key) continue;
    if (activeBoostKeys.has(key)) { score += 1000; break; }
  }
  return score;
}

async function fetchActiveEntityRows(activeEntityIds) {
  const ids = Array.isArray(activeEntityIds) ? activeEntityIds : [];
  if (!ids.length) return [];

  const numericIds = [];
  const sourceIds  = [];
  for (const raw of ids) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) continue;
    if (/^\d+$/.test(trimmed)) { numericIds.push(Number(trimmed)); continue; }
    const parts    = trimmed.split(":").filter(Boolean);
    const sourceId = parts[parts.length - 1] || trimmed;
    if (sourceId) sourceIds.push(sourceId.toLowerCase());
  }

  if (!numericIds.length && !sourceIds.length) return [];

  const { rows } = await getPool().query(
    `SELECT e.id, e.canonical_name, e.type, e.source, e.source_id
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
      `SELECT e.id, e.canonical_name, e.type, e.source, e.source_id
       FROM entities e
       WHERE e.id = ANY($1::int[])
       ORDER BY array_position($1::int[], e.id)`,
      [entityIds]
    ),
    pool.query(
      `SELECT entity_id, book_id, chapter, verse
       FROM (
         SELECT ev.entity_id, ev.book_id, ev.chapter, ev.verse,
                ROW_NUMBER() OVER (
                  PARTITION BY ev.entity_id ORDER BY ev.book_id, ev.chapter, ev.verse
                ) AS rn
         FROM entity_verses ev WHERE ev.entity_id = ANY($1::int[])
       ) ranked
       WHERE rn <= $2
       ORDER BY entity_id, rn`,
      [entityIds, ENTITY_REFS_PER_ENTITY]
    ),
  ]);

  const refsByEntity = new Map();
  for (const row of refsRows.rows) {
    const list = refsByEntity.get(row.entity_id) || [];
    list.push({ book_id: row.book_id, chapter: row.chapter, verse: row.verse,
                ref: `${row.book_id} ${row.chapter}:${row.verse}` });
    refsByEntity.set(row.entity_id, list);
  }

  return entityRows.rows.map((row) => ({
    id:         row.id,
    type:       row.type,
    name:       row.canonical_name,
    appears_in: refsByEntity.get(row.id) || [],
    ...(row.source    ? { source:    row.source }    : {}),
    ...(row.source_id ? { source_id: row.source_id } : {}),
  }));
}

export async function retrieveFoundEntities({ question, activeEntityIds = [], kEntities = 12 } = {}) {
  const terms         = extractEntityTerms(question, activeEntityIds);
  const activeBoostKeys = new Set(
    (activeEntityIds || []).map(normalizeActiveEntityId).filter(Boolean)
  );

  const ranked = new Map();

  const allResults = await Promise.all(
    terms.map((term) => searchEntities(term, { limit: ENTITY_SEARCH_LIMIT, offset: 0 }))
  );
  for (const [termIndex, result] of allResults.entries()) {
    const term = terms[termIndex];
    const rows = Array.isArray(result?.results) ? result.results : [];
    for (const [rowIndex, row] of rows.entries()) {
      const current = ranked.get(row.id);
      const score   = scoreEntityCandidate(row, term, termIndex, rowIndex, activeBoostKeys);
      if (!current || score > current.score) ranked.set(row.id, { score });
    }
  }

  const activeRows = await fetchActiveEntityRows(activeEntityIds);
  for (const row of activeRows) {
    const current     = ranked.get(row.id);
    const boostedScore = 5000;
    if (!current || boostedScore > current.score) ranked.set(row.id, { score: boostedScore });
  }

  const orderedIds = [...ranked.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[0] - b[0])
    .slice(0, Math.max(1, kEntities))
    .map(([entityId]) => entityId);

  if (!orderedIds.length) return [];
  return hydrateEntities(orderedIds);
}

export function buildAskPrompt({ question, translation, book, chapter, verse, chapterVerses = [], foundEntities = [] } = {}) {
  const chapterTextBlock = chapterVerses.length
    ? `[CHAPTER_TEXT]\n${book} ${chapter} (${translation})\n${chapterVerses.map((v) => `${v.verse} ${v.text}`).join("\n")}`
    : "";

  const entityNames = Array.isArray(foundEntities)
    ? foundEntities.slice(0, 5).map((e) => `${e.name} (${e.type})`).filter(Boolean)
    : [];
  const contextEntitiesBlock = entityNames.length
    ? `[CONTEXT_ENTITIES]\n${entityNames.join(", ")}`
    : "";

  return ASK_PROMPT_TEMPLATE
    .replace("{{LANGUAGE}}", translationLanguageName(translation))
    .replace("{{TRANSLATION}}", translation)
    .replace("{{BOOK}}", book)
    .replace("{{CHAPTER}}", chapter)
    .replace("{{VERSE}}", verse)
    .replace("{{CHAPTER_TEXT_BLOCK}}", chapterTextBlock)
    .replace("{{CONTEXT_ENTITIES_BLOCK}}", contextEntitiesBlock)
    .replace("{{QUESTION}}", question)
    .replace(/\n{3,}/g, "\n\n") // collapse extra blank lines from empty optional blocks
    .trimEnd();
}

export async function askQuestion({
  question,
  translation,
  book,
  chapter,
  verse,
  activeEntityIds = [],
  kEntities = 12,
} = {}) {
  const cleanQuestion    = String(question || "").trim();
  if (!cleanQuestion) throw new Error("Question cannot be empty.");

  const normalizedBook    = String(book || "").trim().toUpperCase();
  const normalizedChapter = Number(chapter);

  const [foundEntities, chapterVerses] = await Promise.all([
    retrieveFoundEntities({ question: cleanQuestion, activeEntityIds, kEntities }),
    getChapter(translation, normalizedBook, normalizedChapter),
  ]);

  const prompt = buildAskPrompt({
    question: cleanQuestion,
    translation,
    book:    normalizedBook,
    chapter: normalizedChapter,
    verse,
    chapterVerses,
    foundEntities,
  });

  const rawResponseText = await generateGeminiText({ prompt, temperature: 0.2, maxTokens: 800 });

  return {
    raw_response_text:  rawResponseText,
    found_entities:     foundEntities,
    relevant_passages:  [], // vector search removed; re-enabled when embeddings are re-ingested
  };
}
