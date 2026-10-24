-- SUP-79: this Supabase project now belongs to Support Triage alone. The
-- notes-collections app that used to own the public schema is retired, so
-- its four tables go. Nothing in ticketing or robomart references them.
--
-- A JSON backup of the rows, columns, constraints, indexes and policies was
-- taken first (2026-10-24, kept outside the repo). No CASCADE: if anything
-- does depend on these tables, the drop fails instead of taking it along.
-- IF EXISTS keeps a from-scratch rebuild of the schema working, where these
-- tables were never created.

drop table if exists public.note_tags;
drop table if exists public.notes;
drop table if exists public.tags;
drop table if exists public.collections;
