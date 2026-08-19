-- 2026-07-26_conversation_source_agent_toggle.sql
-- Additive: track conversation traffic source and add per-conversation +
-- per-merchant AI agent toggles. Purely additive — no existing columns,
-- policies, grants, or defaults are altered.

-- 1. Conversation-level fields.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS source         text    NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS agent_enabled  boolean NOT NULL DEFAULT true;

-- 2. Merchant-level global agent switch.
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS agent_globally_enabled boolean NOT NULL DEFAULT true;
