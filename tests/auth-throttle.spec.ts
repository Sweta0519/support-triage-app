import { createHash, randomUUID } from "node:crypto";

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { login, requireEnv } from "./helpers";

// SUP-13: sign-in / sign-up throttling (consume_auth_rate_limit). Each test
// uses its own made-up IP and email, so buckets never collide with other
// tests or runs.

test.use({ storageState: { cookies: [], origins: [] } });

function service() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const fakeIp = () => `203.0.113.${Math.floor(Math.random() * 250) + 1}-${randomUUID().slice(0, 8)}`;

test("failed sign-ins lock that email out for a while, even with the right password", async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = service();
  const email = `sup13-probe-${Date.now()}@example.com`;
  const password = `Pw-${randomUUID()}`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(error).toBeNull();

  const emailKey = `sign_in_failed:${createHash("md5").update(email.toLowerCase()).digest("hex")}`;
  const failures = async () => {
    const { data } = await admin.from("rate_limits").select("count").eq("key", emailKey);
    return (data ?? []).reduce((sum, row) => sum + (row.count as number), 0);
  };

  // A made-up client IP of its own, so the per-IP limit stays out of it.
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { "x-forwarded-for": fakeIp() },
  });
  const page = await context.newPage();
  const signIn = async (pw: string) => {
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill(pw);
    await page.getByRole("button", { name: "Sign in" }).click();
  };
  try {
    await page.goto("/login");

    // A wrong password through the real form is recorded against the email.
    await signIn("wrong-password");
    await expect(page.getByText(/Invalid login credentials/i)).toBeVisible();
    await expect.poll(failures).toBe(1);

    // Nine more failures (recorded the way the server records them --
    // making ten real failed sign-ins in a row also trips Supabase Auth's
    // own limit, which isn't what's under test here)...
    for (let i = 0; i < 9; i++) {
      const { error: recordError } = await admin.rpc("consume_auth_rate_limit", {
        p_action: "sign_in_failed",
        p_ip: null,
        p_email: email,
      });
      expect(recordError).toBeNull();
    }
    expect(await failures()).toBe(10);

    // ...and the right password is refused.
    await signIn(password);
    await expect(page.getByText("Too many attempts. Please wait a few minutes and try again.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    // Another account from the same browser is unaffected.
    await login(page, requireEnv("TEST_USER_EMAIL"), requireEnv("TEST_USER_PASSWORD"));
  } finally {
    await context.close();
    await admin.from("rate_limits").delete().eq("key", emailKey);
    await admin.auth.admin.deleteUser(created.user!.id);
  }
});

test("per-IP and sign-up limits, callable only by the server", async () => {
  const admin = service();
  const call = (action: string, ip: string, email: string) =>
    admin.rpc("consume_auth_rate_limit", { p_action: action, p_ip: ip, p_email: email });

  // Sign-in: 20 attempts per IP in the window, whatever the email.
  const ip = fakeIp();
  const results: boolean[] = [];
  for (let i = 0; i < 21; i++) {
    const { data, error } = await call("sign_in", ip, `ip-probe-${i}-${Date.now()}@example.com`);
    expect(error).toBeNull();
    results.push(data as boolean);
  }
  expect(results.slice(0, 20).every(Boolean)).toBe(true);
  expect(results[20]).toBe(false);

  // Sign-up: 3 per email per hour (each one sends a confirmation email).
  const email = `signup-probe-${Date.now()}@example.com`;
  const signups: boolean[] = [];
  for (let i = 0; i < 4; i++) {
    signups.push((await call("sign_up", fakeIp(), email)).data as boolean);
  }
  expect(signups).toEqual([true, true, true, false]);

  // Sign-up: 5 per IP per hour, whatever the email.
  const signupIp = fakeIp();
  const perIp: boolean[] = [];
  for (let i = 0; i < 6; i++) {
    perIp.push((await call("sign_up", signupIp, `signup-ip-${i}-${Date.now()}@example.com`)).data as boolean);
  }
  expect(perIp).toEqual([true, true, true, true, true, false]);

  // Neither signed-out nor signed-in clients may call it: they could fill
  // someone else's IP bucket.
  const anon = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anonCall = await anon.rpc("consume_auth_rate_limit", { p_action: "sign_in", p_ip: ip, p_email: email });
  expect(anonCall.error).not.toBeNull();
  await anon.auth.signInWithPassword({ email: requireEnv("TEST_USER_EMAIL"), password: requireEnv("TEST_USER_PASSWORD") });
  const userCall = await anon.rpc("consume_auth_rate_limit", { p_action: "sign_in", p_ip: ip, p_email: email });
  expect(userCall.error).not.toBeNull();
});
