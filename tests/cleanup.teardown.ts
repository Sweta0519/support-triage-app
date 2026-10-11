import { test as teardown } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Runs once after the whole suite (the `setup` project's teardown). The
// tests run against the shared live Supabase project and most of them file
// tickets they never delete; left alone these pile up in the real queue
// and analytics. Every probe ticket carries a Date.now() timestamp in its
// subject ("Agent queue probe 1791736112167"), so that's the marker:
// only the test customers' tickets whose subject has a 10+ digit number
// are removed. Hand-written demo tickets don't have one and are kept.
// Comments, events, triage runs, embeddings and shares cascade.
teardown("delete tickets created by this test run", async () => {
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
  const { data: customers, error } = await db.from("profiles").select("id").in("email", emails);
  if (error) throw new Error(error.message);
  if (!customers?.length) return;

  const { data: tickets, error: listError } = await db
    .from("tickets")
    .select("id, subject")
    .in(
      "customer_id",
      customers.map((c) => c.id)
    );
  if (listError) throw new Error(listError.message);

  const probeIds = (tickets ?? []).filter((t) => /\d{10,}/.test(t.subject)).map((t) => t.id);
  for (let i = 0; i < probeIds.length; i += 100) {
    const { error: deleteError } = await db.from("tickets").delete().in("id", probeIds.slice(i, i + 100));
    if (deleteError) throw new Error(deleteError.message);
  }
});
