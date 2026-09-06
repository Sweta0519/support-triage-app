import { test as setup } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// The app rate-limits ticket creation to 10/hour per user (the limiter itself
// is verified separately against the live database -- see docs/supabase-
// schema.md). A full suite run creates ~5 tickets as customer A, so two runs
// inside an hour would trip the limit and fail unrelated tests. This resets
// only the test accounts' counters. Needs the service-role key because
// rate_limits is deny-all to users; that key lives in .env.local, never in
// the repo or CI config committed here.
setup("reset test users' rate-limit counters", async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn("SUPABASE_SERVICE_ROLE_KEY not set -- skipping rate-limit reset");
    return;
  }

  const emails = [
    process.env.TEST_USER_EMAIL,
    process.env.TEST_USER_B_EMAIL,
    process.env.TEST_AGENT_EMAIL,
    process.env.TEST_ADMIN_EMAIL,
  ].filter((e): e is string => Boolean(e));

  const db = createClient(url, key, {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profiles, error } = await db.from("profiles").select("id").in("email", emails);
  if (error) {
    throw new Error(error.message);
  }

  for (const profile of profiles ?? []) {
    const { error: deleteError } = await db
      .from("rate_limits")
      .delete()
      .like("key", `${profile.id}:%`);
    if (deleteError) {
      throw new Error(deleteError.message);
    }
  }
});

// The AI assistant chat keeps one long-lived conversation per staff member,
// so a prior run's messages would otherwise still be there on the next
// run -- and a model asked the same "remember X, now recall X" probe
// repeatedly starts recognizing the pattern and refusing on principle
// (a real safety behaviour, not a bug, but it makes the memory test flaky
// across repeated runs). Clearing it keeps that test deterministic; cascade
// delete on assistant_messages.conversation_id takes the messages with it.
setup("reset the AI assistant's test conversations and notes", async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn("SUPABASE_SERVICE_ROLE_KEY not set -- skipping assistant chat reset");
    return;
  }

  // Both staff test accounts talk to Sage: the agent in ai-chat.spec.ts and
  // notes-rag.spec.ts, the admin in the cross-user notes test.
  const staffEmails = [process.env.TEST_AGENT_EMAIL, process.env.TEST_ADMIN_EMAIL].filter(
    (e): e is string => Boolean(e)
  );
  if (staffEmails.length === 0) {
    return;
  }

  const db = createClient(url, key, {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profiles, error } = await db.from("profiles").select("id").in("email", staffEmails);
  if (error) {
    throw new Error(error.message);
  }
  const ids = (profiles ?? []).map((p) => p.id);
  if (ids.length === 0) {
    return;
  }

  const { error: deleteError } = await db
    .from("assistant_conversations")
    .delete()
    .in("owner_id", ids);
  if (deleteError) {
    throw new Error(deleteError.message);
  }

  // notes-rag.spec.ts saves notes as both staff accounts; left in place they
  // would pile up run over run (each save is a paid embedding call, and a
  // stale "Q3 launch" note from a previous run could satisfy the happy-path
  // search before the current run's note exists). Chunks cascade with the
  // notes (documents.note_id on delete cascade).
  const { error: notesError } = await db.from("notes").delete().in("owner_id", ids);
  if (notesError) {
    throw new Error(notesError.message);
  }
});
