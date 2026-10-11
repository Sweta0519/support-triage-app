// Account preferences (SUP-22): the allowed values, shared by the settings
// form, its server action and the pages that apply them. No server-only
// import, so client components can use the labels. The database enforces
// the same sets with check constraints on ticketing.profiles.

export { isQueueFilter } from "@/app/lib/queue-filters";
import { QUEUE_SORTS, type QueueSort } from "@/app/lib/queue";

export const THEMES = {
  system: "Match my device",
  light: "Light",
  dark: "Dark",
} as const;
export type Theme = keyof typeof THEMES;

export const FULL_NAME_MAX_LENGTH = 80;

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && Object.hasOwn(THEMES, value);
}

export function isQueueSort(value: unknown): value is QueueSort {
  return typeof value === "string" && Object.hasOwn(QUEUE_SORTS, value);
}

// Trimmed; blank means "no name" (the app shows the email instead). Returns
// an error message, or null when the name is acceptable.
export function fullNameError(name: string): string | null {
  // Counted in code points, like Postgres char_length(), so an emoji is one
  // character here as it is in the database.
  if (Array.from(name).length > FULL_NAME_MAX_LENGTH) {
    return `Keep your name to ${FULL_NAME_MAX_LENGTH} characters or fewer.`;
  }
  // C0, DEL and C1 -- the same set as Postgres [[:cntrl:]] under UTF-8.
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) {
    return "Your name can't contain line breaks or control characters.";
  }
  return null;
}
