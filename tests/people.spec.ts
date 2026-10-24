import { randomUUID } from "node:crypto";

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { login, requireEnv } from "./helpers";

// SUP-24: names and pictures via ticketing.profile_cards (docs/profile-cards.md).
// Runs in its own "people" project after the main suite and the settings
// tests: it gives the agent a display name, which other tests (expecting
// the agent's email) and the settings tests (resetting it) would trip on.

function client() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function service() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signedIn(email: string, password: string): Promise<{ db: ReturnType<typeof client>; id: string }> {
  const db = client();
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  // ensure_profile: a fresh auth user has no ticketing profile yet.
  expect((await db.rpc("ensure_profile")).error).toBeNull();
  return { db, id: data.user!.id };
}

const NO_PREFS = { p_theme: "system", p_queue_default_filter: null, p_queue_default_sort: null };

test.describe("names and pictures (profile_cards)", () => {
  test.describe.configure({ mode: "serial" });

  test("cards follow ticket visibility and never carry email or role", async () => {
    test.setTimeout(90_000);
    const admin = service();
    const email = `sup24-probe-${Date.now()}@example.com`;
    const password = `Pw-${randomUUID()}`;
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(error).toBeNull();
    const customerId = created.user!.id;
    let staffId: string | undefined;

    try {
      const customer = await signedIn(email, password);
      const agent = await signedIn(requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
      const otherCustomer = await signedIn(requireEnv("TEST_USER_EMAIL"), requireEnv("TEST_USER_PASSWORD"));
      const { data: adminProfile } = await admin.from("profiles").select("id").eq("email", requireEnv("TEST_ADMIN_EMAIL")).single();

      expect((await customer.db.rpc("update_own_profile", { ...NO_PREFS, p_full_name: "Probe Customer" })).error).toBeNull();

      // Exactly five columns: no email, no role.
      const { data: own } = await customer.db.from("profile_cards").select("*").eq("id", customerId).single();
      expect(Object.keys(own!).sort()).toEqual(["avatar_path", "display_name", "id", "is_staff", "workspace_id"]);
      expect(own).toMatchObject({ display_name: "Probe Customer", is_staff: false });

      // A ticket assigned to the admin: the agent can't see it, so can't see
      // the customer's card either.
      const { data: ticket, error: ticketError } = await admin
        .from("tickets")
        .insert({ customer_id: customerId, subject: `Cards probe ${Date.now()}`, body: "Probe body", assignee_id: adminProfile!.id, status: "assigned" })
        .select("id")
        .single();
      expect(ticketError).toBeNull();
      const agentSees = async () =>
        (await agent.db.from("profile_cards").select("id, display_name").eq("id", customerId)).data ?? [];
      expect(await agentSees()).toHaveLength(0);

      // The customer sees the admin (assigned to their ticket)...
      const { data: staffOnTicket } = await customer.db.from("profile_cards").select("id, is_staff").eq("id", adminProfile!.id);
      expect(staffOnTicket).toEqual([{ id: adminProfile!.id, is_staff: true }]);
      // ...but not the agent, who has nothing to do with it.
      const { data: unrelated } = await customer.db.from("profile_cards").select("id").eq("id", agent.id);
      expect(unrelated).toHaveLength(0);
      // Another customer never sees this customer's card.
      expect((await otherCustomer.db.from("profile_cards").select("id").eq("id", customerId)).data).toHaveLength(0);

      // Unassigned, the ticket is in the agent's queue: now the name shows...
      expect((await admin.from("tickets").update({ assignee_id: null, status: "triaged" }).eq("id", ticket!.id)).error).toBeNull();
      expect(await agentSees()).toEqual([{ id: customerId, display_name: "Probe Customer" }]);
      // ...but the profile row (email) and the membership (role) stay out of reach.
      expect((await agent.db.from("profiles").select("email").eq("id", customerId)).data).toHaveLength(0);
      expect((await agent.db.from("workspace_members").select("role").eq("user_id", customerId)).data).toHaveLength(0);

      // A ticket the agent filed for the customer: the customer still can't
      // read the filer's card (the page says "our support team").
      const { error: filedError } = await admin
        .from("tickets")
        .insert({ customer_id: customerId, subject: `Filed probe ${Date.now()}`, body: "Probe body", created_by: agent.id });
      expect(filedError).toBeNull();
      expect((await customer.db.from("profile_cards").select("id").eq("id", agent.id)).data).toHaveLength(0);

      // A colleague who commented and was later demoted keeps their name for
      // staff on that ticket.
      const staffEmail = `sup24-staff-probe-${Date.now()}@example.com`;
      const staffPassword = `Pw-${randomUUID()}`;
      const { data: staffUser } = await admin.auth.admin.createUser({ email: staffEmail, password: staffPassword, email_confirm: true });
      staffId = staffUser.user!.id;
      const colleague = await signedIn(staffEmail, staffPassword);
      const adminSession = await signedIn(requireEnv("TEST_ADMIN_EMAIL"), requireEnv("TEST_ADMIN_PASSWORD"));
      expect((await adminSession.db.rpc("admin_set_role", { target_user_id: staffId, new_role: "agent" })).error).toBeNull();
      expect((await colleague.db.rpc("update_own_profile", { ...NO_PREFS, p_full_name: "Former Colleague" })).error).toBeNull();
      expect(
        (await colleague.db.from("ticket_comments").insert({ ticket_id: ticket!.id, author_id: staffId, body: "Internal look", is_internal: true })).error
      ).toBeNull();
      expect((await adminSession.db.rpc("admin_set_role", { target_user_id: staffId, new_role: "customer" })).error).toBeNull();
      const { data: demoted } = await agent.db.from("profile_cards").select("display_name").eq("id", staffId);
      expect(demoted).toEqual([{ display_name: "Former Colleague" }]);
    } finally {
      await admin.from("tickets").delete().eq("customer_id", customerId);
      await admin.auth.admin.deleteUser(customerId);
      if (staffId) await admin.auth.admin.deleteUser(staffId);
    }
  });

  test("the ticket page shows people by name", async ({ browser }) => {
    test.setTimeout(90_000);
    const admin = service();
    const agentEmail = requireEnv("TEST_AGENT_EMAIL");
    const agentPassword = requireEnv("TEST_AGENT_PASSWORD");
    const email = `sup24-page-probe-${Date.now()}@example.com`;
    const password = `Pw-${randomUUID()}`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(createError).toBeNull();
    const customerId = created.user!.id;
    let agent: Awaited<ReturnType<typeof signedIn>> | undefined;
    let agentBefore: { full_name: string | null; theme: string } | null = null;

    try {
      agent = await signedIn(agentEmail, agentPassword);
      // Put the agent's own settings back afterwards, not blank them.
      agentBefore = (await agent.db.from("profiles").select("full_name, theme").eq("id", agent.id).single()).data;
      const customer = await signedIn(email, password);
      expect((await customer.db.rpc("update_own_profile", { ...NO_PREFS, p_full_name: "Dana Customer" })).error).toBeNull();
      expect((await agent.db.rpc("update_own_profile", { ...NO_PREFS, p_full_name: "Priya Agent" })).error).toBeNull();

      const { data: ticket } = await admin
        .from("tickets")
        .insert({ customer_id: customerId, subject: `Names probe ${Date.now()}`, body: "Probe body", assignee_id: agent.id, status: "assigned" })
        .select("id")
        .single();
      expect((await agent.db.from("ticket_comments").insert({ ticket_id: ticket!.id, author_id: agent.id, body: "Looking into it." })).error).toBeNull();
      expect((await customer.db.from("ticket_comments").insert({ ticket_id: ticket!.id, author_id: customerId, body: "Thanks!" })).error).toBeNull();

      // The agent sees the customer by name, never their email.
      const agentContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const agentPage = await agentContext.newPage();
      await login(agentPage, agentEmail, agentPassword);
      await agentPage.goto(`/tickets/${ticket!.id}`);
      // Marked as the customer: a customer picks their own name.
      await expect(agentPage.getByText("Dana Customer (Customer)")).toBeVisible();
      await expect(agentPage.getByText(email)).toHaveCount(0);
      await agentContext.close();

      // The customer sees the agent as "<name> (Support)".
      const customerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const customerPage = await customerContext.newPage();
      await login(customerPage, email, password);
      await customerPage.goto(`/tickets/${ticket!.id}`);
      await expect(customerPage.getByText("Priya Agent (Support)")).toBeVisible();
      await expect(customerPage.getByText(agentEmail)).toHaveCount(0);
      await customerContext.close();
    } finally {
      if (agent && agentBefore) {
        await agent.db.rpc("update_own_profile", {
          ...NO_PREFS,
          p_full_name: agentBefore.full_name ?? "",
          p_theme: agentBefore.theme,
        });
      }
      await admin.from("tickets").delete().eq("customer_id", customerId);
      await admin.auth.admin.deleteUser(customerId);
    }
  });
});
