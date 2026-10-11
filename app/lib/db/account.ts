import "server-only";

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
  // in the user's folder go explicitly -- only after the deletion went
  // through, so a refused deletion (last admin) keeps them.
  const folder = service.storage.from(AVATAR_BUCKET);
  const { data: objects, error: listError } = await folder.list(userId);
  if (listError) {
    throw new Error(listError.message);
  }
  if (objects.length > 0) {
    const { error: removeError } = await folder.remove(objects.map((o) => `${userId}/${o.name}`));
    if (removeError) {
      throw new Error(removeError.message);
    }
  }
}
