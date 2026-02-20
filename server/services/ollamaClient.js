// server/services/ollamaClient.js
// Thin Ollama client for non-streaming text generation.

const OLLAMA_HOST = (process.env.OLLAMA_HOST || process.env.OLLAMA_URL || "http://127.0.0.1:11434")
  .replace(/\/+$/, "");
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.OLLAMA_TIMEOUT_MS || "45000", 10);

export class OllamaRequestError extends Error {
  constructor(message, statusCode = 503) {
    super(message);
    this.name = "OllamaRequestError";
    this.statusCode = statusCode;
  }
}

export async function generateOllamaText({
  prompt,
  model = DEFAULT_MODEL,
  temperature = 0.2,
  maxTokens = 700,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const userPrompt = String(prompt || "").trim();
  if (!userPrompt) {
    throw new OllamaRequestError("Cannot call Ollama without a prompt.", 500);
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt: userPrompt,
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens,
        },
      }),
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new OllamaRequestError("Ollama request timed out. Ensure Ollama is running and responsive.");
    }
    throw new OllamaRequestError("Could not reach local Ollama. Ensure `ollama serve` is running.");
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const detail = body ? ` ${body.slice(0, 240)}` : "";
    throw new OllamaRequestError(`Ollama returned ${res.status}.${detail}`.trim());
  }

  const payload = await res.json().catch(() => null);
  const text =
    typeof payload?.response === "string"
      ? payload.response
      : typeof payload?.message?.content === "string"
        ? payload.message.content
        : "";

  if (!text.trim()) {
    throw new OllamaRequestError("Ollama returned an empty response.", 502);
  }

  return text.trim();
}
