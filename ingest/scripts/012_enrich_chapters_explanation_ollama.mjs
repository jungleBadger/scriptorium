// ingest/scripts/012_enrich_chapters_explanation_ollama.mjs
// Offline chapter explanation pipeline using Ollama.
//
// Usage examples:
//   node ingest/scripts/012_enrich_chapters_explanation_ollama.mjs
//   node ingest/scripts/012_enrich_chapters_explanation_ollama.mjs --fast-plus --model qwen3:8b
//   node ingest/scripts/012_enrich_chapters_explanation_ollama.mjs --translation WEBU --book GEN --chapter 1 --force
//   node ingest/scripts/012_enrich_chapters_explanation_ollama.mjs --translation PT1911 --limit 20
//
// --fast-plus: Phase 1 profile — JSON-invalid retry + verse-ref retry only.
//              Defaults prompt to chapter_explainer_prompt_8b.txt. Stores ready even if too short.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { BOOK_ORDER } from "../../server/data/bookNames.js";

const OLLAMA_HOST = (process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/+$/, "");
const DEFAULT_MODEL = process.env.CHAPTER_MODEL || process.env.OLLAMA_MODEL || "qwen3:8b";
const DEFAULT_SIMPLE_MODEL = process.env.CHAPTER_MODEL_SIMPLE || "qwen3:8b";
const DEFAULT_COMPLEX_MODEL = process.env.CHAPTER_MODEL_COMPLEX || "qwen3:14b";
const RETRY_MODEL = "qwen3:14b";
const DEFAULT_TEMPERATURE = Number.parseFloat(process.env.CHAPTER_TEMP || "0.15");
const DEFAULT_TOP_P = Number.parseFloat(process.env.CHAPTER_TOP_P || "0.75");
const DEFAULT_VERBOSITY_RETRY_TEMP = Number.parseFloat(process.env.CHAPTER_VERBOSE_RETRY_TEMP || "0.2");

// Raised default to reduce too-short risk when enforcing structured longer answers.
const DEFAULT_NUM_PREDICT = Number.parseInt(process.env.CHAPTER_NUM_PREDICT || "900", 10);

const DEFAULT_WORD_TARGET = Number.parseInt(process.env.CHAPTER_WORD_TARGET || "220", 10);
const MIN_EXPLANATION_WORDS_FLOOR = 80;
const HARD_MAX_EXPLANATION_WORDS = 260;
const MAX_ALIASES_PER_ENTITY = 2;

const DEFAULT_PROMPT_PATH =
    process.env.CHAPTER_PROMPT || path.join("ingest", "prompts", "chapter_explainer_prompt.txt");
const DEFAULT_PROMPT_PATH_SIMPLE =
    process.env.CHAPTER_PROMPT_SIMPLE ||
    path.join("ingest", "prompts", "chapter_explainer_prompt_8b.txt");
const DEFAULT_PROMPT_PATH_COMPLEX = process.env.CHAPTER_PROMPT_COMPLEX || DEFAULT_PROMPT_PATH;

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

// Ratio is kept for telemetry; semantic gating below avoids comma-only false positives in narrative chapters.
const LIST_HEAVY_RATIO_THRESHOLD = 0.30;

// NOTE appended only when we detect “effectively list heavy”.
const LIST_HEAVY_NOTE =
    "NOTE: This chapter is list-heavy (genealogies/descendants or places/borders/cities). Summarize the repeated listing collectively and explain what is being listed. Avoid inventing narrative events.";

const META_TALK_RETRY_NOTE =
    'IMPORTANT: Do NOT mention payload, dataset, JSON, arrays, objects, schema, fields, keys, input/output, provided data, or how the input is organized. Avoid framing like "the structure/format/pattern/each entry"; instead directly describe what the chapter says. Use concrete details from the verses and include verse refs like (v. 1, v. 13). Output valid JSON only.';

// Used both for list-heavy semantic detection and “list-heavy language” checks.
// (Borders/cities/inheritance)
const LIST_HEAVY_KEYWORDS = [
    "border",
    "borders",
    "boundary",
    "boundaries",
    "city",
    "cities",
    "town",
    "towns",
    "inheritance",
    "allotment",
    "territory",
    "settlement",
    "settlements",
    "fronteira",
    "fronteiras",
    "cidade",
    "cidades",
    "heranca",
    "territorio",
    "territorios",
];

// Genealogy/table-of-nations style list language (to avoid false negatives for Gen 5/10 etc.)
const GENEALOGY_KEYWORDS = [
    "begat",
    "genealogy",
    "generations",
    "descendant",
    "descendants",
    "sons",
    "sons of",
    "father",
    "lived",
    "years",
    "geracoes",
    "geração",
    "descendentes",
    "filhos",
    "filhos de",
    "pai",
    "anos",
];

const STRUCTURAL_GROUNDING_TOKENS = [
    "border",
    "borders",
    "boundary",
    "boundaries",
    "city",
    "cities",
    "inheritance",
    "allotment",
    "territory",
    "settlement",
    "settlements",
    "fronteira",
    "fronteiras",
    "cidade",
    "cidades",
    "heranca",
    "herancas",
    "territorio",
    "territorios",
    "limite",
    "limites",
    "divisa",
    "divisas",
    "lote",
    "lotes",
];

const UNGROUNDED_LIST_HEAVY_PHRASES = [
    /joshua[’']?s leadership/i,
    /\bunity under joshua\b/i,
    /levitical priests?/i,
    /\bpriests?\s+maintaining\s+order\b/i,
    /\bpriestly duties\b/i,
    /\bprepare(?:d|s|ing)?\s+for\s+(?:the\s+)?(?:conquest|campaign)\b/i,
    /\bpreparing for conquest\b/i,
    /\bpreparing for campaign\b/i,
    /\bdivine assurance\b/i,
    /\bgod[’']?s presence(?:\s+with\s+them)?\b/i,
    /\bpresence of god\b/i,
    /cross(ing)?\s+the\s+jordan/i,
    /\bark\s+of\s+the\s+covenant\b/i,
    /\bspiritual order before the campaign\b/i,
];

const TOKEN_STOPWORDS = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "into",
    "unto",
    "that",
    "this",
    "these",
    "those",
    "they",
    "their",
    "them",
    "his",
    "her",
    "its",
    "was",
    "were",
    "are",
    "had",
    "have",
    "has",
    "not",
    "but",
    "you",
    "your",
    "shall",
    "will",
    "then",
    "when",
    "where",
    "which",
    "each",
    "every",
    "among",
    "also",
    "chapter",
    "verse",
    "verses",
]);

const CHAPTER_OUTPUT_SCHEMA = {
    type: "object",
    properties: {
        chapter_explanation: { type: "string" },
    },
    required: ["chapter_explanation"],
    additionalProperties: false,
};

const CHAPTER_LIST_SQL = `
    WITH
    chapter_order AS (
        SELECT
          book_id,
        chapter,
        MIN(COALESCE(ordinal, 2147483647)) AS chapter_ordinal
      FROM verses
      WHERE translation = $1
        AND ($2::text IS NULL OR book_id = $2)
        AND ($3::int  IS NULL OR chapter = $3)
      GROUP BY book_id, chapter
    )
    SELECT
      c.book_id,
      c.chapter,
      c.chapter_ordinal AS first_ordinal
    FROM chapter_order c
    LEFT JOIN unnest($4::text[]) WITH ORDINALITY bo(book_id, book_pos)
      ON bo.book_id = c.book_id
    ORDER BY COALESCE(bo.book_pos, 100000), c.chapter, c.chapter_ordinal
`;

const CHAPTER_PAYLOAD_SQL = `
    WITH params AS (
      SELECT $1::text AS translation, $2::text AS book_id, $3::int AS chapter
    ),
    chapter_verses AS (
      SELECT
        v.verse,
        v.verse_raw,
        v.ref,
        v.text_clean
      FROM verses v
      JOIN params p ON true
      WHERE v.translation = p.translation
        AND v.book_id = p.book_id
        AND v.chapter = p.chapter
      ORDER BY v.verse, v.verse_raw
    ),
    alias_agg AS (
      SELECT
        a.entity_id,
        COALESCE(array_agg(DISTINCT a.name_form ORDER BY a.name_form), '{}') AS aliases
      FROM entity_aliases a
      GROUP BY a.entity_id
    ),
    chapter_entity_hits AS (
      SELECT
        ev.entity_id,
        array_agg(DISTINCT ev.verse ORDER BY ev.verse) AS verses_in_chapter,
        COUNT(DISTINCT ev.verse) AS verse_hits
      FROM entity_verses ev
      JOIN params p ON true
      WHERE ev.book_id = p.book_id
        AND ev.chapter = p.chapter
      GROUP BY ev.entity_id
    ),
    chapter_entities AS (
      SELECT
        e.id,
        e.canonical_name,
        e.type,
        e.disambiguator,
        e.description,
        COALESCE(e.metadata->'llm_enrichment'->>'description_rich', e.description, '') AS description_rich,
        e.lon,
        e.lat,
        COALESCE(aa.aliases, '{}') AS aliases,
        h.verses_in_chapter,
        h.verse_hits,
        ml.modern_id,
        ml.modern_name,
        ml.modern_url_slug,
        ml.modern_score,
        ml.modern_lon,
        ml.modern_lat,
        ti.image_id AS thumbnail_image_id,
        ti.image_url AS thumbnail_url,
        ti.credit AS thumbnail_credit,
        ti.credit_url AS thumbnail_credit_url,
        ti.license AS thumbnail_license
      FROM chapter_entity_hits h
      JOIN entities e ON e.id = h.entity_id
      LEFT JOIN alias_agg aa ON aa.entity_id = e.id
      LEFT JOIN LATERAL (
        SELECT
          eml.modern_id,
          eml.name AS modern_name,
          eml.url_slug AS modern_url_slug,
          eml.score AS modern_score,
          om.lon AS modern_lon,
          om.lat AS modern_lat
        FROM entity_modern_links eml
        LEFT JOIN openbible_modern om ON om.id = eml.modern_id
        WHERE eml.entity_id = e.id
        ORDER BY eml.score DESC NULLS LAST, eml.modern_id
        LIMIT 1
      ) ml ON true
      LEFT JOIN LATERAL (
        SELECT
          eil.image_id,
          oi.image_url,
          oi.credit,
          oi.credit_url,
          oi.license
        FROM entity_image_links eil
        JOIN openbible_images oi ON oi.id = eil.image_id
        WHERE eil.entity_id = e.id
        ORDER BY
          CASE WHEN lower(eil.role) LIKE '%thumbnail%' THEN 0 ELSE 1 END,
          eil.image_id
        LIMIT 1
      ) ti ON true
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
            'description_rich', NULLIF(e.description_rich, ''),
            'lon', e.lon,
            'lat', e.lat,
            'aliases', to_jsonb(e.aliases),
            'verses_in_chapter', to_jsonb(e.verses_in_chapter),
            'verse_hits', e.verse_hits,
            'modern', CASE
              WHEN e.modern_id IS NULL THEN NULL
              ELSE jsonb_build_object(
                'id', e.modern_id,
                'name', e.modern_name,
                'url_slug', e.modern_url_slug,
                'score', e.modern_score,
                'lon', e.modern_lon,
                'lat', e.modern_lat
              )
            END,
            'thumbnail', CASE
              WHEN e.thumbnail_image_id IS NULL THEN NULL
              ELSE jsonb_build_object(
                'image_id', e.thumbnail_image_id,
                'url', e.thumbnail_url,
                'credit', e.thumbnail_credit,
                'credit_url', e.thumbnail_credit_url,
                'license', e.thumbnail_license
              )
            END
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
      schema_version = EXCLUDED.schema_version,
      status = EXCLUDED.status,
      chapter_explanation = EXCLUDED.chapter_explanation,
      input_payload = EXCLUDED.input_payload,
      output_json = EXCLUDED.output_json,
      error_text = EXCLUDED.error_text,
      duration_ms = EXCLUDED.duration_ms,
      generated_at = EXCLUDED.generated_at
`;

