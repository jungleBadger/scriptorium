// server/routes/health.js
// GET /health — liveness + feature availability check.

import { getPool } from "../services/pool.js";
import { checkGeminiHealth } from "../services/geminiClient.js";
import { checkVoiceAIHealth, getVoiceAIConfig } from "../services/ttsService.js";

async function healthHandler(req, reply) {
  const { endpoint: voiceAIEndpoint } = getVoiceAIConfig();

  const status = {
    postgres: false,
    gemini:   { configured: false, ready: false, code: "GEMINI_UNKNOWN", message: "Gemini health check did not run." },
    voice_ai: {
      configured: false, reachable: false, ready: false,
      code: "VOICE_AI_UNKNOWN", message: "voice.ai health check did not run.",
      endpoint: voiceAIEndpoint,
    },
  };

  try {
    await getPool().query("SELECT 1");
    status.postgres = true;
  } catch (err) {
    req.log.warn(err, "Health check: Postgres unreachable");
  }

  // Synchronous — no API call, just checks env var presence.
  status.gemini = checkGeminiHealth();

  try {
    status.voice_ai = await checkVoiceAIHealth();
  } catch (err) {
    req.log.warn(err, "Health check: voice.ai probe failed unexpectedly");
    status.voice_ai = {
      configured: true, reachable: false, ready: false,
      code: "VOICE_AI_HEALTH_ERROR", message: "voice.ai health probe threw an error.",
      endpoint: voiceAIEndpoint,
    };
  }

  const features = {
    // "explore" controls the Ask/Explore UI — available whenever Gemini is configured.
    explore: {
      available: Boolean(status.gemini.ready),
      provider:  "gemini",
      code:      status.gemini.code,
      message:   status.gemini.message,
    },
    read_aloud: {
      available: Boolean(status.voice_ai.ready),
      provider:  "voice_ai",
      code:      status.voice_ai.code,
      message:   status.voice_ai.message,
    },
  };

  const coreReady          = status.postgres;
  const allFeaturesAvailable = features.explore.available && features.read_aloud.available;

  reply.status(coreReady ? 200 : 503).send({
    status: coreReady && allFeaturesAvailable ? "ok" : "degraded",
    ...status,
    features,
  });
}

export default async function healthRoutes(app) {
  app.get("/health",     healthHandler);
  app.get("/api/health", healthHandler);
}
