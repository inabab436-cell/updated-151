-- =============================================================================
-- CUPAI — Align staging_* action CHECK constraints with the unified
-- STAGING_ACTIONS enum ('new', 'merge', 'update', 'skip').
--
-- Previously the CHECK on staging_policies / staging_shipping / staging_contacts
-- allowed ('new', 'replace', 'merge', 'skip'), which rejected the 'update'
-- value emitted by the AI and the application, causing silent INSERT failures
-- and lost data.
--
-- Safe to re-run.
-- =============================================================================

do $$
declare
  t text;
  c text;
begin
  foreach t in array array['staging_policies','staging_shipping','staging_contacts']
  loop
    for c in
      select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      where nsp.nspname = 'public'
        and rel.relname = t
        and con.contype = 'c'
        and pg_get_constraintdef(con.oid) ilike '%action%'
    loop
      execute format('alter table public.%I drop constraint %I', t, c);
    end loop;

    execute format(
      'alter table public.%I add constraint %I check (action in (''new'',''merge'',''update'',''skip''))',
      t, t || '_action_check'
    );
  end loop;
end $$;