function getArg(name, fallback = null) {
    const idx = process.argv.indexOf(name);
    if (idx === -1) return fallback;
    const next = process.argv[idx + 1];
    return next && !next.startsWith("--") ? next : fallback;
}

function hasFlag(name) {
    return process.argv.includes(name);
}

function parseIntArg(name, fallback = null) {
    const raw = getArg(name, null);
    if (raw == null) return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid integer for ${name}: ${raw}`);
    }
    return parsed;
}

function parsePromptFile(promptPath) {
    if (!fs.existsSync(promptPath)) {
        throw new Error(`Prompt file not found: ${promptPath}`);
    }
    const raw = fs.readFileSync(promptPath, "utf8");
    const promptVersion = (raw.match(/^PROMPT_VERSION=(.+)$/m)?.[1] || "v1").trim();
    const schemaVersion = (raw.match(/^SCHEMA_VERSION=(.+)$/m)?.[1] || "v1").trim();
    const template = raw.replace(/^PROMPT_VERSION=.*$/m, "").replace(/^SCHEMA_VERSION=.*$/m, "").trim();
    return { promptVersion, schemaVersion, template };
}

function renderPrompt(template, payload, wordTarget) {
    const payloadJson = JSON.stringify(payload, null, 2);
    if (!template.includes("{{WORD_TARGET}}")) {
        throw new Error("Prompt template must include {{WORD_TARGET}} placeholder.");
    }
    const withWordTarget = template.replaceAll("{{WORD_TARGET}}", String(wordTarget));
    return withWordTarget.replace("{{CHAPTER_PAYLOAD_JSON}}", payloadJson);
}

function isEffectivelyListHeavy(complexityInfo) {
    return (
        (complexityInfo?.list_heavy_ratio ?? 0) >= LIST_HEAVY_RATIO_THRESHOLD &&
        complexityInfo?.list_heavy_semantic === true
    );
}

export function buildChapterPrompt(template, payload, wordTarget, complexityInfo) {
    const basePrompt = renderPrompt(template, payload, wordTarget);
    if (isEffectivelyListHeavy(complexityInfo)) {
        return `${basePrompt}\n\n${LIST_HEAVY_NOTE}`;
    }
    return basePrompt;
}

export function sanitizeChapterPayloadForLLM(payload) {
    const verses = Array.isArray(payload?.verses)
        ? payload.verses.map((v) => ({
            verse: v?.verse ?? null,
            ref: v?.ref ?? null,
            text: v?.text ?? "",
        }))
        : [];

    const entities = Array.isArray(payload?.entities)
        ? payload.entities
            .map((e) => {
                const base = {
                    id: e?.id ?? null,
                    canonical_name: e?.canonical_name ?? null,
                    type: e?.type ?? null,
                    aliases: Array.isArray(e?.aliases)
                        ? e.aliases
                            .map((a) => (typeof a === "string" ? a.trim() : ""))
                            .filter(Boolean)
                            .slice(0, MAX_ALIASES_PER_ENTITY)
                        : [],
                    verses_in_chapter: Array.isArray(e?.verses_in_chapter) ? e.verses_in_chapter : [],
                    verse_hits: Number.isFinite(e?.verse_hits) ? e.verse_hits : 0,
                };

                const rich = typeof e?.description_rich === "string" ? e.description_rich.trim() : "";
                const plain = typeof e?.description === "string" ? e.description.trim() : "";
                if (rich) {
                    base.description_rich = rich;
                } else if (plain) {
                    base.description = plain;
                }

                const modernName = e?.modern?.name;
                if (typeof modernName === "string" && modernName.trim()) {
                    base.modern = { name: modernName.trim() };
                }

                return base;
            })
            .sort((a, b) => {
                if ((b.verse_hits ?? 0) !== (a.verse_hits ?? 0)) {
                    return (b.verse_hits ?? 0) - (a.verse_hits ?? 0);
                }
                return String(a.canonical_name || "").localeCompare(String(b.canonical_name || ""));
            })
            .slice(0, 80)
        : [];

    return {
        translation: payload?.translation ?? null,
        book_id: payload?.book_id ?? null,
        chapter: payload?.chapter ?? null,
        verses,
        entities,
    };
}

function computeChapterComplexity(payload) {
    const verses = Array.isArray(payload?.verses) ? payload.verses : [];
    const entities = Array.isArray(payload?.entities) ? payload.entities : [];
    const versesText = verses.map((v) => String(v?.text || "")).join("\n");
    const verseCount = verses.length;
    const totalChars = verses.reduce((acc, v) => acc + String(v?.text || "").length, 0);
    const avgVerseChars = verseCount > 0 ? totalChars / verseCount : 0;
    const entityCount = entities.length;
    const entityDensity = verseCount > 0 ? entityCount / verseCount : 0;

    const listHeavyVerses = verses.reduce((acc, v) => {
        const txt = String(v?.text || "");
        const commaCount = (txt.match(/,/g) || []).length;
        return acc + (commaCount >= 3 ? 1 : 0);
    }, 0);

    const listHeavyRatio = verseCount > 0 ? listHeavyVerses / verseCount : 0;
    const listHeavySemantic = hasListHeavySemanticCueFromVerses(versesText);

    let score = 0;
    if (verseCount >= 40) score += 2;
    else if (verseCount >= 28) score += 1;

    if (totalChars >= 8000) score += 3;
    else if (totalChars >= 5000) score += 2;
    else if (totalChars >= 3000) score += 1;

    if (entityCount >= 20) score += 2;
    else if (entityCount >= 10) score += 1;

    if (entityDensity >= 0.6) score += 2;
    else if (entityDensity >= 0.35) score += 1;

    if (avgVerseChars >= 170) score += 1;
    if (listHeavyRatio >= 0.35) score += 1;

    return {
        score,
        verse_count: verseCount,
        total_chars: totalChars,
        avg_verse_chars: Math.round(avgVerseChars),
        entity_count: entityCount,
        entity_density: Number(entityDensity.toFixed(3)),
        list_heavy_ratio: Number(listHeavyRatio.toFixed(3)),
        list_heavy_semantic: listHeavySemantic,
    };
}

function chooseModelForChapter(payload, { simpleModel, complexModel }) {
    const complexity = computeChapterComplexity(payload);
    const model = complexity.score >= 5 ? complexModel : simpleModel;
    return { model, complexity };
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
        if (tier === "no_aliases" || tier === "no_aliases_no_modern") {
            delete next.aliases;
        }
        if (tier === "no_aliases_no_modern") {
            delete next.modern;
        }
        return next;
    });

    return {
        tier,
        payload: {
            ...payload,
            entities: transformedEntities,
        },
    };
}

async function fetchOllamaModels(host) {
    let res;
    try {
        res = await fetch(`${host}/api/tags`);
    } catch {
        throw new Error(`Cannot reach Ollama at ${host}. Start it with: ollama serve`);
    }
    if (!res.ok) {
        throw new Error(`Ollama health check failed with ${res.status}`);
    }
    const data = await res.json();
    return (data.models || []).map((m) => m.name);
}

function assertModelAvailable(models, model) {
    const hasTag = model.includes(":");
    const base = model.split(":")[0];
    const found = hasTag ? models.includes(model) : models.some((m) => m === model || m.startsWith(`${base}:`));
    if (!found) {
        throw new Error(`Model "${model}" not found in Ollama. Available: ${models.join(", ") || "(none)"}`);
    }
}
function stripThinkingBlocks(text) {
    // qwen3 (and some other models) emit <think>...</think> reasoning blocks.
    // Strip them so they don't pollute the JSON extraction step.
    return String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractOllamaText(data) {
    // Typical /api/chat shape:
    // { message: { role: "assistant", content: "..." }, done: true, ... }
    const msg = data?.message;
    if (msg && typeof msg.content === "string") return stripThinkingBlocks(msg.content);
    if (msg && msg.content && typeof msg.content === "object") return stripThinkingBlocks(JSON.stringify(msg.content));

    // Some setups / older endpoints return { response: "..." }
    if (typeof data?.response === "string") return stripThinkingBlocks(data.response);

    // Sometimes content is nested differently (rare), keep a last-resort:
    if (typeof data?.content === "string") return stripThinkingBlocks(data.content);

    return "";
}

function summarizeKeys(obj) {
    if (!obj || typeof obj !== "object") return String(obj);
    const top = Object.keys(obj);
    const msgKeys = obj.message && typeof obj.message === "object" ? Object.keys(obj.message) : [];
    return `top-level keys=${JSON.stringify(top)}; message keys=${JSON.stringify(msgKeys)}`;
}

async function callOllama({ host, model, userPrompt, temperature, topP, numPredict }) {
    const url = `${host}/api/chat`;

    // 1) First try: strict schema (your current approach)
    const bodySchema = {
        model,
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
        ],
        format: CHAPTER_OUTPUT_SCHEMA,
        stream: false,
        options: {
            temperature,
            top_p: topP,
            num_predict: numPredict,
            // Disable qwen3's extended thinking mode so reasoning tokens don't
            // consume the num_predict budget before the actual response begins.
            // Ignored by models that don't support this option.
            think: false,
        },
    };

    const res1 = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodySchema),
    });

    if (!res1.ok) {
        throw new Error(`Ollama returned ${res1.status}: ${await res1.text()}`);
    }

    const data1 = await res1.json();
    let text = extractOllamaText(data1).trim();
    if (text) return text;

    // 2) Fallback: ask for JSON (not schema). Some models/builds behave better here.
    const bodyJson = {
        ...bodySchema,
        format: "json",
    };

    const res2 = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyJson),
    });

    if (!res2.ok) {
        throw new Error(`Ollama fallback returned ${res2.status}: ${await res2.text()}`);
    }

    const data2 = await res2.json();
    text = extractOllamaText(data2).trim();
    if (text) return text;

    // 3) Hard fail with useful diagnostics
    throw new Error(
        `Ollama returned empty content twice. ` +
        `Schema attempt: ${summarizeKeys(data1)}. ` +
        `JSON attempt: ${summarizeKeys(data2)}.`
    );
}

export function parseChapterOutput(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        const firstBrace = raw.indexOf("{");
        const lastBrace = raw.lastIndexOf("}");
        if (firstBrace === -1 || lastBrace <= firstBrace) {
            throw new Error("Invalid output: response is not parseable JSON");
        }
        parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Invalid output: expected JSON object");
    }
    const keys = Object.keys(parsed);
    if (keys.length !== 1 || keys[0] !== "chapter_explanation") {
        throw new Error("Invalid output: expected exactly one top-level key 'chapter_explanation'");
    }

    const explanation = parsed?.chapter_explanation;
    if (typeof explanation !== "string" || !explanation.trim()) {
        throw new Error("Invalid output: missing non-empty chapter_explanation");
    }

    return {
        chapter_explanation: explanation.trim(),
        output_json: parsed,
    };
}

function coerceChapterOutputFromRaw(raw) {
    const input = String(raw || "").trim();
    if (!input) {
        throw new Error("Invalid output: response is not parseable JSON");
    }

    // Strip markdown fences if present.
    let text = input
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    // Try extracting quoted chapter_explanation value from malformed JSON-ish text.
    const keyMatch = text.match(/"chapter_explanation"\s*:\s*"([\s\S]*?)"\s*(?:,|\}|$)/i);
    if (keyMatch && keyMatch[1]) {
        const extracted = keyMatch[1]
            .replace(/\\"/g, "\"")
            .replace(/\\n/g, " ")
            .replace(/\\t/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        if (extracted) {
            return {
                chapter_explanation: extracted,
                output_json: { chapter_explanation: extracted },
            };
        }
    }

    // Fallback: treat response as plain explanation text.
    text = text
        .replace(/^\s*(?:json\s*:\s*)?/i, "")
        .replace(/^\s*"?chapter_explanation"?\s*:\s*/i, "")
        .trim();

    text = text.replace(/^"(.*)"$/s, "$1").replace(/\s+/g, " ").trim();
    if (!text) {
        throw new Error("Invalid output: response is not parseable JSON");
    }

    return {
        chapter_explanation: text,
        output_json: { chapter_explanation: text },
    };
}

export function evaluateNoMetaTalk(explanation) {
    const text = String(explanation || "");
    const checks = [
        { key: "json", rx: /\bjson\b/i },
        { key: "payload", rx: /\bpayload\b/i },
        { key: "dataset", rx: /\bdataset\b/i },
        { key: "schema", rx: /\bschema\b/i },
        { key: "array", rx: /\barray\b/i },
        { key: "object", rx: /\bobject\b/i },
        { key: "fields", rx: /\bfields?\b/i },
        { key: "keys", rx: /\bkeys?\b/i },
        { key: "input_output", rx: /\b(?:input|output)\b/i },
        { key: "provided_data", rx: /\bprovided\s+data\b/i },
        { key: "response_describes", rx: /\bresponse\s+describes\b/i },
        { key: "chapter_payload", rx: /\bchapter\s+payload\b/i },
        { key: "verses_array_list", rx: /\bverses?\s+(?:array|list)\b/i },
        { key: "entities_array_list", rx: /\bentities?\s+(?:array|list)\b/i },
        { key: "contains_data_about", rx: /\bcontains\s+data\s+about\b/i },
        // Catch formatting framing only when explicitly tied to meta terms.
        {
            key: "meta_structure_framing",
            rx: /\b(?:structure|format|entries?|entry)\b[\s\S]{0,40}\b(?:json|payload|dataset|schema|array|object|fields?|keys?|input|output)\b/i,
        },
        {
            key: "meta_structure_framing_reverse",
            rx: /\b(?:json|payload|dataset|schema|array|object|fields?|keys?|input|output)\b[\s\S]{0,40}\b(?:structure|format|entries?|entry)\b/i,
        },
    ];

    const hits = [];
    for (const check of checks) {
        if (check.rx.test(text)) hits.push(check.key);
    }
    if (!hits.length) return { ok: true };

    return {
        ok: false,
        reason: "response describes payload structure/meta format instead of chapter content",
        hits,
    };
}

function isLikelyTruncated(explanation) {
    const text = String(explanation || "").trim();
    if (!text) return false;

    if (/\(v\.\s*$/i.test(text) || /\($/.test(text)) return true;

    const endsWithSentencePunctuation = /[.!?](?:["')\]]+)?$/.test(text);
    if (!endsWithSentencePunctuation) return true;

    return false;
}

function normalizeForGrounding(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

// Semantic gate to avoid comma-density misclassifying narrative chapters (e.g., Genesis 1/3) as list-heavy.
function hasListHeavySemanticCueFromVerses(versesText) {
    /*
      Self-check (expected):
      - Genesis 1: comma-heavy narrative without list semantics -> false.
      - Joshua 15: border/city/inheritance semantics -> true.
      - Genesis 10: genealogy/table-of-nations cues -> true.
    */
    const normalized = normalizeForGrounding(versesText);
    if (!normalized.trim()) return false;

    if (LIST_HEAVY_KEYWORDS.some((kw) => normalized.includes(kw))) {
        return true;
    }

    const genealogyCues = [
        /\bbegat\b/i,
        /\bgenealogy\b/i,
        /\bgenerations\b/i,
        /\bdescendants?\b/i,
        /\bsons of\b/i,
        /\bthese are the sons of\b/i,
        /\baccording to their families\b/i,
        /\bby their clans\b/i,
        /\bby their tongues\b/i,
        /\bby their languages\b/i,
        /\bgeracoes\b/i,
        /\bdescendentes\b/i,
        /\bfilhos de\b/i,
        /\bsegundo as suas familias\b/i,
        /\bsegundo as suas linguas\b/i,
    ];
    if (genealogyCues.some((rx) => rx.test(normalized))) {
        return true;
    }

    // Optional lightweight signal: many verse lines starting with "and ..."/"e ..." often indicates formulaic lists.
    // Raised threshold to reduce false positives in narrative chapters.
    const introLines = String(versesText || "")
        .split(/\r?\n/)
        .reduce((acc, line) => acc + (/^\s*(?:and|e)\s+\p{L}+/iu.test(line) ? 1 : 0), 0);

    return introLines >= 10;
}

function countWords(text) {
    return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function getSentenceBounds(listHeavy = false) {
    // Relaxed non-list upper bound to avoid unnecessary retries on otherwise good outputs.
    return listHeavy ? { min: 2, max: 5 } : { min: 3, max: 7 };
}

function stripVerseRefsForCounting(text) {
    return String(text || "")
        // Remove parenthesized (v. ...) blocks, absorbing any surrounding comma/space
        .replace(/,?\s*\(\s*v\.\s*[^)]*\)\s*,?/gi, " ")
        // Remove bare v. N patterns that escaped parens (e.g. "v. 12" mid-sentence)
        .replace(/\bv\.\s*\d[\d\s,\-–]*/gi, " ")
        // Remove any empty parens () left behind
        .replace(/\(\s*\)/g, "")
        // Collapse adjacent sentence-end punctuation artifacts (e.g. ". .")
        .replace(/([.!?])\s+([.!?])/g, "$1")
        // Collapse multiple spaces
        .replace(/\s{2,}/g, " ")
        .trim();
}

function countSentences(text) {
    const cleaned = stripVerseRefsForCounting(text);
    return cleaned
        .split(/[.!?]+/)
        .map((part) => part.trim())
        .filter(Boolean).length;
}

function countVerseRefBlocks(text) {
    // Count distinct (v. ...) parenthesized blocks.
    const matches = String(text || "").match(/\(\s*v\.\s*[^)]+\)/gi);
    return matches ? matches.length : 0;
}

function extractFinalVerseRefBlock(text) {
    // Accept either "... (v. 1-3, v. 24-28)" or "... (v. 1-3, v. 24-28)."
    return String(text || "").trim().match(/(\(\s*v\.\s*[^)]+\))(?:\.)?\s*$/i)?.[1] || null;
}

function countVerseRefsInBlock(blockText) {
    const block = String(blockText || "");
    const matches = block.match(/\bv\.\s*\d[\d\-–]*/gi);
    return matches ? matches.length : 0;
}

function hasInlineVerseMentionOutsideFinalBlock(text, finalBlock) {
    const trimmed = String(text || "").trim();
    const withoutFinal = finalBlock
        ? trimmed.replace(/(\(\s*v\.\s*[^)]+\))(?:\.)?\s*$/i, "").trim()
        : trimmed;
    return /\bv\.\s*\d[\d\-–]*/i.test(withoutFinal);
}

function hasBookChapterVerseMention(text) {
    // Ban styles like "Genesis 10:10", "Gen 10:10", "1 Kings 2:3".
    return /\b(?:[1-3]\s+)?[A-Za-z]{2,}(?:\s+[A-Za-z]{2,})*\s+\d{1,3}:\d{1,3}\b/.test(
        String(text || "")
    );
}

export function evaluateSentenceCount(explanation, { listHeavy = false } = {}) {
    const { min, max } = getSentenceBounds(listHeavy);
    const sentenceCount = countSentences(explanation);
    return {
        ok: sentenceCount >= min && sentenceCount <= max,
        sentence_count: sentenceCount,
        min,
        max,
    };
}

export function evaluateVerseRefCount(explanation) {
    // Enforce one final block style:
    // "... (v. 1-3, v. 24-28)." with no inline "v. N" elsewhere and no "Gen 1:1" style.
    const text = String(explanation || "").trim();
    const blockCount = countVerseRefBlocks(text);
    const finalBlock = extractFinalVerseRefBlock(text);
    const refCount = countVerseRefsInBlock(finalBlock);
    const inlineOutsideFinal = hasInlineVerseMentionOutsideFinalBlock(text, finalBlock);
    const bookChapterVerseHit = hasBookChapterVerseMention(text);
    const finalBlockAtEnd = Boolean(finalBlock);
    return {
        ok:
            blockCount === 1 &&
            finalBlockAtEnd &&
            refCount === 2 &&
            !inlineOutsideFinal &&
            !bookChapterVerseHit,
        block_count: blockCount,
        final_block_at_end: finalBlockAtEnd,
        verse_ref_count: refCount,
        inline_verse_outside_final_block: inlineOutsideFinal,
        book_chapter_verse_hit: bookChapterVerseHit,
        required_blocks: 1,
        required_refs: 2,
    };
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function evaluateConfidence({
    explanation,
    wordCount,
    wordPolicy,
    sentenceAssessment,
    verseRefAssessment,
    groundingAssessment,
    metaTalkAssessment,
    retries = {},
    verseRefNormalized = false,
}) {
    let score = 100;
    const reasons = [];

    const penalize = (amount, reason) => {
        score -= amount;
        reasons.push(reason);
    };

    if (wordPolicy) {
        if (wordCount < wordPolicy.min_words) {
            penalize(25, `word_count_below_min(${wordCount}<${wordPolicy.min_words})`);
        } else if (wordCount > wordPolicy.max_words) {
            penalize(15, `word_count_above_max(${wordCount}>${wordPolicy.max_words})`);
        }
    }

    if (!sentenceAssessment?.ok) {
        penalize(20, `sentence_count_out_of_range(${sentenceAssessment?.sentence_count})`);
    }

    if (!verseRefAssessment?.ok) {
        penalize(35, `verse_ref_format_or_count_invalid(blocks=${verseRefAssessment?.block_count},refs=${verseRefAssessment?.verse_ref_count})`);
    }

    if (!groundingAssessment?.isGrounded) {
        penalize(30, "grounding_failed");
    } else if (
        Number.isFinite(groundingAssessment?.required_hits) &&
        groundingAssessment.required_hits > 0 &&
        Number.isFinite(groundingAssessment?.token_hits) &&
        groundingAssessment.token_hits > groundingAssessment.required_hits
    ) {
        score += 3;
        reasons.push("grounding_token_hits_above_minimum");
    }

    if (!metaTalkAssessment?.ok) {
        penalize(20, "meta_talk_detected");
    }

    if (/\b(?:possibly|likely|means|suggests)\b/i.test(String(explanation || ""))) {
        penalize(8, "speculation_word_detected");
    }

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

    if (verseRefNormalized) {
        penalize(4, "verse_refs_normalized_in_postprocess");
    }

    const finalScore = Math.round(clamp(score, 0, 100));
    const band = finalScore >= 85 ? "high" : finalScore >= 65 ? "medium" : "low";

    return {
        score: finalScore,
        band,
        reasons,
    };
}

/**
 * Deterministically normalises verse references so the explanation contains
 * exactly ONE parenthesised block with exactly TWO v. anchors:
 *   (v. 3-4, v. 24-28)
 *
 * Applied as a final code-level pass after all LLM retries have been exhausted.
 * Returns the original text unchanged when it already satisfies the constraint,
 * or when there are no refs to work with.
 */
export function consolidateVerseRefs(text) {
    const str = String(text || "").trim();

    // Collect all (v. ...) blocks in document order
    const blocks = [];
    let bm;
    const blockRe = /\(\s*v\.\s*[^)]+\)/gi;
    while ((bm = blockRe.exec(str)) !== null) blocks.push(bm[0]);

    if (blocks.length === 0) return str; // nothing to normalise

    // Already ideal: 1 block, 2 anchors inside it
    if (blocks.length === 1) {
        const anchors = (blocks[0].match(/\bv\.\s*\d[\d\-–]*/gi) || []);
        if (anchors.length === 2) return str;
    }

    // Gather every "v. N[N-N]" expression across all blocks
    const refRe = /\bv\.\s*\d[\d\-–]*/gi;
    const allRefs = [];
    for (const block of blocks) {
        for (const r of (block.match(refRe) || [])) allRefs.push(r);
    }
    if (allRefs.length === 0) return str;

    // Deduplicate while preserving order, then pick first + last for chapter span
    const seen = new Set();
    const unique = allRefs.filter(r => {
        const key = r.replace(/\s/g, "");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    const chosen = unique.length <= 2 ? unique : [unique[0], unique[unique.length - 1]];
    const consolidated = `(${chosen.join(", ")})`;

    // Strip all original blocks from the text and tidy artifacts
    let base = str.replace(/\s*\(\s*v\.\s*[^)]+\)/gi, "").trim();
    // Remove disallowed inline ref styles before appending the canonical final block.
    base = base.replace(/\b(?:in|at|from)\s+v\.\s*\d[\d\-–]*/gi, "");
    base = base.replace(/\bv\.\s*\d[\d\-–]*/gi, "");
    base = base.replace(/\b(?:[1-3]\s+)?[A-Za-z]{2,}(?:\s+[A-Za-z]{2,})*\s+\d{1,3}:\d{1,3}\b/g, "");
    base = base.replace(/\s{2,}/g, " ").replace(/\s+([.,;])/g, "$1").trim();

    // Re-attach before the terminal punctuation mark
    if (/[.!?]$/.test(base)) {
        base = base.replace(/([.!?])$/, ` ${consolidated}$1`);
    } else {
        base = `${base} ${consolidated}.`;
    }

    return base;
}

function buildVerseRefFormatLockRetryNote({ minWords, maxWords, minSentences, maxSentences, listHeavy = false }) {
    const sentenceConstraint = listHeavy
        ? "Use EXACTLY 3 sentences."
        : "Use BETWEEN 4 and 6 sentences.";
    // Aim above the floor so the model doesn't calibrate to the minimum.
    const aimMin = minWords + 25;
    return `IMPORTANT: FORMAT LOCK. Rewrite from scratch. Include EXACTLY 2 verse references total in ONE parenthesized block, e.g. (v. 3-4, v. 24-28). Do not include any other "(v." anywhere else in the text. Do not write inline verse mentions like "in v. 3". Do not use book/chapter notation like "Genesis 10:10". The verse-reference block must be the final characters of the output string. ${sentenceConstraint} Keep between ${aimMin} and ${maxWords} words. Output valid JSON only.`;
}

function buildSentenceCountRetryNote({ minWords, maxWords, minSentences, maxSentences, listHeavy = false }) {
    const sentenceConstraint = listHeavy
        ? "Rewrite from scratch using EXACTLY 3 sentences."
        : "Rewrite from scratch using BETWEEN 4 and 6 sentences.";
    // Aim above the floor so the model doesn't calibrate to the minimum.
    const aimMin = minWords + 25;
    return `IMPORTANT: Your previous answer had the wrong number of sentences. ${sentenceConstraint} Include EXACTLY 2 verse references total using one parenthesized block (v. ..., v. ...), with no other "(v." anywhere. Do not write inline verse mentions like "in v. 3". Do not use book/chapter notation like "Genesis 10:10". End with the verse-reference block as the final characters of the output. Keep between ${aimMin} and ${maxWords} words. Output valid JSON only.`;
}

function buildGroundingRetryNote({
    minWords,
    targetWords,
    minSentences,
    maxSentences,
    listHeavy = false,
}) {
    const sentenceConstraint = listHeavy
        ? "Use EXACTLY 3 sentences."
        : "Use BETWEEN 4 and 6 sentences.";
    // Aim 25 words above the floor so the model doesn't stop exactly at the minimum.
    const aimMin = minWords + 25;
    return `IMPORTANT: Grounding check failed. Your previous explanation referenced events, people, or places NOT present in THIS chapter's verses, or drifted into themes from other chapters. Rewrite from scratch using ONLY the verses provided in this payload — do not describe events from other chapters or books. Keep AT LEAST ${aimMin} words (target ${targetWords}). If needed, add one extra sentence with a concrete detail from these verses. Include exactly 2 verse references total in ONE parenthesized block, e.g. (v. 3-4, v. 24-28), and no other "(v." in the text. Do not write inline verse mentions like "in v. 3". Do not use book/chapter notation like "Genesis 10:10". End with the verse-reference block as the final characters of the output. ${sentenceConstraint} No speculation: avoid possibly, likely, means, suggests. Output valid JSON only.`;
}

