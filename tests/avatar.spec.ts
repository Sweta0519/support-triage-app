import { randomUUID } from "node:crypto";

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

import { login, requireEnv } from "./helpers";

// SUP-23: profile pictures. Uses customer B (nothing else in the suite
// looks at B's sidebar) and puts B back to no picture afterwards.

const BUCKET = "ticketing-avatars";

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

async function signedIn(email: string, password: string) {
  const db = client();
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  return { db, id: data.user!.id };
}

// A large photo-like JPEG carrying EXIF, as a phone would send.
async function photo(): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 800, channels: 3, background: "#3366cc" } })
    .jpeg()
    .withExif({ IFD0: { Copyright: "exif probe" } })
    .toBuffer();
}

async function upload(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.getByLabel("Profile picture").setInputFiles(file);
  await page.getByRole("button", { name: "Upload picture" }).click();
}

const sidebarPicture = (page: Page) => page.getByRole("complementary").locator('img[src^="/avatar/"]');

test.describe("profile pictures", () => {
  test.describe.configure({ mode: "serial" });

  test("upload, replace and remove; the stored picture is a small WebP without EXIF", async ({ browser }) => {
    const email = requireEnv("TEST_USER_B_EMAIL");
    const password = requireEnv("TEST_USER_B_PASSWORD");
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, email, password);
      await page.goto("/account");
      // No picture yet: the initials fallback, no <img>.
      await expect(sidebarPicture(page)).toHaveCount(0);

      await upload(page, { name: "me.jpg", mimeType: "image/jpeg", buffer: await photo() });
      await expect(page.getByRole("status").filter({ hasText: "Picture updated." })).toBeVisible();
      const first = await sidebarPicture(page).getAttribute("src");
      expect(first).toMatch(/^\/avatar\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);

      const res = await page.request.get(first!);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("image/webp");
      const meta = await sharp(await res.body()).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["webp", 256, 256]);
      expect(meta.exif).toBeUndefined();

      // Replacing gets a new name and deletes the old object.
      await upload(page, { name: "me.png", mimeType: "image/png", buffer: await sharp(await photo()).png().toBuffer() });
      await expect(sidebarPicture(page)).not.toHaveAttribute("src", first!);
      const second = await sidebarPicture(page).getAttribute("src");
      expect((await page.request.get(first!)).status()).toBe(404);

      // Not an image we accept: refused, picture unchanged.
      await upload(page, {
        name: "evil.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      });
      await expect(page.getByRole("status").filter({ hasText: "Use a JPEG, PNG or WebP picture." })).toBeVisible();
      await upload(page, { name: "fake.png", mimeType: "image/png", buffer: Buffer.from("not really a png") });
      await expect(page.getByRole("status").filter({ hasText: "Use a JPEG, PNG or WebP picture." })).toBeVisible();
      await expect(sidebarPicture(page)).toHaveAttribute("src", second!);

      await page.getByRole("button", { name: "Remove picture" }).click();
      await expect(sidebarPicture(page)).toHaveCount(0);
      expect((await page.request.get(second!)).status()).toBe(404);
    } finally {
      const { db } = await signedIn(email, password);
      const { data: old } = await db.rpc("set_own_avatar", { p_path: null });
      if (typeof old === "string") await db.storage.from(BUCKET).remove([old]);
      await context.close();
    }
  });

  test("nobody can write, point at or delete another user's picture", async ({ browser }) => {
    const b = await signedIn(requireEnv("TEST_USER_B_EMAIL"), requireEnv("TEST_USER_B_PASSWORD"));
    const a = await signedIn(requireEnv("TEST_USER_EMAIL"), requireEnv("TEST_USER_PASSWORD"));
    const webp = await sharp(await photo()).resize(256, 256).webp().toBuffer();

    // B uploads a picture of their own (directly, under the same policies).
    const bPath = `${b.id}/${randomUUID()}.webp`;
    expect((await b.db.storage.from(BUCKET).upload(bPath, webp, { contentType: "image/webp" })).error).toBeNull();
    try {
      // A can't write into B's folder, or overwrite B's picture...
      const intoB = await a.db.storage.from(BUCKET).upload(`${b.id}/${randomUUID()}.webp`, webp, { contentType: "image/webp" });
      expect(intoB.error).not.toBeNull();
      const overwrite = await a.db.storage.from(BUCKET).upload(bPath, webp, { contentType: "image/webp", upsert: true });
      expect(overwrite.error).not.toBeNull();
      // ...can't point their own profile at it...
      const { error: pointError } = await a.db.rpc("set_own_avatar", { p_path: bPath });
      expect(pointError?.code).toBe("22023");
      // ...and can't delete it (the policy filters it out: nothing removed).
      const { data: removed } = await a.db.storage.from(BUCKET).remove([bPath]);
      expect(removed ?? []).toHaveLength(0);
      expect((await b.db.storage.from(BUCKET).download(bPath)).error).toBeNull();

      // A path in your own folder that was never uploaded is refused too.
      const { error: ghost } = await a.db.rpc("set_own_avatar", { p_path: `${a.id}/${randomUUID()}.webp` });
      expect(ghost?.code).toBe("22023");

      // Signed out, the picture route serves nothing.
      // An empty storageState: newContext() would otherwise inherit the
      // project's signed-in customer A.
      const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const res = await anon.request.get(`/avatar/${bPath.replace(/\.webp$/, "")}`, { maxRedirects: 0 });
      expect(res.status()).not.toBe(200);
      await anon.close();
    } finally {
      await b.db.storage.from(BUCKET).remove([bPath]);
    }
  });

  test("deleting the account removes its pictures", async ({ browser }) => {
    test.setTimeout(90_000);
    const admin = service();
    const email = `sup23-delete-probe-${Date.now()}@example.com`;
    const password = `Pw-${randomUUID()}`;
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(error).toBeNull();
    const userId = created.user!.id;

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, email, password);
      await page.goto("/account");
      await upload(page, { name: "me.jpg", mimeType: "image/jpeg", buffer: await photo() });
      await expect(sidebarPicture(page)).toHaveCount(1);
      const { data: before } = await admin.storage.from(BUCKET).list(userId);
      expect(before).toHaveLength(1);

      await page.getByLabel(/to confirm/).fill(email);
      await page.getByRole("button", { name: "Delete my account" }).click();
      await expect(page).toHaveURL(/\/login\?deleted=1$/);

      const { data: after } = await admin.storage.from(BUCKET).list(userId);
      expect(after).toHaveLength(0);
    } finally {
      await context.close();
      // If the test failed before the UI deletion, clean up here.
      const { data: left } = await admin.storage.from(BUCKET).list(userId);
      if (left?.length) await admin.storage.from(BUCKET).remove(left.map((o) => `${userId}/${o.name}`));
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
  });
});
