// ingest/scripts/002_usfx_to_verses.mjs
// USFX (XML) -> verses.ndjson (milestone <v id=".."/> supported)
//
// Usage:
//   node ingest/scripts/002_usfx_to_verses.mjs ingest/data/por-almeida.usfx.xml ingest/out PT1911

import fs from "node:fs";
import path from "node:path";
import sax from "sax";

const inputPath = process.argv[2];
const outDir = process.argv[3];
const translation = process.argv[4] || "PT1911";

if (!inputPath || !outDir) {
    console.error(
        "Usage: node ingest/scripts/002_usfx_to_verses.mjs <input.usfx.xml> <outDir> [translation]"
    );
    process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `verses_${translation.toLowerCase()}.ndjson`);
const out = fs.createWriteStream(outPath, { encoding: "utf8" });

function normWs(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
}

function makeRef({ translation, book_id, chapter, verse_raw }) {
    return `${translation}:${book_id}.${chapter}.${verse_raw}`;
}

// Tags whose inner text we should ignore (footnotes, cross-refs, etc.)
const SKIP_TAGS = new Set([
    "f", "fe", "fr", "fk", "fq", "fqa", "ft", "fv",
    "x", "xo", "xt",
    "note", "ref",
]);

let book_id = null;
let chapter = null;
let verse = null; // number
let verse_raw = null;
let buffer = [];
let ordinal = 0;

let skipDepth = 0;

function flushVerse() {
    if (!book_id || !chapter || !verse_raw) return;

    const text_raw = normWs(buffer.join(" "));
    const text_clean = text_raw; // already cleaned by skipping footnotes/crossrefs

    if (!text_clean) return;

    ordinal += 1;

    const rec = {
        ref: makeRef({ translation, book_id, chapter, verse_raw }),
        translation,
        book_id,
        chapter,
        verse: verse,
        verse_raw,
        text_raw,
        text_clean,
        source_file: path.basename(inputPath),
        ordinal,
    };

    out.write(JSON.stringify(rec) + "\n");
}

const parser = sax.createStream(true, { trim: false, normalize: false });

parser.on("opentag", (node) => {
    const name = String(node.name || "").toLowerCase();
    const attrs = node.attributes || {};

    if (SKIP_TAGS.has(name)) {
        skipDepth += 1;
        return;
    }

    // USFX: <book id="GEN"> or sometimes <book code="GEN">
    if (name === "book") {
        // new book => flush any pending verse
        if (verse_raw) flushVerse();

        const id = attrs.id || attrs.code || attrs.book || null;
        book_id = id ? String(id).trim() : book_id;
        chapter = null;
        verse = null;
        verse_raw = null;
        buffer = [];
        return;
    }

    // USFX: <c id="1"/>
    if (name === "c") {
        if (verse_raw) flushVerse();
        const cid = attrs.id;
        chapter = cid ? parseInt(String(cid), 10) : chapter;
        verse = null;
        verse_raw = null;
        buffer = [];
        return;
    }

    // USFX milestone: <v id="1"/> (not a container)
    if (name === "v") {
        // starting a new verse flushes previous one
        if (verse_raw) flushVerse();

        const vid = attrs.id;
        verse_raw = vid ? String(vid).trim() : null;
        verse = verse_raw ? parseInt(verse_raw, 10) : null;
        buffer = [];
        return;
    }

    // Add a space for certain line-ish markers (optional, keeps words separated)
    if (name === "p" || name === "q" || name === "q1" || name === "q2" || name === "m") {
        if (verse_raw) buffer.push(" ");
    }
});

parser.on("text", (txt) => {
    if (skipDepth > 0) return;
    if (!verse_raw) return; // only capture text inside a verse scope
    const t = String(txt);
    if (t.trim().length === 0) return;
    buffer.push(t);
});

parser.on("cdata", (txt) => {
    if (skipDepth > 0) return;
    if (!verse_raw) return;
    buffer.push(String(txt));
});

parser.on("closetag", (tagName) => {
    const name = String(tagName || "").toLowerCase();
    if (SKIP_TAGS.has(name)) {
        skipDepth = Math.max(0, skipDepth - 1);
    }
});

parser.on("end", () => {
    // flush last verse
    if (verse_raw) flushVerse();
    out.end();
    console.log(`Done. translation=${translation} verses=${ordinal}`);
    console.log(`Wrote: ${outPath}`);
});

parser.on("error", (err) => {
    console.error("XML parse error:", err);
    process.exit(1);
});

fs.createReadStream(inputPath, { encoding: "utf8" }).pipe(parser);
