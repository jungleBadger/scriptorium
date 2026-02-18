// server/services/versesRepo.js
// Queries for chapter reading and verse ranges.

import { getPool } from "./pool.js";
import { BOOK_ORDER } from "../data/bookNames.js";

/**
 * Get all verses for a chapter.
 */
export async function getChapter(translation, bookId, chapter) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT verse, text_clean AS text
     FROM verses
     WHERE translation = $1 AND book_id = $2 AND chapter = $3
     ORDER BY verse`,
    [translation, bookId, chapter]
  );
  return rows;
}

/**
 * Get a range of verses within a chapter.
 */
export async function getVerseRange(translation, bookId, chapter, startVerse, endVerse) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT verse, text_clean AS text
     FROM verses
     WHERE translation = $1 AND book_id = $2 AND chapter = $3
       AND verse BETWEEN $4 AND $5
     ORDER BY verse`,
    [translation, bookId, chapter, startVerse, endVerse]
  );
  return rows;
}

/**
 * Get the max chapter number for a book in a given translation.
 */
export async function getMaxChapter(translation, bookId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT MAX(chapter) AS max_chapter
     FROM verses
     WHERE translation = $1 AND book_id = $2`,
    [translation, bookId]
  );
  return rows[0]?.max_chapter ? Number(rows[0].max_chapter) : null;
}

/**
 * Compute prev/next navigation hints for a chapter.
 * Returns { prev, next } where each is { book_id, chapter } or has chapter: null at boundaries.
 */
export function computeNav(bookId, chapter, maxChapter) {
  const idx = BOOK_ORDER.findIndex((b) => b.book_id === bookId);

  let prev = null;
  if (chapter > 1) {
    prev = { book_id: bookId, chapter: chapter - 1 };
  } else if (idx > 0) {
    prev = { book_id: BOOK_ORDER[idx - 1].book_id, chapter: null };
  }

  let next = null;
  if (maxChapter != null && chapter < maxChapter) {
    next = { book_id: bookId, chapter: chapter + 1 };
  } else if (idx < BOOK_ORDER.length - 1) {
    next = { book_id: BOOK_ORDER[idx + 1].book_id, chapter: null };
  }

  return { prev, next };
}
