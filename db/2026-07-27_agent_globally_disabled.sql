-- Additive: brand-level "disable AI agent for all conversations" toggle.
-- Independent of the earlier agent_globally_enabled column so nothing else breaks.
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS agent_globally_disabled boolean NOT NULL DEFAULT false;
