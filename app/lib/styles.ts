// Shared Tailwind class strings so every form/button across the app looks
// the same, instead of each component re-typing (and slowly drifting from)
// its own copy.

export const inputClass =
  "rounded-lg border border-black/[.08] bg-white px-4 py-2 text-sm text-black outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-white/[.145] dark:bg-black dark:text-zinc-50 dark:focus:border-indigo-500 dark:focus:ring-indigo-950";

export const primaryButtonClass =
  "rounded-full bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50";

export const secondaryButtonClass =
  "rounded-full border border-black/[.08] px-5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-black/[.05] disabled:opacity-50 dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.06]";
