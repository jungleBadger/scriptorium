// ingest/scripts/006_load_openbible_places.mjs
// Loads OpenBible Geodata (ancient.jsonl) into the entities tables.
//
// Usage:
//   node ingest/scripts/006_load_openbible_places.mjs ingest/data/ancient.jsonl

import fs from "node:fs";
import readline from "node:readline";
import { Client } from "pg";
import { parseUsx } from "./015_osis_book_map.mjs";

function parseLonLat(rawLonLat) {
    if (typeof rawLonLat !== "string" || !rawLonLat.includes(",")) {
        return null;
    }

    const [lonStr, latStr] = rawLonLat.split(",", 2);
    const lon = Number.parseFloat(lonStr);
    const lat = Number.parseFloat(latStr);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        return null;
    }
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        return null;
    }
    return { lon, lat };
}

async function main() {
    const input = process.argv[2];
    if (!input || !fs.existsSync(input)) {
        console.error("Usage: node ingest/scripts/006_load_openbible_places.mjs <ancient.jsonl>");
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

    const upsertEntity = `
        INSERT INTO entities (canonical_name, type, lon, lat, source, source_id, metadata)
        VALUES ($1, $2, $3, $4, 'openbible', $5, $6)
        ON CONFLICT (source, source_id) DO UPDATE SET
            canonical_name = EXCLUDED.canonical_name,
            type           = EXCLUDED.type,
            lon            = EXCLUDED.lon,
            lat            = EXCLUDED.lat,
            metadata       = EXCLUDED.metadata
        RETURNING id
    `;

    const insertAlias = `
        INSERT INTO entity_aliases (entity_id, name_form, lang)
        VALUES ($1, $2, 'en')
    `;

    const insertVerse = `
        INSERT INTO entity_verses (entity_id, book_id, chapter, verse)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
    `;

    // Clear old aliases/verses for openbible entities before re-inserting
    // (simpler than diffing; the upsert on entities handles the main row)
    await client.query(`
        DELETE FROM entity_verses WHERE entity_id IN
            (SELECT id FROM entities WHERE source = 'openbible')
    `);
    await client.query(`
        DELETE FROM entity_aliases WHERE entity_id IN
            (SELECT id FROM entities WHERE source = 'openbible')
    `);

    const rl = readline.createInterface({
        input: fs.createReadStream(input, { encoding: "utf8" }),
        crlfDelay: Infinity,
    });

    let entityCount = 0;
    let aliasCount = 0;
    let verseCount = 0;
    let invalidCoordCount = 0;

    for await (const line of rl) {
        const t = line.trim();
        if (!t) continue;

        const rec = JSON.parse(t);

        // --- Determine type ---
        const types = rec.types || [];
        const placeType = types.length > 0 ? `place.${types[0]}` : "place";

        // --- Extract coordinates from first identification's first resolution ---
        let lon = null;
        let lat = null;
        const idents = rec.identifications || [];
        if (idents.length > 0) {
            const resolutions = idents[0].resolutions || [];
            if (resolutions.length > 0 && resolutions[0].lonlat) {
                const parsed = parseLonLat(resolutions[0].lonlat);
                if (parsed) {
                    lon = parsed.lon;
                    lat = parsed.lat;
                } else {
                    invalidCoordCount++;
                }
            }
        }

        // --- Build metadata JSONB ---
        const metadata = {};
        if (rec.linked_data) metadata.linked_data = rec.linked_data;
        if (rec.media) metadata.media = rec.media;
        if (rec.modern_associations) metadata.modern_associations = rec.modern_associations;
        if (rec.url_slug) metadata.url_slug = rec.url_slug;

        // --- Upsert entity ---
        const { rows } = await client.query(upsertEntity, [
            rec.friendly_id,
            placeType,
            lon,
            lat,
            rec.id,
            JSON.stringify(metadata),
        ]);
        const entityId = rows[0].id;
        entityCount++;

        // --- Insert aliases from translation_name_counts ---
        const nameVariants = rec.translation_name_counts || {};
        for (const name of Object.keys(nameVariants)) {
            await client.query(insertAlias, [entityId, name]);
            aliasCount++;
        }

        // --- Insert verse references ---
        const verses = rec.verses || [];
        for (const v of verses) {
            const parsed = parseUsx(v.usx);
            if (!parsed) continue;
            await client.query(insertVerse, [entityId, parsed.book_id, parsed.chapter, parsed.verse]);
            verseCount++;
        }

        if (entityCount % 200 === 0) {
            console.log(`Processed ${entityCount} entities...`);
        }
    }

    await client.query("COMMIT");
    await client.end();

    console.log(`Done. Entities: ${entityCount}, Aliases: ${aliasCount}, Verse refs: ${verseCount}, Invalid coords: ${invalidCoordCount}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
