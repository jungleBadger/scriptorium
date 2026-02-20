// ingest/scripts/017_escalate_chapters_openai.mjs
// Phase 3 chapter explanation pipeline.
// Escalates errored / low-confidence chapters from a prior run to the OpenAI API.
// Full quality retry chain. Requires OPENAI_API_KEY.
//
// Requires --source-model to identify which prior model's results to escalate from.
//
// Usage:
//   export OPENAI_API_KEY=sk-...
//   node ingest/scripts/017_escalate_chapters_openai.mjs --source-model qwen3:14b
//   node ingest/scripts/017_escalate_chapters_openai.mjs --source-model qwen3:14b --min-band medium
//   node ingest/scripts/017_escalate_chapters_openai.mjs --source-model qwen3:14b --model gpt-4o
//   node ingest/scripts/017_escalate_chapters_openai.mjs --source-model qwen3:14b --translation PT1911 --limit 20

import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { BOOK_ORDER } from "../../server/data/bookNames.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const DEFAULT_MODEL = process.env.CHAPTER_MODEL || "gpt-4o-mini";
const DEFAULT_TEMPERATURE = Number.parseFloat(process.env.CHAPTER_TEMP || "0.15");
const DEFAULT_VERBOSITY_RETRY_TEMP = Number.parseFloat(process.env.CHAPTER_VERBOSE_RETRY_TEMP || "0.2");
const DEFAULT_MAX_TOKENS = Number.parseInt(process.env.CHAPTER_MAX_TOKENS || "900", 10);
const DEFAULT_WORD_TARGET = Number.parseInt(process.env.CHAPTER_WORD_TARGET || "220", 10);
const MIN_EXPLANATION_WORDS_FLOOR = 80;
const HARD_MAX_EXPLANATION_WORDS = 260;
const MAX_ALIASES_PER_ENTITY = 2;

const DEFAULT_PROMPT_PATH =
    process.env.CHAPTER_PROMPT || path.join("ingest", "prompts", "chapter_explainer_prompt.txt");

const SYSTEM_PROMPT = [
    "You are a biblical chapter explainer.",
    "Base the explanation ONLY on the verses included in the user message.",
    "Do NOT introduce events or claims not explicitly supported by those verses.",
    "If the chapter is list-heavy (genealogies/descendants, borders/cities/inheritance), summarize the repeated listing and explain what is being listed.",
    "Do NOT mention payload, JSON, schema, arrays, objects, fields, keys, input/output, or how the input is organized.",
    "If uncertain, prefer describing explicitly listed details over guessing.",
    "Output valid JSON only.",
].join(" ");

const CANONICAL_BOOK_IDS = BOOK_ORDER.map((b) => b.book_id);

const LIST_HEAVY_RATIO_THRESHOLD = 0.30;

const LIST_HEAVY_NOTE =
    "NOTE: This chapter is list-heavy (genealogies/descendants or places/borders/cities). Summarize the repeated listing collectively and explain what is being listed. Avoid inventing narrative events.";

const META_TALK_RETRY_NOTE =
    'IMPORTANT: Do NOT mention payload, dataset, JSON, arrays, objects, schema, fields, keys, input/output, provided data, or how the input is organized. Avoid framing like "the structure/format/pattern/each entry"; instead directly describe what the chapter says. Use concrete details from the verses and include verse refs like (v. 1, v. 13). Output valid JSON only.';

const LIST_HEAVY_KEYWORDS = [
    "border", "borders", "boundary", "boundaries",
    "city", "cities", "town", "towns",
    "inheritance", "allotment", "territory", "settlement", "settlements",
    "fronteira", "fronteiras", "cidade", "cidades", "heranca", "territorio", "territorios",
];

const GENEALOGY_KEYWORDS = [
    "begat", "genealogy", "generations", "descendant", "descendants",
    "sons", "sons of", "father", "lived", "years",
    "geracoes", "geração", "descendentes", "filhos", "filhos de", "pai", "anos",
];

const STRUCTURAL_GROUNDING_TOKENS = [
    "border", "borders", "boundary", "boundaries",
    "city", "cities", "inheritance", "allotment", "territory", "settlement", "settlements",
    "fronteira", "fronteiras", "cidade", "cidades", "heranca", "herancas",
    "territorio", "territorios", "limite", "limites", "divisa", "divisas", "lote", "lotes",
];

const UNGROUNDED_LIST_HEAVY_PHRASES = [
    /joshua['']?s leadership/i,
    /\bunity under joshua\b/i,
    /levitical priests?/i,
    /\bpriests?\s+maintaining\s+order\b/i,
    /\bpriestly duties\b/i,
    /\bprepare(?:d|s|ing)?\s+for\s+(?:the\s+)?(?:conquest|campaign)\b/i,
    /\bpreparing for conquest\b/i,
    /\bpreparing for campaign\b/i,
    /\bdivine assurance\b/i,
    /\bgod['']?s presence(?:\s+with\s+them)?\b/i,
    /\bpresence of god\b/i,
    /cross(ing)?\s+the\s+jordan/i,
    /\bark\s+of\s+the\s+covenant\b/i,
    /\bspiritual order before the campaign\b/i,
];

const TOKEN_STOPWORDS = new Set([
    "the", "and", "for", "with", "from", "into", "unto",
    "that", "this", "these", "those", "they", "their", "them",
    "his", "her", "its", "was", "were", "are", "had", "have", "has",
    "not", "but", "you", "your", "shall", "will", "then",
    "when", "where", "which", "each", "every", "among", "also",
    "chapter", "verse", "verses",
]);

// ── SQL ───────────────────────────────────────────────────────────────────────

// $1 translation  $2 sourceModel  $3 bookId (nullable)  $4 chapter (nullable int)
// $5 escalateBands (text[])  $6 CANONICAL_BOOK_IDS (text[])
const ESCALATION_CHAPTER_SQL = `
    WITH
    escalation_candidates AS (
        SELECT DISTINCT
            ce.book_id,
            ce.chapter
        FROM chapter_explanations ce
        WHERE ce.translation = $1
          AND ce.model = $2
          AND (
              ce.status = 'error'
              OR ce.output_json->'_meta'->>'confidence_band' = ANY($5::text[])
          )
          AND ($3::text IS NULL OR ce.book_id = $3)
          AND ($4::int  IS NULL OR ce.chapter = $4)
    ),
    chapter_order AS (
        SELECT
            v.book_id,
            v.chapter,
            MIN(COALESCE(v.ordinal, 2147483647)) AS chapter_ordinal
        FROM verses v
        JOIN escalation_candidates ec
          ON ec.book_id = v.book_id AND ec.chapter = v.chapter
        WHERE v.translation = $1
        GROUP BY v.book_id, v.chapter
    )
    SELECT
        c.book_id,
        c.chapter,
        c.chapter_ordinal AS first_ordinal
    FROM chapter_order c
    LEFT JOIN unnest($6::text[]) WITH ORDINALITY bo(book_id, book_pos)
      ON bo.book_id = c.book_id
    ORDER BY COALESCE(bo.book_pos, 100000), c.chapter, c.chapter_ordinal
`;

