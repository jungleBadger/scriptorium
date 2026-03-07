// server/tests/geminiClient.test.js
// Unit tests for geminiClient — all Gemini SDK calls are mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// These refs are captured by the vi.mock factory below.
// The `mock` prefix is required so Vitest's hoisting allows the closure.
const mockGenerateContent = vi.fn();
const mockGetGenerativeModel = vi.fn(() => ({ generateContent: mockGenerateContent }));

vi.mock("@google/generative-ai", () => ({
  // Must be a regular function (not arrow) so `new GoogleGenerativeAI()` works.
  GoogleGenerativeAI: vi.fn(function () { return { getGenerativeModel: mockGetGenerativeModel }; }),
}));

// Re-import the module fresh for each test so env-var changes take effect.
beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

// ---------------------------------------------------------------------------
// checkGeminiHealth
// ---------------------------------------------------------------------------

describe("checkGeminiHealth", () => {
  it("returns not-configured when GEMINI_API_KEY is missing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const { checkGeminiHealth } = await import("../services/geminiClient.js");
    expect(checkGeminiHealth()).toMatchObject({
      configured: false,
      ready: false,
      code: "GEMINI_NOT_CONFIGURED",
    });
  });

  it("returns ready when GEMINI_API_KEY is set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const { checkGeminiHealth } = await import("../services/geminiClient.js");
    expect(checkGeminiHealth()).toMatchObject({
      configured: true,
      ready: true,
      code: "GEMINI_OK",
    });
  });

  it("includes the model name from GEMINI_MODEL env var", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-custom");
    const { checkGeminiHealth } = await import("../services/geminiClient.js");
    expect(checkGeminiHealth().model).toBe("gemini-custom");
  });
});

// ---------------------------------------------------------------------------
// generateGeminiText
// ---------------------------------------------------------------------------

describe("generateGeminiText", () => {
  it("throws GEMINI_BAD_REQUEST when prompt is empty", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const { generateGeminiText } = await import("../services/geminiClient.js");
    await expect(generateGeminiText({ prompt: "   " })).rejects.toMatchObject({
      code: "GEMINI_BAD_REQUEST",
      statusCode: 500,
    });
  });

  it("throws GEMINI_NOT_CONFIGURED when no API key is set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const { generateGeminiText } = await import("../services/geminiClient.js");
    await expect(generateGeminiText({ prompt: "hello" })).rejects.toMatchObject({
      code: "GEMINI_NOT_CONFIGURED",
      statusCode: 503,
    });
  });

  it("throws GEMINI_SAFETY_BLOCK when finishReason is SAFETY", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    mockGenerateContent.mockResolvedValueOnce({
      response: { candidates: [{ finishReason: "SAFETY" }], text: () => "" },
    });
    const { generateGeminiText } = await import("../services/geminiClient.js");
    await expect(generateGeminiText({ prompt: "hello" })).rejects.toMatchObject({
      code: "GEMINI_SAFETY_BLOCK",
      statusCode: 422,
    });
  });

  it("throws GEMINI_RATE_LIMITED on HTTP 429", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    mockGenerateContent.mockRejectedValueOnce({ status: 429, message: "quota" });
    const { generateGeminiText } = await import("../services/geminiClient.js");
    await expect(generateGeminiText({ prompt: "hello" })).rejects.toMatchObject({
      code: "GEMINI_RATE_LIMITED",
      statusCode: 429,
    });
  });

  it("throws GEMINI_AUTH_ERROR on HTTP 401", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    mockGenerateContent.mockRejectedValueOnce({ status: 401, message: "unauthorized" });
    const { generateGeminiText } = await import("../services/geminiClient.js");
    await expect(generateGeminiText({ prompt: "hello" })).rejects.toMatchObject({
      code: "GEMINI_AUTH_ERROR",
      statusCode: 503,
    });
  });

  it("throws GEMINI_AUTH_ERROR on HTTP 403", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    mockGenerateContent.mockRejectedValueOnce({ status: 403, message: "forbidden" });
    const { generateGeminiText } = await import("../services/geminiClient.js");
    await expect(generateGeminiText({ prompt: "hello" })).rejects.toMatchObject({
      code: "GEMINI_AUTH_ERROR",
      statusCode: 503,
    });
  });

  it("throws GEMINI_EMPTY_RESPONSE when response text is blank", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    mockGenerateContent.mockResolvedValueOnce({
      response: { candidates: [{ finishReason: "STOP" }], text: () => "   " },
    });
    const { generateGeminiText } = await import("../services/geminiClient.js");
    await expect(generateGeminiText({ prompt: "hello" })).rejects.toMatchObject({
      code: "GEMINI_EMPTY_RESPONSE",
      statusCode: 502,
    });
  });

  it("returns trimmed response text on success", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    mockGenerateContent.mockResolvedValueOnce({
      response: { candidates: [{ finishReason: "STOP" }], text: () => "  The answer.  " },
    });
    const { generateGeminiText } = await import("../services/geminiClient.js");
    const result = await generateGeminiText({ prompt: "hello" });
    expect(result).toBe("The answer.");
  });
});
