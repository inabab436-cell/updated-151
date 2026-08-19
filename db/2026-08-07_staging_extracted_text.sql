-- =============================================================================
-- Extracted Text Data: a new staging type for useful textual content the AI
-- pulls from uploaded files that does NOT belong to any existing category
-- (product / policy / shipping / contact / address).
--
-- Goes through the same review / matching / merge / conflict flow as the
-- other staging_* types. On approval the row is written directly into the
-- EXISTING public.knowledge_base table (single source of truth already read
-- by the chat agent for every status='approved' row, and already used by the
-- manual entry feature). No new final table is introduced.
--
-- Standard columns mirror staging_policies / staging_shipping / staging_contacts
-- (id, user_id, batch_id, action, status, created_at) plus the per-row
-- approval bookkeeping added in db/2026-07-23_approval_workflow.sql
-- (processing_fingerprint, failure_reason, failed_at).
--
-- Type-specific columns: title, content, suggested_category, source_files,
-- and duplicate_of pointing at the linked knowledge_base row.
--
-- The knowledge_base table itself is NOT modified by this migration.
-- Safe to re-run.
-- =============================================================================
BEGIN;

create table if not exists public.staging_extracted_text (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null,
  -- Type-specific fields
  title text not null default '',
  content text not null default '',
  suggested_category text,
  source_files text[] not null default '{}',
  duplicate_of uuid,
  -- Standard staging workflow columns
  action text not null default 'new' check (action in ('new','replace','merge','skip')),
  status text not null default 'pending' check (
    status in (
      'pending','edited','processing','needs_review','needs_ai_review',
      'publish_selected','approved','discarded','deleted','failed','completed'
    )
  ),
  processing_fingerprint uuid,
  failure_reason text,
  failed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists staging_extracted_text_batch_idx
  on public.staging_extracted_text(batch_id);
create index if not exists staging_extracted_text_duplicate_of_idx
  on public.staging_extracted_text(duplicate_of);

grant select, insert, update, delete on public.staging_extracted_text to authenticated;
grant all on public.staging_extracted_text to service_role;

alter table public.staging_extracted_text enable row level security;
drop policy if exists staging_extracted_text_owner on public.staging_extracted_text;
create policy staging_extracted_text_owner on public.staging_extracted_text for all
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Attach a FK from duplicate_of -> public.knowledge_base(id) ONLY when the
-- knowledge_base.id column is a compatible uuid type. If it is anything else
-- (or the table does not exist), the column is left as a plain uuid pointer
-- without an FK constraint, so this migration never fails.
DO $$
DECLARE
  kb_id_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO kb_id_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'knowledge_base'
     AND a.attname = 'id'
     AND a.attnum > 0
     AND NOT a.attisdropped;

  IF kb_id_type = 'uuid' THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.staging_extracted_text'::regclass
         AND conname = 'staging_extracted_text_duplicate_of_fkey'
    ) THEN
      EXECUTE $f$
        ALTER TABLE public.staging_extracted_text
          ADD CONSTRAINT staging_extracted_text_duplicate_of_fkey
          FOREIGN KEY (duplicate_of)
          REFERENCES public.knowledge_base(id)
          ON DELETE SET NULL
      $f$;
    END IF;
  END IF;
END $$;

-- Column-level documentation, matching the style used elsewhere in db/.
comment on table  public.staging_extracted_text is
  'Staging rows for the "Extracted Text Data" type: useful textual content the AI pulled from uploaded files that does not fit any existing category. On approval the row is written into public.knowledge_base (no separate final table).';
comment on column public.staging_extracted_text.title is
  'Short human-readable label for this extracted text block, shown in the review UI.';
comment on column public.staging_extracted_text.content is
  'Full extracted text. On approval this becomes knowledge_base.content_text.';
comment on column public.staging_extracted_text.suggested_category is
  'Free-text category hint proposed by the AI (e.g. "return policy", "care instructions"). Informational only.';
comment on column public.staging_extracted_text.source_files is
  'Names of the uploaded files this text was extracted from. Kept as an array to support merged multi-file extractions.';
comment on column public.staging_extracted_text.duplicate_of is
  'When the review flow detects an existing knowledge_base entry as a duplicate/target for merge/replace, this points to public.knowledge_base(id). FK is attached only when knowledge_base.id is uuid-compatible.';

COMMIT;
