import "server-only";

import { createClient } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import { AVATAR_BUCKET } from "@/app/lib/avatars";
import { createServiceSupabaseClient } from "@/app/lib/supabase/service";

// GDPR Art. 15/20: everything the caller can see about themselves, in one
// RLS-scoped call. The shape is assembled in ticketing.export_own_data()
// (SECURITY INVOKER, every branch pinned to auth.uid()), so a customer's
// export can never contain internal comments, triage output, or another
// user's rows -- RLS decides, not this module.
export async function exportOwnData(): Promise<unknown> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("export_own_data");
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export class LastAdminError extends Error {
  constructor() {
    super("The only admin cannot delete their account. Promote another admin first.");
    this.name = "LastAdminError";
  }
}

// GDPR Art. 17: a real deletion, not a flag. Removing the auth.users row
// cascades through profiles, tickets, comments, notes, documents and
// assistant chats (see supabase/migrations/20260915000000_*); profile
// pictures in Storage are removed afterwards. Only the
// service role may call auth.admin.deleteUser(), so this is one of the few
// permitted importers of the service client -- and the caller must already
// have proven `userId` is the signed-in user (app/(app)/account/actions.ts
// takes it from requireProfile(), never from the form).
export async function deleteOwnAccount(userId: string): Promise<void> {
  const service = createServiceSupabaseClient();
  const { error } = await service.auth.admin.deleteUser(userId);
  if (error) {
    // Raised by the profiles_guard_last_admin_delete trigger inside the
    // cascade; the whole deletion is rolled back.
    if (error.message.includes("last_admin")) {
      throw new LastAdminError();
    }
    throw new Error(error.message);
  }

  // Storage objects don't cascade from auth.users, so the profile pictures
  // in the user's folder go explicitly -- after the deletion went through,
  // so a refused deletion (last admin) keeps them. Best effort: the account
  // is already gone, so a Storage error is logged, not shown to the user.
  try {
    const folder = service.storage.from(AVATAR_BUCKET);
    const { data: objects, error: listError } = await folder.list(userId, { limit: 1000 });
    if (listError) throw listError;
    if (objects.length > 0) {
      const { error: removeError } = await folder.remove(objects.map((o) => `${userId}/${o.name}`));
      if (removeError) throw removeError;
    }
  } catch (err) {
    console.error(`Couldn't remove profile pictures of deleted user ${userId}:`, err);
  }
}

// Re-authentication before a destructive action (SUP-14): checks the
// password against Supabase Auth with a throwaway client that keeps no
// session, so the caller's own sign-in (cookies) is never touched. The
// email must be the verified session's, never one from the form.
// "ok" | "wrong" (the password didn't match) | throws on anything else.
export async function verifyOwnPassword(email: string, password: string): Promise<"ok" | "wrong"> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase is not configured");
  }
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (!error) {
    // Drop the extra session it just created (local only: the user's real
    // session is a different one).
    await client.auth.signOut({ scope: "local" });
    return "ok";
  }
  if (error.code === "invalid_credentials") {
    return "wrong";
  }
  throw new Error(error.message);
}
