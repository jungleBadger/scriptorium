// server/routes/health.js
// GET /health — liveness check for Postgres.

import { getPool } from "../services/chunksRepo.js";

async function healthHandler(req, reply) {
  const status = { postgres: false };

  try {
    await getPool().query("SELECT 1");
    status.postgres = true;
  } catch (err) {
    req.log.warn(err, "Health check: Postgres unreachable");
  }

  const ok = status.postgres;
  reply.status(ok ? 200 : 503).send({ status: ok ? "ok" : "degraded", ...status });
}

export default async function healthRoutes(app) {
  app.get("/health", healthHandler);
}
