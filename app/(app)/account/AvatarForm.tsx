"use client";

import { removeAvatarAction, uploadAvatarAction, type AvatarState } from "./actions";
import { Avatar } from "@/app/components/Avatar";
import { useSafeActionState } from "@/app/components/useSafeActionState";
import { secondaryButtonClass } from "@/app/lib/styles";

const MAX_BYTES = 2 * 1024 * 1024;

// One state for both buttons, so whichever ran last reports.
async function avatarAction(prev: AvatarState, formData: FormData): Promise<AvatarState> {
  if (formData.get("intent") === "remove") {
    return removeAvatarAction();
  }
  // Caught here so an oversized file gets the friendly message instead of
  // the framework's body-size error; the server checks again.
  const file = formData.get("avatar");
  if (file instanceof File && file.size > MAX_BYTES) {
    return { status: "error", error: "That picture is over 2 MB. Choose a smaller one." };
  }
  return uploadAvatarAction(prev, formData);
}

export function AvatarForm({
  id,
  name,
  avatarPath,
}: {
  id: string;
  name: string;
  avatarPath: string | null;
}) {
  const [state, action, pending, formRef] = useSafeActionState(avatarAction, undefined, (error) => ({ status: "error" as const, error }));

  return (
    <form ref={formRef} action={action} className="flex flex-wrap items-center gap-4">
      <Avatar id={id} name={name} avatarPath={avatarPath} size={64} />
      <div className="flex flex-col gap-2">
        <label htmlFor="avatar" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Profile picture
        </label>
        <input
          id="avatar"
          name="avatar"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="text-xs text-zinc-600 file:mr-3 file:rounded-full file:border file:border-black/[.08] file:bg-transparent file:px-3 file:py-1 file:text-xs file:font-medium dark:text-zinc-400 dark:file:border-white/[.145] dark:file:text-zinc-200"
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          JPEG, PNG or WebP, up to 2 MB. It&apos;s cropped to a square and shown to people signed in to this app.
        </p>
        <div className="flex items-center gap-2">
          <button type="submit" name="intent" value="upload" disabled={pending} className={secondaryButtonClass}>
            {pending ? "Saving..." : "Upload picture"}
          </button>
          {avatarPath ? (
            <button type="submit" name="intent" value="remove" disabled={pending} className={secondaryButtonClass}>
              Remove picture
            </button>
          ) : null}
        </div>
        <p role="status" className="text-sm">
          {state?.status === "saved" ? (
            <span className="text-emerald-700 dark:text-emerald-400">Picture updated.</span>
          ) : state?.status === "error" ? (
            <span className="text-red-600 dark:text-red-400">{state.error}</span>
          ) : null}
        </p>
      </div>
    </form>
  );
}
