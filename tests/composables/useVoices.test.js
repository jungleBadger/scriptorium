// Unit tests for useVoices pure helper functions.

import { describe, it, expect } from "vitest";
import { translationLanguage, pickVoiceForLanguage } from "../../client/src/composables/useVoices.js";

const VOICES = [
  { id: "", label: "Auto", language: "en", locale: "en-US", isAuto: true },
  { id: "voice-en-1", label: "EN Voice 1", language: "en", locale: "en-US", isDefault: true },
  { id: "voice-pt-1", label: "PT Voice 1", language: "pt", locale: "pt-BR", isDefault: true },
];

describe("translationLanguage", () => {
  it("maps PT1911 to pt", () => {
    expect(translationLanguage("PT1911")).toBe("pt");
  });

  it("maps ARC to pt", () => {
    expect(translationLanguage("ARC")).toBe("pt");
  });

  it("maps WEBU to en", () => {
    expect(translationLanguage("WEBU")).toBe("en");
  });

  it("defaults unknown translations to en", () => {
    expect(translationLanguage("KJV")).toBe("en");
    expect(translationLanguage("NIV")).toBe("en");
  });

  it("is case-insensitive", () => {
    expect(translationLanguage("pt1911")).toBe("pt");
    expect(translationLanguage("Pt1911")).toBe("pt");
  });

  it("handles null and undefined gracefully", () => {
    expect(translationLanguage(null)).toBe("en");
    expect(translationLanguage(undefined)).toBe("en");
  });
});

describe("pickVoiceForLanguage", () => {
  it("keeps the current voice when it already matches the target language", () => {
    expect(pickVoiceForLanguage(VOICES, "en", "voice-en-1")).toBe("voice-en-1");
  });

  it("switches to the first matching voice when language does not match", () => {
    expect(pickVoiceForLanguage(VOICES, "pt", "voice-en-1")).toBe("voice-pt-1");
  });

  it("picks the dedicated locale voice when no current voice is set", () => {
    expect(pickVoiceForLanguage(VOICES, "pt", "")).toBe("voice-pt-1");
    expect(pickVoiceForLanguage(VOICES, "en", "")).toBe("voice-en-1");
  });

  it("returns empty string when no voice matches the target language", () => {
    const englishOnly = [{ id: "v1", label: "V1", language: "en" }];
    expect(pickVoiceForLanguage(englishOnly, "pt", "")).toBe("");
  });

  it("returns empty string when voices list is empty", () => {
    expect(pickVoiceForLanguage([], "en", "")).toBe("");
  });

  it("treats the default '' voice id as auto and prefers a dedicated locale voice", () => {
    const result = pickVoiceForLanguage(VOICES, "en", "voice-pt-1");
    expect(result).toBe("voice-en-1");
  });
});
