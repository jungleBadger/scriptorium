-- sql/003_embeddings.sql
-- Add pgvector extension and embedding column to chunks table.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE chunks
    ADD COLUMN IF NOT EXISTS embedding vector(384);

CREATE INDEX IF NOT EXISTS ix_chunks_embedding_hnsw
    ON chunks USING hnsw (embedding vector_cosine_ops);
