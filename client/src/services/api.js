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
