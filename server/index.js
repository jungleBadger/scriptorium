// server/index.js
// Scriptorium BFF – Fastify server bootstrap.

import { fileURLToPath } from "node:url";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import { closePool } from "./services/pool.js";
import searchRoutes from "./routes/search.js";
import askRoutes from "./routes/ask.js";
import healthRoutes from "./routes/health.js";
import entityRoutes from "./routes/entities.js";
import bookRoutes from "./routes/books.js";
import chapterRoutes from "./routes/chapters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

const app = Fastify({ logger: true });

await app.register(cors);
await app.register(searchRoutes);
await app.register(askRoutes);
await app.register(healthRoutes);
await app.register(entityRoutes);
await app.register(bookRoutes);
await app.register(chapterRoutes);

// ---------- Serve built client SPA ----------
const clientDist = path.join(__dirname, "..", "client", "dist");
await app.register(fastifyStatic, { root: clientDist, wildcard: false });

// SPA fallback – serve index.html for any non-API route
app.setNotFoundHandler((_req, reply) => {
  reply.sendFile("index.html");
});

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
