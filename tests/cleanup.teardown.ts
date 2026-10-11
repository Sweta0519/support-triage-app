import { test as teardown } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Runs once after the whole suite (the `setup` project's teardown). The
// tests run against the shared live Supabase project and most of them file
// tickets they never delete; left alone these pile up in the real queue
// and analytics. Every probe ticket's subject ends in a Date.now()
// timestamp ("Agent queue probe 1791736112167"), so that exact shape -- a
// space and 13 digits at the very end -- is the marker, and only the test
// customer accounts are touched. A hand-written subject that merely
// contains a long number ("Order 1234567890 never arrived") is kept.
// Comments, events, triage runs, embeddings and shares cascade.
//
// KEEP_TEST_TICKETS=1 skips the cleanup, e.g. to inspect a failed run.
const PROBE_SUBJECT = / \d{13}$/;

teardown("delete tickets created by this test run", async () => {
  if (process.env.KEEP_TEST_TICKETS === "1") {
    console.log("KEEP_TEST_TICKETS=1 -- leaving test tickets in place");
    return;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn("SUPABASE_SERVICE_ROLE_KEY not set -- skipping test-ticket cleanup");
    return;
  }
  const db = createClient(url, key, {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const emails = [process.env.TEST_USER_EMAIL, process.env.TEST_USER_B_EMAIL].filter(
    (e): e is string => Boolean(e)
  );
  // Only customer accounts: if a test email were ever pointed at a staff
  // account, its tickets are left alone.
  const { data: customers, error } = await db
    .from("profiles")
    .select("id")
    .in("email", emails)
    .eq("role", "customer");
  if (error) throw new Error(error.message);
  if (!customers?.length) return;

  // Paged: PostgREST caps a single response at 1,000 rows.
  const probes: { id: string; subject: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: listError } = await db
      .from("tickets")
      .select("id, subject")
      .in(
        "customer_id",
        customers.map((c) => c.id)
      )
      .order("created_at")
      .range(from, from + 999);
    if (listError) throw new Error(listError.message);
    probes.push(...(data ?? []).filter((t) => PROBE_SUBJECT.test(t.subject)));
    if (!data || data.length < 1000) break;
  }

  for (let i = 0; i < probes.length; i += 100) {
    const { error: deleteError } = await db
      .from("tickets")
      .delete()
      .in(
        "id",
        probes.slice(i, i + 100).map((t) => t.id)
      );
    if (deleteError) throw new Error(deleteError.message);
  }
  console.log(
    `Deleted ${probes.length} test ticket(s)` +
      (probes.length ? `: ${probes.slice(0, 5).map((t) => t.subject).join(", ")}${probes.length > 5 ? ", ..." : ""}` : "")
  );
});
