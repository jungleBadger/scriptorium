// server/routes/feedback.js
// Anonymous, privacy-first feedback intake with lightweight abuse controls.

import crypto from "node:crypto";
import {
  createFeedbackReport,
  hasFeedbackInCooldownWindow,
  hasRecentDuplicateFeedback,
} from "../services/feedbackRepo.js";

const FEEDBACK_KINDS = new Set(["content_report", "bug_report", "product_feedback"]);
const FEEDBACK_BODY_LIMIT = 32 * 1024;
const MESSAGE_MIN_LENGTH = 10;
const MESSAGE_MAX_LENGTH = 3000;
const SUGGESTED_FIX_MAX_LENGTH = 3000;
const CONTENT_SNAPSHOT_MAX_LENGTH = 12000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const feedbackSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["kind", "user_message"],
    properties: {
      kind: { type: "string", minLength: 1, maxLength: 40 },
      target_type: { type: ["string", "null"], maxLength: 80 },
      translation: { type: ["string", "null"], maxLength: 16 },
      book_id: { type: ["string", "null"], maxLength: 24 },
      chapter: { type: ["integer", "null"], minimum: 1 },
      verse_start: { type: ["integer", "null"], minimum: 1 },
      verse_end: { type: ["integer", "null"], minimum: 1 },
      entity_id: { type: ["string", "null"], maxLength: 128 },
      user_message: { type: "string", minLength: 1, maxLength: 3200 },
      suggested_fix: { type: ["string", "null"], maxLength: 3200 },
      content_snapshot: { type: ["string", "null"], maxLength: 12000 },
      generation_metadata: { type: ["object", "null"] },
      page_context: { type: ["object", "null"] },
      contact_email: { type: ["string", "null"], maxLength: 320 },
      website: { type: ["string", "null"], maxLength: 200 },
    },
  },
};

function sendBadRequest(reply, error = "Invalid feedback payload.") {
  reply.status(400).send({
    error,
    code: "FEEDBACK_BAD_REQUEST",
    retryable: false,
  });
}

function normalizeOptionalText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeSnapshot(value) {
  if (value == null) return null;
  const snapshot = String(value);
  return snapshot.trim() ? snapshot : null;
}

