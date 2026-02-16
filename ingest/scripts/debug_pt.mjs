import fs from "fs"

const p = "ingest/out/verses_pt1911.ndjson";

const books = new Map();
let lines = 0;
const refs = new Set();
let dups = 0;

for (const l of fs.readFileSync(p, "utf8").trim().split("\n")) {
    const r = JSON.parse(l);

    // count book ids
    books.set(r.book_id, (books.get(r.book_id) || 0) + 1);

    // check unique ref
    const k = `${r.translation}:${r.book_id}.${r.chapter}.${r.verse_raw}`;
    if (refs.has(k)) dups++;
    else refs.add(k);

    lines++;
}

const topBooks = [...books.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);

console.log("LINES:", lines);
console.log("UNIQUE REFS:", refs.size);
console.log("DUPLICATES:", dups);
console.log("DISTINCT BOOK IDs:", books.size);
console.log("TOP BOOK IDS:", topBooks);
