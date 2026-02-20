// ingest/scripts/001_usfm_to_verses.mjs
// Convert WEB USFM (zip) -> NDJSON verses (one JSON per line).
// Outputs both text_raw and text_clean.
//
// Usage:
//   node ingest/scripts/001_usfm_to_verses.mjs ingest/data/engwebu_usfm.zip ingest/out WEBU
//
// Output: out/verses.ndjson
// Record shape:
// {
//   ref, translation, book_id, chapter, verse, verse_raw,
//   text_raw, text_clean, source_file, ordinal
// }

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
}

export function normalizeWhitespace(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
}

function stripUsfmNoteBlocks(s) {
    let x = String(s || "");

    // Remove inline note/cross-reference payloads entirely.
    // Examples:
    //   \f + \fr 5:2 \ft note...\f*
    //   \x + \xo 5:7 \xt Ezra 2:1\x*
    x = x.replace(/\\f\b[\s\S]*?\\f\*/gi, " ");
    x = x.replace(/\\fe\b[\s\S]*?\\fe\*/gi, " ");
    x = x.replace(/\\x\b[\s\S]*?\\x\*/gi, " ");

    // Best-effort: if a malformed note block is left unclosed, drop the tail.
    x = x.replace(/\\f\b[\s\S]*$/gi, " ");
    x = x.replace(/\\fe\b[\s\S]*$/gi, " ");
    x = x.replace(/\\x\b[\s\S]*$/gi, " ");

    return x;
}

/**
 * Remove common USFM inline markup and WEBU-specific annotations:
 * - Strong's:  word|strong="H8064"*
 * - USFM character styles: \+wh ... \+wh* (and similar \+xx)
 * - Generic inline markers like \wj, \add, \nd, \it, etc.
 * - Any leftover backslash markers best-effort
 */
export function cleanUsfmInline(s) {
    let x = String(s || "");

    x = stripUsfmNoteBlocks(x);

    // Remove Strong's tags like |strong="H8064"
    x = x.replace(/\|strong="[^"]*"/g, "");

    // Remove \+w*, \+wh* closers first, then \+w, \+wh openers
    x = x.replace(/\\\+[a-z0-9]+\*/gi, "");
    x = x.replace(/\\\+[a-z0-9]+\s*/gi, "");

    // Remove common inline USFM markers that may appear mid-text:
    // \wj \wj* \add \add* \nd \nd* \it \it* etc.
    x = x.replace(/\\[a-z0-9]+\*?/gi, "");

    // Remove braces sometimes used around inline markup
    x = x.replace(/[{}]/g, "");

    // Normalize whitespace
    x = normalizeWhitespace(x);

    return x;
}

function isMarkerLine(line) {
    return line.startsWith("\\");
}

function parseIdLine(line) {
    // \id GEN ...
    const m = line.match(/^\\id\s+([A-Z0-9]{3})\b/i);
    return m ? m[1].toUpperCase() : null;
}

