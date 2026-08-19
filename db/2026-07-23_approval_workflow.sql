-- =====================================================================
--  Approval workflow: per-item fingerprint, isolated approval, re-approve
--
--  RUN THIS MIGRATION MANUALLY.
--
--  Adds a processing_fingerprint / failure_reason / failed_at triple to
--  every staging_* table and widens the batch status check-list.
--  No existing rows are touched.
--
--  IMPORTANT: does NOT change analysis, matching, merging or any AI
--  logic. Fingerprints exist only as a save-side reference.
-- =====================================================================
BEGIN;

-- 1. Per-row approval bookkeeping ------------------------------------------
ALTER TABLE public.staging_products
  ADD COLUMN IF NOT EXISTS processing_fingerprint uuid,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz;

ALTER TABLE public.staging_policies
  ADD COLUMN IF NOT EXISTS processing_fingerprint uuid,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz;

ALTER TABLE public.staging_shipping
  ADD COLUMN IF NOT EXISTS processing_fingerprint uuid,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz;

ALTER TABLE public.staging_contacts
  ADD COLUMN IF NOT EXISTS processing_fingerprint uuid,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz;

-- 2. Allow the new 'failed' status on each staging table.
--    Each block is idempotent: drops the existing check (if any), then
--    re-adds it with 'failed' included. Skip entirely if a table has no
--    status check constraint in your project.
DO $$
DECLARE
  t text;
  c text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'staging_products','staging_policies','staging_shipping','staging_contacts'
  ]) LOOP
    FOR c IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = ('public.'||t)::regclass
        AND contype  = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%status%'
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, c);
    END LOOP;
    EXECUTE format($f$
      ALTER TABLE public.%I
      ADD CONSTRAINT %I CHECK (
        status IN (
          'pending','edited','processing','needs_review','needs_ai_review',
          'publish_selected','approved','discarded','deleted','failed',
          'completed'
        )
      )
    $f$, t, t||'_status_check');
  END LOOP;
END $$;

-- 3. Allow 'partially_approved' on analysis_batches.status.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.analysis_batches'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.analysis_batches DROP CONSTRAINT %I', c);
  END LOOP;
  EXECUTE $f$
    ALTER TABLE public.analysis_batches
    ADD CONSTRAINT analysis_batches_status_check CHECK (
      status IN (
        'pending','processing','completed','needs_review',
        'approved','partially_approved','discarded','failed'
      )
    )
  $f$;
END $$;

COMMIT;
