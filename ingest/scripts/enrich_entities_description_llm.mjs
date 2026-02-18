// ingest/scripts/enrich_entities_description_llm.mjs
// Imports rich descriptions from an externally generated JSONL file
// and merges them into each entity's metadata->'llm_enrichment'.
//
// Usage:
//   node ingest/scripts/enrich_entities_description_llm.mjs [input_path]
//
// Input JSONL format: {"id": 1, "description": "..."}
// Default input: ingest/data/entities_enriched.jsonl

import { Client } from "pg";
import { readFileSync } from "fs";

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

    let updated = 0;
    let skipped = 0;

    for (const entry of entries) {
        if (!entry.id || !entry.description) {
            skipped++;
            continue;
        }

        await client.query(
            `UPDATE entities
             SET metadata = jsonb_set(
                 COALESCE(metadata, '{}'),
                 '{llm_enrichment,description_rich}',
                 $2::jsonb
             )
             WHERE id = $1`,
            [entry.id, JSON.stringify(entry.description)]
        );
        updated++;
    }

    await client.end();

    console.log(`Updated: ${updated}`);
    if (skipped) console.log(`Skipped (missing id or description): ${skipped}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
