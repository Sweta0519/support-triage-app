import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { requireEnv } from "./helpers";

// The AI's assessment is staff-only. The UI never renders it for customers
// (ai-triage.spec.ts); this checks the database API too: a customer reading
// their *own* ticket's triage rows directly gets nothing back (SUP-34).

test.use({ storageState: { cookies: [], origins: [] } });

function service() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test("customers can't read AI triage for their own ticket through the database API", async () => {
  const db = service();
  const { data: customer } = await db.from("profiles").select("id").eq("email", requireEnv("TEST_USER_EMAIL")).single();
  const { data: ticket, error } = await db
    .from("tickets")
    .insert({ customer_id: customer!.id, subject: `Triage visibility probe ${Date.now()}`, body: "Visibility probe body" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  try {
    const { error: resultError } = await db.from("triage_results").insert({
      ticket_id: ticket.id,
      model: "test/model",
      prompt_version: "test",
      summary: "Internal assessment the customer must not see",
      priority: "high",
      priority_reason: "Internal reasoning",
      is_escalation_risk: true,
    });
    expect(resultError).toBeNull();
    // The service role sees both rows, so an empty answer below is RLS, not a missing row.
    expect((await db.from("triage_results").select("id").eq("ticket_id", ticket.id)).data).toHaveLength(1);
    expect((await db.from("ticket_triage_state").select("ticket_id").eq("ticket_id", ticket.id)).data).toHaveLength(1);

    const asCustomer = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
      db: { schema: "ticketing" },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await asCustomer.auth.signInWithPassword({
      email: requireEnv("TEST_USER_EMAIL"),
      password: requireEnv("TEST_USER_PASSWORD"),
    });
    expect(signInError).toBeNull();
    // Their own ticket is readable...
    expect((await asCustomer.from("tickets").select("id").eq("id", ticket.id)).data).toHaveLength(1);
    // ...its AI assessment and working triage state are not.
    expect((await asCustomer.from("triage_results").select("id, summary").eq("ticket_id", ticket.id)).data ?? []).toEqual([]);
    expect((await asCustomer.from("ticket_triage_state").select("ticket_id, priority").eq("ticket_id", ticket.id)).data ?? []).toEqual([]);
    // Nor through the ticket read the customer pages use (the embed comes back null).
    const { data: embedded } = await asCustomer
      .from("tickets")
      .select("id, triage_state:ticket_triage_state(priority)")
      .eq("id", ticket.id)
      .single();
    expect(embedded?.triage_state ?? null).toBeNull();
  } finally {
    await db.from("tickets").delete().eq("id", ticket.id);
  }
});