const CHAPTER_PAYLOAD_SQL = `
    WITH params AS (
      SELECT $1::text AS translation, $2::text AS book_id, $3::int AS chapter
    ),
    chapter_verses AS (
      SELECT v.verse, v.verse_raw, v.ref, v.text_clean
      FROM verses v
      JOIN params p ON true
      WHERE v.translation = p.translation
        AND v.book_id = p.book_id
        AND v.chapter = p.chapter
      ORDER BY v.verse, v.verse_raw
    ),
    alias_agg AS (
      SELECT a.entity_id,
             COALESCE(array_agg(DISTINCT a.name_form ORDER BY a.name_form), '{}') AS aliases
      FROM entity_aliases a
      GROUP BY a.entity_id
    ),
    chapter_entity_hits AS (
      SELECT ev.entity_id,
             array_agg(DISTINCT ev.verse ORDER BY ev.verse) AS verses_in_chapter,
             COUNT(DISTINCT ev.verse) AS verse_hits
      FROM entity_verses ev
      JOIN params p ON true
      WHERE ev.book_id = p.book_id AND ev.chapter = p.chapter
      GROUP BY ev.entity_id
    ),
    chapter_entities AS (
      SELECT e.id, e.canonical_name, e.type, e.disambiguator, e.description,
             COALESCE(e.metadata->'llm_enrichment'->>'description_rich', e.description, '') AS description_rich,
             e.lon, e.lat,
             COALESCE(aa.aliases, '{}') AS aliases,
             h.verses_in_chapter, h.verse_hits,
             ml.modern_id, ml.modern_name, ml.modern_url_slug, ml.modern_score, ml.modern_lon, ml.modern_lat,
             ti.image_id AS thumbnail_image_id, ti.image_url AS thumbnail_url,
             ti.credit AS thumbnail_credit, ti.credit_url AS thumbnail_credit_url, ti.license AS thumbnail_license
      FROM chapter_entity_hits h
      JOIN entities e ON e.id = h.entity_id
      LEFT JOIN alias_agg aa ON aa.entity_id = e.id
      LEFT JOIN LATERAL (
        SELECT eml.modern_id, eml.name AS modern_name, eml.url_slug AS modern_url_slug,
               eml.score AS modern_score, om.lon AS modern_lon, om.lat AS modern_lat
        FROM entity_modern_links eml
        LEFT JOIN openbible_modern om ON om.id = eml.modern_id
        WHERE eml.entity_id = e.id
        ORDER BY eml.score DESC NULLS LAST, eml.modern_id
        LIMIT 1
      ) ml ON true
      LEFT JOIN LATERAL (
        SELECT eil.image_id, oi.image_url, oi.credit, oi.credit_url, oi.license
        FROM entity_image_links eil
        JOIN openbible_images oi ON oi.id = eil.image_id
        WHERE eil.entity_id = e.id
        ORDER BY CASE WHEN lower(eil.role) LIKE '%thumbnail%' THEN 0 ELSE 1 END, eil.image_id
        LIMIT 1
      ) ti ON true
    ),
    entities_by_verse AS (
      SELECT ev.verse,
             jsonb_agg(jsonb_build_object('id', e.id, 'canonical_name', e.canonical_name, 'type', e.type)
                       ORDER BY e.canonical_name) AS entities
      FROM entity_verses ev
      JOIN entities e ON e.id = ev.entity_id
      JOIN params p ON true
      WHERE ev.book_id = p.book_id AND ev.chapter = p.chapter
      GROUP BY ev.verse
    )
    SELECT jsonb_build_object(
      'translation', (SELECT translation FROM params),
      'book_id',     (SELECT book_id FROM params),
      'chapter',     (SELECT chapter FROM params),
      'verse_count', (SELECT COUNT(*) FROM chapter_verses),
      'entity_count',(SELECT COUNT(*) FROM chapter_entities),
      'verses', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('verse', v.verse, 'verse_raw', v.verse_raw, 'ref', v.ref, 'text', v.text_clean)
                         ORDER BY v.verse, v.verse_raw) FROM chapter_verses v), '[]'::jsonb),
      'entities', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', e.id, 'canonical_name', e.canonical_name, 'type', e.type, 'disambiguator', e.disambiguator,
          'description', e.description, 'description_rich', NULLIF(e.description_rich, ''),
          'lon', e.lon, 'lat', e.lat, 'aliases', to_jsonb(e.aliases),
          'verses_in_chapter', to_jsonb(e.verses_in_chapter), 'verse_hits', e.verse_hits,
          'modern', CASE WHEN e.modern_id IS NULL THEN NULL
            ELSE jsonb_build_object('id', e.modern_id, 'name', e.modern_name, 'url_slug', e.modern_url_slug,
                                    'score', e.modern_score, 'lon', e.modern_lon, 'lat', e.modern_lat) END,
          'thumbnail', CASE WHEN e.thumbnail_image_id IS NULL THEN NULL
            ELSE jsonb_build_object('image_id', e.thumbnail_image_id, 'url', e.thumbnail_url,
                                    'credit', e.thumbnail_credit, 'credit_url', e.thumbnail_credit_url,
                                    'license', e.thumbnail_license) END)
          ORDER BY e.verse_hits DESC, e.canonical_name) FROM chapter_entities e), '[]'::jsonb),
      'entities_by_verse', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('verse', ebv.verse, 'entities', ebv.entities) ORDER BY ebv.verse)
        FROM entities_by_verse ebv), '[]'::jsonb)
    ) AS chapter_payload
`;

const UPSERT_SQL = `
    INSERT INTO chapter_explanations (
      translation, book_id, chapter, model, prompt_version, schema_version,
      status, chapter_explanation, input_payload, output_json, error_text, duration_ms, generated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9::jsonb, $10::jsonb, $11, $12, NOW()
    )
    ON CONFLICT (translation, book_id, chapter, model, prompt_version)
    DO UPDATE SET
      schema_version    = EXCLUDED.schema_version,
      status            = EXCLUDED.status,
      chapter_explanation = EXCLUDED.chapter_explanation,
      input_payload     = EXCLUDED.input_payload,
      output_json       = EXCLUDED.output_json,
      error_text        = EXCLUDED.error_text,
      duration_ms       = EXCLUDED.duration_ms,
      generated_at      = EXCLUDED.generated_at
`;

// ── Argument helpers ──────────────────────────────────────────────────────────

function getArg(name, fallback = null) {
    const idx = process.argv.indexOf(name);
    if (idx === -1) return fallback;
    const next = process.argv[idx + 1];
    return next && !next.startsWith("--") ? next : fallback;
}

function hasFlag(name) { return process.argv.includes(name); }

function parseIntArg(name, fallback = null) {
    const raw = getArg(name, null);
    if (raw == null) return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) throw new Error(`Invalid integer for ${name}: ${raw}`);
    return parsed;
}

// ── Prompt helpers ────────────────────────────────────────────────────────────

function parsePromptFile(promptPath) {
    if (!fs.existsSync(promptPath)) throw new Error(`Prompt file not found: ${promptPath}`);
    const raw = fs.readFileSync(promptPath, "utf8");
    const promptVersion = (raw.match(/^PROMPT_VERSION=(.+)$/m)?.[1] || "v1").trim();
    const schemaVersion = (raw.match(/^SCHEMA_VERSION=(.+)$/m)?.[1] || "v1").trim();
    const template = raw.replace(/^PROMPT_VERSION=.*$/m, "").replace(/^SCHEMA_VERSION=.*$/m, "").trim();
    return { promptVersion, schemaVersion, template };
}

function renderPrompt(template, payload, wordTarget) {
    const payloadJson = JSON.stringify(payload, null, 2);
    if (!template.includes("{{WORD_TARGET}}")) throw new Error("Prompt template must include {{WORD_TARGET}} placeholder.");
    return template.replaceAll("{{WORD_TARGET}}", String(wordTarget)).replace("{{CHAPTER_PAYLOAD_JSON}}", payloadJson);
}

function isEffectivelyListHeavy(complexityInfo) {
    return (
        (complexityInfo?.list_heavy_ratio ?? 0) >= LIST_HEAVY_RATIO_THRESHOLD &&
        complexityInfo?.list_heavy_semantic === true
    );
}

function buildChapterPrompt(template, payload, wordTarget, complexityInfo) {
    const basePrompt = renderPrompt(template, payload, wordTarget);
    if (isEffectivelyListHeavy(complexityInfo)) return `${basePrompt}\n\n${LIST_HEAVY_NOTE}`;
    return basePrompt;
}

// ── Payload sanitization ──────────────────────────────────────────────────────

