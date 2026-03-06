// client/src/composables/useVoices.js
// Shared voices list with module-level cache — only one fetch per session.

const FALLBACK = [{ id: "", label: "Default", language: "en" }];

let _cache = null;
let _pending = null;

export async function fetchVoices() {
  if (_cache) return _cache;
  if (!_pending) {
    _pending = fetch("/api/tts/voices")
      .then((r) => (r.ok ? r.json() : FALLBACK))
      .catch(() => FALLBACK)
      .then((v) => { _cache = v.length ? v : FALLBACK; return _cache; });
  }
  return _pending;
}

// Returns the language code for a given translation key.
// Mirrors the server-side mapping in ttsService.js.
const TRANSLATION_LANGUAGE = { PT1911: "pt", ARC: "pt" };
const PREFERRED_LOCALE_BY_LANGUAGE = { en: "en-us", pt: "pt-br" };

export function translationLanguage(translation) {
  return TRANSLATION_LANGUAGE[String(translation || "").toUpperCase()] ?? "en";
}

// Returns the best voice id for a language, preferring the current voice if it
// already matches. Falls back to the first voice for that language, or "".
export function pickVoiceForLanguage(voices, lang, currentVoiceId) {
  const current = voices.find((v) => v.id === currentVoiceId);
  // Keep current selection only for explicit non-empty voices; the empty "" entry
  // behaves like "auto", so translation switches can move to a locale-specific voice.
  if (current && current.id && current.language === lang) return currentVoiceId;

  const matches = voices.filter((v) => v.language === lang);
  if (!matches.length) return "";

  const preferredLocale = PREFERRED_LOCALE_BY_LANGUAGE[String(lang || "").toLowerCase()] || "";
  const match =
    matches.find((v) => v.id && String(v.locale || "").toLowerCase() === preferredLocale && v.isDefault) ||
    matches.find((v) => v.id && String(v.locale || "").toLowerCase() === preferredLocale) ||
    matches.find((v) => v.id && v.isDefault) ||
    matches.find((v) => v.id) ||
    matches[0];
  return match ? match.id : "";
}
