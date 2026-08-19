-- 2026-07-25_orders_inventory.sql
-- Adds shipping/delivery timestamps + note column to orders,
-- and creates a per-merchant order_status_messages settings table.

-- 1. Extend orders with lifecycle timestamps and customer note.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipped_at   timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes        text;

-- 2. Per-merchant editable status message templates.
CREATE TABLE IF NOT EXISTS public.order_status_messages (
  merchant_id       uuid PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,
  shipped_message   text,
  delivered_message text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_status_messages TO authenticated;
GRANT ALL ON public.order_status_messages TO service_role;

ALTER TABLE public.order_status_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "merchant owns status messages"
  ON public.order_status_messages;
CREATE POLICY "merchant owns status messages"
  ON public.order_status_messages
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.merchants m
      WHERE m.id = order_status_messages.merchant_id
        AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.merchants m
      WHERE m.id = order_status_messages.merchant_id
        AND m.user_id = auth.uid()
    )
  );