function parseChapterLine(line) {
    // \c 1
    const m = line.match(/^\\c\s+(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
}

function parseVerseStart(line) {
    // \v 1 In the beginning...
    // \v 1-2 ...
    // \v 3a ...
    const m = line.match(/^\\v\s+([0-9]+(?:[-–][0-9]+)?(?:[a-z])?)\s*(.*)$/i);
    if (!m) return null;
    const verseRaw = m[1];
    const verseNumMatch = verseRaw.match(/^(\d+)/);
    const verse = verseNumMatch ? parseInt(verseNumMatch[1], 10) : null;
    const rest = (m[2] || "").trim();
    return { verseRaw, verse, rest };
}

function shouldIgnoreLine(line) {
    const t = line.trim();
    if (!t) return true;

    // Ignore headers/toc/metadata and explicit footnote/crossref blocks
    const ignPrefixes = [
        "\\h",
        "\\toc",
        "\\toca",
        "\\toc1",
        "\\toc2",
        "\\toc3",
        "\\mt",
        "\\ms",
        "\\mr",
        "\\cl",
        "\\cp",
        "\\ca",
        "\\d",
        "\\sp",
        "\\qa",
        "\\tr",
        "\\th",
        "\\tc",
        "\\f", // footnotes (block)
        "\\x", // cross-references (block)
    ];
    return ignPrefixes.some((p) => t.startsWith(p));
}

function makeRef({ translation, book_id, chapter, verse_raw }) {
    return `${translation}:${book_id}.${chapter}.${verse_raw}`;
}

/**
 * Parse a single USFM file into verse records.
 * Keeps raw text (joined) and a cleaned version.
 */
export function parseUsfmToVerseRecords(usfmText, { translation, sourceFile }) {
    const lines = usfmText.split(/\r?\n/);

    let bookId = null;
    let chapter = null;

    let cur = null; // { verseRaw, verse, textParts: [] }
    let ordinal = 0;

    const out = [];

    function flush() {
        if (!cur) return;
        const textRaw = normalizeWhitespace(cur.textParts.join(" ").trim());
        const textClean = cleanUsfmInline(textRaw);

        if (textClean && bookId && chapter != null && cur.verse != null) {
            ordinal += 1;
            const rec = {
                ref: makeRef({
                    translation,
                    book_id: bookId,
                    chapter,
                    verse_raw: cur.verseRaw,
                }),
                translation,
                book_id: bookId,
                chapter,
                verse: cur.verse,
                verse_raw: cur.verseRaw,
                text_raw: textRaw,
                text_clean: textClean,
                source_file: sourceFile,
                ordinal,
            };
            out.push(rec);
        }
        cur = null;
    }

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (shouldIgnoreLine(line)) continue;

        const id = parseIdLine(line);
        if (id) {
            flush();
            bookId = id;
            chapter = null;
            continue;
        }

        const ch = parseChapterLine(line);
        if (ch != null) {
            flush();
            chapter = ch;
            continue;
        }

        const vs = parseVerseStart(line);
        if (vs) {
            flush();
            cur = { verseRaw: vs.verseRaw, verse: vs.verse, textParts: [] };
            if (vs.rest) cur.textParts.push(vs.rest);
            continue;
        }

        // Continuation lines: can be normal text or markers like \p \q1 etc.
        if (!cur) continue;

        if (isMarkerLine(line)) {
            // If it's a paragraph/poetry marker with text after, keep the text portion
            // Example: "\p Some text" or "\q1 Some text"
            const cleanedInline = cleanUsfmInline(line);
            if (cleanedInline) cur.textParts.push(cleanedInline);
        } else {
            cur.textParts.push(line);
        }
    }

    flush();
    return out;
}

export function main() {
    const zipPath = process.argv[2] || path.join("data", "engwebu_usfm.zip");
    const outDir = process.argv[3] || "out";
    const translation = process.argv[4] || "WEBU";

    if (!fs.existsSync(zipPath)) {
        console.error(`Zip not found: ${zipPath}`);
        process.exit(1);
    }

    ensureDir(outDir);

    const outNdjsonPath = path.join(outDir, "verses.ndjson");
    const nd = fs.createWriteStream(outNdjsonPath, { encoding: "utf8" });

    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    let total = 0;
    let files = 0;

    for (const e of entries) {
        if (e.isDirectory) continue;

        const name = e.entryName;
        const lower = name.toLowerCase();

        // Only parse USFM-ish files
        if (!(lower.endsWith(".usfm") || lower.endsWith(".sfm"))) continue;

        const text = e.getData().toString("utf8");
        const records = parseUsfmToVerseRecords(text, { translation, sourceFile: name });

        for (const r of records) {
            nd.write(JSON.stringify(r) + "\n");
        }

        total += records.length;
        files += 1;
        console.log(`Parsed ${name}: ${records.length} verses`);
    }

    nd.end();
    console.log(`\nDone. Files: ${files}. Total verses: ${total}`);
    console.log(`Wrote: ${outNdjsonPath}`);
}

function isDirectRun() {
    if (!process.argv[1]) return false;
    const entry = path.resolve(process.argv[1]).toLowerCase();
    const self = fileURLToPath(import.meta.url).toLowerCase();
    return entry === self;
}

if (isDirectRun()) {
    main();
}
