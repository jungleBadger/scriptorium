async function request(url, options = {}) {
  const res = await fetch(url, options);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body.error || body.message || `Request failed (${res.status})`;
    throw new Error(message);
  }

  return res.json();
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