function sanitizeChapterPayloadForLLM(payload) {
    const verses = Array.isArray(payload?.verses)
        ? payload.verses.map((v) => ({ verse: v?.verse ?? null, ref: v?.ref ?? null, text: v?.text ?? "" }))
        : [];
    const entities = Array.isArray(payload?.entities)
        ? payload.entities
            .map((e) => {
                const base = {
                    id: e?.id ?? null, canonical_name: e?.canonical_name ?? null, type: e?.type ?? null,
                    aliases: Array.isArray(e?.aliases) ? e.aliases.map((a) => (typeof a === "string" ? a.trim() : "")).filter(Boolean).slice(0, MAX_ALIASES_PER_ENTITY) : [],
                    verses_in_chapter: Array.isArray(e?.verses_in_chapter) ? e.verses_in_chapter : [],
                    verse_hits: Number.isFinite(e?.verse_hits) ? e.verse_hits : 0,
                };
                const rich = typeof e?.description_rich === "string" ? e.description_rich.trim() : "";
                const plain = typeof e?.description === "string" ? e.description.trim() : "";
                if (rich) base.description_rich = rich; else if (plain) base.description = plain;
                const modernName = e?.modern?.name;
                if (typeof modernName === "string" && modernName.trim()) base.modern = { name: modernName.trim() };
                return base;
            })
            .sort((a, b) => { if ((b.verse_hits ?? 0) !== (a.verse_hits ?? 0)) return (b.verse_hits ?? 0) - (a.verse_hits ?? 0); return String(a.canonical_name || "").localeCompare(String(b.canonical_name || "")); })
            .slice(0, 80)
        : [];
    return { translation: payload?.translation ?? null, book_id: payload?.book_id ?? null, chapter: payload?.chapter ?? null, verses, entities };
}

// ── Complexity ────────────────────────────────────────────────────────────────

function computeChapterComplexity(payload) {
    const verses = Array.isArray(payload?.verses) ? payload.verses : [];
    const entities = Array.isArray(payload?.entities) ? payload.entities : [];
    const versesText = verses.map((v) => String(v?.text || "")).join("\n");
    const verseCount = verses.length;
    const totalChars = verses.reduce((acc, v) => acc + String(v?.text || "").length, 0);
    const avgVerseChars = verseCount > 0 ? totalChars / verseCount : 0;
    const entityCount = entities.length;
    const entityDensity = verseCount > 0 ? entityCount / verseCount : 0;
    const listHeavyVerses = verses.reduce((acc, v) => acc + ((String(v?.text || "").match(/,/g) || []).length >= 3 ? 1 : 0), 0);
    const listHeavyRatio = verseCount > 0 ? listHeavyVerses / verseCount : 0;
    const listHeavySemantic = hasListHeavySemanticCueFromVerses(versesText);
    let score = 0;
    if (verseCount >= 40) score += 2; else if (verseCount >= 28) score += 1;
    if (totalChars >= 8000) score += 3; else if (totalChars >= 5000) score += 2; else if (totalChars >= 3000) score += 1;
    if (entityCount >= 20) score += 2; else if (entityCount >= 10) score += 1;
    if (entityDensity >= 0.6) score += 2; else if (entityDensity >= 0.35) score += 1;
    if (avgVerseChars >= 170) score += 1;
    if (listHeavyRatio >= 0.35) score += 1;
    return { score, verse_count: verseCount, total_chars: totalChars, avg_verse_chars: Math.round(avgVerseChars), entity_count: entityCount, entity_density: Number(entityDensity.toFixed(3)), list_heavy_ratio: Number(listHeavyRatio.toFixed(3)), list_heavy_semantic: listHeavySemantic };
}

function getPayloadTierForScore(score) {
    if (score < 4) return "full";
    if (score <= 5) return "no_aliases";
    return "no_aliases_no_modern";
}

function applyPayloadTierForComplexity(payload, score) {
    const tier = getPayloadTierForScore(score);
    const entities = Array.isArray(payload?.entities) ? payload.entities : [];
    const transformedEntities = entities.map((entity) => {
        const next = { ...entity };
        if (tier === "no_aliases" || tier === "no_aliases_no_modern") delete next.aliases;
        if (tier === "no_aliases_no_modern") delete next.modern;
        return next;
    });
    return { tier, payload: { ...payload, entities: transformedEntities } };
}

// ── OpenAI call layer ─────────────────────────────────────────────────────────

async function callOpenAI({ apiKey, baseUrl, model, userPrompt, temperature, maxTokens }) {
    const url = `${baseUrl}/chat/completions`;
    const body = {
        model,
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature,
        max_tokens: maxTokens,
    };

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenAI returned ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
        const topKeys = data ? Object.keys(data) : [];
        throw new Error(`OpenAI returned empty content. finish_reason=${data?.choices?.[0]?.finish_reason}, top-level keys=${JSON.stringify(topKeys)}`);
    }
    return content.trim();
}

// ── Output parsing ────────────────────────────────────────────────────────────

function parseChapterOutput(raw) {
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
        const firstBrace = raw.indexOf("{");
        const lastBrace = raw.lastIndexOf("}");
        if (firstBrace === -1 || lastBrace <= firstBrace) throw new Error("Invalid output: response is not parseable JSON");
        parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid output: expected JSON object");
    const keys = Object.keys(parsed);
    if (keys.length !== 1 || keys[0] !== "chapter_explanation") throw new Error("Invalid output: expected exactly one top-level key 'chapter_explanation'");
    const explanation = parsed?.chapter_explanation;
    if (typeof explanation !== "string" || !explanation.trim()) throw new Error("Invalid output: missing non-empty chapter_explanation");
    return { chapter_explanation: explanation.trim(), output_json: parsed };
}

function coerceChapterOutputFromRaw(raw) {
    const input = String(raw || "").trim();
    if (!input) throw new Error("Invalid output: response is not parseable JSON");
    let text = input.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const keyMatch = text.match(/"chapter_explanation"\s*:\s*"([\s\S]*?)"\s*(?:,|\}|$)/i);
    if (keyMatch && keyMatch[1]) {
        const extracted = keyMatch[1].replace(/\\"/g, '"').replace(/\\n/g, " ").replace(/\\t/g, " ").replace(/\s+/g, " ").trim();
        if (extracted) return { chapter_explanation: extracted, output_json: { chapter_explanation: extracted } };
    }
    text = text.replace(/^\s*(?:json\s*:\s*)?/i, "").replace(/^\s*"?chapter_explanation"?\s*:\s*/i, "").trim();
    text = text.replace(/^"(.*)"$/s, "$1").replace(/\s+/g, " ").trim();
    if (!text) throw new Error("Invalid output: response is not parseable JSON");
    return { chapter_explanation: text, output_json: { chapter_explanation: text } };
}

// ── Quality evaluators ────────────────────────────────────────────────────────

function evaluateNoMetaTalk(explanation) {
    const text = String(explanation || "");
    const checks = [
        { key: "json", rx: /\bjson\b/i }, { key: "payload", rx: /\bpayload\b/i },
        { key: "dataset", rx: /\bdataset\b/i }, { key: "schema", rx: /\bschema\b/i },
        { key: "array", rx: /\barray\b/i }, { key: "object", rx: /\bobject\b/i },
        { key: "fields", rx: /\bfields?\b/i }, { key: "keys", rx: /\bkeys?\b/i },
        { key: "input_output", rx: /\b(?:input|output)\b/i },
        { key: "provided_data", rx: /\bprovided\s+data\b/i },
        { key: "response_describes", rx: /\bresponse\s+describes\b/i },
        { key: "chapter_payload", rx: /\bchapter\s+payload\b/i },
        { key: "verses_array_list", rx: /\bverses?\s+(?:array|list)\b/i },
        { key: "entities_array_list", rx: /\bentities?\s+(?:array|list)\b/i },
        { key: "contains_data_about", rx: /\bcontains\s+data\s+about\b/i },
        { key: "meta_structure_framing", rx: /\b(?:structure|format|entries?|entry)\b[\s\S]{0,40}\b(?:json|payload|dataset|schema|array|object|fields?|keys?|input|output)\b/i },
        { key: "meta_structure_framing_reverse", rx: /\b(?:json|payload|dataset|schema|array|object|fields?|keys?|input|output)\b[\s\S]{0,40}\b(?:structure|format|entries?|entry)\b/i },
    ];
    const hits = [];
    for (const check of checks) { if (check.rx.test(text)) hits.push(check.key); }
    if (!hits.length) return { ok: true };
    return { ok: false, reason: "response describes payload structure/meta format instead of chapter content", hits };
}

