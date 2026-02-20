// server/services/booksRepo.js
// Queries for book listing and chapter counts.

import { getPool } from "./pool.js";
import { BOOK_ORDER } from "../data/bookNames.js";

const EXTRA_BOOK_NAMES = {
  TOB: "Tobit",
  JDT: "Judith",
  ESG: "Additions to Esther",
  WIS: "Wisdom of Solomon",
  SIR: "Sirach",
  BAR: "Baruch",
  DAG: "Daniel (Greek)",
  "1MA": "1 Maccabees",
  "2MA": "2 Maccabees",
  "3MA": "3 Maccabees",
  "4MA": "4 Maccabees",
  "1ES": "1 Esdras",
  "2ES": "2 Esdras",
  MAN: "Prayer of Manasseh",
  PS2: "Psalm 151",
};

/**
 * Get all books with chapter counts for a given translation.
 * Merges DB chapter counts with static book metadata (name, testament).
 * Returns books in canonical order.
 */
export async function getBooks(translation) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT book_id, MAX(chapter) AS chapters
     FROM verses
     WHERE translation = $1
     GROUP BY book_id`,
    [translation]
  );

  const chapterMap = Object.fromEntries(
    rows.map((r) => [r.book_id, Number(r.chapters)])
  );

  // Return canonical books first, then any additional books found in DB.
  const orderedBooks = BOOK_ORDER
    .filter((b) => chapterMap[b.book_id] != null)
    .map((b) => ({
      book_id: b.book_id,
      name: b.name,
      chapters: chapterMap[b.book_id],
      testament: b.testament,
    }));

  const seenBookIds = new Set(orderedBooks.map((b) => b.book_id));
  const extraBooks = rows
    .filter((r) => !seenBookIds.has(r.book_id))
    .sort((a, b) => String(a.book_id).localeCompare(String(b.book_id)))
    .map((r) => ({
      book_id: r.book_id,
      name: EXTRA_BOOK_NAMES[r.book_id] || r.book_id,
      chapters: Number(r.chapters),
      testament: "DC",
    }));

  return [...orderedBooks, ...extraBooks];
}
