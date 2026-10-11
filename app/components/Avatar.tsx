"use client";

import { useState } from "react";

import { avatarUrl, fallbackColour, initials } from "@/app/lib/avatars";

// A person's picture, or their initials on a colour derived from their id.
// name is null when the viewer doesn't know a real name (a fallback like
// "Customer" or "Assigned" isn't one): then a neutral person glyph, not
// made-up initials. Decorative: the label is always shown next to it, so
// alt is empty.
export function Avatar({
  id,
  name,
  avatarPath,
  size = 32,
}: {
  id: string;
  name: string | null;
  avatarPath: string | null;
  size?: number;
}) {
  const style = { width: size, height: size };
  // A picture that fails to load (removed meanwhile, Storage error) falls
  // back to the initials rather than a broken-image icon.
  const [failedPath, setFailedPath] = useState<string | null>(null);
  if (avatarPath && failedPath !== avatarPath) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- already a 256px WebP; served by our own route behind the session
      <img
        src={avatarUrl(avatarPath)}
        alt=""
        width={size}
        height={size}
        style={style}
        onError={() => setFailedPath(avatarPath)}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  if (name === null) {
    return (
      <span
        aria-hidden
        style={style}
        className="flex shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
      >
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6z" />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-hidden
      style={{ ...style, fontSize: Math.max(10, Math.round(size * 0.38)) }}
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${fallbackColour(id)}`}
    >
      {initials(name)}
    </span>
  );
}
