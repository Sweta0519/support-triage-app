// Account preferences (SUP-22): the allowed values, shared by the settings
// form, its server action and the pages that apply them. No server-only
// import, so client components can use the labels. The database enforces
// the same sets with check constraints on ticketing.profiles.

import { QUEUE_FILTERS, type QueueFilterKey } from "@/app/lib/queue-filters";
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

export function isQueueFilter(value: unknown): value is QueueFilterKey {
  return typeof value === "string" && QUEUE_FILTERS.some((f) => f.key === value);
}

export function isQueueSort(value: unknown): value is QueueSort {
  return typeof value === "string" && Object.hasOwn(QUEUE_SORTS, value);
}

// Trimmed; blank means "no name" (the app shows the email instead). Returns
// an error message, or null when the name is acceptable.
export function fullNameError(name: string): string | null {
  if (name.length > FULL_NAME_MAX_LENGTH) {
    return `Keep your name to ${FULL_NAME_MAX_LENGTH} characters or fewer.`;
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    return "Your name can't contain line breaks or control characters.";
  }
  return null;
}
