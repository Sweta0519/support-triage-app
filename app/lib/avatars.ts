// Shared by server and client code: where a profile picture is served
// from, and the initials fallback. No server-only import.

export const AVATAR_BUCKET = "ticketing-avatars";

// Stored as "<owner uid>/<uuid>.webp" (enforced by a check constraint);
// served by app/avatar/[owner]/[file]/route.ts without the extension, so
// the request still passes through the proxy's session refresh (its
// matcher skips image extensions).
export function avatarUrl(path: string): string {
  return `/avatar/${path.replace(/\.webp$/, "")}`;
}

export function initials(name: string): string {
  const words = name.replace(/@.*$/, "").split(/[\s._-]+/).filter(Boolean);
  // Array.from splits by code point, so an emoji initial stays whole.
  const first = Array.from(words[0] ?? "?");
  const letters = words.length > 1 ? first[0] + Array.from(words[words.length - 1])[0] : first.slice(0, 2).join("");
  return letters.toUpperCase();
}

// A stable colour per person, from their id: the same user gets the same
// fallback everywhere, with no external avatar service.
const FALLBACK_COLOURS = [
  "bg-indigo-600",
  "bg-emerald-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-sky-600",
  "bg-violet-600",
  "bg-teal-600",
  "bg-fuchsia-600",
];

export function fallbackColour(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_COLOURS[hash % FALLBACK_COLOURS.length];
}
