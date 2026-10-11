import "server-only";

import { randomUUID } from "node:crypto";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import { AVATAR_BUCKET } from "@/app/lib/avatars";
import { createServiceSupabaseClient } from "@/app/lib/supabase/service";

// Profile pictures (SUP-23). The bucket has no client policies: only this
// module touches it, with the service role -- uploads after
// app/lib/avatar-image.ts has re-encoded the picture, deletes of pictures
// a profile no longer points at, and reads for the /avatar route. Object
// paths always come from the verified session or from set_own_avatar()'s
// return value, never from the request. The profile's pointer changes
// only through set_own_avatar(), as the signed-in user.

function bucket() {
  return createServiceSupabaseClient().storage.from(AVATAR_BUCKET);
}

// Only for /avatar/<owner>/<file>, whose caller has a ticketing profile.
// The listing reads Storage's own metadata, not its CDN: a removed or
// replaced picture can still be served from the CDN cache for a while, so
// without this check the route would keep serving it. (Browsers that
// already have it keep it for the route's short max-age.)
export async function downloadAvatar(owner: string, file: string): Promise<ArrayBuffer | null> {
  const { data: listed, error: listError } = await bucket().list(owner, { search: file, limit: 1 });
  if (listError) {
    throw new Error(listError.message);
  }
  if (!listed.some((o) => o.name === file)) {
    return null;
  }
  const { data, error } = await bucket().download(`${owner}/${file}`);
  if (error) {
    throw new Error(error.message);
  }
  return data.arrayBuffer();
}

// Stores an already re-encoded WebP as the caller's picture and deletes the
// previous one. Upload first, then point the profile at it. userId must
// come from the verified session (requireProfile), never from the request.
export async function replaceOwnAvatar(userId: string, webp: Buffer): Promise<void> {
  const path = `${userId}/${randomUUID()}.webp`;
  const { error: uploadError } = await bucket().upload(path, webp, { contentType: "image/webp", upsert: false });
  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const supabase = await createServerSupabaseClient();
  const { data: oldPath, error } = await supabase.rpc("set_own_avatar", { p_path: path });
  if (error) {
    // The call may have committed with only the response lost: delete the
    // new object only if the profile doesn't point at it.
    const { data: profile } = await supabase.from("profiles").select("avatar_path").eq("id", userId).maybeSingle();
    if (profile?.avatar_path !== path) {
      await removeObject(path);
    }
    throw new Error(error.message);
  }
  await removeObject(oldPath);
}

export async function removeOwnAvatar(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { data: oldPath, error } = await supabase.rpc("set_own_avatar", { p_path: null });
  if (error) {
    throw new Error(error.message);
  }
  await removeObject(oldPath);
}

// Best effort: the profile no longer points at it either way, and a stray
// object is only readable by signed-in users who know its random name.
// A failure is logged rather than failing the user's change.
async function removeObject(path: unknown): Promise<void> {
  if (typeof path !== "string") return;
  const { error } = await bucket().remove([path]);
  if (error) {
    console.error(`Couldn't delete old profile picture ${path}: ${error.message}`);
  }
}
