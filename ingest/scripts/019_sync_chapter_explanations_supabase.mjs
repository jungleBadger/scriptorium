#!/usr/bin/env node

import process from "node:process";
import pg from "pg";

const { Client } = pg;

const DEFAULT_BATCH_SIZE = 100;

function parseBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function parseArgs(argv) {
  const options = {
    translation: undefined,
    status: undefined,
    model: undefined,
    promptVersion: undefined,
    bookId: undefined,
    chapter: undefined,
    batchSize: Number.parseInt(process.env.BATCH_SIZE || `${DEFAULT_BATCH_SIZE}`, 10),
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--translation") {
      options.translation = next;
      index += 1;
      continue;
    }
    if (arg === "--status") {
      options.status = next;
      index += 1;
      continue;
    }
    if (arg === "--model") {
      options.model = next;
      index += 1;
      continue;
    }
    if (arg === "--prompt-version") {
      options.promptVersion = next;
      index += 1;
      continue;
    }
    if (arg === "--book-id") {
      options.bookId = next;
      index += 1;
      continue;
    }
    if (arg === "--chapter") {
      options.chapter = Number.parseInt(next, 10);
      index += 1;
      continue;
    }
    if (arg === "--batch-size") {
      options.batchSize = Number.parseInt(next, 10);
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.batchSize) || options.batchSize <= 0) {
    throw new Error(`Invalid --batch-size: ${options.batchSize}`);
  }

  if (options.chapter != null && (!Number.isInteger(options.chapter) || options.chapter <= 0)) {
    throw new Error(`Invalid --chapter: ${options.chapter}`);
  }

  return options;
}

function printUsage() {
  console.log(`Sync chapter_explanations from local Postgres to Supabase.

Usage:
  node ingest/scripts/019_sync_chapter_explanations_supabase.mjs [options]

Options:
  --translation <code>       Filter by translation (example: WEBU)
  --status <ready|error>     Filter by status
  --model <name>             Filter by model
  --prompt-version <value>   Filter by prompt_version
  --book-id <osis>           Filter by book_id
  --chapter <number>         Filter by chapter
  --batch-size <number>      Rows per remote transaction batch (default: ${DEFAULT_BATCH_SIZE})
  --dry-run                  Show how many rows would be synced without writing

Environment:
  Local DB:     LOCAL_HOST / LOCAL_PORT / LOCAL_USER / LOCAL_DB / LOCAL_PASSWORD
                Falls back to PGHOST / PGPORT / PGUSER / PGDATABASE / PGPASSWORD.
  Supabase DB:  SUPABASE_DATABASE_URL
                or SUPABASE_HOST / SUPABASE_PORT / SUPABASE_USER / SUPABASE_DB / SUPABASE_PASSWORD
                Optional: SUPABASE_SSL=true|false, SUPABASE_SSL_REJECT_UNAUTHORIZED=true|false
`);
}

function buildLocalConfig() {
  return {
    host: process.env.LOCAL_HOST || process.env.PGHOST || "localhost",
    port: Number.parseInt(process.env.LOCAL_PORT || process.env.PGPORT || "5432", 10),
    user: process.env.LOCAL_USER || process.env.PGUSER || "bible",
    password: process.env.LOCAL_PASSWORD || process.env.PGPASSWORD || "bible",
    database: process.env.LOCAL_DB || process.env.PGDATABASE || "bible",
    ssl: parseBoolean(process.env.LOCAL_SSL || process.env.PGSSL, false) ? { rejectUnauthorized: false } : false,
    application_name: "scriptorium-chapter-sync-local",
  };
}

function buildSupabaseConfig() {
  const connectionString = process.env.SUPABASE_DATABASE_URL;
  const sslEnabled = parseBoolean(process.env.SUPABASE_SSL, true);
  const rejectUnauthorized = parseBoolean(process.env.SUPABASE_SSL_REJECT_UNAUTHORIZED, false);
  const password = process.env.SUPABASE_PASSWORD;

  if (connectionString) {
    return {
      connectionString,
      ssl: sslEnabled ? { rejectUnauthorized } : false,
      application_name: "scriptorium-chapter-sync-supabase",
    };
  }

  if (!password) {
    throw new Error("Missing SUPABASE_DATABASE_URL or SUPABASE_PASSWORD");
  }

  if (!process.env.SUPABASE_HOST) {
    throw new Error("Missing SUPABASE_HOST. Prefer SUPABASE_DATABASE_URL from the Supabase Connect dialog.");
  }

  return {
    host: process.env.SUPABASE_HOST,
    port: Number.parseInt(process.env.SUPABASE_PORT || "5432", 10),
    user: process.env.SUPABASE_USER || "postgres",
    password,
    database: process.env.SUPABASE_DB || "postgres",
    ssl: sslEnabled ? { rejectUnauthorized } : false,
    application_name: "scriptorium-chapter-sync-supabase",
  };
}

