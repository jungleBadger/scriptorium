// server/routes/health.js
// GET /health — liveness check for Postgres.

import { getPool } from "../services/pool.js";
import { checkOllamaHealth, getOllamaConfig } from "../services/ollamaClient.js";

async function healthHandler(req, reply) {
  const { model: ollamaModel } = getOllamaConfig();
  const status = {
    postgres: false,
    ollama: {
      reachable: false,
      model_available: false,
      model: ollamaModel,
      code: "OLLAMA_UNKNOWN",
      message: "Ollama health check did not run.",
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

  const ok = status.postgres && status.ollama.reachable && status.ollama.model_available;
  reply.status(ok ? 200 : 503).send({
    status: ok ? "ok" : "degraded",
    ...status,
  });
}

export default async function healthRoutes(app) {
  app.get("/health", healthHandler);
  app.get("/api/health", healthHandler);
}