function isLikelyTruncated(explanation) {
    const text = String(explanation || "").trim();
    if (!text) return false;
    if (/\(v\.\s*$/i.test(text) || /\($/.test(text)) return true;
    return !/[.!?](?:["')\]]+)?$/.test(text);
}

function normalizeForGrounding(value) {
    return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function hasListHeavySemanticCueFromVerses(versesText) {
    const normalized = normalizeForGrounding(versesText);
    if (!normalized.trim()) return false;
    if (LIST_HEAVY_KEYWORDS.some((kw) => normalized.includes(kw))) return true;
    const genealogyCues = [
        /\bbegat\b/i, /\bgenealogy\b/i, /\bgenerations\b/i, /\bdescendants?\b/i,
        /\bsons of\b/i, /\bthese are the sons of\b/i, /\baccording to their families\b/i,
        /\bby their clans\b/i, /\bby their tongues\b/i, /\bby their languages\b/i,
        /\bgeracoes\b/i, /\bdescendentes\b/i, /\bfilhos de\b/i,
        /\bsegundo as suas familias\b/i, /\bsegundo as suas linguas\b/i,
    ];
    if (genealogyCues.some((rx) => rx.test(normalized))) return true;
    const introLines = String(versesText || "").split(/\r?\n/).reduce((acc, line) => acc + (/^\s*(?:and|e)\s+\p{L}+/iu.test(line) ? 1 : 0), 0);
    return introLines >= 10;
}

function countWords(text) { return String(text || "").trim().split(/\s+/).filter(Boolean).length; }

function getSentenceBounds(listHeavy = false) { return listHeavy ? { min: 2, max: 5 } : { min: 3, max: 7 }; }

function stripVerseRefsForCounting(text) {
    return String(text || "").replace(/,?\s*\(\s*v\.\s*[^)]*\)\s*,?/gi, " ").replace(/\bv\.\s*\d[\d\s,\-–]*/gi, " ").replace(/\(\s*\)/g, "").replace(/([.!?])\s+([.!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

function countSentences(text) { return stripVerseRefsForCounting(text).split(/[.!?]+/).map((p) => p.trim()).filter(Boolean).length; }
function countVerseRefBlocks(text) { const m = String(text || "").match(/\(\s*v\.\s*[^)]+\)/gi); return m ? m.length : 0; }
function extractFinalVerseRefBlock(text) { return String(text || "").trim().match(/(\(\s*v\.\s*[^)]+\))(?:\.)?\s*$/i)?.[1] || null; }
function countVerseRefsInBlock(blockText) { const m = String(blockText || "").match(/\bv\.\s*\d[\d\-–]*/gi); return m ? m.length : 0; }
function hasInlineVerseMentionOutsideFinalBlock(text, finalBlock) {
    const trimmed = String(text || "").trim();
    const withoutFinal = finalBlock ? trimmed.replace(/(\(\s*v\.\s*[^)]+\))(?:\.)?\s*$/i, "").trim() : trimmed;
    return /\bv\.\s*\d[\d\-–]*/i.test(withoutFinal);
}
function hasBookChapterVerseMention(text) { return /\b(?:[1-3]\s+)?[A-Za-z]{2,}(?:\s+[A-Za-z]{2,})*\s+\d{1,3}:\d{1,3}\b/.test(String(text || "")); }

function evaluateSentenceCount(explanation, { listHeavy = false } = {}) {
    const { min, max } = getSentenceBounds(listHeavy);
    const sentenceCount = countSentences(explanation);
    return { ok: sentenceCount >= min && sentenceCount <= max, sentence_count: sentenceCount, min, max };
}

function evaluateVerseRefCount(explanation) {
    const text = String(explanation || "").trim();
    const blockCount = countVerseRefBlocks(text);
    const finalBlock = extractFinalVerseRefBlock(text);
    const refCount = countVerseRefsInBlock(finalBlock);
    const inlineOutsideFinal = hasInlineVerseMentionOutsideFinalBlock(text, finalBlock);
    const bookChapterVerseHit = hasBookChapterVerseMention(text);
    return {
        ok: blockCount === 1 && Boolean(finalBlock) && refCount === 2 && !inlineOutsideFinal && !bookChapterVerseHit,
        block_count: blockCount, final_block_at_end: Boolean(finalBlock), verse_ref_count: refCount,
        inline_verse_outside_final_block: inlineOutsideFinal, book_chapter_verse_hit: bookChapterVerseHit,
        required_blocks: 1, required_refs: 2,
    };
}

// ── Confidence scoring ────────────────────────────────────────────────────────

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

function evaluateConfidence({ explanation, wordCount, wordPolicy, sentenceAssessment, verseRefAssessment, groundingAssessment, metaTalkAssessment, retries = {}, verseRefNormalized = false }) {
    let score = 100;
    const reasons = [];
    const penalize = (amount, reason) => { score -= amount; reasons.push(reason); };
    if (wordPolicy) {
        if (wordCount < wordPolicy.min_words) penalize(25, `word_count_below_min(${wordCount}<${wordPolicy.min_words})`);
        else if (wordCount > wordPolicy.max_words) penalize(15, `word_count_above_max(${wordCount}>${wordPolicy.max_words})`);
    }
    if (!sentenceAssessment?.ok) penalize(20, `sentence_count_out_of_range(${sentenceAssessment?.sentence_count})`);
    if (!verseRefAssessment?.ok) penalize(35, `verse_ref_format_or_count_invalid(blocks=${verseRefAssessment?.block_count},refs=${verseRefAssessment?.verse_ref_count})`);
    if (!groundingAssessment?.isGrounded) penalize(30, "grounding_failed");
    else if (Number.isFinite(groundingAssessment?.required_hits) && groundingAssessment.required_hits > 0 && Number.isFinite(groundingAssessment?.token_hits) && groundingAssessment.token_hits > groundingAssessment.required_hits) { score += 3; reasons.push("grounding_token_hits_above_minimum"); }
    if (!metaTalkAssessment?.ok) penalize(20, "meta_talk_detected");
    if (/\b(?:possibly|likely|means|suggests)\b/i.test(String(explanation || ""))) penalize(8, "speculation_word_detected");
    if (retries?.jsonInvalidRetry) penalize(8, "json_retry_used");
    if (retries?.truncationRetry) penalize(6, "truncation_retry_used");
    if (retries?.metaTalkRetry) penalize(6, "meta_talk_retry_used");
    if (retries?.groundingRetry) penalize(8, "grounding_retry_used");
    if (retries?.wordcountRetry) penalize(6, "wordcount_retry_used");
    if (retries?.tooshortRetry) penalize(8, "tooshort_retry_used");
    if (retries?.tooshortRetry2) penalize(10, "tooshort_retry2_used");
    if (retries?.sentenceCountRetry) penalize(6, "sentence_count_retry_used");
    if (retries?.verseRefCountRetry) penalize(6, "verse_ref_count_retry_used");
    if (retries?.postFormatRecoveryRetry) penalize(10, "post_format_recovery_retry_used");
    if (verseRefNormalized) penalize(4, "verse_refs_normalized_in_postprocess");
    const finalScore = Math.round(clamp(score, 0, 100));
    return { score: finalScore, band: finalScore >= 85 ? "high" : finalScore >= 65 ? "medium" : "low", reasons };
}

// ── Verse ref normalization ───────────────────────────────────────────────────

function consolidateVerseRefs(text) {
    const str = String(text || "").trim();
    const blocks = [];
    let bm;
    const blockRe = /\(\s*v\.\s*[^)]+\)/gi;
    while ((bm = blockRe.exec(str)) !== null) blocks.push(bm[0]);
    if (blocks.length === 0) return str;
    if (blocks.length === 1) { const anchors = (blocks[0].match(/\bv\.\s*\d[\d\-–]*/gi) || []); if (anchors.length === 2) return str; }
    const refRe = /\bv\.\s*\d[\d\-–]*/gi;
    const allRefs = [];
    for (const block of blocks) { for (const r of (block.match(refRe) || [])) allRefs.push(r); }
    if (allRefs.length === 0) return str;
    const seen = new Set();
    const unique = allRefs.filter(r => { const key = r.replace(/\s/g, ""); if (seen.has(key)) return false; seen.add(key); return true; });
    const chosen = unique.length <= 2 ? unique : [unique[0], unique[unique.length - 1]];
    const consolidated = `(${chosen.join(", ")})`;
    let base = str.replace(/\s*\(\s*v\.\s*[^)]+\)/gi, "").trim();
    base = base.replace(/\b(?:in|at|from)\s+v\.\s*\d[\d\-–]*/gi, "").replace(/\bv\.\s*\d[\d\-–]*/gi, "").replace(/\b(?:[1-3]\s+)?[A-Za-z]{2,}(?:\s+[A-Za-z]{2,})*\s+\d{1,3}:\d{1,3}\b/g, "").replace(/\s{2,}/g, " ").replace(/\s+([.,;])/g, "$1").trim();
    if (/[.!?]$/.test(base)) return base.replace(/([.!?])$/, ` ${consolidated}$1`);
    return `${base} ${consolidated}.`;
}

// ── Retry note builders ───────────────────────────────────────────────────────

function buildVerseRefFormatLockRetryNote({ minWords, maxWords, minSentences, maxSentences, listHeavy = false }) {
    const sentenceConstraint = listHeavy ? "Use EXACTLY 3 sentences." : "Use BETWEEN 4 and 6 sentences.";
    return `IMPORTANT: FORMAT LOCK. Rewrite from scratch. Include EXACTLY 2 verse references total in ONE parenthesized block, e.g. (v. 3-4, v. 24-28). Do not include any other "(v." anywhere else in the text. Do not write inline verse mentions like "in v. 3". Do not use book/chapter notation like "Genesis 10:10". The verse-reference block must be the final characters of the output string. ${sentenceConstraint} Keep between ${minWords + 25} and ${maxWords} words. Output valid JSON only.`;
}

function buildSentenceCountRetryNote({ minWords, maxWords, minSentences, maxSentences, listHeavy = false }) {
    const sentenceConstraint = listHeavy ? "Rewrite from scratch using EXACTLY 3 sentences." : "Rewrite from scratch using BETWEEN 4 and 6 sentences.";
    return `IMPORTANT: Your previous answer had the wrong number of sentences. ${sentenceConstraint} Include EXACTLY 2 verse references total using one parenthesized block (v. ..., v. ...), with no other "(v." anywhere. Do not write inline verse mentions like "in v. 3". Do not use book/chapter notation like "Genesis 10:10". End with the verse-reference block as the final characters of the output. Keep between ${minWords + 25} and ${maxWords} words. Output valid JSON only.`;
}

function buildGroundingRetryNote({ minWords, targetWords, minSentences, maxSentences, listHeavy = false }) {
    const sentenceConstraint = listHeavy ? "Use EXACTLY 3 sentences." : "Use BETWEEN 4 and 6 sentences.";
    return `IMPORTANT: Grounding check failed. Your previous explanation referenced events, people, or places NOT present in THIS chapter's verses, or drifted into themes from other chapters. Rewrite from scratch using ONLY the verses provided in this payload — do not describe events from other chapters or books. Keep AT LEAST ${minWords + 25} words (target ${targetWords}). Include exactly 2 verse references total in ONE parenthesized block, e.g. (v. 3-4, v. 24-28), and no other "(v." in the text. Do not write inline verse mentions like "in v. 3". Do not use book/chapter notation like "Genesis 10:10". End with the verse-reference block as the final characters of the output. ${sentenceConstraint} No speculation: avoid possibly, likely, means, suggests. Output valid JSON only.`;
}

function buildVerbosityRetryNote(policy, { strict = false } = {}) {
    const aimMin = policy.min_words + 30;
    if (strict) return `IMPORTANT: Still too short. Rewrite from scratch with EXACTLY 6 full sentences and ${aimMin}-${policy.max_words} words. Every sentence must anchor to a concrete verse detail (named item, number, or specific action). Do not mention payload/format. Do not use semicolons. Output valid JSON only.`;
    return `IMPORTANT: Your explanation is too short. Write EXACTLY 6 sentences totaling ${aimMin}-${policy.max_words} words. Each sentence must include at least one named person/place/object OR one explicit number/action from the verses. Do not use semicolons to cram multiple sentences. Include 1-3 verse refs like (v. 1, v. 13). Output valid JSON only.`;
}

function buildWordcountRetryNote(policy) {
    return `IMPORTANT: Keep the explanation between ${policy.min_words} and ${policy.max_words} words. Do not exceed ${HARD_MAX_EXPLANATION_WORDS}. Output only valid JSON.`;
}

// ── Word policy ───────────────────────────────────────────────────────────────

function estimateExplanationWordPolicy(payload, { listHeavy = false, overrideTarget = null } = {}) {
    const verses = Array.isArray(payload?.verses) ? payload.verses : [];
    let chapterWords = verses.reduce((acc, verse) => acc + countWords(verse?.text), 0);
    let chapterWordsEstimated = false;
    if (chapterWords <= 0) { const wordsPerVerse = listHeavy ? 16 : 22; chapterWords = Math.max(1, verses.length) * wordsPerVerse; chapterWordsEstimated = true; }
    const override = Number.isFinite(overrideTarget) ? Number(overrideTarget) : null;
    const targetWords = override && override > 0
        ? Math.round(override)
        : listHeavy ? clamp(Math.round(50 + (0.06 * chapterWords)), 95, 165) : clamp(Math.round(60 + (0.08 * chapterWords)), 110, 190);
    const floorForChapter = listHeavy ? 70 : MIN_EXPLANATION_WORDS_FLOOR;
    const minWords = Math.max(floorForChapter, targetWords - 40);
    const maxWords = Math.min(HARD_MAX_EXPLANATION_WORDS, targetWords + 40);
    const promptTargetWords = Math.min(HARD_MAX_EXPLANATION_WORDS, Math.max(targetWords, minWords + 40));
    return { chapter_words: chapterWords, chapter_words_estimated: chapterWordsEstimated, list_heavy: listHeavy === true, target_words: targetWords, prompt_target_words: promptTargetWords, min_words: minWords, max_words: maxWords, target_mode: override && override > 0 ? "override" : "dynamic" };
}

// ── Grounding ─────────────────────────────────────────────────────────────────

function extractVerseGroundingTokens(payload, maxTokens = 16) {
    const freq = new Map();
    const pushToken = (raw) => {
        const token = String(raw || "").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
        if (token.length < 3) return;
        const lowered = normalizeForGrounding(token);
        if (TOKEN_STOPWORDS.has(lowered)) return;
        freq.set(lowered, (freq.get(lowered) || 0) + 1);
        if (/[-']/g.test(token)) { for (const part of token.split(/[-']/g)) { const pn = normalizeForGrounding(part); if (pn.length >= 3 && !TOKEN_STOPWORDS.has(pn)) freq.set(pn, (freq.get(pn) || 0) + 1); } }
    };
    const verses = Array.isArray(payload?.verses) ? payload.verses : [];
    for (const verse of verses) {
        for (const cand of (String(verse?.text || "").match(/\b[A-Z][A-Za-z'-]{2,}(?:\s+[A-Z][A-Za-z'-]{2,}){0,2}\b/g) || [])) pushToken(cand);
        const normalizedVerse = normalizeForGrounding(String(verse?.text || ""));
        for (const anchor of STRUCTURAL_GROUNDING_TOKENS) { if (normalizedVerse.includes(anchor)) freq.set(anchor, (freq.get(anchor) || 0) + 1); }
    }
    for (const entity of (Array.isArray(payload?.entities) ? payload.entities : [])) {
        const name = String(entity?.canonical_name || "");
        pushToken(name);
        for (const part of name.split(/[\s-]+/g)) pushToken(part);
    }
    return [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, maxTokens).map(([token]) => token);
}

