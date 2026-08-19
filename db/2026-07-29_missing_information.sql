-- =============================================================================
-- CUPAI — Missing-information follow-up system.
--
-- When the agent cannot find an answer anywhere in the database, it tells the
-- customer it will check and get back to them, and records the gap here:
--
--   missing_info_topics : ONE row per distinct missing piece of information
--                         (semantically grouped across phrasings/languages).
--   missing_info_asks   : ONE row per (topic, conversation) — the customer who
--                         asked and the exact message where they asked it.
--
-- Exactly ONE notification row exists per topic. Repeat asks never create a
-- second notification: they bump alert_count / priority on the same row.
--
-- Safe to re-run.
-- =============================================================================

-- 0) notifications: make sure the enum can carry the missing-information type
do $$
begin
  if exists (select 1 from pg_type where typname = 'notification_type')
     and not exists (
       select 1 from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       where t.typname = 'notification_type' and e.enumlabel = 'missing_information'
     )
  then
    alter type public.notification_type add value 'missing_information';
  end if;
end$$;

-- 1) topics -------------------------------------------------------------------
create table if not exists public.missing_info_topics (
  id                 uuid primary key default gen_random_uuid(),
  merchant_id        uuid not null references public.merchants(id) on delete cascade,
  canonical_question text not null,
  normalized_key     text,
  product            text,
  missing_field      text not null default 'other',
  details            jsonb not null default '{}'::jsonb,
  status             text not null default 'open',   -- open | resolved
  alert_count        integer not null default 1,     -- how many times it was re-raised
  priority           integer not null default 1,
  first_asked_at     timestamptz not null default now(),
  last_asked_at      timestamptz not null default now(),
  resolved_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists missing_info_topics_merchant_idx
  on public.missing_info_topics (merchant_id, status, last_asked_at desc);

grant select, insert, update, delete on public.missing_info_topics to authenticated;
grant all on public.missing_info_topics to service_role;
alter table public.missing_info_topics enable row level security;

drop policy if exists missing_info_topics_owner on public.missing_info_topics;
create policy missing_info_topics_owner on public.missing_info_topics for all
  to authenticated
  using (exists (select 1 from public.merchants m
                 where m.id = missing_info_topics.merchant_id and m.user_id = auth.uid()))
  with check (exists (select 1 from public.merchants m
                 where m.id = missing_info_topics.merchant_id and m.user_id = auth.uid()));

-- 2) asks ---------------------------------------------------------------------
create table if not exists public.missing_info_asks (
  id              uuid primary key default gen_random_uuid(),
  topic_id        uuid not null references public.missing_info_topics(id) on delete cascade,
  merchant_id     uuid not null,
  conversation_id uuid not null,
  customer_id     uuid,
  customer_key    text not null,      -- customer_id when known, else conversation_id
  message_id      uuid,               -- the customer message where it was asked
  question_text   text,
  created_at      timestamptz not null default now()
);

-- One ask row per conversation per topic: repeated questions from the same
-- customer in the same conversation can never inflate the customer count.
create unique index if not exists missing_info_asks_topic_convo_uidx
  on public.missing_info_asks (topic_id, conversation_id);
create index if not exists missing_info_asks_topic_idx
  on public.missing_info_asks (topic_id, created_at);

grant select, insert, update, delete on public.missing_info_asks to authenticated;
grant all on public.missing_info_asks to service_role;
alter table public.missing_info_asks enable row level security;

drop policy if exists missing_info_asks_owner on public.missing_info_asks;
create policy missing_info_asks_owner on public.missing_info_asks for all
  to authenticated
  using (exists (select 1 from public.merchants m
                 where m.id = missing_info_asks.merchant_id and m.user_id = auth.uid()))
  with check (exists (select 1 from public.merchants m
                 where m.id = missing_info_asks.merchant_id and m.user_id = auth.uid()));

-- 3) notifications: link to a topic + carry priority ---------------------------
alter table public.notifications
  add column if not exists topic_id      uuid references public.missing_info_topics(id) on delete cascade,
  add column if not exists alert_count   integer not null default 1,
  add column if not exists priority      integer not null default 1,
  add column if not exists updated_at    timestamptz not null default now();

-- Exactly one notification per missing-information topic.
create unique index if not exists notifications_topic_uidx
  on public.notifications (topic_id) where topic_id is not null;
