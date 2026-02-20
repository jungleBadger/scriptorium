// ingest/scripts/011_export_entities_jsonl.mjs
// Exports all entities as JSONL files, split into batches.
//
// Usage:
//   node ingest/scripts/011_export_entities_jsonl.mjs <output_dir> [--batch-size N]
//
// Creates files like: <output_dir>/entities_001.jsonl, entities_002.jsonl, ...
// Default batch size: 300 rows per file.

import { Client } from "pg";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const BATCH_SIZE = (() => {
    const idx = process.argv.indexOf("--batch-size");
    return idx !== -1 ? parseInt(process.argv[idx + 1], 10) : 300;
})();

async function main() {
    const outDir = process.argv[2];
    if (!outDir) {
        console.error("Usage: node ingest/scripts/011_export_entities_jsonl.mjs <output_dir> [--batch-size N]");
        process.exit(1);
    }

    mkdirSync(outDir, { recursive: true });

    const client = new Client({
        host: process.env.PGHOST || "localhost",
        port: parseInt(process.env.PGPORT || "5432", 10),
        user: process.env.PGUSER || "bible",
        password: process.env.PGPASSWORD || "bible",
        database: process.env.PGDATABASE || "bible",
    });
    await client.connect();

    const { rows } = await client.query(
        `SELECT id, canonical_name AS name, type FROM entities ORDER BY id`
    );

    await client.end();

    const totalFiles = Math.ceil(rows.length / BATCH_SIZE);

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const fileNum = Math.floor(i / BATCH_SIZE) + 1;
        const fileName = `entities_${String(fileNum).padStart(3, "0")}.jsonl`;
        const filePath = join(outDir, fileName);
        const lines = batch.map((r) => JSON.stringify(r)).join("\n") + "\n";
        writeFileSync(filePath, lines, "utf-8");
    }

    console.log(`Exported ${rows.length} entities across ${totalFiles} files to ${outDir}/`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
