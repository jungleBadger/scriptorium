// ingest/scripts/destroy.mjs
// Wipes all ingested data while leaving Docker containers running.
//
// Usage:
//   node ingest/scripts/destroy.mjs
//
// What it does:
//   1. TRUNCATE verses, chunks, entity tables in Postgres

import { Client } from "pg";

async function main() {
    const pg = new Client({
        host: process.env.PGHOST || "localhost",
        port: parseInt(process.env.PGPORT || "5432", 10),
        user: process.env.PGUSER || "bible",
        password: process.env.PGPASSWORD || "bible",
        database: process.env.PGDATABASE || "bible",
    });

    await pg.connect();
    await pg.query("TRUNCATE TABLE entity_verses, entity_aliases, entities, chunks, verses");
    console.log("Postgres: truncated verses, chunks, and entity tables.");
    await pg.end();

    console.log("Destroy complete.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
