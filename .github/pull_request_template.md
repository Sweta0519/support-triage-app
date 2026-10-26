## What and why

<!-- What changes, and why. Link the Linear issue (SUP-…). -->

Linear: SUP-

## Checklist (every PR)

- [ ] One feature on its own branch; the commit messages say what changed and why.
- [ ] **Migrations:** each schema change is a new file in `supabase/migrations/`, applied with
      `supabase db push`. Already-applied migrations aren't edited. (Or: no schema change.)
- [ ] **RLS reviewed:** new tables have RLS enabled and owner- or role-scoped policies; grants are
      as narrow as the feature needs; policies on tables with `workspace_id` check the caller's
      workspace; `workspace_members.role` changes only through `admin_set_role()`.
      (Or: no data-access change.)
- [ ] **Server-side rules held (CLAUDE.md):**
  - mutations go through Server Actions, and DB access through `app/lib/db/`;
  - the service-role key stays in `app/lib/supabase/service.ts`, and LLM and embedding calls stay
    server-side;
  - roles come from `requireRole`/`requireStaff`/`requireAdmin`, never a JWT claim, and profile
    reads call `ensure_profile()` first;
  - assignment uses the conditional `UPDATE ... WHERE assignee_id IS NULL`;
  - AI output stays advisory and treats ticket text as untrusted;
  - the pinned models and `vector(1536)` are unchanged;
  - no new npm packages without asking.
- [ ] **Tests:** new or changed behaviour has a Playwright test. The full suite passed before the
      commit (paste the summary line). Any unrelated failure is named and was rerun. (Or: docs or
      config only, so no behaviour changed; say so.) GitHub doesn't run the suite: this is on
      the author.
- [ ] **Reviews:** `/code-review --comment <PR>` and the `ai-code-reviewer` subagent ran on the
      diff. Every finding is an inline comment with a reply ("Fixed in `<sha>`", or why not), and
      every thread is resolved. GitHub blocks the merge until the threads are resolved.
- [ ] **Vercel preview** built and passed.

## UI changes (a redesign is an engineering change, not only a visual one)

<!-- Delete this section if the PR has no UI change. -->

- [ ] **State handling:** loading, empty, error and pending states all behave. Optimistic updates
      settle to the server's answer, and nothing gets stuck after a failed request.
- [ ] **Accessibility:**
  - every control works with the keyboard alone;
  - focus is visible, is moved on open and is returned on close;
  - roles and ARIA attributes are valid, and accessible names include the visible text;
  - meaning isn't carried by colour alone.
- [ ] **Regressions:** existing flows on the changed pages still work: queue, board, ticket page,
      Sage, and customer views. Tests that depended on the old markup were updated, not deleted.
- [ ] **Evidence:** screenshots of the changed views (light and dark if both changed), plus the
      tests that cover the new behaviour.
- [ ] **Visual review:** follows the calm, Linear-style UI (`app/components/CardBits.tsx`):
      neutral text, colour only in dots and icons, few labels.