function evaluateGrounding(explanation, payload, { listHeavy = false } = {}) {
    const text = String(explanation || "").trim();
    const normalizedText = normalizeForGrounding(text);
    const tokens = extractVerseGroundingTokens(payload);
    const verses = Array.isArray(payload?.verses) ? payload.verses : [];
    const entities = Array.isArray(payload?.entities) ? payload.entities : [];
    const entityDensity = verses.length > 0 ? entities.length / verses.length : 0;
    const relaxedForListOrDense = listHeavy || entityDensity >= 0.45;
    const matchedTokens = tokens.filter((token) => normalizedText.includes(token));
    const requiredHits = relaxedForListOrDense ? (tokens.length >= 1 ? 1 : 0) : (tokens.length >= 2 ? 2 : tokens.length === 1 ? 1 : 0);
    const tokenGrounded = requiredHits === 0 ? text.length > 0 : matchedTokens.length >= requiredHits;
    const hasListHeavyLanguage = listHeavy ? LIST_HEAVY_KEYWORDS.some((kw) => normalizedText.includes(kw)) || GENEALOGY_KEYWORDS.map(normalizeForGrounding).some((kw) => normalizedText.includes(kw)) : true;
    const hasDisallowedPhrase = listHeavy ? UNGROUNDED_LIST_HEAVY_PHRASES.some((rx) => rx.test(text)) : false;
    const hasVerseRef = /\bv\.\s*\d+/i.test(text);
    return { isGrounded: tokenGrounded && hasListHeavyLanguage && !hasDisallowedPhrase && hasVerseRef, token_hits: matchedTokens.length, required_hits: requiredHits, entity_density: Number(entityDensity.toFixed(3)), relaxed_for_list_or_dense: relaxedForListOrDense, list_heavy_keyword_hit: hasListHeavyLanguage, disallowed_phrase_hit: hasDisallowedPhrase, verse_ref_hit: hasVerseRef };
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function fetchChapterPayload(client, { translation, bookId, chapter }) {
    const { rows } = await client.query(CHAPTER_PAYLOAD_SQL, [translation, bookId, chapter]);
    return rows[0]?.chapter_payload || null;
}

async function upsertChapterResult(client, data) {
    await client.query(UPSERT_SQL, [
        data.translation, data.bookId, data.chapter, data.model,
        data.promptVersion, data.schemaVersion, data.status,
        data.chapterExplanation || null, JSON.stringify(data.inputPayload || {}),
        JSON.stringify(data.outputJson || {}), data.errorText || null, data.durationMs || null,
    ]);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY environment variable is required.");

    const translation = getArg("--translation", "WEBU");
    const bookId = getArg("--book", null);
    const chapter = parseIntArg("--chapter", null);
    const limit = parseIntArg("--limit", 0);
    const force = hasFlag("--force");

    const sourceModel = getArg("--source-model", null);
    if (!sourceModel) throw new Error("--source-model <model> is required (the prior model whose results to escalate).");

    const minBandArg = getArg("--min-band", "low");
    if (!["low", "medium"].includes(minBandArg)) throw new Error("--min-band must be 'low' or 'medium'.");
    const escalateBands = minBandArg === "medium" ? ["low", "medium"] : ["low"];

    const model = getArg("--model", DEFAULT_MODEL);
    const retryModel = getArg("--retry-model", model);

    const promptPathArg = getArg("--prompt", null);
    const promptPath = promptPathArg || DEFAULT_PROMPT_PATH;
    const promptVersionOverride = getArg("--prompt-version", null);

    const temperature = Number.isFinite(DEFAULT_TEMPERATURE) ? DEFAULT_TEMPERATURE : 0.15;
    const verbosityRetryTemperature = Number.isFinite(DEFAULT_VERBOSITY_RETRY_TEMP) ? DEFAULT_VERBOSITY_RETRY_TEMP : 0.2;

    const cliMaxTokens = parseIntArg("--max-tokens", null);
    const maxTokens = cliMaxTokens ?? (Number.isFinite(DEFAULT_MAX_TOKENS) ? DEFAULT_MAX_TOKENS : 900);

    const cliWordTarget = parseIntArg("--word-target", null);
    const defaultWordTarget = Number.isFinite(DEFAULT_WORD_TARGET) ? DEFAULT_WORD_TARGET : 220;

    if (chapter != null && chapter < 1) throw new Error("--chapter must be >= 1");
    if (chapter != null && !bookId) throw new Error("--chapter requires --book");
    if (limit < 0) throw new Error("--limit must be >= 0");
    if (!Number.isFinite(maxTokens) || maxTokens < 1) throw new Error("--max-tokens must be >= 1");
    if (cliWordTarget != null && (!Number.isFinite(cliWordTarget) || cliWordTarget < 1)) throw new Error("--word-target must be >= 1");

    const promptInfo = parsePromptFile(promptPath);
    const promptContext = {
        path: promptPath,
        template: promptInfo.template,
        promptVersion: promptVersionOverride || promptInfo.promptVersion,
        schemaVersion: promptInfo.schemaVersion,
    };

    console.log(`OpenAI base URL: ${OPENAI_BASE_URL}`);
    console.log(`OpenAI API key: set`);
    console.log(`Source model (escalate from): ${sourceModel}`);
    console.log(`Escalate bands: ${escalateBands.join(", ")}`);
    console.log(`Escalation model: ${model}`);
    console.log(`Retry model: ${retryModel}`);
    console.log(`Prompt: ${promptContext.path}`);
    console.log(`Prompt version: ${promptContext.promptVersion}`);
    console.log(`Schema version: ${promptContext.schemaVersion}`);
    console.log(`Translation: ${translation}`);
    console.log(`Temperature: ${temperature}`);
    console.log(`Verbosity retry temperature: ${verbosityRetryTemperature}`);
    console.log(`Max tokens: ${maxTokens}`);
    console.log(`Word target mode: ${cliWordTarget != null ? "override" : "dynamic-by-chapter"}`);
    if (cliWordTarget != null) console.log(`Word target override: ${cliWordTarget}`);
    else console.log(`Word target fallback (no verse text): ${defaultWordTarget}`);
    console.log(`Force: ${force}`);
    if (bookId) console.log(`Book filter: ${bookId}`);
    if (chapter != null) console.log(`Chapter filter: ${chapter}`);
    if (limit > 0) console.log(`Limit: ${limit}`);
    console.log("");

    const client = new Client({
        host: process.env.PGHOST || "localhost",
        port: parseInt(process.env.PGPORT || "5432", 10),
        user: process.env.PGUSER || "bible",
        password: process.env.PGPASSWORD || "bible",
        database: process.env.PGDATABASE || "bible",
    });
    await client.connect();

    const { rows: chapters } = await client.query(ESCALATION_CHAPTER_SQL, [
        translation, sourceModel, bookId, chapter, escalateBands, CANONICAL_BOOK_IDS,
    ]);
    if (!chapters.length) {
        await client.end();
        console.log("No escalation candidates found for the provided filters.");
        return;
    }

    const readySet = new Set();
    if (!force) {
        const { rows: readyRows } = await client.query(
            `SELECT book_id, chapter FROM chapter_explanations
             WHERE translation = $1 AND model = $2 AND prompt_version = $3 AND status = 'ready'`,
            [translation, model, promptContext.promptVersion]
        );
        for (const row of readyRows) readySet.add(`${row.book_id}:${row.chapter}`);
    }

    const filtered = [];
    for (const row of chapters) {
        if (!force && readySet.has(`${row.book_id}:${row.chapter}`)) continue;
        filtered.push({ book_id: row.book_id, chapter: row.chapter });
    }

    const targets = limit > 0 ? filtered.slice(0, limit) : filtered;
    if (!targets.length) {
        await client.end();
        console.log("All escalation candidates are already enriched at this model/prompt_version.");
        return;
    }

    let ok = 0, err = 0;
    const skipped = chapters.length - targets.length;

    for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        const label = `${target.book_id} ${target.chapter}`;
        console.log(`[${i + 1}/${targets.length}] ${label}`);

        const selectedModel = model;
        let complexityInfo = null;
        let payloadTier = "full";
        let wordPolicy = null;
        let payload = null;

        let rawResponse = "";
        let jsonInvalidRetry = false;
        let truncationRetry = false;
        let tooshortRetry = false;
        let tooshortRetry2 = false;
        let wordcountRetry = false;
        let metaTalkRetry = false;
        let verseRefCountRetry = false;
        let sentenceCountRetry = false;
        let groundingRetry = false;
        let postFormatRecoveryRetry = false;
        let finalLengthRescueRetry = false;
        let jsonCoerceFallback = false;
        let jsonFallbackToPrevious = false;
        let verseRefNormalized = false;
        let temperatureUsed = temperature;
        let maxTokensUsed = maxTokens;
        let lastParsedOutputJson = null;
        let lastWordCount = null;

        const t0 = Date.now();

        try {
            payload = await fetchChapterPayload(client, { translation, bookId: target.book_id, chapter: target.chapter });
            if (!payload || !Array.isArray(payload.verses) || payload.verses.length === 0) throw new Error("Missing chapter payload verses");

            const llmPayloadBase = sanitizeChapterPayloadForLLM(payload);
            complexityInfo = computeChapterComplexity(llmPayloadBase);
            const listHeavy = isEffectivelyListHeavy(complexityInfo);

            if (complexityInfo.score >= 5) maxTokensUsed = Math.max(maxTokensUsed, 1000);

            const tiered = applyPayloadTierForComplexity(llmPayloadBase, complexityInfo.score);
            const llmPayload = tiered.payload;
            payloadTier = tiered.tier;
            wordPolicy = estimateExplanationWordPolicy(llmPayload, { listHeavy, overrideTarget: cliWordTarget });

            console.log(`  Model: ${selectedModel} (complexity: ${complexityInfo.score}, tier: ${payloadTier}, max_tokens: ${maxTokensUsed}, prompt: ${promptContext.promptVersion}, words: ${wordPolicy.target_words}/${wordPolicy.min_words}-${wordPolicy.max_words})`);

            const promptWordTarget = wordPolicy?.prompt_target_words || wordPolicy?.target_words || defaultWordTarget;
            const prompt = buildChapterPrompt(promptContext.template, llmPayload, promptWordTarget, complexityInfo);

            process.stdout.write("  Calling LLM...");
            let parsed;
            const setParsed = (nextParsed) => { parsed = nextParsed; lastParsedOutputJson = nextParsed?.output_json || null; };

            const callAndSetParsedWithJsonGuard = async ({ modelName, userPrompt, temp, maxTokensValue = maxTokensUsed }) => {
                const previousParsed = parsed
                    ? { chapter_explanation: parsed.chapter_explanation, output_json: parsed.output_json && typeof parsed.output_json === "object" ? { ...parsed.output_json } : { chapter_explanation: parsed.chapter_explanation } }
                    : null;
                const fallbackToPrevious = () => { if (!previousParsed) return false; jsonFallbackToPrevious = true; setParsed(previousParsed); return true; };
                try {
                    rawResponse = await callOpenAI({ apiKey: OPENAI_API_KEY, baseUrl: OPENAI_BASE_URL, model: modelName, userPrompt, temperature: temp, maxTokens: maxTokensValue });
                    try { setParsed(parseChapterOutput(rawResponse)); temperatureUsed = temp; }
                    catch {
                        jsonInvalidRetry = true;
                        const repairPrompt = `${userPrompt}\n\nIMPORTANT: Your previous response was invalid JSON. No extra text before/after JSON. Exactly one top-level key: "chapter_explanation".`;
                        rawResponse = await callOpenAI({ apiKey: OPENAI_API_KEY, baseUrl: OPENAI_BASE_URL, model: modelName, userPrompt: repairPrompt, temperature: 0, maxTokens: maxTokensValue });
                        try { setParsed(parseChapterOutput(rawResponse)); temperatureUsed = 0; }
                        catch {
                            try { const coerced = coerceChapterOutputFromRaw(rawResponse); jsonCoerceFallback = true; setParsed(coerced); temperatureUsed = 0; }
                            catch { if (!fallbackToPrevious()) throw new Error("Invalid output: response is not parseable JSON"); }
                        }
                    }
                } catch { if (!fallbackToPrevious()) throw new Error("Invalid output: response is not parseable JSON"); }
            };

            rawResponse = await callOpenAI({ apiKey: OPENAI_API_KEY, baseUrl: OPENAI_BASE_URL, model: selectedModel, userPrompt: prompt, temperature, maxTokens: maxTokensUsed });
            try { setParsed(parseChapterOutput(rawResponse)); }
            catch {
                jsonInvalidRetry = true;
                const retryPrompt = `${prompt}\n\nIMPORTANT: Your previous response was invalid JSON. No extra text before/after JSON. Exactly one top-level key: "chapter_explanation".`;
                await callAndSetParsedWithJsonGuard({ modelName: selectedModel, userPrompt: retryPrompt, temp: 0 });
            }

            if (isLikelyTruncated(parsed.chapter_explanation)) {
                truncationRetry = true; maxTokensUsed = Math.max(maxTokensUsed, 1100);
                await callAndSetParsedWithJsonGuard({ modelName: selectedModel, userPrompt: `${prompt}\n\nIMPORTANT: Ensure the explanation is complete and ends with a full sentence. Output only valid JSON.`, temp: 0, maxTokensValue: maxTokensUsed });
            }

            let wordCount = countWords(parsed.chapter_explanation);
            lastWordCount = wordCount;
            const sentenceBounds = getSentenceBounds(listHeavy);

            let metaTalkAssessment = evaluateNoMetaTalk(parsed.chapter_explanation);
            if (!metaTalkAssessment.ok) {
                metaTalkRetry = true;
                await callAndSetParsedWithJsonGuard({ modelName: selectedModel, userPrompt: `${prompt}\n\n${META_TALK_RETRY_NOTE}`, temp: 0 });
                wordCount = countWords(parsed.chapter_explanation); lastWordCount = wordCount;
                metaTalkAssessment = evaluateNoMetaTalk(parsed.chapter_explanation);
            }

            let groundingAssessment = evaluateGrounding(parsed.chapter_explanation, llmPayload, { listHeavy });
            if (!groundingAssessment.isGrounded) {
                groundingRetry = true;
                console.log("  Retrying once for grounding...");
                await callAndSetParsedWithJsonGuard({ modelName: retryModel, userPrompt: `${prompt}\n\n${buildGroundingRetryNote({ minWords: wordPolicy.min_words, targetWords: wordPolicy.target_words, minSentences: sentenceBounds.min, maxSentences: sentenceBounds.max, listHeavy })}`, temp: 0 });
                wordCount = countWords(parsed.chapter_explanation); lastWordCount = wordCount;
                groundingAssessment = evaluateGrounding(parsed.chapter_explanation, llmPayload, { listHeavy });
            }

            if (wordCount < wordPolicy.min_words) {
                tooshortRetry = true; maxTokensUsed = Math.max(maxTokensUsed, 1100);
                await callAndSetParsedWithJsonGuard({ modelName: selectedModel, userPrompt: `${prompt}\n\n${buildVerbosityRetryNote(wordPolicy)}`, temp: verbosityRetryTemperature, maxTokensValue: maxTokensUsed });
                wordCount = countWords(parsed.chapter_explanation); lastWordCount = wordCount;
                if (wordCount < wordPolicy.min_words) {
                    tooshortRetry2 = true; maxTokensUsed = Math.max(maxTokensUsed, 1300);
                    await callAndSetParsedWithJsonGuard({ modelName: selectedModel, userPrompt: `${prompt}\n\n${buildVerbosityRetryNote(wordPolicy, { strict: true })}`, temp: verbosityRetryTemperature, maxTokensValue: maxTokensUsed });
                    wordCount = countWords(parsed.chapter_explanation); lastWordCount = wordCount;
                }
            }

            if (wordCount > wordPolicy.max_words) {
                wordcountRetry = true;
                await callAndSetParsedWithJsonGuard({ modelName: selectedModel, userPrompt: `${prompt}\n\n${buildWordcountRetryNote(wordPolicy)}`, temp: 0 });
                wordCount = countWords(parsed.chapter_explanation); lastWordCount = wordCount;
            }

            let sentenceCountAssessment = evaluateSentenceCount(parsed.chapter_explanation, { listHeavy });
            if (!sentenceCountAssessment.ok) {
                sentenceCountRetry = true;
                await callAndSetParsedWithJsonGuard({ modelName: selectedModel, userPrompt: `${prompt}\n\n${buildSentenceCountRetryNote({ minWords: wordPolicy.min_words, maxWords: wordPolicy.max_words, minSentences: sentenceBounds.min, maxSentences: sentenceBounds.max, listHeavy })}`, temp: 0 });
                wordCount = countWords(parsed.chapter_explanation); lastWordCount = wordCount;
                sentenceCountAssessment = evaluateSentenceCount(parsed.chapter_explanation, { listHeavy });
            }

            let verseRefAssessment = evaluateVerseRefCount(parsed.chapter_explanation);
            if (!verseRefAssessment.ok) {
                const normalised = consolidateVerseRefs(parsed.chapter_explanation);
                if (normalised !== parsed.chapter_explanation) { verseRefNormalized = true; parsed.chapter_explanation = normalised; parsed.output_json.chapter_explanation = normalised; verseRefAssessment = evaluateVerseRefCount(parsed.chapter_explanation); }
            }
            if (!verseRefAssessment.ok) {
                verseRefCountRetry = true;
                await callAndSetParsedWithJsonGuard({ modelName: retryModel, userPrompt: `${prompt}\n\n${buildVerseRefFormatLockRetryNote({ minWords: wordPolicy.min_words, maxWords: wordPolicy.max_words, minSentences: sentenceBounds.min, maxSentences: sentenceBounds.max, listHeavy })}`, temp: 0 });
                wordCount = countWords(parsed.chapter_explanation); lastWordCount = wordCount;
                verseRefAssessment = evaluateVerseRefCount(parsed.chapter_explanation);
            }

            { const preNorm = evaluateVerseRefCount(parsed.chapter_explanation); if (!preNorm.ok) { const n = consolidateVerseRefs(parsed.chapter_explanation); if (n !== parsed.chapter_explanation) { verseRefNormalized = true; parsed.chapter_explanation = n; parsed.output_json.chapter_explanation = n; } } }

            wordCount = countWords(parsed.chapter_explanation); lastWordCount = wordCount;
            if (wordCount < wordPolicy.min_words) {
                postFormatRecoveryRetry = true; maxTokensUsed = Math.max(maxTokensUsed, 1300);
                await callAndSetParsedWithJsonGuard({ modelName: selectedModel, userPrompt: `${prompt}\n\n${buildVerbosityRetryNote(wordPolicy, { strict: true })}`, temp: Math.max(verbosityRetryTemperature, 0.45), maxTokensValue: maxTokensUsed });
                { const n = evaluateVerseRefCount(parsed.chapter_explanation); if (!n.ok) { const normalised = consolidateVerseRefs(parsed.chapter_explanation); if (normalised !== parsed.chapter_explanation) { verseRefNormalized = true; parsed.chapter_explanation = normalised; parsed.output_json.chapter_explanation = normalised; } } }
            }

            let finalVerseRefAssessment = evaluateVerseRefCount(parsed.chapter_explanation);
            let finalSentenceCountAssessment = evaluateSentenceCount(parsed.chapter_explanation, { listHeavy });
            let finalWordCount = countWords(parsed.chapter_explanation); lastWordCount = finalWordCount;

            if (finalWordCount < wordPolicy.min_words) {
                finalLengthRescueRetry = true; maxTokensUsed = Math.max(maxTokensUsed, 1400);
                await callAndSetParsedWithJsonGuard({ modelName: retryModel, userPrompt: `${prompt}\n\nIMPORTANT: Rewrite from scratch. Keep AT LEAST ${wordPolicy.min_words} words (target ${wordPolicy.target_words}). Use ${listHeavy ? "EXACTLY 3 sentences" : "BETWEEN 4 and 6 sentences"}. Include exactly 2 verse references total in ONE parenthesized block and no other "(v." anywhere. The verse-reference block must be at the end. Output valid JSON only.`, temp: 0, maxTokensValue: maxTokensUsed });
                { const n = evaluateVerseRefCount(parsed.chapter_explanation); if (!n.ok) { const normalised = consolidateVerseRefs(parsed.chapter_explanation); if (normalised !== parsed.chapter_explanation) { verseRefNormalized = true; parsed.chapter_explanation = normalised; parsed.output_json.chapter_explanation = normalised; } } }
                finalVerseRefAssessment = evaluateVerseRefCount(parsed.chapter_explanation);
                finalSentenceCountAssessment = evaluateSentenceCount(parsed.chapter_explanation, { listHeavy });
                finalWordCount = countWords(parsed.chapter_explanation); lastWordCount = finalWordCount;
            }

            const confidence = evaluateConfidence({
                explanation: parsed.chapter_explanation, wordCount: finalWordCount, wordPolicy,
                sentenceAssessment: finalSentenceCountAssessment, verseRefAssessment: finalVerseRefAssessment,
                groundingAssessment, metaTalkAssessment,
                retries: { jsonInvalidRetry, truncationRetry, metaTalkRetry, groundingRetry, wordcountRetry, tooshortRetry, tooshortRetry2, sentenceCountRetry, verseRefCountRetry, postFormatRecoveryRetry },
                verseRefNormalized,
            });

            parsed.output_json._meta = {
                model: selectedModel, retry_model: retryModel,
                source_model: sourceModel,
                temperature_used: temperatureUsed, max_tokens_used: maxTokensUsed,
                truncation_retry: truncationRetry, json_invalid_retry: jsonInvalidRetry,
                json_coerce_fallback: jsonCoerceFallback, json_fallback_to_previous: jsonFallbackToPrevious,
                tooshort_retry: tooshortRetry, tooshort_retry2: tooshortRetry2,
                post_format_recovery_retry: postFormatRecoveryRetry, final_length_rescue_retry: finalLengthRescueRetry,
                wordcount_retry: wordcountRetry,
                meta_talk_retry: metaTalkRetry, meta_talk_ok: metaTalkAssessment.ok, meta_talk_hits: metaTalkAssessment.hits,
                verse_ref_count_retry: verseRefCountRetry, verse_ref_normalized: verseRefNormalized,
                verse_ref_count_ok: finalVerseRefAssessment.ok, verse_ref_block_count: finalVerseRefAssessment.block_count, verse_ref_count: finalVerseRefAssessment.verse_ref_count,
                sentence_count_retry: sentenceCountRetry, sentence_count_ok: finalSentenceCountAssessment.ok, sentence_count: finalSentenceCountAssessment.sentence_count,
                grounding_retry: groundingRetry, grounding_ok: groundingAssessment.isGrounded, grounding_token_hits: groundingAssessment.token_hits,
                word_count: finalWordCount, too_short_final: finalWordCount < wordPolicy.min_words,
                word_policy: wordPolicy, prompt_version: promptContext.promptVersion, schema_version: promptContext.schemaVersion,
                complexity: complexityInfo || undefined, payload_tier: payloadTier,
                confidence_score: confidence.score, confidence_band: confidence.band, confidence_reasons: confidence.reasons,
            };
            lastParsedOutputJson = parsed.output_json;

            if (finalWordCount < wordPolicy.min_words) throw new Error(`Explanation too short after retries: ${finalWordCount} words (minimum ${wordPolicy.min_words}, target ${wordPolicy.target_words}).`);

            const durationMs = Date.now() - t0;
            process.stdout.write(` ${Math.round(durationMs / 100) / 10}s\n`);

            await upsertChapterResult(client, {
                translation, bookId: target.book_id, chapter: target.chapter, model: selectedModel,
                promptVersion: promptContext.promptVersion, schemaVersion: promptContext.schemaVersion,
                status: "ready", chapterExplanation: parsed.chapter_explanation,
                inputPayload: payload, outputJson: parsed.output_json, errorText: null, durationMs,
            });
            ok++;

        } catch (e) {
            const durationMs = Date.now() - t0;
            const errorOutputJson = (() => {
                let out = lastParsedOutputJson && typeof lastParsedOutputJson === "object" ? { ...lastParsedOutputJson } : {};
                if (rawResponse) out.raw_response = rawResponse;
                if (Number.isFinite(lastWordCount)) { const baseMeta = out._meta && typeof out._meta === "object" ? out._meta : {}; out._meta = { ...baseMeta, word_count: lastWordCount }; }
                if (!Object.keys(out).length && rawResponse) out = { raw_response: rawResponse };
                return out;
            })();
            await upsertChapterResult(client, {
                translation, bookId: target.book_id, chapter: target.chapter, model: selectedModel,
                promptVersion: promptContext?.promptVersion || "unknown", schemaVersion: promptContext?.schemaVersion || "unknown",
                status: "error", chapterExplanation: null, inputPayload: payload || {},
                outputJson: errorOutputJson, errorText: e?.message || String(e), durationMs,
            });
            console.warn(`  ERROR: ${e?.message || String(e)}`);
            err++;
        }
    }

    await client.end();
    console.log("");
    console.log("Chapter escalation (OpenAI) finished.");
    console.log(`  Source model: ${sourceModel}`);
    console.log(`  Escalation model: ${model}`);
    console.log(`  Escalated bands: error + ${escalateBands.join(", ")}`);
    console.log(`  OK: ${ok}`);
    console.log(`  Errors: ${err}`);
    console.log(`  Skipped (already ready at escalation model): ${skipped}`);
    console.log(`  Total targeted: ${targets.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
