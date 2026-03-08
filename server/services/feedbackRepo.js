// server/services/feedbackRepo.js
// Insert and abuse-check helpers for anonymous feedback intake.

import { getPool } from "./pool.js";

export async function hasFeedbackInCooldownWindow(ipHash, seconds = 15) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT 1
     FROM feedback_reports
     WHERE ip_hash = $1
       AND created_at >= NOW() - ($2 * INTERVAL '1 second')
     LIMIT 1`,
    [ipHash, seconds]
  );
  return rows.length > 0;
}

export async function hasRecentDuplicateFeedback(ipHash, normalizedMessage, hours = 6) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT 1
     FROM feedback_reports
     WHERE ip_hash = $1
       AND created_at >= NOW() - ($3 * INTERVAL '1 hour')
       AND regexp_replace(lower(trim(user_message)), '\\s+', ' ', 'g') = $2
     LIMIT 1`,
    [ipHash, normalizedMessage, hours]
  );
  return rows.length > 0;
}

export async function createFeedbackReport(report) {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO feedback_reports (
       kind,
       target_type,
       translation,
       book_id,
       chapter,
       verse_start,
       verse_end,
       entity_id,
       user_message,
       suggested_fix,
       content_snapshot,
       generation_metadata,
       page_context,
       contact_email,
       ip_hash
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13, $14, $15
     )
     RETURNING id, created_at`,
    [
      report.kind,
      report.target_type,
      report.translation,
      report.book_id,
      report.chapter,
      report.verse_start,
      report.verse_end,
      report.entity_id,
      report.user_message,
      report.suggested_fix,
      report.content_snapshot,
      report.generation_metadata,
      report.page_context,
      report.contact_email,
      report.ip_hash,
    ]
  );

  return rows[0] ?? null;
}
