-- =============================================================================
-- CUPAI — Auto follow-up for waiting customers when missing info is added.
--
-- When the brand owner adds knowledge that resolves a missing_info_topic, the
-- AI evaluates every conversation that asked about that topic and, for each
-- one where the customer still needs the answer, posts a natural in-chat
-- follow-up message. The brand owner then gets ONE notification summarising
-- which customers were updated.
--
-- Safe to re-run.
-- =============================================================================

-- 1) Enum: add the follow-up notification type ---------------------------------
do $$
begin
  if exists (select 1 from pg_type where typname = 'notification_type')
     and not exists (
       select 1 from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       where t.typname = 'notification_type' and e.enumlabel = 'missing_info_followup'
     )
  then
    alter type public.notification_type add value 'missing_info_followup';
  end if;
end$$;

-- 2) messages: mark auto follow-ups so the merchant UI can highlight them ------
alter table public.messages
  add column if not exists is_auto_followup boolean not null default false,
  add column if not exists followup_topic_id uuid
    references public.missing_info_topics(id) on delete set null;

create index if not exists messages_followup_topic_idx
  on public.messages (followup_topic_id) where followup_topic_id is not null;

-- 3) missing_info_asks: track the follow-up decision per waiting customer ------
alter table public.missing_info_asks
  add column if not exists followup_status text not null default 'pending',
  add column if not exists followup_message_id uuid
    references public.messages(id) on delete set null,
  add column if not exists followup_reason text,
  add column if not exists followup_decided_at timestamptz;

-- 4) notifications: link the follow-up summary row to its topic ----------------
alter table public.notifications
  add column if not exists followup_topic_id uuid
    references public.missing_info_topics(id) on delete cascade,
  add column if not exists sent_count integer;

-- Exactly one follow-up notification per topic.
create unique index if not exists notifications_followup_topic_uidx
  on public.notifications (followup_topic_id)
  where followup_topic_id is not null;
