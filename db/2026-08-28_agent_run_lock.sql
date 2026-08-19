-- 2026-08-28_agent_run_lock.sql
-- Additive: one agent run at a time per conversation.
--
-- Without this, every incoming customer message started its own agent run, so
-- a burst of quick messages produced several parallel runs and several
-- separate replies. The run is claimed with a single conditional UPDATE, so
-- only one worker can hold it; a claim older than 2 minutes is treated as dead.
-- No existing column, policy, grant or default is altered.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS agent_run_id         text,
  ADD COLUMN IF NOT EXISTS agent_run_started_at timestamptz;
