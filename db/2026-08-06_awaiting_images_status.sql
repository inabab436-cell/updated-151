-- =============================================================================
-- CUPAI — "Awaiting image" status for image-less staging products.
--
-- A staging_products row that has no images at all must NOT be sent to the
-- AI analyzer. It should sit in a dedicated status until the merchant
-- uploads at least one image, after which the normal pipeline resumes.
--
-- This migration widens the staging_products.status CHECK constraint (see
-- db/2026-07-23_approval_workflow.sql) to include a new value:
--   'awaiting_images'
--
-- All previously allowed values are preserved unchanged.
-- Safe to re-run.
-- =============================================================================
BEGIN;

-- Idempotent: drop any existing status check on staging_products and re-add
-- it with the full set of previously-approved values PLUS 'awaiting_images'.
-- If the table has no status check constraint in this environment, the note
-- below documents that 'awaiting_images' is nonetheless a valid,
-- application-level-approved status for the status column.
DO $$
DECLARE c text;
DECLARE had_check boolean := false;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.staging_products'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    had_check := true;
    EXECUTE format('ALTER TABLE public.staging_products DROP CONSTRAINT %I', c);
  END LOOP;

  IF had_check THEN
    EXECUTE $f$
      ALTER TABLE public.staging_products
      ADD CONSTRAINT staging_products_status_check CHECK (
        status IN (
          'pending','edited','processing','needs_review','needs_ai_review',
          'publish_selected','approved','discarded','deleted','failed',
          'completed','awaiting_images'
        )
      )
    $f$;
  END IF;
END $$;

-- NOTE: If no CHECK constraint exists on staging_products.status in this
-- environment, the new value 'awaiting_images' is still a valid,
-- application-level-approved status. It represents a product row that has
-- no images attached and must be held out of the AI analysis pipeline until
-- at least one image is uploaded, at which point the application transitions
-- it back into the normal flow (e.g. 'pending').
COMMENT ON COLUMN public.staging_products.status IS
  'Lifecycle status of the staging row. Approved values include the prior set (pending, edited, processing, needs_review, needs_ai_review, publish_selected, approved, discarded, deleted, failed, completed) plus ''awaiting_images'' — a row that has no images yet and is intentionally excluded from AI analysis until an image is uploaded.';

COMMIT;
