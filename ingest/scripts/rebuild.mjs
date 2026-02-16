// ingest/scripts/rebuild.mjs
// Runs the full ingestion pipeline end-to-end.
//
// Usage:
//   node ingest/scripts/rebuild.mjs
//
// Steps:
//   1. Parse USFM -> NDJSON
//   2. Load verses into Postgres
//   3. Generate chunks (window=3, stride=1)
//   4. Embed chunks and store in Postgres (pgvector)

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = __dirname;
const ingestDir = path.resolve(__dirname, "..");

const steps = [
    {
        label: "Step 1/4: Parse USFM → NDJSON",
        script: path.join(scriptsDir, "usfm_to_verses.mjs"),
        args: [
            path.join(ingestDir, "data", "engwebu_usfm.zip"),
            path.join(ingestDir, "out"),
            "WEBU",
        ],
    },
    {
        label: "Step 2/4: Load verses into Postgres",
        script: path.join(scriptsDir, "load_verses_to_postgres.mjs"),
        args: [path.join(ingestDir, "out", "verses.ndjson")],
    },
    {
        label: "Step 3/4: Generate chunks",
        script: path.join(scriptsDir, "generate_chunks.mjs"),
        args: ["3", "1"],
    },
    {
        label: "Step 4/4: Embed chunks → Postgres (pgvector)",
        script: path.join(scriptsDir, "embed_chunks.mjs"),
        args: [],
    },
];

for (const step of steps) {
    console.log(`\n========================================`);
    console.log(step.label);
    console.log(`========================================\n`);

    const env = { ...process.env, ...step.env };

    try {
        execFileSync(process.execPath, [step.script, ...step.args], {
            stdio: "inherit",
            env,
        });
    } catch (e) {
        console.error(`\nFailed at: ${step.label}`);
        process.exit(1);
    }
}

console.log(`\n========================================`);
console.log("Rebuild complete!");
console.log(`========================================\n`);
