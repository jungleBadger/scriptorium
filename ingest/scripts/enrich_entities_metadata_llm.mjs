// ingest/scripts/enrich_entities_llm.mjs
// Enriches entities with richer descriptions using a local LLM via Ollama.
// Each entity gets historical/theological context, cross-references,
// related entities, and further reading suggestions.
//
// Usage:
//   node ingest/scripts/enrich_entities_llm.mjs [--force] [--limit N]
//
// Env defaults:
//   OLLAMA_HOST=http://localhost:11434
//   OLLAMA_MODEL=qwen2.5:14b
//   PGHOST=localhost PGPORT=5432 PGUSER=bible PGPASSWORD=bible PGDATABASE=bible

import { Client } from "pg";

const OLLAMA_HOST = (process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/+$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";
const FORCE = process.argv.includes("--force");
const LIMIT = (() => {
    const idx = process.argv.indexOf("--limit");
    return idx !== -1 ? parseInt(process.argv[idx + 1], 10) : 0;
})();
const ROSTER_SAMPLE_SIZE = 50;
const ROSTER_SAME_TYPE_CAP = 50;

// ── Prompt templates ────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a biblical studies reference assistant. You respond ONLY with valid JSON — no prose, no markdown fences, no extra keys. Use standard abbreviated book references (e.g. GEN, EXO, LEV, NUM, DEU, JOS, JDG, RUT, 1SA, 2SA, 1KI, 2KI, 1CH, 2CH, EZR, NEH, EST, JOB, PSA, PRO, ECC, SNG, ISA, JER, LAM, EZK, DAN, HOS, JOL, AMO, OBA, JON, MIC, NAM, HAB, ZEP, HAG, ZEC, MAL, MAT, MRK, LUK, JHN, ACT, ROM, 1CO, 2CO, GAL, EPH, PHP, COL, 1TH, 2TH, 1TI, 2TI, TIT, PHM, HEB, JAS, 1PE, 2PE, 1JN, 2JN, 3JN, JUD, REV).`;

export function buildUserPrompt(entity, verseRefs, rosterContext, rosterIds) {
    const aliasLine = entity.aliases?.length
        ? `Also known as: ${entity.aliases.join(", ")}`
        : "";
    const descLine = entity.description
        ? `Current description (etymological): ${entity.description}`
        : "No existing description.";
    const versePart = verseRefs.length > 0
        ? `First ${Math.min(verseRefs.length, 20)} verse references: ${verseRefs.slice(0, 20).join(", ")}`
        : "No verse references available.";

    // Use real IDs from the roster as example values to avoid the model copying placeholders
    const exampleIds = (rosterIds || []).slice(0, 2);
    const exampleIdStr = exampleIds.length >= 2 ? `[${exampleIds.join(", ")}]` : "[<id>, <id>]";

    return `You must write about: ${entity.canonical_name} (${entity.type})
${descLine}
${aliasLine}
${versePart}

Return a JSON object with exactly these keys:
{
  "key_refs": ["BOOK CH:VS", "BOOK CH:VS"],
  "related_entities": ${exampleIdStr}
}

Rules:
- key_refs: pick the 2-5 most significant verse references from the list above — do NOT invent new ones
- related_entities: 2-5 IDs chosen ONLY from the roster below

Known entities in the dataset for linking (id:name(type)):
${rosterContext}

Remember: you are writing about ${entity.canonical_name}, not any other entity.`;
}

// ── Roster context ──────────────────────────────────────────────

export function buildRosterContext(roster, currentEntity) {
    const sameType = [];
    const otherType = [];

    for (const e of roster) {
        if (e.id === currentEntity.id) continue;
        if (e.type === currentEntity.type) {
            sameType.push(e);
        } else {
            otherType.push(e);
        }
    }

    // Cap both pools to keep context manageable for smaller models
    const sampledSame = deterministicSample(sameType, ROSTER_SAME_TYPE_CAP);
    const sampled = deterministicSample(otherType, ROSTER_SAMPLE_SIZE);
    const combined = [...sampledSame, ...sampled];

    const context = combined.map((e) => `${e.id}:${e.canonical_name}(${e.type})`).join("\n");
    const ids = combined.map((e) => e.id);
    return { context, ids };
}

function deterministicSample(arr, n) {
    if (arr.length <= n) return arr;
    const step = arr.length / n;
    const result = [];
    for (let i = 0; i < n; i++) {
        result.push(arr[Math.floor(i * step)]);
    }
    return result;
}

// ── Ollama interaction ──────────────────────────────────────────

async function checkOllamaHealth() {
    let res;
    try {
        res = await fetch(`${OLLAMA_HOST}/api/tags`);
    } catch {
        console.error(`\nError: Cannot reach Ollama at ${OLLAMA_HOST}`);
        console.error("Make sure Ollama is running: ollama serve");
        process.exit(1);
    }
    if (!res.ok) {
        console.error(`\nError: Ollama health check returned ${res.status}`);
        process.exit(1);
    }
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name);
    // Check if the requested model (or a tag variant of it) is available
    const modelBase = OLLAMA_MODEL.split(":")[0];
    const found = models.some((m) => m === OLLAMA_MODEL || m.startsWith(modelBase + ":"));
    if (!found) {
        console.error(`\nError: Model "${OLLAMA_MODEL}" not found in Ollama.`);
        console.error(`Available models: ${models.join(", ") || "(none)"}`);
        console.error(`Pull it first: ollama pull ${OLLAMA_MODEL}`);
        process.exit(1);
    }
}