function buildWhereClause(options) {
  const values = [];
  const clauses = [];

  const push = (sql, value) => {
    values.push(value);
    clauses.push(`${sql} $${values.length}`);
  };

  if (options.translation) push("translation =", options.translation);
  if (options.status) push("status =", options.status);
  if (options.model) push("model =", options.model);
  if (options.promptVersion) push("prompt_version =", options.promptVersion);
  if (options.bookId) push("book_id =", options.bookId);
  if (options.chapter != null) push("chapter =", options.chapter);

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}

async function fetchLocalRows(client, options) {
  const { whereSql, values } = buildWhereClause(options);
  const sql = `
    SELECT
      translation,
      book_id,
      chapter,
      model,
      prompt_version,
      schema_version,
      status,
      chapter_explanation,
      input_payload,
      output_json,
      error_text,
      duration_ms,
      generated_at
    FROM chapter_explanations
    ${whereSql}
    ORDER BY generated_at ASC, translation ASC, book_id ASC, chapter ASC, model ASC, prompt_version ASC
  `;
  const result = await client.query(sql, values);
  return result.rows;
}

async function fetchLocalCount(client, options) {
  const { whereSql, values } = buildWhereClause(options);
  const result = await client.query(`SELECT COUNT(*)::int AS count FROM chapter_explanations ${whereSql}`, values);
  return result.rows[0]?.count ?? 0;
}

async function upsertBatch(remoteClient, rows) {
  const sql = `
    INSERT INTO chapter_explanations (
      translation,
      book_id,
      chapter,
      model,
      prompt_version,
      schema_version,
      status,
      chapter_explanation,
      input_payload,
      output_json,
      error_text,
      duration_ms,
      generated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13
    )
    ON CONFLICT (translation, book_id, chapter, model, prompt_version)
    DO UPDATE SET
      schema_version = EXCLUDED.schema_version,
      status = EXCLUDED.status,
      chapter_explanation = EXCLUDED.chapter_explanation,
      input_payload = EXCLUDED.input_payload,
      output_json = EXCLUDED.output_json,
      error_text = EXCLUDED.error_text,
      duration_ms = EXCLUDED.duration_ms,
      generated_at = EXCLUDED.generated_at
  `;

  await remoteClient.query("BEGIN");
  try {
    for (const row of rows) {
      await remoteClient.query(sql, [
        row.translation,
        row.book_id,
        row.chapter,
        row.model,
        row.prompt_version,
        row.schema_version,
        row.status,
        row.chapter_explanation,
        JSON.stringify(row.input_payload ?? {}),
        JSON.stringify(row.output_json ?? {}),
        row.error_text,
        row.duration_ms,
        row.generated_at,
      ]);
    }
    await remoteClient.query("COMMIT");
  } catch (error) {
    await remoteClient.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const localClient = new Client(buildLocalConfig());
  let remoteClient = null;

  try {
    await localClient.connect();
    const count = await fetchLocalCount(localClient, options);

    if (count === 0) {
      console.log("No matching chapter_explanations rows found locally.");
      return;
    }

    console.log(`Found ${count} local chapter_explanations row(s) to sync.`);
    if (options.dryRun) {
      console.log("Dry run only. No remote writes performed.");
      return;
    }

    const rows = await fetchLocalRows(localClient, options);
    remoteClient = new Client(buildSupabaseConfig());
    await remoteClient.connect();

    for (let index = 0; index < rows.length; index += options.batchSize) {
      const batch = rows.slice(index, index + options.batchSize);
      await upsertBatch(remoteClient, batch);
      console.log(`Synced ${Math.min(index + batch.length, rows.length)}/${rows.length} row(s).`);
    }

    console.log("Supabase chapter_explanations sync complete.");
  } finally {
    const closes = [localClient.end()];
    if (remoteClient) closes.push(remoteClient.end());
    await Promise.allSettled(closes);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
