export class ApiError extends Error {
  constructor(message, { status, code, retryable, body, url } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status ?? null;
    this.code = code ?? null;
    this.retryable = Boolean(retryable);
    this.body = body ?? null;
    this.url = url ?? null;
  }
}

const ERROR_MESSAGE_BY_CODE = {
  NETWORK_ERROR: "Could not reach the server. Verify the backend is running and retry.",
  OLLAMA_UNREACHABLE: "Local Ollama is unavailable. Start `ollama serve` and retry.",
  OLLAMA_MODEL_MISSING: "Model qwen3:8b is missing. Run `ollama pull qwen3:8b`.",
  OLLAMA_TIMEOUT: "Ollama timed out while generating the answer. Please retry.",
  ASK_BAD_REQUEST: "Could not process this ask request. Please adjust it and try again.",
  ASK_INTERNAL_ERROR: "Ask service is temporarily unavailable. Please try again.",
};

const CONTEXT_FALLBACKS = {
  generic: "Something went wrong. Please try again.",
  books: "Could not load the book list. Please try again.",
  chapter: "Could not load this chapter. Please try again.",
  chapterContext: "Could not load chapter insights right now. Please try again.",
  entityDetail: "Could not load entity details right now. Please try again.",
  search: "Could not run this search right now. Please try again.",
  ask: "Could not explore this passage right now. Please try again.",
};

export function getApiErrorMessage(err, { context = "generic" } = {}) {
  const code = String(err?.code || "").trim().toUpperCase();
  if (code && ERROR_MESSAGE_BY_CODE[code]) {
    return ERROR_MESSAGE_BY_CODE[code];
  }

  const status = Number(err?.status);
  if (status === 400) {
    return "Request is invalid. Please review your input and try again.";
  }
  if (status === 404) {
    if (context === "chapter") {
      return "This chapter is not available for the selected translation.";
    }
    return "Requested content was not found.";
  }
  if (status === 429) {
    return "Too many requests in a short time. Please wait a moment and retry.";
  }
  if (Number.isFinite(status) && status >= 500) {
    return "The server is temporarily unavailable. Please retry in a moment.";
  }

  return CONTEXT_FALLBACKS[context] || CONTEXT_FALLBACKS.generic;
}

async function request(url, options = {}) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new ApiError("Could not reach the server. Check your network or backend process.", {
      code: "NETWORK_ERROR",
      retryable: true,
      url,
    });
  }

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.toLowerCase().includes("application/json");
  const body = isJson
    ? await res.json().catch(() => ({}))
    : await res.text().catch(() => "");

  if (!res.ok) {
    const payload = typeof body === "string" ? { error: body } : body;
    const message = payload?.error || payload?.message || `Request failed (${res.status})`;
    throw new ApiError(message, {
      status: res.status,
      code: payload?.code || `HTTP_${res.status}`,
      retryable: payload?.retryable ?? res.status >= 500,
      body: payload,
      url,
    });
  }

  return isJson ? body : null;
}

export async function getBooks(translation = "WEBU") {
  return request(`/api/books?translation=${encodeURIComponent(translation)}`);
}

export async function getChapter(bookId, chapter, translation = "WEBU") {
  return request(
    `/api/chapters/${encodeURIComponent(bookId)}/${chapter}?translation=${encodeURIComponent(translation)}`
  );
}

export async function search({
  q,
  topk = 8,
  mode = "explorer",
  includeDeutero = true,
  translation = "WEBU",
}) {
  const payload = {
    q,
    topk,
    mode,
    includeDeutero,
    translations: [translation],
  };

  return request("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function ask({
  question,
  translation = "WEBU",
  book,
  chapter,
  verse,
  active_entity_ids = [],
  k_entities = 12,
  k_passages = 10,
}) {
  const payload = {
    question,
    translation,
    book,
    chapter,
    verse,
    active_entity_ids,
    k_entities,
    k_passages,
  };

  return request("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function getChapterContext(bookId, chapter, translation = "WEBU") {
  return request(
    `/api/chapters/${encodeURIComponent(bookId)}/${chapter}/context?translation=${encodeURIComponent(translation)}`
  );
}

export async function getEntitiesByVerse(bookId, chapter, verse) {
  return request(
    `/api/entities/by-verse/${encodeURIComponent(bookId)}/${chapter}/${verse}`
  );
}

export async function getEntityById(id) {
  return request(`/api/entities/${id}`);
}

export async function searchEntities({ q, type, limit = 20, offset = 0 }) {
  const params = new URLSearchParams({ q: String(q || "") });
  if (type) params.set("type", String(type));
  if (Number.isFinite(limit)) params.set("limit", String(limit));
  if (Number.isFinite(offset)) params.set("offset", String(offset));
  return request(`/api/entities?${params.toString()}`);
}