export async function callOllama(systemPrompt, userPrompt) {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: OLLAMA_MODEL,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            format: "json",
            stream: false,
            options: { temperature: 0.3 },
        }),
    });
    if (!res.ok) {
        throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    return data.message?.content || "";
}

// ── Response parsing & validation ───────────────────────────────

export function parseAndValidate(raw, validIds, knownRefs) {
    const parsed = JSON.parse(raw);

    const result = {
        cross_references: [],
        related_entities: [],
    };

    // Validate key_refs against the known verse references from the DB
    if (Array.isArray(parsed.key_refs) && knownRefs) {
        result.cross_references = parsed.key_refs
            .filter((ref) => typeof ref === "string" && knownRefs.has(ref))
            .slice(0, 5);
    }

    if (Array.isArray(parsed.related_entities)) {
        result.related_entities = parsed.related_entities
            .filter((id) => typeof id === "number" && validIds.has(id))
            .slice(0, 5);
    }

    return result;
}

// ── Name-match heuristic ────────────────────────────────────────

export function checkNameRelevance(entity, description) {
    const name = entity.canonical_name.toLowerCase();
    const desc = description.toLowerCase();
    // Check for the entity name or any of its aliases in the description
    const names = [name, ...(entity.aliases || []).map((a) => a.toLowerCase())];
    // Also check first word of canonical name (e.g. "Abel" from "Abel-beth-maacah")
    const firstName = name.split(/[-\s]/)[0];
    if (firstName.length >= 3) names.push(firstName);
    return names.some((n) => desc.includes(n));
}

