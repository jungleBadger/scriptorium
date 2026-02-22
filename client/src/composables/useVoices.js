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

export function translationLanguage(translation) {
  return TRANSLATION_LANGUAGE[String(translation || "").toUpperCase()] ?? "en";
}

// Returns the best voice id for a language, preferring the current voice if it
// already matches. Falls back to the first voice for that language, or "".
export function pickVoiceForLanguage(voices, lang, currentVoiceId) {
  const current = voices.find((v) => v.id === currentVoiceId);
  if (current && current.language === lang) return currentVoiceId; // already correct
  const match = voices.find((v) => v.language === lang);
  return match ? match.id : "";
}
