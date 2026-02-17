// ingest/scripts/load_hitchcock_names.mjs
// Loads Hitchcock's Bible Names Dictionary into the entities tables.
// Merges with existing OpenBible entities when names match (case-insensitive).
//
// Usage:
//   node ingest/scripts/load_hitchcock_names.mjs ingest/data/HitchcocksBibleNamesDictionary.csv

import fs from "node:fs";
import readline from "node:readline";
import { Client } from "pg";

async function main() {
    const input = process.argv[2];
    if (!input || !fs.existsSync(input)) {
        console.error("Usage: node load_hitchcock_names.mjs <HitchcocksBibleNamesDictionary.csv>");
        process.exit(1);
    }

    const client = new Client({
        host: process.env.PGHOST || "localhost",
        port: parseInt(process.env.PGPORT || "5432", 10),
        user: process.env.PGUSER || "bible",
        password: process.env.PGPASSWORD || "bible",
        database: process.env.PGDATABASE || "bible",
    });

    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL synchronous_commit = off");

    // Find existing entity by canonical_name (case-insensitive)
    const findExisting = `
        SELECT id FROM entities
        WHERE lower(canonical_name) = lower($1)
        LIMIT 1
    `;

    // Update description on existing entity
    const updateDesc = `
        UPDATE entities SET description = $2 WHERE id = $1
    `;

    // Insert new entity for names not already in openbible
    const insertEntity = `
        INSERT INTO entities (canonical_name, type, description, source, source_id)
        VALUES ($1, 'person', $2, 'hitchcock', $3)
        ON CONFLICT (source, source_id) DO UPDATE SET
            canonical_name = EXCLUDED.canonical_name,
            description    = EXCLUDED.description
        RETURNING id
    `;

    const insertAlias = `
        INSERT INTO entity_aliases (entity_id, name_form, lang)
        VALUES ($1, $2, 'en')
    `;

    const rl = readline.createInterface({
        input: fs.createReadStream(input, { encoding: "utf8" }),
        crlfDelay: Infinity,
    });

    let merged = 0;
    let created = 0;
    let aliasCount = 0;
    let lineNum = 0;

    for await (const line of rl) {
        lineNum++;
        const t = line.trim();
        if (!t) continue;

        // Skip CSV header
        if (lineNum === 1 && t.startsWith("Name,")) continue;

        // Parse CSV: Name,Meaning (meaning may contain commas)
        const commaIdx = t.indexOf(",");
        if (commaIdx === -1) continue;

        const name = t.slice(0, commaIdx).trim();
        const meaning = t.slice(commaIdx + 1).trim();
        if (!name) continue;

        // Try to merge with existing entity
        const { rows: existing } = await client.query(findExisting, [name]);

        let entityId;
        if (existing.length > 0) {
            entityId = existing[0].id;
            await client.query(updateDesc, [entityId, meaning]);
            merged++;
        } else {
            // Use lowercase name as source_id for hitchcock (stable key)
            const sourceId = name.toLowerCase();
            const { rows } = await client.query(insertEntity, [name, meaning, sourceId]);
            entityId = rows[0].id;
            created++;
        }

        // Add alias (check if alias already exists for this entity to avoid duplicates on re-run)
        const { rows: existingAlias } = await client.query(
            `SELECT 1 FROM entity_aliases WHERE entity_id = $1 AND name_form = $2 AND lang = 'en' LIMIT 1`,
            [entityId, name]
        );
        if (existingAlias.length === 0) {
            await client.query(insertAlias, [entityId, name]);
            aliasCount++;
        }

        if ((merged + created) % 500 === 0) {
            console.log(`Processed ${merged + created} names...`);
        }
    }

    await client.query("COMMIT");
    await client.end();

    console.log(`Done. Merged: ${merged}, Created: ${created}, Aliases added: ${aliasCount}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
