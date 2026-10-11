import "server-only";

import { randomUUID } from "node:crypto";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import { AVATAR_BUCKET } from "@/app/lib/avatars";

// Profile pictures (SUP-23). Uploads and deletes run as the signed-in user,
// so the storage policies (own folder only) apply; the profile's pointer
// changes only through ticketing.set_own_avatar().

// path is "<owner>/<file>.webp". The listing reads Storage's own metadata,
// not its CDN: a removed or replaced picture can still be served from the
// CDN cache for a while, so without this check it would outlive its
// deletion.
export async function downloadAvatar(owner: string, file: string): Promise<ArrayBuffer | null> {
  const supabase = await createServerSupabaseClient();
  const bucket = supabase.storage.from(AVATAR_BUCKET);
  const { data: listed, error: listError } = await bucket.list(owner, { search: file, limit: 1 });
  if (listError || !listed?.some((o) => o.name === file)) {
    return null;
  }
  const { data, error } = await bucket.download(`${owner}/${file}`);
  if (error || !data) {
    return null;
  }
  return data.arrayBuffer();
}

// Stores an already-resized WebP as the caller's picture and deletes the
// previous one. Upload first, then point the profile at it: if the second
// step fails, the new object is removed again and the profile is unchanged.
export async function replaceOwnAvatar(userId: string, webp: Buffer): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const path = `${userId}/${randomUUID()}.webp`;
  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, webp, { contentType: "image/webp", upsert: false });
  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data: oldPath, error } = await supabase.rpc("set_own_avatar", { p_path: path });
  if (error) {
    await supabase.storage.from(AVATAR_BUCKET).remove([path]);
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
// object is only ever readable by signed-in users.
async function removeObject(path: unknown): Promise<void> {
  if (typeof path !== "string") return;
  const supabase = await createServerSupabaseClient();
  await supabase.storage.from(AVATAR_BUCKET).remove([path]);
}
