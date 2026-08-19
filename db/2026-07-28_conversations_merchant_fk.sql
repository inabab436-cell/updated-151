-- 2026-07-28_conversations_merchant_fk.sql
-- Add the missing foreign key from conversations.merchant_id to merchants.id.
-- The dashboard query in src/lib/conversations.functions.ts previously used a
-- PostgREST embed (`merchants!inner(...)`) that failed at runtime with:
--   "Could not find a relationship between 'conversations' and 'merchants'
--    in the schema cache"
-- because no FK constraint existed. This migration adds it so PostgREST can
-- detect the relationship. Purely additive — no data or column changes.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversations_merchant_id_fkey'
      AND conrelid = 'public.conversations'::regclass
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_merchant_id_fkey
      FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
