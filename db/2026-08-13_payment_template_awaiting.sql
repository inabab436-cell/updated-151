-- =============================================================================
-- CUPAI — Per-payment-method confirmation message template.
-- Empty template  → the agent uses the default Arabic wording for the method's
-- behavior (manual / auto).
-- Manual methods also park the conversation in status 'awaiting_payment',
-- which the dashboard shows under "في انتظار ردك".
-- Safe to re-run.
-- =============================================================================

alter table public.payment_methods
  add column if not exists payment_template text not null default '';
