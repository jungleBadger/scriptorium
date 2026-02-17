/**
 * POST /api/search — semantic Bible search.
 * @param {string} query
 * @param {number} [limit=20]
 * @returns {Promise<Array>} results
 */
export async function search(query, limit = 20) {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, limit }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Search failed (${res.status})`);
  }

  const data = await res.json();
  return data.results;
}
