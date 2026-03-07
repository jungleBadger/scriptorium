-- sql/003_embeddings.sql
-- pgvector extension + embedding column on chunks.
-- Embedding model: Google text-embedding-004 (768 dimensions).
--
-- MIGRATION NOTE: if upgrading from the old Xenova/384-dim setup, run this first:
--   ALTER TABLE chunks DROP COLUMN IF EXISTS embedding;
--   DROP INDEX IF EXISTS ix_chunks_embedding_hnsw;
-- Then re-run this file and re-run 005_embed_chunks.mjs.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE chunks
    ADD COLUMN IF NOT EXISTS embedding vector(768);

CREATE INDEX IF NOT EXISTS ix_chunks_embedding_hnsw
    ON chunks USING hnsw (embedding vector_cosine_ops);
