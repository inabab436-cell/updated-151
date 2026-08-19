-- =============================================================================
-- Fix: "new row for relation \"orders\" violates check constraint
--       \"orders_status_check\"" when the merchant presses
--       «تم التجهيز» (prepared) or «تم الشحن» (shipped).
--
-- Cause: public.orders.status has an old CHECK constraint that does not list
--        the newer lifecycle values ('prepared', 'shipped'). The app code
--        (updateOrderStatus) writes them, so Postgres rejects the UPDATE.
--
-- Fix:   drop and re-create the constraint with the full status list actually
--        used by the app. Nothing else is touched.
-- =============================================================================

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (
    status IN (
      'new',
      'pending',
      'confirmed',
      'processing',
      'prepared',
      'shipped',
      'delivered',
      'cancelled'
    )
  );
