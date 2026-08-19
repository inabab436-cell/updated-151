-- =============================================================================
-- CUPAI — Enable/disable flags for automatic order-status messages.
-- When a flag is false (or the message text is empty), no message is sent to
-- the customer when the order status changes.
-- Safe to re-run.
-- =============================================================================

alter table public.order_status_messages
  add column if not exists shipped_enabled   boolean not null default true,
  add column if not exists delivered_enabled boolean not null default true;