function buildVerbosityRetryNote(policy, { strict = false } = {}) {
    // Aim 30 words above the floor so the model doesn't calibrate to the minimum.
    const aimMin = policy.min_words + 30;
    if (strict) {
        return `IMPORTANT: Still too short. Rewrite from scratch with EXACTLY 6 full sentences and ${aimMin}-${policy.max_words} words. Every sentence must anchor to a concrete verse detail (named item, number, or specific action). Do not mention payload/format. Do not use semicolons. Output valid JSON only.`;
    }
    return `IMPORTANT: Your explanation is too short. Write EXACTLY 6 sentences totaling ${aimMin}-${policy.max_words} words. Each sentence must include at least one named person/place/object OR one explicit number/action from the verses. Do not use semicolons to cram multiple sentences. Include 1-3 verse refs like (v. 1, v. 13). Output valid JSON only.`;
}

function buildWordcountRetryNote(policy) {
    return `IMPORTANT: Keep the explanation between ${policy.min_words} and ${policy.max_words} words. Do not exceed ${HARD_MAX_EXPLANATION_WORDS}. Output only valid JSON.`;
}

export function estimateExplanationWordPolicy(payload, { listHeavy = false, overrideTarget = null } = {}) {
    const verses = Array.isArray(payload?.verses) ? payload.verses : [];
    let chapterWords = verses.reduce((acc, verse) => acc + countWords(verse?.text), 0);
    let chapterWordsEstimated = false;

    if (chapterWords <= 0) {
        const wordsPerVerse = listHeavy ? 16 : 22;
        chapterWords = Math.max(1, verses.length) * wordsPerVerse;
        chapterWordsEstimated = true;
    }

    const override = Number.isFinite(overrideTarget) ? Number(overrideTarget) : null;
    const targetWords = override && override > 0
        ? Math.round(override)
        : listHeavy
            ? clamp(Math.round(50 + (0.06 * chapterWords)), 95, 165)
            : clamp(Math.round(60 + (0.08 * chapterWords)), 110, 190);

    const floorForChapter = listHeavy ? 70 : MIN_EXPLANATION_WORDS_FLOOR;
    const minWords = Math.max(floorForChapter, targetWords - 40);
    const maxWords = Math.min(HARD_MAX_EXPLANATION_WORDS, targetWords + 40);

    // Always aim at least 40 words above the minimum so the model's natural
    // undershoot still clears the floor. Decouples prompt signal from the
    // enforcement threshold (the root cause of "lower limit → lower output").
    const promptTargetWords = Math.min(HARD_MAX_EXPLANATION_WORDS, Math.max(targetWords, minWords + 40));

    return {
        chapter_words: chapterWords,
        chapter_words_estimated: chapterWordsEstimated,
        list_heavy: listHeavy === true,
        target_words: targetWords,
        prompt_target_words: promptTargetWords,
        min_words: minWords,
        max_words: maxWords,
        target_mode: override && override > 0 ? "override" : "dynamic",
    };
}

