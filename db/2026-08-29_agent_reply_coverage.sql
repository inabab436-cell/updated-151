-- 2026-08-29_agent_reply_coverage.sql
-- Records exactly which customer messages were included in an agent run.
-- This prevents a reply from an older history snapshot from accidentally
-- being treated as the answer to a message that arrived while that run was
-- already in progress.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS agent_reply_id uuid
  REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS messages_agent_reply_id_idx
  ON public.messages(agent_reply_id)
  WHERE agent_reply_id IS NOT NULL;