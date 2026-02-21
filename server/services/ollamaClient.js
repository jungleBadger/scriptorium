// server/services/ollamaClient.js
// Thin Ollama client for non-streaming text generation.

const OLLAMA_HOST = (process.env.OLLAMA_HOST || process.env.OLLAMA_URL || "http://127.0.0.1:11434")
  .replace(/\/+$/, "");
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.OLLAMA_TIMEOUT_MS || "45000", 10);
const DEFAULT_HEALTH_TIMEOUT_MS = Number.parseInt(process.env.OLLAMA_HEALTH_TIMEOUT_MS || "3500", 10);

export class OllamaRequestError extends Error {
  constructor(message, statusCode = 503, code = "OLLAMA_ERROR") {
    super(message);
    this.name = "OllamaRequestError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function getOllamaConfig() {
  return {
    host: OLLAMA_HOST,
    model: DEFAULT_MODEL,
  };
}

export async function checkOllamaHealth({
  model = DEFAULT_MODEL,
  timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
} = {}) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${OLLAMA_HOST}/api/tags`, {
      method: "GET",
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (err?.name === "AbortError") {
      return {
        reachable: false,
        model_available: false,
        model,
        code: "OLLAMA_TIMEOUT",
        message: "Timed out contacting Ollama health endpoint.",
      };
    }
    return {
      reachable: false,
      model_available: false,
      model,
      code: "OLLAMA_UNREACHABLE",
      message: "Could not reach Ollama health endpoint.",
    };
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!res.ok) {
    return {
      reachable: false,
      model_available: false,
      model,
      code: "OLLAMA_BAD_STATUS",
      message: `Ollama health endpoint returned ${res.status}.`,
    };
  }

  const payload = await res.json().catch(() => null);
  const models = Array.isArray(payload?.models) ? payload.models : [];
  const names = models.map((entry) => String(entry?.name || "").trim()).filter(Boolean);
  const modelBase = String(model || "").split(":")[0];
  const modelAvailable = names.some((name) => name === model || name.startsWith(`${modelBase}:`));

  return {
    reachable: true,
    model_available: modelAvailable,
    model,
    code: modelAvailable ? "OLLAMA_OK" : "OLLAMA_MODEL_MISSING",
    message: modelAvailable
      ? "Ollama is reachable and model is available."
      : `Ollama is reachable but model "${model}" is missing.`,
  };
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
    throw new OllamaRequestError("Cannot call Ollama without a prompt.", 500, "OLLAMA_BAD_REQUEST");
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
      throw new OllamaRequestError(
        "Ollama request timed out. Ensure Ollama is running and responsive.",
        504,
        "OLLAMA_TIMEOUT"
      );
    }
    throw new OllamaRequestError(
      "Could not reach local Ollama. Ensure `ollama serve` is running.",
      503,
      "OLLAMA_UNREACHABLE"
    );
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const detail = body ? ` ${body.slice(0, 240)}` : "";
    const lowerBody = body.toLowerCase();
    const isModelMissing = res.status === 404 || lowerBody.includes("model") && lowerBody.includes("not found");
    if (isModelMissing) {
      throw new OllamaRequestError(
        `Ollama model "${model}" is not available. Run 'ollama pull ${model}'.`,
        503,
        "OLLAMA_MODEL_MISSING"
      );
    }
    throw new OllamaRequestError(
      `Ollama returned ${res.status}.${detail}`.trim(),
      502,
      "OLLAMA_BAD_RESPONSE"
    );
  }

  const payload = await res.json().catch(() => null);
  const text =
    typeof payload?.response === "string"
      ? payload.response
      : typeof payload?.message?.content === "string"
        ? payload.message.content
        : "";

  if (!text.trim()) {
    throw new OllamaRequestError("Ollama returned an empty response.", 502, "OLLAMA_EMPTY_RESPONSE");
  }

  return text.trim();
}
