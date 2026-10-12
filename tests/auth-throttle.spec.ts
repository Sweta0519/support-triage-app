import { createHmac, randomUUID } from "node:crypto";

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { login, requireEnv } from "./helpers";

// SUP-13: sign-in / sign-up throttling (consume_auth_rate_limit). Each test
// uses its own made-up IPs and emails, so buckets never collide with other
// tests or runs.

test.use({ storageState: { cookies: [], origins: [] } });

function service() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// The same keyed hash app/lib/db/auth-rate-limit.ts sends.
const emailKey = (email: string) =>
  createHmac("sha256", requireEnv("SUPABASE_SERVICE_ROLE_KEY")).update(email.trim().toLowerCase()).digest("hex");

// Not IPv6 (no colon), so the server uses it as is.
const fakeIp = () => `203.0.113.${Math.floor(Math.random() * 250) + 1}-${randomUUID().slice(0, 8)}`;

function rpc(action: string, ip: string | null, email: string) {
  return service().rpc("consume_auth_rate_limit", { p_action: action, p_ip: ip, p_email_key: emailKey(email) });
}

test("wrong passwords lock that email out from that IP only, even with the right password", async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = service();
  const email = `sup13-probe-${Date.now()}@example.com`;
  const password = `Pw-${randomUUID()}`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(error).toBeNull();

  const attackerIp = fakeIp();
  const asIp = (ip: string) =>
    browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  const signIn = async (page: import("@playwright/test").Page, pw: string) => {
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill(pw);
    await page.getByRole("button", { name: "Sign in" }).click();
  };

  const attacker = await asIp(attackerIp);
  const victim = await asIp(fakeIp());
  try {
    const page = await attacker.newPage();
    await page.goto("/login");

    // A wrong password through the real form counts...
    await signIn(page, "wrong-password");
    await expect(page.getByText(/Invalid login credentials/i)).toBeVisible();
    // ...and nine more from the same IP (recorded the way the server does --
    // ten real failed sign-ins in a row also trip Supabase Auth's own limit,
    // which isn't what's under test).
    for (let i = 0; i < 9; i++) {
      expect((await rpc("sign_in", attackerIp, email)).data).toBe(true);
    }

    // From that IP, even the right password is now refused.
    await signIn(page, password);
    await expect(page.getByText("Too many attempts. Please wait a few minutes and try again.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    // The account's owner, elsewhere, still gets in: a stranger failing on
    // purpose can't lock someone else out.
    const victimPage = await victim.newPage();
    await victimPage.goto("/login");
    await signIn(victimPage, password);
    await expect(victimPage.getByRole("button", { name: "Sign out" })).toBeVisible();

    // And another account from the attacker's IP is unaffected.
    await login(page, requireEnv("TEST_USER_EMAIL"), requireEnv("TEST_USER_PASSWORD"));
  } finally {
    await attacker.close();
    await victim.close();
    await admin.auth.admin.deleteUser(created.user!.id);
  }
});

test("the limiter's counts: parallel guesses, per IP, per email, sign-up, refunds", async () => {
  // Parallel guesses can't slip past the email+IP lock: each is counted
  // before the password is checked.
  const ip = fakeIp();
  const target = `parallel-${Date.now()}@example.com`;
  const burst = await Promise.all(Array.from({ length: 15 }, () => rpc("sign_in", ip, target)));
  expect(burst.filter((r) => r.data === true)).toHaveLength(10);

  // 20 wrong passwords per IP per window, whatever the email; a sign-in
  // that wasn't a wrong password gives its attempt back.
  const busyIp = fakeIp();
  const perIp: boolean[] = [];
  for (let i = 0; i < 20; i++) perIp.push((await rpc("sign_in", busyIp, `ip-${i}-${Date.now()}@example.com`)).data);
  expect(perIp.every(Boolean)).toBe(true);
  expect((await rpc("sign_in", busyIp, `ip-over-${Date.now()}@example.com`)).data).toBe(false);
  await rpc("sign_in_succeeded", busyIp, `ip-0-refund@example.com`);
  expect((await rpc("sign_in", busyIp, `ip-after-refund-${Date.now()}@example.com`)).data).toBe(true);

  // 50 per email across many IPs, then refused from anywhere.
  const spread = `spread-${Date.now()}@example.com`;
  const fromMany = await Promise.all(Array.from({ length: 50 }, () => rpc("sign_in", fakeIp(), spread)));
  expect(fromMany.every((r) => r.data === true)).toBe(true);
  expect((await rpc("sign_in", fakeIp(), spread)).data).toBe(false);

  // Sign-up: 3 per email per hour; a refused sign-up (no email sent) gives
  // its quota back.
  const newcomer = `signup-${Date.now()}@example.com`;
  const signups: boolean[] = [];
  for (let i = 0; i < 4; i++) signups.push((await rpc("sign_up", fakeIp(), newcomer)).data);
  expect(signups).toEqual([true, true, true, false]);
  await rpc("sign_up_failed", null, newcomer);
  expect((await rpc("sign_up", fakeIp(), newcomer)).data).toBe(true);

  // Sign-up: 5 per IP per hour; a sign-up refused by the IP limit doesn't
  // use up the email's quota.
  const signupIp = fakeIp();
  for (let i = 0; i < 5; i++) expect((await rpc("sign_up", signupIp, `su-ip-${i}-${Date.now()}@example.com`)).data).toBe(true);
  const spared = `spared-${Date.now()}@example.com`;
  expect((await rpc("sign_up", signupIp, spared)).data).toBe(false);
  for (let i = 0; i < 3; i++) expect((await rpc("sign_up", fakeIp(), spared)).data).toBe(true);

  // Neither signed-out nor signed-in clients may call it: they could fill
  // someone else's IP bucket.
  const anon = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const args = { p_action: "sign_in", p_ip: ip, p_email_key: emailKey(target) };
  expect((await anon.rpc("consume_auth_rate_limit", args)).error).not.toBeNull();
  await anon.auth.signInWithPassword({ email: requireEnv("TEST_USER_EMAIL"), password: requireEnv("TEST_USER_PASSWORD") });
  expect((await anon.rpc("consume_auth_rate_limit", args)).error).not.toBeNull();
});
