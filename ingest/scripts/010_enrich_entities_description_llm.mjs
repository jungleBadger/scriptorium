// ingest/scripts/enrich_entities_description_llm.mjs
// Imports rich descriptions from an externally generated JSONL file
// and merges them into each entity's metadata->'llm_enrichment'.
//
// Usage:
//   node ingest/scripts/enrich_entities_description_llm.mjs [input_path]
//
// Input JSONL formats (any one resolver is enough):
//   {"id": 1, "description": "..."}                                  (legacy/local id)
//   {"source": "openbible", "source_id": "a00123", "description":"..."} (portable/stable)
//   {"canonical_name":"Abana","type":"place.river","description":"..."} (fallback)
// Default input: ingest/data/entities_enriched.jsonl

import { Client } from "pg";
import { readFileSync } from "fs";

function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
}

function buildLookup(rows) {
    const byId = new Map();
    const bySourceKey = new Map();
    const byNameType = new Map();
    const byName = new Map();

    for (const row of rows) {
        byId.set(row.id, row.id);

        const source = normalizeText(row.source).toLowerCase();
        const sourceId = normalizeText(row.source_id);
        if (source && sourceId) {
            bySourceKey.set(`${source}::${sourceId}`, row.id);
        }

        const name = normalizeText(row.canonical_name).toLowerCase();
        const type = normalizeText(row.type).toLowerCase();
        if (name && type) {
            byNameType.set(`${name}::${type}`, row.id);
        }
        if (name) {
            const ids = byName.get(name) || [];
            ids.push(row.id);
            byName.set(name, ids);
        }
    }

    return { byId, bySourceKey, byNameType, byName };
}

function resolveEntityId(entry, lookup) {
    const source = normalizeText(entry.source).toLowerCase();
    const sourceId = normalizeText(entry.source_id);
    const name = normalizeText(entry.canonical_name).toLowerCase();
    const type = normalizeText(entry.type).toLowerCase();
    const rawId = Number.parseInt(entry.id, 10);
    const hasId = Number.isFinite(rawId) && rawId > 0;

    const bySource = source && sourceId ? lookup.bySourceKey.get(`${source}::${sourceId}`) : null;
    if (bySource) {
        return { id: bySource, method: "source+source_id", id_mismatch: hasId && bySource !== rawId };
    }

    const byNameType = name && type ? lookup.byNameType.get(`${name}::${type}`) : null;
    if (byNameType) {
        return { id: byNameType, method: "canonical_name+type", id_mismatch: hasId && byNameType !== rawId };
    }

    if (name) {
        const ids = lookup.byName.get(name) || [];
        if (ids.length === 1) {
            return { id: ids[0], method: "canonical_name(unique)", id_mismatch: hasId && ids[0] !== rawId };
        }
    }

    if (hasId && lookup.byId.has(rawId)) {
        return { id: rawId, method: "id", id_mismatch: false };
    }

    return { id: null, method: "unresolved", id_mismatch: false };
}

async function main() {
    const inputPath = process.argv[2] || "ingest/data/entities_enriched.jsonl";

    const raw = readFileSync(inputPath, "utf-8");
    const entries = raw
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));

    console.log(`Loaded ${entries.length} entries from ${inputPath}`);

    const client = new Client({
        host: process.env.PGHOST || "localhost",
        port: parseInt(process.env.PGPORT || "5432", 10),
        user: process.env.PGUSER || "bible",
        password: process.env.PGPASSWORD || "bible",
        database: process.env.PGDATABASE || "bible",
    });
    await client.connect();

    const { rows: entityRows } = await client.query(
        `SELECT id, canonical_name, type, source, source_id
         FROM entities`
    );
    const lookup = buildLookup(entityRows);

    let updated = 0;
    let unchanged = 0;
    let skipped = 0;
    let unresolved = 0;
    let idMismatch = 0;
    const resolvedByMethod = {
        "source+source_id": 0,
        "canonical_name+type": 0,
        "canonical_name(unique)": 0,
        id: 0,
        unresolved: 0,
    };
    const unresolvedSamples = [];

    await client.query("BEGIN");
    await client.query("SET LOCAL synchronous_commit = off");

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const description = normalizeText(entry.description);
        if (!description) {
            skipped++;
            continue;
        }

        const resolved = resolveEntityId(entry, lookup);
        if (resolvedByMethod[resolved.method] != null) {
            resolvedByMethod[resolved.method]++;
        }
        if (!resolved.id) {
            unresolved++;
            if (unresolvedSamples.length < 10) {
                unresolvedSamples.push({
                    line: i + 1,
                    id: entry.id ?? null,
                    source: entry.source ?? null,
                    source_id: entry.source_id ?? null,
                    canonical_name: entry.canonical_name ?? null,
                    type: entry.type ?? null,
                });
            }
            continue;
        }
        if (resolved.id_mismatch) {
            idMismatch++;
        }

        const result = await client.query(
            `UPDATE entities
             SET metadata = jsonb_set(
                 jsonb_set(
                     COALESCE(metadata, '{}'::jsonb),
                     '{llm_enrichment}',
                     COALESCE(metadata->'llm_enrichment', '{}'::jsonb),
                     true
                 ),
                 '{llm_enrichment,description_rich}',
                 to_jsonb($2::text),
                 true
             )
             WHERE id = $1
               AND metadata->'llm_enrichment'->>'description_rich' IS DISTINCT FROM $2`,
            [resolved.id, description]
        );
        if (result.rowCount > 0) {
            updated++;
        } else {
            unchanged++;
        }
    }

    await client.query("COMMIT");
    await client.end();

    console.log(`Updated: ${updated}`);
    if (unchanged) console.log(`Unchanged (already had same description_rich): ${unchanged}`);
    if (skipped) console.log(`Skipped (missing description): ${skipped}`);
    if (unresolved) console.log(`Unresolved: ${unresolved}`);
    if (idMismatch) console.log(`Resolved with id mismatch vs input id: ${idMismatch}`);
    console.log(
        `Resolution methods: source+source_id=${resolvedByMethod["source+source_id"]}, ` +
        `canonical_name+type=${resolvedByMethod["canonical_name+type"]}, ` +
        `canonical_name(unique)=${resolvedByMethod["canonical_name(unique)"]}, ` +
        `id=${resolvedByMethod.id}`
    );
    if (unresolvedSamples.length) {
        console.log("Unresolved samples:");
        for (const sample of unresolvedSamples) {
            console.log(
                `  line ${sample.line}: id=${sample.id ?? ""} source=${sample.source ?? ""} ` +
                `source_id=${sample.source_id ?? ""} canonical_name=${sample.canonical_name ?? ""} type=${sample.type ?? ""}`
            );
        }
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