function extractVerseGroundingTokens(payload, maxTokens = 16) {
    const freq = new Map();
    const pushToken = (raw) => {
        const token = String(raw || "").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
        if (token.length < 3) return;
        const lowered = normalizeForGrounding(token);
        if (TOKEN_STOPWORDS.has(lowered)) return;
        freq.set(lowered, (freq.get(lowered) || 0) + 1);

        // Keep anchors from hyphen/apostrophe names (e.g., Beth-shemesh, En-gedi, Baal's).
        if (/[-']/g.test(token)) {
            const parts = token.split(/[-']/g);
            for (const part of parts) {
                const partNorm = normalizeForGrounding(part);
                if (partNorm.length >= 3 && !TOKEN_STOPWORDS.has(partNorm)) {
                    freq.set(partNorm, (freq.get(partNorm) || 0) + 1);
                }
            }
        }
    };

    const verses = Array.isArray(payload?.verses) ? payload.verses : [];
    for (const verse of verses) {
        const text = String(verse?.text || "");
        const candidates =
            text.match(/\b[A-Z][A-Za-z'-]{2,}(?:\s+[A-Z][A-Za-z'-]{2,}){0,2}\b/g) || [];
        for (const cand of candidates) pushToken(cand);

        // Secondary pass for structural chapter nouns common in border/city/allotment chapters.
        const normalizedVerse = normalizeForGrounding(text);
        for (const anchor of STRUCTURAL_GROUNDING_TOKENS) {
            if (normalizedVerse.includes(anchor)) {
                freq.set(anchor, (freq.get(anchor) || 0) + 1);
            }
        }
    }

    const entities = Array.isArray(payload?.entities) ? payload.entities : [];
    for (const entity of entities) {
        const name = String(entity?.canonical_name || "");
        pushToken(name);
        const parts = name.split(/[\s-]+/g);
        for (const part of parts) pushToken(part);
    }

    return [...freq.entries()]
        .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
        .slice(0, maxTokens)
        .map(([token]) => token);
}

export function evaluateGrounding(explanation, payload, { listHeavy = false } = {}) {
    const text = String(explanation || "").trim();
    const normalizedText = normalizeForGrounding(text);
    const tokens = extractVerseGroundingTokens(payload);
    const verses = Array.isArray(payload?.verses) ? payload.verses : [];
    const entities = Array.isArray(payload?.entities) ? payload.entities : [];
    const entityDensity = verses.length > 0 ? entities.length / verses.length : 0;
    const relaxedForListOrDense = listHeavy || entityDensity >= 0.45;

    const matchedTokens = tokens.filter((token) => normalizedText.includes(token));
    const requiredHits = relaxedForListOrDense
        ? tokens.length >= 1
            ? 1
            : 0
        : tokens.length >= 2
            ? 2
            : tokens.length === 1
                ? 1
                : 0;
    const tokenGrounded = requiredHits === 0 ? text.length > 0 : matchedTokens.length >= requiredHits;

    // List-heavy chapters can be “places/borders/cities” OR “genealogies/descendants”.
    const hasListHeavyLanguage = listHeavy
        ? LIST_HEAVY_KEYWORDS.some((kw) => normalizedText.includes(kw)) ||
        GENEALOGY_KEYWORDS.map(normalizeForGrounding).some((kw) => normalizedText.includes(kw))
        : true;

    const hasDisallowedPhrase = listHeavy ? UNGROUNDED_LIST_HEAVY_PHRASES.some((rx) => rx.test(text)) : false;

    // Require at least one verse ref always (your prompts now enforce it).
    const hasVerseRef = /\bv\.\s*\d+/i.test(text);

    return {
        isGrounded: tokenGrounded && hasListHeavyLanguage && !hasDisallowedPhrase && hasVerseRef,
        token_hits: matchedTokens.length,
        required_hits: requiredHits,
        entity_density: Number(entityDensity.toFixed(3)),
        relaxed_for_list_or_dense: relaxedForListOrDense,
        list_heavy_keyword_hit: hasListHeavyLanguage,
        disallowed_phrase_hit: hasDisallowedPhrase,
        verse_ref_hit: hasVerseRef,
    };
}

async function fetchChapterPayload(client, { translation, bookId, chapter }) {
    const { rows } = await client.query(CHAPTER_PAYLOAD_SQL, [translation, bookId, chapter]);
    return rows[0]?.chapter_payload || null;
}

async function upsertChapterResult(client, data) {
    await client.query(UPSERT_SQL, [
        data.translation,
        data.bookId,
        data.chapter,
        data.model,
        data.promptVersion,
        data.schemaVersion,
        data.status,
        data.chapterExplanation || null,
        JSON.stringify(data.inputPayload || {}),
        JSON.stringify(data.outputJson || {}),
        data.errorText || null,
        data.durationMs || null,
    ]);
}

async function main() {
    const translation = getArg("--translation", "WEBU");
    const bookId = getArg("--book", null);
    const chapter = parseIntArg("--chapter", null);
    const limit = parseIntArg("--limit", 0);
    const force = hasFlag("--force");
    const autoModel = hasFlag("--auto-model");
    const fastPlus = hasFlag("--fast-plus");
    if (autoModel && fastPlus) throw new Error("--fast-plus and --auto-model are mutually exclusive.");

    const modelSimple = getArg("--model-simple", DEFAULT_SIMPLE_MODEL);
    const modelComplex = getArg("--model-complex", DEFAULT_COMPLEX_MODEL);
    const model = getArg("--model", fastPlus ? modelSimple : DEFAULT_MODEL);
    const retryModel = RETRY_MODEL;

    const promptPathArg = getArg("--prompt", null);
    const promptPath = promptPathArg || (fastPlus ? DEFAULT_PROMPT_PATH_SIMPLE : DEFAULT_PROMPT_PATH);
    const promptPathSimple = getArg("--prompt-simple", promptPathArg || DEFAULT_PROMPT_PATH_SIMPLE);
    const promptPathComplex = getArg("--prompt-complex", promptPathArg || DEFAULT_PROMPT_PATH_COMPLEX);
    const promptVersionOverride = getArg("--prompt-version", null);

    const temperature = Number.isFinite(DEFAULT_TEMPERATURE) ? DEFAULT_TEMPERATURE : 0.15;
    const topP = Number.isFinite(DEFAULT_TOP_P) ? DEFAULT_TOP_P : 0.75;
    const verbosityRetryTemperature = Number.isFinite(DEFAULT_VERBOSITY_RETRY_TEMP)
        ? DEFAULT_VERBOSITY_RETRY_TEMP
        : 0.2;

    const cliNumPredict = parseIntArg("--num-predict", null);
    const numPredict = cliNumPredict ?? (Number.isFinite(DEFAULT_NUM_PREDICT) ? DEFAULT_NUM_PREDICT : 900);

    const cliWordTarget = parseIntArg("--word-target", null);
    const defaultWordTarget = Number.isFinite(DEFAULT_WORD_TARGET) ? DEFAULT_WORD_TARGET : 220;

    if (chapter != null && chapter < 1) throw new Error("--chapter must be >= 1");
    if (chapter != null && !bookId) throw new Error("--chapter requires --book");
    if (limit < 0) throw new Error("--limit must be >= 0");
    if (!Number.isFinite(numPredict) || numPredict < 1) throw new Error("--num-predict must be >= 1");
    if (cliWordTarget != null && (!Number.isFinite(cliWordTarget) || cliWordTarget < 1)) {
        throw new Error("--word-target must be >= 1");
    }

    const promptContextSingle = !autoModel
        ? (() => {
            const info = parsePromptFile(promptPath);
            return {
                path: promptPath,
                template: info.template,
                promptVersion: promptVersionOverride || info.promptVersion,
                schemaVersion: info.schemaVersion,
            };
        })()
        : null;

    const promptContextSimple = autoModel
        ? (() => {
            const info = parsePromptFile(promptPathSimple);
            return {
                path: promptPathSimple,
                template: info.template,
                promptVersion: promptVersionOverride || info.promptVersion,
                schemaVersion: info.schemaVersion,
            };
        })()
        : null;

    const promptContextComplex = autoModel
        ? (() => {
            const info = parsePromptFile(promptPathComplex);
            return {
                path: promptPathComplex,
                template: info.template,
                promptVersion: promptVersionOverride || info.promptVersion,
                schemaVersion: info.schemaVersion,
            };
        })()
        : null;

    console.log(`Ollama host: ${OLLAMA_HOST}`);
    if (autoModel) {
        console.log(`Model mode: auto (complexity-based)`);
        console.log(`Model simple: ${modelSimple}`);
        console.log(`Model complex: ${modelComplex}`);
        console.log(`Retry model: ${retryModel}`);
        console.log(`Prompt simple: ${promptContextSimple.path}`);
        console.log(`Prompt simple version: ${promptContextSimple.promptVersion}`);
        console.log(`Prompt complex: ${promptContextComplex.path}`);
        console.log(`Prompt complex version: ${promptContextComplex.promptVersion}`);
        console.log(`Schema simple: ${promptContextSimple.schemaVersion}`);
        console.log(`Schema complex: ${promptContextComplex.schemaVersion}`);
    } else {
        console.log(`Model: ${model}`);
        console.log(`Retry model: ${retryModel}`);
        console.log(`Prompt: ${promptContextSingle.path}`);
        console.log(`Prompt version: ${promptContextSingle.promptVersion}`);
        console.log(`Schema version: ${promptContextSingle.schemaVersion}`);
    }
    console.log(`Translation: ${translation}`);
    console.log(`Temperature: ${temperature}`);
    console.log(`Verbosity retry temperature: ${verbosityRetryTemperature}`);
    console.log(`Top-p: ${topP}`);
    console.log(`Num predict: ${numPredict}`);
    console.log(`Word target mode: ${cliWordTarget != null ? "override" : "dynamic-by-chapter"}`);
    if (cliWordTarget != null) {
        console.log(`Word target override: ${cliWordTarget}`);
    } else {
        console.log(`Word target fallback (no verse text): ${defaultWordTarget}`);
    }
    console.log(`Force: ${force}`);
    if (fastPlus) console.log("Mode: fast-plus (JSON-invalid retry + verse-ref retry only, stores ready even if too short)");
    if (bookId) console.log(`Book filter: ${bookId}`);
    if (chapter != null) console.log(`Chapter filter: ${chapter}`);
    if (limit > 0) console.log(`Limit: ${limit}`);
    console.log("");

    const availableModels = await fetchOllamaModels(OLLAMA_HOST);
    if (autoModel) {
        assertModelAvailable(availableModels, modelSimple);
        assertModelAvailable(availableModels, modelComplex);
    } else {
        assertModelAvailable(availableModels, model);
    }
    assertModelAvailable(availableModels, retryModel);
    console.log("Ollama is reachable and required model(s) are available.");

    const client = new Client({
        host: process.env.PGHOST || "localhost",
        port: parseInt(process.env.PGPORT || "5432", 10),
        user: process.env.PGUSER || "bible",
        password: process.env.PGPASSWORD || "bible",
        database: process.env.PGDATABASE || "bible",
    });
    await client.connect();

    const { rows: chapters } = await client.query(CHAPTER_LIST_SQL, [
        translation,
        bookId,
        chapter,
        CANONICAL_BOOK_IDS,
    ]);
    if (!chapters.length) {
        await client.end();
        console.log("No chapters found for the provided filters.");
        return;
    }

    const readySet = new Set();
    const existingSet = new Set();
    const modelsForReadyCheck = autoModel ? [modelSimple, modelComplex] : [model];
    const promptVersionsForReadyCheck = autoModel
        ? [...new Set([promptContextSimple.promptVersion, promptContextComplex.promptVersion])]
        : [promptContextSingle.promptVersion];

    if (!force) {
        const { rows: readyRows } = await client.query(
            `SELECT book_id, chapter, model, prompt_version
       FROM chapter_explanations
       WHERE translation = $1
         AND model = ANY($2::text[])
         AND prompt_version = ANY($3::text[])
         AND status = 'ready'`,
            [translation, modelsForReadyCheck, promptVersionsForReadyCheck]
        );
        for (const row of readyRows) {
            readySet.add(`${row.book_id}:${row.chapter}:${row.model}:${row.prompt_version}`);
        }

        if (fastPlus && !autoModel) {
            const { rows: existingRows } = await client.query(
                `SELECT book_id, chapter
           FROM chapter_explanations
           WHERE translation = $1
             AND model = $2`,
                [translation, model]
            );
            for (const row of existingRows) {
                existingSet.add(`${row.book_id}:${row.chapter}`);
            }
        }
    }

    const filtered = [];
    for (const row of chapters) {
        if (!force && !autoModel) {
            if (fastPlus) {
                const existingKey = `${row.book_id}:${row.chapter}`;
                if (existingSet.has(existingKey)) continue;
            }
            const key = `${row.book_id}:${row.chapter}:${model}:${promptContextSingle.promptVersion}`;
            if (readySet.has(key)) continue;
        }
        filtered.push({ book_id: row.book_id, chapter: row.chapter });
    }

    const targets = limit > 0 ? filtered.slice(0, limit) : filtered;
    if (!targets.length) {
        await client.end();
        console.log("All target chapters are already enriched for this model/prompt_version.");
        return;
    }

    let ok = 0;
    let err = 0;
    let skipped = autoModel ? 0 : chapters.length - targets.length;

    for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        const label = `${target.book_id} ${target.chapter}`;
        console.log(`[${i + 1}/${targets.length}] ${label}`);

        let selectedModel = model;
        let selectedPromptContext = autoModel ? promptContextComplex : promptContextSingle;
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
        let numPredictUsed = numPredict;
        let lastParsedOutputJson = null;
        let lastWordCount = null;

        const t0 = Date.now();

        try {
            payload = await fetchChapterPayload(client, {
                translation,
                bookId: target.book_id,
                chapter: target.chapter,
            });
            if (!payload || !Array.isArray(payload.verses) || payload.verses.length === 0) {
                throw new Error("Missing chapter payload verses");
            }

            const llmPayloadBase = sanitizeChapterPayloadForLLM(payload);
            complexityInfo = computeChapterComplexity(llmPayloadBase);
            const listHeavy = isEffectivelyListHeavy(complexityInfo);

            if (autoModel && complexityInfo.score >= 5) {
                numPredictUsed = Math.max(numPredictUsed, 1000);
            }

            const tiered = applyPayloadTierForComplexity(llmPayloadBase, complexityInfo.score);
            const llmPayload = tiered.payload;
            payloadTier = tiered.tier;
            wordPolicy = estimateExplanationWordPolicy(llmPayload, {
                listHeavy,
                overrideTarget: cliWordTarget,
            });

            if (autoModel) {
                if (listHeavy) {
                    selectedModel = modelSimple;
                    selectedPromptContext = promptContextSimple;
                } else {
                    const selected = chooseModelForChapter(llmPayloadBase, {
                        simpleModel: modelSimple,
                        complexModel: modelComplex,
                    });
                    selectedModel = selected.model;
                    selectedPromptContext = selectedModel === modelSimple ? promptContextSimple : promptContextComplex;
                }

                if (!force) {
                    const readyKey = `${target.book_id}:${target.chapter}:${selectedModel}:${selectedPromptContext.promptVersion}`;
                    if (readySet.has(readyKey)) {
                        skipped++;
                        console.log(`  Skipping: already ready for ${selectedModel} (${selectedPromptContext.promptVersion})`);
                        continue;
                    }
                }
            }

            console.log(
                `  Model used: ${selectedModel} (complexity score: ${complexityInfo.score}, payload tier: ${payloadTier}, num_predict: ${numPredictUsed}, prompt: ${selectedPromptContext.promptVersion}, words target/range: ${wordPolicy.target_words}/${wordPolicy.min_words}-${wordPolicy.max_words})`
            );

            const promptWordTarget = wordPolicy?.prompt_target_words || wordPolicy?.target_words || defaultWordTarget;
            const prompt = buildChapterPrompt(
                selectedPromptContext.template,
                llmPayload,
                promptWordTarget,
                complexityInfo
            );

            process.stdout.write("  Calling LLM...");
            let parsed;
            const setParsed = (nextParsed) => {
                parsed = nextParsed;
                lastParsedOutputJson = nextParsed?.output_json || null;
            };
            const callAndSetParsedWithJsonGuard = async ({
                modelName,
                userPrompt,
                temp,
                numPredictValue = numPredictUsed,
            }) => {
                const previousParsed = parsed
                    ? {
                        chapter_explanation: parsed.chapter_explanation,
                        output_json:
                            parsed.output_json && typeof parsed.output_json === "object"
                                ? { ...parsed.output_json }
                                : { chapter_explanation: parsed.chapter_explanation },
                    }
                    : null;
                const fallbackToPrevious = () => {
                    if (!previousParsed) return false;
                    jsonFallbackToPrevious = true;
                    setParsed(previousParsed);
                    return true;
                };

                try {
                    rawResponse = await callOllama({
                        host: OLLAMA_HOST,
                        model: modelName,
                        userPrompt,
                        temperature: temp,
                        topP,
                        numPredict: numPredictValue,
                    });
                    try {
                        setParsed(parseChapterOutput(rawResponse));
                        temperatureUsed = temp;
                    } catch {
                        jsonInvalidRetry = true;
                        const invalidJsonRepairPrompt = `${userPrompt}\n\nIMPORTANT: Your previous response was invalid JSON. No extra text before/after JSON. Exactly one top-level key: "chapter_explanation".`;
                        rawResponse = await callOllama({
                            host: OLLAMA_HOST,
                            model: modelName,
                            userPrompt: invalidJsonRepairPrompt,
                            temperature: 0,
                            topP,
                            numPredict: numPredictValue,
                        });
                        try {
                            setParsed(parseChapterOutput(rawResponse));
                            temperatureUsed = 0;
                        } catch {
                            // Last JSON repair fallback on the chapter's selected model.
                            if (modelName !== selectedModel) {
                                rawResponse = await callOllama({
                                    host: OLLAMA_HOST,
                                    model: selectedModel,
                                    userPrompt: invalidJsonRepairPrompt,
                                    temperature: 0,
                                    topP,
                                    numPredict: numPredictValue,
                                });
                                try {
                                    setParsed(parseChapterOutput(rawResponse));
                                    temperatureUsed = 0;
                                } catch {
                                    try {
                                        const coerced = coerceChapterOutputFromRaw(rawResponse);
                                        jsonCoerceFallback = true;
                                        setParsed(coerced);
                                        temperatureUsed = 0;
                                    } catch {
                                        if (!fallbackToPrevious()) {
                                            throw new Error("Invalid output: response is not parseable JSON");
                                        }
                                    }
                                }
                            } else {
                                try {
                                    const coerced = coerceChapterOutputFromRaw(rawResponse);
                                    jsonCoerceFallback = true;
                                    setParsed(coerced);
                                    temperatureUsed = 0;
                                } catch {
                                    if (!fallbackToPrevious()) {
                                        throw new Error("Invalid output: response is not parseable JSON");
                                    }
                                }
                            }
                        }
                    }
                } catch {
                    // Retry path should not fail the whole chapter if we already had a valid output.
                    if (!fallbackToPrevious()) {
                        throw new Error("Invalid output: response is not parseable JSON");
                    }
                }
            };

            rawResponse = await callOllama({
                host: OLLAMA_HOST,
                model: selectedModel,
                userPrompt: prompt,
                temperature,
                topP,
                numPredict: numPredictUsed,
            });

            try {
                setParsed(parseChapterOutput(rawResponse));
            } catch {
                jsonInvalidRetry = true;
                const retryPrompt = `${prompt}\n\nIMPORTANT: Your previous response was invalid JSON. No extra text before/after JSON. Exactly one top-level key: "chapter_explanation".`;
                await callAndSetParsedWithJsonGuard({
                    modelName: selectedModel,
                    userPrompt: retryPrompt,
                    temp: 0,
                });
            }

            if (fastPlus) {
                // ── FAST-PLUS DECISION TREE ──────────────────────────────────────────────
                // Max 2 LLM calls (3 if JSON was invalid). Only verse-ref format can
                // trigger a quality retry in fast-plus mode.
                let fpWordCount = countWords(parsed.chapter_explanation);
                lastWordCount = fpWordCount;
                const fpSentenceBounds = getSentenceBounds(listHeavy);

                // Code-level normalisation first (no LLM call).
                let fpVerseRefAssessment = evaluateVerseRefCount(parsed.chapter_explanation);
                if (!fpVerseRefAssessment.ok) {
                    const normalised = consolidateVerseRefs(parsed.chapter_explanation);
                    if (normalised !== parsed.chapter_explanation) {
                        verseRefNormalized = true;
                        parsed.chapter_explanation = normalised;
                        parsed.output_json.chapter_explanation = normalised;
                        fpVerseRefAssessment = evaluateVerseRefCount(parsed.chapter_explanation);
                    }
                }
                if (!fpVerseRefAssessment.ok) {
                    verseRefCountRetry = true;
                    const verseRefsRetryPrompt = `${prompt}\n\n${buildVerseRefFormatLockRetryNote({
                        minWords: wordPolicy.min_words,
                        maxWords: wordPolicy.max_words,
                        minSentences: fpSentenceBounds.min,
                        maxSentences: fpSentenceBounds.max,
                        listHeavy,
                    })}`;
                    await callAndSetParsedWithJsonGuard({
                        modelName: retryModel,
                        userPrompt: verseRefsRetryPrompt,
                        temp: 0,
                    });
                    fpWordCount = countWords(parsed.chapter_explanation);
                    lastWordCount = fpWordCount;
                }

                // Evaluate all quality metrics for _meta telemetry (no more retries).
                const fpFinalVerseRefAssessment = evaluateVerseRefCount(parsed.chapter_explanation);
                const fpFinalSentenceAssessment = evaluateSentenceCount(parsed.chapter_explanation, { listHeavy });
                const fpGroundingAssessment = evaluateGrounding(parsed.chapter_explanation, llmPayload, { listHeavy });
                const fpMetaTalkAssessment = evaluateNoMetaTalk(parsed.chapter_explanation);
                lastWordCount = fpWordCount;

                const confidence = evaluateConfidence({
                    explanation: parsed.chapter_explanation,
                    wordCount: fpWordCount,
                    wordPolicy,
                    sentenceAssessment: fpFinalSentenceAssessment,
                    verseRefAssessment: fpFinalVerseRefAssessment,
                    groundingAssessment: fpGroundingAssessment,
                    metaTalkAssessment: fpMetaTalkAssessment,
                    retries: {
                        jsonInvalidRetry,
                        truncationRetry,
                        metaTalkRetry,
                        groundingRetry,
                        wordcountRetry,
                        tooshortRetry,
                        tooshortRetry2,
                        sentenceCountRetry,
                        verseRefCountRetry,
                        postFormatRecoveryRetry,
                    },
                    verseRefNormalized,
                });

                parsed.output_json._meta = {
                    model: selectedModel,
                    retry_model: retryModel,
                    temperature_used: temperatureUsed,
                    top_p: topP,
                    num_predict_used: numPredictUsed,
                    fast_plus: true,

                    truncation_retry: false,
                    json_invalid_retry: jsonInvalidRetry,
                    json_coerce_fallback: jsonCoerceFallback,
                    json_fallback_to_previous: jsonFallbackToPrevious,
                    tooshort_retry: tooshortRetry,
                    tooshort_retry2: false,
                    post_format_recovery_retry: false,
                    final_length_rescue_retry: false,
                    wordcount_retry: false,

                    meta_talk_retry: false,
                    meta_talk_ok: fpMetaTalkAssessment.ok,
                    meta_talk_hits: fpMetaTalkAssessment.hits,

                    verse_ref_count_retry: verseRefCountRetry,
                    verse_ref_normalized: verseRefNormalized,
                    verse_ref_count_ok: fpFinalVerseRefAssessment.ok,
                    verse_ref_block_count: fpFinalVerseRefAssessment.block_count,
                    verse_ref_count: fpFinalVerseRefAssessment.verse_ref_count,

                    sentence_count_retry: false,
                    sentence_count_ok: fpFinalSentenceAssessment.ok,
                    sentence_count: fpFinalSentenceAssessment.sentence_count,

                    grounding_retry: false,
                    grounding_ok: fpGroundingAssessment.isGrounded,
                    grounding_token_hits: fpGroundingAssessment.token_hits,

                    word_count: fpWordCount,
                    too_short_final: fpWordCount < wordPolicy.min_words,
                    word_policy: wordPolicy,
                    prompt_version: selectedPromptContext.promptVersion,
                    schema_version: selectedPromptContext.schemaVersion,
                    complexity: complexityInfo || undefined,
                    payload_tier: payloadTier,
                    confidence_score: confidence.score,
                    confidence_band: confidence.band,
                    confidence_reasons: confidence.reasons,
                };
                lastParsedOutputJson = parsed.output_json;

                // Store as ready even if still too short — Phase 2 escalates from confidence_band.
                const durationMs = Date.now() - t0;
                process.stdout.write(` ${Math.round(durationMs / 100) / 10}s\n`);

                await upsertChapterResult(client, {
                    translation,
                    bookId: target.book_id,
                    chapter: target.chapter,
                    model: selectedModel,
                    promptVersion: selectedPromptContext.promptVersion,
                    schemaVersion: selectedPromptContext.schemaVersion,
                    status: "ready",
                    chapterExplanation: parsed.chapter_explanation,
                    inputPayload: payload,
                    outputJson: parsed.output_json,
                    errorText: null,
                    durationMs,
                });
                ok++;
            } else {
            // ── FULL RETRY CHAIN (non-fast-plus) ─────────────────────────────────────
            if (isLikelyTruncated(parsed.chapter_explanation)) {
                truncationRetry = true;
                numPredictUsed = Math.max(numPredictUsed, 1100);
                const truncationRetryPrompt = `${prompt}\n\nIMPORTANT: Ensure the explanation is complete and ends with a full sentence. Output only valid JSON.`;
                await callAndSetParsedWithJsonGuard({
                    modelName: selectedModel,
                    userPrompt: truncationRetryPrompt,
                    temp: 0,
                    numPredictValue: numPredictUsed,
                });
            }

            let wordCount = countWords(parsed.chapter_explanation);
            lastWordCount = wordCount;
            const sentenceBounds = getSentenceBounds(listHeavy);

            // Meta-talk check (and one retry)
            let metaTalkAssessment = evaluateNoMetaTalk(parsed.chapter_explanation);
            if (!metaTalkAssessment.ok) {
                metaTalkRetry = true;
                const metaTalkRetryPrompt = `${prompt}\n\n${META_TALK_RETRY_NOTE}`;
                await callAndSetParsedWithJsonGuard({
                    modelName: selectedModel,
                    userPrompt: metaTalkRetryPrompt,
                    temp: 0,
                });
                wordCount = countWords(parsed.chapter_explanation);
                lastWordCount = wordCount;
                metaTalkAssessment = evaluateNoMetaTalk(parsed.chapter_explanation);
            }

            // Grounding check (and one retry)
            let groundingAssessment = evaluateGrounding(parsed.chapter_explanation, llmPayload, {
                listHeavy,
            });
            if (!groundingAssessment.isGrounded) {
                groundingRetry = true;
                console.log("  Retrying once for grounding...");
                const groundingRetryPrompt = `${prompt}\n\n${buildGroundingRetryNote({
                    minWords: wordPolicy.min_words,
                    targetWords: wordPolicy.target_words,
                    minSentences: sentenceBounds.min,
                    maxSentences: sentenceBounds.max,
                    listHeavy,
                })}`;
                await callAndSetParsedWithJsonGuard({
                    modelName: retryModel,
                    userPrompt: groundingRetryPrompt,
                    temp: 0,
                });
                wordCount = countWords(parsed.chapter_explanation);
                lastWordCount = wordCount;
                groundingAssessment = evaluateGrounding(parsed.chapter_explanation, llmPayload, {
                    listHeavy,
                });
            }

            // Enforce length (with num_predict bump + optional second attempt)
            if (wordCount < wordPolicy.min_words) {
                tooshortRetry = true;
                numPredictUsed = Math.max(numPredictUsed, 1100);

                const shortRetryPrompt = `${prompt}\n\n${buildVerbosityRetryNote(wordPolicy)}`;

                await callAndSetParsedWithJsonGuard({
                    modelName: selectedModel,
                    userPrompt: shortRetryPrompt,
                    temp: verbosityRetryTemperature,
                    numPredictValue: numPredictUsed,
                });
                wordCount = countWords(parsed.chapter_explanation);
                lastWordCount = wordCount;

                if (wordCount < wordPolicy.min_words) {
                    tooshortRetry2 = true;
                    numPredictUsed = Math.max(numPredictUsed, 1300);

                    const shortRetryPrompt2 = `${prompt}\n\n${buildVerbosityRetryNote(wordPolicy, { strict: true })}`;

                    await callAndSetParsedWithJsonGuard({
                        modelName: selectedModel,
                        userPrompt: shortRetryPrompt2,
                        temp: verbosityRetryTemperature,
                        numPredictValue: numPredictUsed,
                    });
                    wordCount = countWords(parsed.chapter_explanation);
                    lastWordCount = wordCount;
                }
            }

            if (wordCount > wordPolicy.max_words) {
                wordcountRetry = true;
                const wordcountRetryPrompt = `${prompt}\n\n${buildWordcountRetryNote(wordPolicy)}`;
                await callAndSetParsedWithJsonGuard({
                    modelName: selectedModel,
                    userPrompt: wordcountRetryPrompt,
                    temp: 0,
                });
                wordCount = countWords(parsed.chapter_explanation);
                lastWordCount = wordCount;
            }

            // Sentence-count check (and one retry)
            let sentenceCountAssessment = evaluateSentenceCount(parsed.chapter_explanation, { listHeavy });
            if (!sentenceCountAssessment.ok) {
                sentenceCountRetry = true;
                const sentenceCountRetryPrompt = `${prompt}\n\n${buildSentenceCountRetryNote({
                    minWords: wordPolicy.min_words,
                    maxWords: wordPolicy.max_words,
                    minSentences: sentenceBounds.min,
                    maxSentences: sentenceBounds.max,
                    listHeavy,
                })}`;
                await callAndSetParsedWithJsonGuard({
                    modelName: selectedModel,
                    userPrompt: sentenceCountRetryPrompt,
                    temp: 0,
                });
                wordCount = countWords(parsed.chapter_explanation);
                lastWordCount = wordCount;
                sentenceCountAssessment = evaluateSentenceCount(parsed.chapter_explanation, { listHeavy });
            }

            // Final verse-ref count check (format lock, one retry)
            let verseRefAssessment = evaluateVerseRefCount(parsed.chapter_explanation);
            if (!verseRefAssessment.ok) {
                const normalised = consolidateVerseRefs(parsed.chapter_explanation);
                if (normalised !== parsed.chapter_explanation) {
                    verseRefNormalized = true;
                    parsed.chapter_explanation = normalised;
                    parsed.output_json.chapter_explanation = normalised;
                    verseRefAssessment = evaluateVerseRefCount(parsed.chapter_explanation);
                }
            }
            if (!verseRefAssessment.ok) {
                verseRefCountRetry = true;
                const verseRefsRetryPrompt = `${prompt}\n\n${buildVerseRefFormatLockRetryNote({
                    minWords: wordPolicy.min_words,
                    maxWords: wordPolicy.max_words,
                    minSentences: sentenceBounds.min,
                    maxSentences: sentenceBounds.max,
                    listHeavy,
                })}`;
                await callAndSetParsedWithJsonGuard({
                    modelName: retryModel,
                    userPrompt: verseRefsRetryPrompt,
                    temp: 0,
                });
                wordCount = countWords(parsed.chapter_explanation);
                lastWordCount = wordCount;
                verseRefAssessment = evaluateVerseRefCount(parsed.chapter_explanation);
            }

            // Deterministic format clean-up: consolidate verse refs in code so any
            // word-count regression from ref removal is visible to the recovery check below.
            {
                const preNorm = evaluateVerseRefCount(parsed.chapter_explanation);
                if (!preNorm.ok) {
                    const normalised = consolidateVerseRefs(parsed.chapter_explanation);
                    if (normalised !== parsed.chapter_explanation) {
                        verseRefNormalized = true;
                        parsed.chapter_explanation = normalised;
                        parsed.output_json.chapter_explanation = normalised;
                    }
                }
            }

            // Post-format recovery: sentence/verse-ref retries AND normalisation can
            // regress word count. Run after consolidation so we catch all reductions.
            wordCount = countWords(parsed.chapter_explanation);
            lastWordCount = wordCount;
            if (wordCount < wordPolicy.min_words) {
                postFormatRecoveryRetry = true;
                numPredictUsed = Math.max(numPredictUsed, 1300);
                const recoveryPrompt = `${prompt}\n\n${buildVerbosityRetryNote(wordPolicy, { strict: true })}`;
                // Use a higher temperature so the model breaks out of a short-answer
                // pattern — this retry only fires when all earlier attempts have failed.
                const recoveryTemp = Math.max(verbosityRetryTemperature, 0.45);
                await callAndSetParsedWithJsonGuard({
                    modelName: selectedModel,
                    userPrompt: recoveryPrompt,
                    temp: recoveryTemp,
                    numPredictValue: numPredictUsed,
                });
                // Re-run consolidation on the recovery output
                {
                    const postRecovNorm = evaluateVerseRefCount(parsed.chapter_explanation);
                    if (!postRecovNorm.ok) {
                        const normalised = consolidateVerseRefs(parsed.chapter_explanation);
                        if (normalised !== parsed.chapter_explanation) {
                            verseRefNormalized = true;
                            parsed.chapter_explanation = normalised;
                            parsed.output_json.chapter_explanation = normalised;
                        }
                    }
                }
            }

            let finalVerseRefAssessment = evaluateVerseRefCount(parsed.chapter_explanation);
            let finalSentenceCountAssessment = evaluateSentenceCount(parsed.chapter_explanation, {
                listHeavy,
            });
            let finalWordCount = countWords(parsed.chapter_explanation);
            lastWordCount = finalWordCount;

            if (finalWordCount < wordPolicy.min_words) {
                finalLengthRescueRetry = true;
                numPredictUsed = Math.max(numPredictUsed, 1400);
                const finalRescuePrompt = `${prompt}\n\nIMPORTANT: Rewrite from scratch. Keep AT LEAST ${wordPolicy.min_words} words (target ${wordPolicy.target_words}). Use ${listHeavy ? "EXACTLY 3 sentences" : "BETWEEN 4 and 6 sentences"}. Include exactly 2 verse references total in ONE parenthesized block and no other "(v." anywhere. The verse-reference block must be at the end. Output valid JSON only.`;
                await callAndSetParsedWithJsonGuard({
                    modelName: retryModel,
                    userPrompt: finalRescuePrompt,
                    temp: 0,
                });

                const postRescueNorm = evaluateVerseRefCount(parsed.chapter_explanation);
                if (!postRescueNorm.ok) {
                    const normalised = consolidateVerseRefs(parsed.chapter_explanation);
                    if (normalised !== parsed.chapter_explanation) {
                        verseRefNormalized = true;
                        parsed.chapter_explanation = normalised;
                        parsed.output_json.chapter_explanation = normalised;
                    }
                }

                finalVerseRefAssessment = evaluateVerseRefCount(parsed.chapter_explanation);
                finalSentenceCountAssessment = evaluateSentenceCount(parsed.chapter_explanation, {
                    listHeavy,
                });
                finalWordCount = countWords(parsed.chapter_explanation);
                lastWordCount = finalWordCount;
            }
            const confidence = evaluateConfidence({
                explanation: parsed.chapter_explanation,
                wordCount: finalWordCount,
                wordPolicy,
                sentenceAssessment: finalSentenceCountAssessment,
                verseRefAssessment: finalVerseRefAssessment,
                groundingAssessment,
                metaTalkAssessment,
                retries: {
                    jsonInvalidRetry,
                    truncationRetry,
                    metaTalkRetry,
                    groundingRetry,
                    wordcountRetry,
                    tooshortRetry,
                    tooshortRetry2,
                    sentenceCountRetry,
                    verseRefCountRetry,
                    postFormatRecoveryRetry,
                },
                verseRefNormalized,
            });

            parsed.output_json._meta = {
                model: selectedModel,
                retry_model: retryModel,
                temperature_used: temperatureUsed,
                top_p: topP,
                num_predict_used: numPredictUsed,

                truncation_retry: truncationRetry,
                json_invalid_retry: jsonInvalidRetry,
                json_coerce_fallback: jsonCoerceFallback,
                json_fallback_to_previous: jsonFallbackToPrevious,
                tooshort_retry: tooshortRetry,
                tooshort_retry2: tooshortRetry2,
                post_format_recovery_retry: postFormatRecoveryRetry,
                final_length_rescue_retry: finalLengthRescueRetry,
                wordcount_retry: wordcountRetry,

                meta_talk_retry: metaTalkRetry,
                meta_talk_ok: metaTalkAssessment.ok,
                meta_talk_hits: metaTalkAssessment.hits,

                verse_ref_count_retry: verseRefCountRetry,
                verse_ref_normalized: verseRefNormalized,
                verse_ref_count_ok: finalVerseRefAssessment.ok,
                verse_ref_block_count: finalVerseRefAssessment.block_count,
                verse_ref_count: finalVerseRefAssessment.verse_ref_count,

                sentence_count_retry: sentenceCountRetry,
                sentence_count_ok: finalSentenceCountAssessment.ok,
                sentence_count: finalSentenceCountAssessment.sentence_count,

                grounding_retry: groundingRetry,
                grounding_ok: groundingAssessment.isGrounded,
                grounding_token_hits: groundingAssessment.token_hits,

                word_count: finalWordCount,
                too_short_final: finalWordCount < wordPolicy.min_words,
                word_policy: wordPolicy,
                prompt_version: selectedPromptContext.promptVersion,
                schema_version: selectedPromptContext.schemaVersion,
                complexity: complexityInfo || undefined,
                payload_tier: payloadTier,
                confidence_score: confidence.score,
                confidence_band: confidence.band,
                confidence_reasons: confidence.reasons,
            };
            lastParsedOutputJson = parsed.output_json;

            if (finalWordCount < wordPolicy.min_words) {
                throw new Error(
                    `Explanation too short after retries: ${finalWordCount} words (minimum ${wordPolicy.min_words}, target ${wordPolicy.target_words}).`
                );
            }

            const durationMs = Date.now() - t0;
            process.stdout.write(` ${Math.round(durationMs / 100) / 10}s\n`);

            await upsertChapterResult(client, {
                translation,
                bookId: target.book_id,
                chapter: target.chapter,
                model: selectedModel,
                promptVersion: selectedPromptContext.promptVersion,
                schemaVersion: selectedPromptContext.schemaVersion,
                status: "ready",
                chapterExplanation: parsed.chapter_explanation,
                inputPayload: payload,
                outputJson: parsed.output_json,
                errorText: null,
                durationMs,
            });

            ok++;
            } // end else (full retry chain)
        } catch (e) {
            const durationMs = Date.now() - t0;
            const errorOutputJson = (() => {
                let out = lastParsedOutputJson && typeof lastParsedOutputJson === "object"
                    ? { ...lastParsedOutputJson }
                    : {};

                if (rawResponse) {
                    out.raw_response = rawResponse;
                }
                if (Number.isFinite(lastWordCount)) {
                    const baseMeta = out._meta && typeof out._meta === "object" ? out._meta : {};
                    out._meta = { ...baseMeta, word_count: lastWordCount };
                }
                if (!Object.keys(out).length && rawResponse) {
                    out = { raw_response: rawResponse };
                }
                return out;
            })();

            await upsertChapterResult(client, {
                translation,
                bookId: target.book_id,
                chapter: target.chapter,
                model: selectedModel,
                promptVersion: selectedPromptContext?.promptVersion || "unknown",
                schemaVersion: selectedPromptContext?.schemaVersion || "unknown",
                status: "error",
                chapterExplanation: null,
                inputPayload: payload || {},
                outputJson: errorOutputJson,
                errorText: e?.message || String(e),
                durationMs,
            });
            console.warn(`  ERROR: ${e?.message || String(e)}`);
            err++;
        }
    }

    await client.end();

    console.log("");
    console.log("Chapter explanation enrichment finished.");
    console.log(`  OK: ${ok}`);
    console.log(`  Errors: ${err}`);
    console.log(`  Skipped (already ready): ${skipped}`);
    console.log(`  Total targeted: ${targets.length}`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
