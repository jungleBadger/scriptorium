// Voice definitions for voice.ai TTS.
// Add your voice IDs from the voice.ai dashboard (https://voice.ai).
// The `language` field must match one of voice.ai's supported language codes:
// en, es, fr, de, it, pt, pl, ru, nl, ca, sv
export const VOICES = [
  // Auto keeps backward compatibility for saved settings; server/client now prefer
  // dedicated locale-specific voices when they are available.
  { id: "",                                      label: "Auto (Match translation)", language: "en", locale: "en-US", isAuto: true },
  { id: "83574172-326a-4213-9514-c07b0a6a51a1", label: "English (en-US)",           language: "en", locale: "en-US", isDefault: true },
  { id: "6eb00994-ddc7-44ee-a504-ef80065d5d6a", label: "Portuguese (pt-BR)",        language: "pt", locale: "pt-BR", isDefault: true },
];
