// Shared color mapping so a ticket's status/priority reads the same way
// everywhere it appears (list, detail, queue, admin breakdowns, the public
// share page). Deliberately plain data, no "server-only" -- these are used
// from client components too (e.g. the queue list).

export function statusBadgeClasses(status: string): string {
  switch (status) {
    case "new":
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
    case "triaged":
      return "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300";
    case "assigned":
      return "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300";
    case "in_progress":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300";
    case "resolved":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
    case "closed":
      return "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500";
    default:
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  }
}

export function priorityBadgeClasses(priority: string): string {
  switch (priority) {
    case "urgent":
      return "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300";
    case "high":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300";
    case "normal":
      return "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300";
    case "low":
      return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
    default:
      return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  }
}

export function roleBadgeClasses(role: string): string {
  switch (role) {
    case "admin":
      return "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300";
    case "agent":
      return "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300";
    default:
      return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  }
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}
