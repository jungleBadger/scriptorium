// server/services/booksRepo.js
// Queries for book listing and chapter counts.

import { getPool } from "./pool.js";
import { BOOK_ORDER, BOOK_MAP } from "../data/bookNames.js";

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

  // Return only books present in the DB, in canonical order
  return BOOK_ORDER
    .filter((b) => chapterMap[b.book_id] != null)
    .map((b) => ({
      book_id: b.book_id,
      name: b.name,
      chapters: chapterMap[b.book_id],
      testament: b.testament,
    }));
}
