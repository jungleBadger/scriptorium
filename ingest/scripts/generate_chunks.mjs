// scripts/generate_chunks.mjs
// Build overlapping chunks (window=3, stride=1) within each chapter.
// Uses verses.text_clean. Writes into Postgres table `chunks`.
//
// Usage:
//   node scripts/generate_chunks.mjs 3 1
//
// Env (defaults):
//   PGHOST=localhost PGPORT=5432 PGUSER=bible PGPASSWORD=bible PGDATABASE=bible

import { Client } from "pg";

const windowSize = parseInt(process.argv[2] || "3", 10);
const stride = parseInt(process.argv[3] || "1", 10);

function must(n, msg) {
    if (!n) throw new Error(msg);
}

function chunkId({ translation, book_id, chapter, verse_raw_start, verse_raw_end }) {
    return `${translation}:${book_id}.${chapter}.${verse_raw_start}-${chapter}.${verse_raw_end}`;
}

async function main() {
    must(windowSize >= 2, "windowSize must be >= 2");
    must(stride >= 1, "stride must be >= 1");

    const client = new Client({
        host: process.env.PGHOST || "localhost",
        port: parseInt(process.env.PGPORT || "5432", 10),
        user: process.env.PGUSER || "bible",
        password: process.env.PGPASSWORD || "bible",
        database: process.env.PGDATABASE || "bible",
    });

    await client.connect();

    // Start clean so reruns are deterministic
    await client.query("BEGIN");
    await client.query("TRUNCATE TABLE chunks");

    // Pull verses ordered for stable chunking
    const { rows } = await client.query(`
    SELECT ref, translation, book_id, chapter, verse, verse_raw, text_clean
    FROM verses
    ORDER BY translation, book_id, chapter, verse, verse_raw
  `);

    console.log(`Loaded verses: ${rows.length}`);

    // Group by (translation, book_id, chapter)
    const groups = new Map();
    for (const r of rows) {
        const key = `${r.translation}|${r.book_id}|${r.chapter}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }

    const insertSql = `
    INSERT INTO chunks (
      chunk_id, translation, book_id, chapter,
      verse_start, verse_end, verse_raw_start, verse_raw_end,
      ref_start, ref_end, text_clean, verse_refs
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
  `;

    let chunkCount = 0;

    for (const [key, verses] of groups.entries()) {
        for (let i = 0; i + windowSize <= verses.length; i += stride) {
            const slice = verses.slice(i, i + windowSize);

            const first = slice[0];
            const last = slice[slice.length - 1];

            const text = slice.map(v => v.text_clean).join(" ").replace(/\s+/g, " ").trim();
            if (!text) continue;

            const id = chunkId({
                translation: first.translation,
                book_id: first.book_id,
                chapter: first.chapter,
                verse_raw_start: first.verse_raw,
                verse_raw_end: last.verse_raw,
            });

            const payload = [
                id,
                first.translation,
                first.book_id,
                first.chapter,
                first.verse,
                last.verse,
                first.verse_raw,
                last.verse_raw,
                first.ref,
                last.ref,
                text,
                JSON.stringify(slice.map(v => v.ref)),
            ];

            await client.query(insertSql, payload);
            chunkCount++;

            if (chunkCount % 5000 === 0) console.log(`Chunks inserted: ${chunkCount}`);
        }
    }

    await client.query("COMMIT");
    await client.end();

    console.log(`Done. Chunks inserted: ${chunkCount}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
