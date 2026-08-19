-- =============================================================================
-- CUPAI — Widen conversations.status so the agent can park a conversation.
-- Without this the update to 'awaiting_payment' fails silently and the agent
-- keeps replying after a manual payment method is chosen.
-- Safe to re-run.
-- =============================================================================

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.conversations'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.conversations drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.conversations
  add constraint conversations_status_check check (
    status in (
      'open', 'active', 'in_progress', 'closed', 'resolved',
      'needs_human', 'awaiting_payment', 'awaiting_images'
    )
  );
