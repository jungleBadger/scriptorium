// scripts/embed_chunks.mjs
// Embeds Postgres chunks and stores embeddings back into Postgres (pgvector).
//
// Run:
//   node ingest/scripts/embed_chunks.mjs
//
// Env defaults:
//   PGHOST=localhost PGPORT=5432 PGUSER=bible PGPASSWORD=bible PGDATABASE=bible
//   EMBED_MODEL=Xenova/paraphrase-multilingual-MiniLM-L12-v2
//   EMBED_DIM=384
//   BATCH=32

import { Client } from "pg";
import { pipeline } from "@xenova/transformers";

const MODEL = process.env.EMBED_MODEL || "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const DIM = parseInt(process.env.EMBED_DIM || "384", 10);
const BATCH = parseInt(process.env.BATCH || "32", 10);

async function main() {
    const pg = new Client({
        host: process.env.PGHOST || "localhost",
        port: parseInt(process.env.PGPORT || "5432", 10),
        user: process.env.PGUSER || "bible",
        password: process.env.PGPASSWORD || "bible",
        database: process.env.PGDATABASE || "bible",
    });
    await pg.connect();

    console.log(`Loading embedding model: ${MODEL}`);
    const embedder = await pipeline("feature-extraction", MODEL);

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
        const batch = rows.slice(i, i + BATCH);

        const texts = batch.map((r) => r.text_clean);
        const emb = await embedder(texts, { pooling: "mean", normalize: true });
        const vectors = emb.tolist();

        if (vectors[0]?.length !== DIM) {
            throw new Error(`Embedding dim mismatch: got=${vectors[0]?.length} expected=${DIM}`);
        }

        // Build a single UPDATE statement for the batch
        const values = [];
        const params = [];
        for (let j = 0; j < batch.length; j++) {
            const paramIdx = j * 2;
            values.push(`($${paramIdx + 1}, $${paramIdx + 2}::vector)`);
            params.push(batch[j].chunk_id, JSON.stringify(vectors[j]));
        }

        await pg.query(
            `UPDATE chunks SET embedding = v.emb
       FROM (VALUES ${values.join(", ")}) AS v(id, emb)
       WHERE chunks.chunk_id = v.id`,
            params
        );

        total += batch.length;
        console.log(`Embedded + updated: ${total}/${rows.length}`);
    }

    await pg.end();
    console.log(`Done. Total embedded: ${total}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
