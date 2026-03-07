// ingest/scripts/005_embed_chunks.mjs
// Embeds Postgres chunks using Google text-embedding-004 and stores
// the 768-dim vectors back into Postgres (pgvector).
//
// Run:
//   node --env-file=.env ingest/scripts/005_embed_chunks.mjs
//
// Required env:
//   GEMINI_API_KEY=<your key>
//
// Optional env:
//   PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE
//   EMBED_BATCH=100   texts per Gemini batch call (max 100)
//   EMBED_DELAY_MS=700  ms to wait between batch calls (~85 RPM, safely under 100 RPM free tier)

import { Client } from "pg";
import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const EMBED_MODEL    = "text-embedding-004";
const EMBED_DIM      = 768;
const BATCH          = Math.min(100, parseInt(process.env.EMBED_BATCH   || "100",  10));
const DELAY_MS       =               parseInt(process.env.EMBED_DELAY_MS || "700", 10);

if (!GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is required.");
    process.exit(1);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedBatch(model, texts) {
    const result = await model.batchEmbedContents({
        requests: texts.map((text) => ({
            content:  { parts: [{ text }] },
            taskType: "RETRIEVAL_DOCUMENT",
        })),
    });
    return result.embeddings.map((e) => e.values);
}

async function main() {
    const pg = new Client({
        host:     process.env.PGHOST     || "localhost",
        port:     parseInt(process.env.PGPORT || "5432", 10),
        user:     process.env.PGUSER     || "bible",
        password: process.env.PGPASSWORD || "bible",
        database: process.env.PGDATABASE || "bible",
        ssl:      process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
    });
    await pg.connect();

    const genai = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genai.getGenerativeModel({ model: EMBED_MODEL });

    const { rows } = await pg.query(`
        SELECT chunk_id, text_clean
        FROM chunks
        WHERE embedding IS NULL
        ORDER BY book_id, chapter, verse_start
    `);
    console.log(`Chunks to embed: ${rows.length}`);

    if (rows.length === 0) {
        console.log("Nothing to do.");
        await pg.end();
        return;
    }

    let total = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
        const batch  = rows.slice(i, i + BATCH);
        const texts  = batch.map((r) => r.text_clean);
        const vectors = await embedBatch(model, texts);

        if (vectors[0]?.length !== EMBED_DIM) {
            throw new Error(`Embedding dim mismatch: got=${vectors[0]?.length} expected=${EMBED_DIM}`);
        }

        // Bulk UPDATE via VALUES list
        const values = [];
        const params = [];
        for (let j = 0; j < batch.length; j++) {
            const base = j * 2;
            values.push(`($${base + 1}, $${base + 2}::vector)`);
            params.push(batch[j].chunk_id, JSON.stringify(vectors[j]));
        }

        await pg.query(
            `UPDATE chunks SET embedding = v.emb
             FROM (VALUES ${values.join(", ")}) AS v(id, emb)
             WHERE chunks.chunk_id = v.id`,
            params
        );

        total += batch.length;
        console.log(`Embedded + stored: ${total}/${rows.length}`);

        // Respect Gemini free-tier rate limit (100 RPM → 1 call per 600 ms).
        if (i + BATCH < rows.length) await sleep(DELAY_MS);
    }

    await pg.end();
    console.log(`Done. Total embedded: ${total}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
