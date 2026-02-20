// ingest/scripts/003_load_verses_to_postgres.mjs
import fs from "node:fs";
import readline from "node:readline";
import { Client } from "pg";

function makeRef(r) {
    // Keep verse_raw because ranges like 1-2 matter.
    return `${r.translation}:${r.book_id}.${r.chapter}.${r.verse_raw}`;
}

async function main() {
    const input = process.argv[2] || "out/verses.ndjson";

    const pgHost = process.env.PGHOST || "localhost";
    const pgPort = parseInt(process.env.PGPORT || "5432", 10);
    const pgUser = process.env.PGUSER || "bible";
    const pgPassword = process.env.PGPASSWORD || "bible";
    const pgDatabase = process.env.PGDATABASE || "bible";

    if (!fs.existsSync(input)) {
        console.error(`Input not found: ${input}`);
        process.exit(1);
    }

    const client = new Client({
        host: pgHost,
        port: pgPort,
        user: pgUser,
        password: pgPassword,
        database: pgDatabase,
    });

    await client.connect();

    // Faster ingest
    await client.query("BEGIN");
    await client.query("SET LOCAL synchronous_commit = off");

    const sql = `
        INSERT INTO verses (
            ref, translation, book_id, chapter, verse, verse_raw,
            text_raw, text_clean, source_file, ordinal
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT (ref) DO UPDATE SET
                translation = EXCLUDED.translation,
                book_id = EXCLUDED.book_id,
                chapter = EXCLUDED.chapter,
                verse = EXCLUDED.verse,
                verse_raw = EXCLUDED.verse_raw,
                text_raw = EXCLUDED.text_raw,
                text_clean = EXCLUDED.text_clean,
                source_file = EXCLUDED.source_file,
                ordinal = EXCLUDED.ordinal
  `;

    const rl = readline.createInterface({
        input: fs.createReadStream(input, { encoding: "utf8" }),
        crlfDelay: Infinity,
    });

    let n = 0;
    let batch = [];
    const BATCH_SIZE = 500;

    async function flush() {
        if (!batch.length) return;

        // Use a prepared statement per row; with small dataset it’s fine.
        // (If you want max speed later, we can switch to COPY.)
        for (const r of batch) {
            const ref = makeRef(r);
            await client.query(sql, [
                ref,
                r.translation,
                r.book_id,
                r.chapter,
                r.verse,
                r.verse_raw,
                r.text_raw,
                r.text_clean,
                r.source_file || null,
                r.ordinal || null,
            ]);
        }

        batch = [];
    }

    for await (const line of rl) {
        const t = line.trim();
        if (!t) continue;
        const r = JSON.parse(t);
        batch.push(r);
        n++;

        if (batch.length >= BATCH_SIZE) {
            await flush();
            if (n % 5000 === 0) console.log(`Inserted ~${n}...`);
        }
    }

    await flush();
    await client.query("COMMIT");
    await client.end();

    console.log(`Done. Processed ${n} records into Postgres.`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
