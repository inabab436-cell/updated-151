-- =============================================================================
-- CUPAI — Store knowledge + customer memory: rebuilt from scratch.
--
-- Design: ONE source per data type. The agent reads brand-owner data directly
-- from its own table in real time (merchants, products, product_variants,
-- policies, shipping_rates, contact_info, knowledge_base) — no derived copy,
-- no embeddings, no similarity search. Customer memory is ONE cumulative
-- structured profile on `customers`.
--
-- Everything dropped below was a duplicate/derived copy of data that still
-- lives in its source table. Upload/analysis objects (staging_*, batches,
-- unclassified) are intentionally untouched.
-- Safe to re-run.
-- =============================================================================

-- 1. Drop the RAG / embeddings layer (duplicate of the source tables) --------
drop function if exists public.match_knowledge(uuid, vector, int);
drop function if exists public.match_knowledge(uuid, vector, int, text[]);
drop table if exists public.knowledge_chunks cascade;
drop table if exists public.rag_index_state cascade;

-- 2. Drop the second customer-memory store ----------------------------------
--    Replaced by customers.profile_structured (single cumulative profile).
drop table if exists public.agent_memory cascade;

-- 3. Drop the duplicated customer preferences column ------------------------
alter table public.customers drop column if exists preferences;

-- 4. The single customer-memory surface -------------------------------------
alter table public.customers
  add column if not exists profile_structured    jsonb,
  add column if not exists profile_summary       text,
  add column if not exists profile_updated_at    timestamptz,
  add column if not exists profile_message_count int not null default 0;

comment on column public.customers.profile_structured is
  'The ONLY long-term customer memory: cumulative, AI-structured personal profile (communication style, purchasing power, preferences, behaviour) built from the entire conversation history. Contains no prices and no brand-owner data.';
comment on column public.customers.profile_updated_at is
  'created_at of the last customer message already folded into profile_structured.';