function normalizeDedupMessage(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isObjectLike(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hashRequesterIp(ipAddress) {
  const secret = String(process.env.FEEDBACK_IP_HASH_SECRET || "").trim();
  if (!secret) return null;
  const input = `${String(ipAddress || "unknown").trim() || "unknown"}:${secret}`;
  return crypto.createHash("sha256").update(input).digest("hex");
}

async function feedbackBodyGuard(req, reply) {
  const contentLength = Number(req.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > FEEDBACK_BODY_LIMIT) {
    return reply.status(413).send({
      error: "Feedback submission is too large.",
      code: "FEEDBACK_TOO_LARGE",
      retryable: false,
    });
  }
}

async function feedbackHandler(req, reply) {
  if (req.validationError) {
    sendBadRequest(reply);
    return;
  }

  const payload = req.body || {};
  const kind = String(payload.kind || "").trim().toLowerCase();
  const userMessage = String(payload.user_message || "").trim();
  const suggestedFix = normalizeOptionalText(payload.suggested_fix);
  const contentSnapshot = normalizeSnapshot(payload.content_snapshot);
  const contactEmail = normalizeOptionalText(payload.contact_email);
  const targetType = normalizeOptionalText(payload.target_type);
  const translation = normalizeOptionalText(payload.translation);
  const bookId = normalizeOptionalText(payload.book_id);
  const entityId = normalizeOptionalText(payload.entity_id);
  const website = normalizeOptionalText(payload.website);
  const generationMetadata = payload.generation_metadata == null ? null : payload.generation_metadata;
  const pageContext = payload.page_context == null ? null : payload.page_context;

  if (!FEEDBACK_KINDS.has(kind)) {
    sendBadRequest(reply, "Feedback kind is invalid.");
    return;
  }
  if (!userMessage) {
    sendBadRequest(reply, "Message is required.");
    return;
  }
  if (userMessage.length < MESSAGE_MIN_LENGTH) {
    sendBadRequest(reply, `Message must be at least ${MESSAGE_MIN_LENGTH} characters.`);
    return;
  }
  if (userMessage.length > MESSAGE_MAX_LENGTH) {
    sendBadRequest(reply, `Message must be ${MESSAGE_MAX_LENGTH} characters or fewer.`);
    return;
  }
  if (suggestedFix && suggestedFix.length > SUGGESTED_FIX_MAX_LENGTH) {
    sendBadRequest(reply, `Suggested correction must be ${SUGGESTED_FIX_MAX_LENGTH} characters or fewer.`);
    return;
  }
  if (contentSnapshot && contentSnapshot.length > CONTENT_SNAPSHOT_MAX_LENGTH) {
    sendBadRequest(reply, `Content snapshot must be ${CONTENT_SNAPSHOT_MAX_LENGTH} characters or fewer.`);
    return;
  }
  if (contactEmail && !EMAIL_RE.test(contactEmail)) {
    sendBadRequest(reply, "Contact email is invalid.");
    return;
  }
  if (generationMetadata && !isObjectLike(generationMetadata)) {
    sendBadRequest(reply, "Generation metadata must be an object.");
    return;
  }
  if (pageContext && !isObjectLike(pageContext)) {
    sendBadRequest(reply, "Page context must be an object.");
    return;
  }

  const chapter = payload.chapter == null ? null : payload.chapter;
  const verseStart = payload.verse_start == null ? null : payload.verse_start;
  const verseEnd = payload.verse_end == null ? null : payload.verse_end;

  if (verseEnd != null && verseStart == null) {
    sendBadRequest(reply, "verse_end requires verse_start.");
    return;
  }
  if (verseStart != null && chapter == null) {
    sendBadRequest(reply, "verse_start requires chapter.");
    return;
  }
  if (verseEnd != null && chapter == null) {
    sendBadRequest(reply, "verse_end requires chapter.");
    return;
  }
  if (verseStart != null && verseEnd != null && verseEnd < verseStart) {
    sendBadRequest(reply, "verse_end must be greater than or equal to verse_start.");
    return;
  }

  if (website) {
    req.log.info({ route: "/api/feedback" }, "Feedback honeypot triggered");
    return { ok: true };
  }

  const ipHash = hashRequesterIp(req.ip);
  if (!ipHash) {
    req.log.error("FEEDBACK_IP_HASH_SECRET is not configured");
    reply.status(503).send({
      error: "Feedback is temporarily unavailable.",
      code: "FEEDBACK_UNAVAILABLE",
      retryable: false,
    });
    return;
  }

  try {
    const inCooldown = await hasFeedbackInCooldownWindow(ipHash, 15);
    if (inCooldown) {
      reply.status(429).send({
        error: "Please wait a moment before sending another message.",
        code: "FEEDBACK_COOLDOWN",
        retryable: true,
      });
      return;
    }

    const normalizedMessage = normalizeDedupMessage(userMessage);
    const isDuplicate = await hasRecentDuplicateFeedback(ipHash, normalizedMessage, 6);
    if (isDuplicate) {
      req.log.info({ route: "/api/feedback" }, "Duplicate feedback skipped");
      return { ok: true };
    }

    await createFeedbackReport({
      kind,
      target_type: targetType,
      translation,
      book_id: bookId,
      chapter,
      verse_start: verseStart,
      verse_end: verseEnd,
      entity_id: entityId,
      user_message: userMessage,
      suggested_fix: suggestedFix,
      content_snapshot: contentSnapshot,
      generation_metadata: generationMetadata,
      page_context: pageContext,
      contact_email: contactEmail,
      ip_hash: ipHash,
    });

    return { ok: true };
  } catch (err) {
    req.log.error(err, "Failed to save feedback");
    reply.status(500).send({
      error: "Could not submit feedback.",
      code: "FEEDBACK_ERROR",
      retryable: true,
    });
  }
}

export default async function feedbackRoutes(app) {
  app.post("/api/feedback", {
    schema: feedbackSchema,
    attachValidation: true,
    bodyLimit: FEEDBACK_BODY_LIMIT,
    preValidation: feedbackBodyGuard,
    config: {
      rateLimit: { max: 5, timeWindow: "1 hour" },
    },
  }, feedbackHandler);
}
