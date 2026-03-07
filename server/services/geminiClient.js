// server/services/geminiClient.js
// Thin Gemini client for text generation via @google/generative-ai.

import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL   = process.env.GEMINI_MODEL   || "gemini-2.0-flash";

export class GeminiRequestError extends Error {
  constructor(message, statusCode = 500, code = "GEMINI_ERROR") {
    super(message);
    this.name       = "GeminiRequestError";
    this.statusCode = statusCode;
    this.code       = code;
  }
}

export function getGeminiConfig() {
  return { configured: Boolean(GEMINI_API_KEY), model: GEMINI_MODEL };
}

function getClient() {
  if (!GEMINI_API_KEY) {
    throw new GeminiRequestError(
      "GEMINI_API_KEY is not configured.",
      503,
      "GEMINI_NOT_CONFIGURED"
    );
  }
  return new GoogleGenerativeAI(GEMINI_API_KEY);
}

export async function generateGeminiText({ prompt, temperature = 0.2, maxTokens = 800 } = {}) {
  const text = String(prompt || "").trim();
  if (!text) {
    throw new GeminiRequestError("Cannot call Gemini without a prompt.", 500, "GEMINI_BAD_REQUEST");
  }

  const model = getClient().getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  });

  let result;
  try {
    result = await model.generateContent(text);
  } catch (err) {
    const status = Number(err?.status);
    if (status === 429) {
      throw new GeminiRequestError(
        "Too many requests to Gemini. Please try again shortly.",
        429,
        "GEMINI_RATE_LIMITED"
      );
    }
    if (status === 401 || status === 403) {
      throw new GeminiRequestError(
        "Gemini API key is invalid or unauthorized.",
        503,
        "GEMINI_AUTH_ERROR"
      );
    }
    throw new GeminiRequestError(
      `Gemini request failed: ${err?.message || "unknown error"}`,
      502,
      "GEMINI_ERROR"
    );
  }

  const candidate   = result?.response?.candidates?.[0];
  const finishReason = candidate?.finishReason;
  if (finishReason === "SAFETY") {
    throw new GeminiRequestError(
      "This question could not be answered due to content safety filters. Try rephrasing.",
      422,
      "GEMINI_SAFETY_BLOCK"
    );
  }

  const responseText = result?.response?.text?.();
  if (!responseText?.trim()) {
    throw new GeminiRequestError("Gemini returned an empty response.", 502, "GEMINI_EMPTY_RESPONSE");
  }

  return responseText.trim();
}

// Synchronous — just checks whether the API key is present.
// No API call so health probes don't burn quota.
export function checkGeminiHealth() {
  const { configured, model } = getGeminiConfig();
  if (!configured) {
    return {
      configured: false,
      ready: false,
      model,
      code: "GEMINI_NOT_CONFIGURED",
      message: "GEMINI_API_KEY environment variable is not set.",
    };
  }
  return {
    configured: true,
    ready: true,
    model,
    code: "GEMINI_OK",
    message: "Gemini is configured.",
  };
}
