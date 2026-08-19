-- =============================================================================
-- CUPAI — Persistent structured order state per conversation.
--
-- The agent used to re-derive the order facts (product, variant, quantity,
-- phone, address, payment method, shipping zone) from the chat transcript on
-- every run, so a thin re-extraction silently lost data that had already been
-- collected and the agent asked for it again.
--
-- `conversations.order_state` stores that state as JSON with a stage per field
-- (extracted / verified / confirmed / committed). Runs may only add to it or
-- upgrade a stage; once the order is created every field becomes `committed`
-- and the order flow is closed.
--
-- Safe to re-run. Nothing else in the schema is touched.
-- =============================================================================

alter table public.conversations
  add column if not exists order_state jsonb;

comment on column public.conversations.order_state is
  'Structured order state (see src/lib/order-state.ts): { version, fields: { <field>: { value, stage, at } }, order_number, order_placed, updated_at }.';