async function clearEnrichment(client, entityId) {
    await client.query(
        `UPDATE entities SET metadata = metadata - 'llm_enrichment' WHERE id = $1 AND metadata ? 'llm_enrichment'`,
        [entityId]
    );
    console.warn(`         Cleared old enrichment for id=${entityId}`);
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
    console.log(`Ollama host: ${OLLAMA_HOST}`);
    console.log(`Model: ${OLLAMA_MODEL}`);
    console.log(`Force re-enrich: ${FORCE}`);
    if (LIMIT) console.log(`Limit: ${LIMIT} entities`);

    // 1. Health check
    await checkOllamaHealth();
    console.log("Ollama is reachable and model is available.\n");

    // 2. Connect to Postgres
    const client = new Client({
        host: process.env.PGHOST || "localhost",
        port: parseInt(process.env.PGPORT || "5432", 10),
        user: process.env.PGUSER || "bible",
        password: process.env.PGPASSWORD || "bible",
        database: process.env.PGDATABASE || "bible",
    });
    await client.connect();

    // 3. Load full entity roster (for related_entities linking)
    const { rows: roster } = await client.query(
        `SELECT id, canonical_name, type FROM entities ORDER BY id`
    );
    const validIds = new Set(roster.map((e) => e.id));
    console.log(`Loaded entity roster: ${roster.length} entities`);

    // 4. Load entities to enrich
    const enrichFilter = FORCE
        ? ""
        : "AND (metadata IS NULL OR metadata->'llm_enrichment' IS NULL)";

    const { rows: entities } = await client.query(`
        SELECT
            e.id,
            e.canonical_name,
            e.type,
            e.description,
            COALESCE(
                (SELECT array_agg(a.name_form) FROM entity_aliases a WHERE a.entity_id = e.id),
                '{}'
            ) AS aliases,
            COALESCE(
                (SELECT array_agg(
                    v.book_id || ' ' || v.chapter || ':' || v.verse
                    ORDER BY v.book_id, v.chapter, v.verse
                ) FROM entity_verses v WHERE v.entity_id = e.id),
                '{}'
            ) AS verse_refs
        FROM entities e
        WHERE 1=1 ${enrichFilter}
        ORDER BY e.id
        ${LIMIT ? `LIMIT ${LIMIT}` : ""}
    `);

    console.log(`Entities to enrich: ${entities.length}\n`);

    if (entities.length === 0) {
        console.log("Nothing to do.");
        await client.end();
        return;
    }

    // 5. Sequential enrichment loop
    let enriched = 0;
    let skipped = 0;
    let errored = 0;
    const startTime = Date.now();

    for (let idx = 0; idx < entities.length; idx++) {
        const entity = entities[idx];
        const pos = `[${idx + 1}/${entities.length}]`;
        const label = `${entity.canonical_name} (id=${entity.id}, ${entity.type})`;

        console.log(`\n${pos} ${label}`);

        const verseRefs = entity.verse_refs || [];
        const knownRefs = new Set(verseRefs);
        const { context: rosterContext, ids: rosterIds } = buildRosterContext(roster, entity);
        const userPrompt = buildUserPrompt(entity, verseRefs, rosterContext, rosterIds);

        const t0 = Date.now();
        let result;
        let retried = false;
        try {
            process.stdout.write("  Calling LLM...");
            const raw = await callOllama(SYSTEM_PROMPT, userPrompt);
            const llmMs = Date.now() - t0;
            process.stdout.write(` ${(llmMs / 1000).toFixed(1)}s\n`);
            result = parseAndValidate(raw, validIds, knownRefs);
        } catch (err) {
            // Retry once with corrective prompt on JSON parse errors
            if (err instanceof SyntaxError || err.message.includes("Missing")) {
                try {
                    retried = true;
                    process.stdout.write(" invalid response, retrying...");
                    const retryPrompt = `${userPrompt}\n\nIMPORTANT: Your previous response was invalid JSON. Please respond with ONLY a valid JSON object, no other text.`;
                    const raw2 = await callOllama(SYSTEM_PROMPT, retryPrompt);
                    const llmMs = Date.now() - t0;
                    process.stdout.write(` ${(llmMs / 1000).toFixed(1)}s\n`);
                    result = parseAndValidate(raw2, validIds, knownRefs);
                } catch (retryErr) {
                    console.warn(`\n  SKIP: retry failed — ${retryErr.message}`);
                    if (FORCE) await clearEnrichment(client, entity.id);
                    errored++;
                    continue;
                }
            } else {
                console.warn(`\n  SKIP: ${err.message}`);
                if (FORCE) await clearEnrichment(client, entity.id);
                errored++;
                continue;
            }
        }

        // Add provenance fields
        const enrichment = {
            ...result,
            model: OLLAMA_MODEL,
            enriched_at: new Date().toISOString(),
        };

        // Write to DB (individual commit)
        await client.query(
            `UPDATE entities
             SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{llm_enrichment}', $2::jsonb)
             WHERE id = $1`,
            [entity.id, JSON.stringify(enrichment)]
        );

        enriched++;
        console.log(`  OK: ${result.cross_references.length} refs, ${result.related_entities.length} related${retried ? " (retried)" : ""}`);

        // Progress summary every 50 entities
        const processed = enriched + errored;
        if (processed % 50 === 0 || idx === entities.length - 1) {
            const elapsed = (Date.now() - startTime) / 1000;
            const rate = processed / elapsed;
            const remaining = entities.length - processed;
            const eta = rate > 0 ? remaining / rate : 0;
            const pct = ((processed / entities.length) * 100).toFixed(1);
            console.log(
                `\n── Progress: ${processed}/${entities.length} (${pct}%)` +
                ` | OK: ${enriched} | Err: ${errored}` +
                ` | ${(rate * 60).toFixed(1)}/min` +
                ` | ETA: ${formatDuration(eta)} ──`
            );
        }
    }

    await client.end();

    // 6. Final summary
    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`\n${"═".repeat(50)}`);
    console.log(`  Enriched:  ${enriched}`);
    console.log(`  Errored:   ${errored}`);
    console.log(`  Total:     ${entities.length}`);
    console.log(`  Success:   ${((enriched / entities.length) * 100).toFixed(1)}%`);
    console.log(`  Time:      ${formatDuration(totalTime)}`);
    console.log(`  Avg:       ${(totalTime / entities.length).toFixed(1)}s/entity`);
    console.log(`${"═".repeat(50)}`);
}

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

// Only run main() when executed directly (not when imported by tests)
const isDirectRun = process.argv[1]?.replace(/\\/g, "/").endsWith("enrich_entities_llm.mjs");
if (isDirectRun) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
