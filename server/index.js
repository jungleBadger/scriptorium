// server/index.js
// Scriptorium BFF – Fastify server bootstrap.

import Fastify from "fastify";
import cors from "@fastify/cors";
import { closePool } from "./services/chunksRepo.js";
import searchRoutes from "./routes/search.js";
import healthRoutes from "./routes/health.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

const app = Fastify({ logger: true });

await app.register(cors);
await app.register(searchRoutes);
await app.register(healthRoutes);

// ---------- Start ----------
const start = async () => {
  try {
    await app.listen({ port: PORT, host: HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  await app.close();
  await closePool();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start();
