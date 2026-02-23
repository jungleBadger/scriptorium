// server/routes/health.js
// GET /health — liveness check for Postgres.

import { getPool } from "../services/pool.js";
import { checkOllamaHealth, getOllamaConfig } from "../services/ollamaClient.js";
import { checkVoiceAIHealth, getVoiceAIConfig } from "../services/ttsService.js";

async function healthHandler(req, reply) {
  const { model: ollamaModel } = getOllamaConfig();
  const { endpoint: voiceAIEndpoint } = getVoiceAIConfig();
  const status = {
    postgres: false,
    ollama: {
      reachable: false,
      model_available: false,
      model: ollamaModel,
      code: "OLLAMA_UNKNOWN",
      message: "Ollama health check did not run.",
    },
    voice_ai: {
      configured: false,
      reachable: false,
      ready: false,
      code: "VOICE_AI_UNKNOWN",
      message: "voice.ai health check did not run.",
      endpoint: voiceAIEndpoint,
    },
  };

  try {
    await getPool().query("SELECT 1");
    status.postgres = true;
  } catch (err) {
    req.log.warn(err, "Health check: Postgres unreachable");
  }

  try {
    status.ollama = await checkOllamaHealth({ model: ollamaModel });
  } catch (err) {
    req.log.warn(err, "Health check: Ollama probe failed unexpectedly");
    status.ollama = {
      reachable: false,
      model_available: false,
      model: ollamaModel,
      code: "OLLAMA_HEALTH_ERROR",
      message: "Ollama health probe threw an error.",
    };
  }

  try {
    status.voice_ai = await checkVoiceAIHealth();
  } catch (err) {
    req.log.warn(err, "Health check: voice.ai probe failed unexpectedly");
    status.voice_ai = {
      configured: true,
      reachable: false,
      ready: false,
      code: "VOICE_AI_HEALTH_ERROR",
      message: "voice.ai health probe threw an error.",
      endpoint: voiceAIEndpoint,
    };
  }

  const features = {
    explore: {
      available: Boolean(status.ollama.reachable && status.ollama.model_available),
      provider: "ollama",
      code: status.ollama.code,
      message: status.ollama.message,
    },
    read_aloud: {
      available: Boolean(status.voice_ai.ready),
      provider: "voice_ai",
      code: status.voice_ai.code,
      message: status.voice_ai.message,
    },
  };

  const allFeaturesAvailable = features.explore.available && features.read_aloud.available;
  const coreReady = status.postgres;
  reply.status(coreReady ? 200 : 503).send({
    status: coreReady && allFeaturesAvailable ? "ok" : "degraded",
    ...status,
    features,
  });
}

export default async function healthRoutes(app) {
  app.get("/health", healthHandler);
  app.get("/api/health", healthHandler);
}
