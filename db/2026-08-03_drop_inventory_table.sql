-- =============================================================================
-- CUPAI — Drop the unused public.inventory table.
--
-- The public.inventory table (created in db/2026-07-12_inventory_notifications.sql)
-- is not referenced anywhere in the application code, in any RPC/DB function,
-- and no other table has a foreign key pointing at it. It is safe to remove.
--
-- This migration touches ONLY public.inventory and objects directly attached
-- to it (its RLS policy and its indexes, both dropped implicitly by DROP TABLE).
-- No other table — including public.product_variants — is modified.
-- =============================================================================

drop policy if exists inventory_owner on public.inventory;
drop table if exists public.inventory;
