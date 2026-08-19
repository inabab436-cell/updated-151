-- =============================================================================
-- CUPAI — Link a missing-information topic to the knowledge the owner added.
--
-- When the brand owner answers a missing_info_topic (manual entry), we keep a
-- permanent pointer to the stored knowledge_base row plus a copy of the text,
-- so the dedicated "المعلومات الناقصة" dashboard page can always show:
--   - the question, who asked it,
--   - whether the information was added, and what exactly was added,
--   - which customers the agent went back to with the answer.
--
-- Safe to re-run.
-- =============================================================================

alter table public.missing_info_topics
  add column if not exists resolved_entry_id    uuid,
  add column if not exists resolved_title       text,
  add column if not exists resolved_answer      text;

create index if not exists missing_info_topics_resolved_entry_idx
  on public.missing_info_topics (resolved_entry_id)
  where resolved_entry_id is not null;
