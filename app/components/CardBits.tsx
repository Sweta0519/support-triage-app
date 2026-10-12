// Small pieces for the calm, Linear-style ticket cards (SUP-38) on the
// queue and the board. Text stays neutral; colour lives only in icons and
// dots. Every icon carries a text equivalent for screen readers. No hooks
// and no server-only imports, so server and client cards can both use them.

import { statusLabel } from "@/app/lib/badges";
import { capitalize } from "@/app/lib/format";
import { labelDot } from "@/app/lib/labels";
import { fieldLabel } from "@/app/lib/triage-fields";

const srOnly = "sr-only";

// Priority as bars, like Linear: urgent is an exclamation mark in a square.
export function PriorityIcon({ priority }: { priority: string | null }) {
  const label = priority ? `${capitalize(priority)} priority` : "No priority yet";
  if (priority === "urgent") {
    return (
      <span className="inline-flex shrink-0 text-orange-600 dark:text-orange-400" title={label}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <rect x="1" y="1" width="14" height="14" rx="3" />
          <rect x="7" y="4" width="2" height="5" rx="1" className="fill-white dark:fill-zinc-900" />
          <rect x="7" y="10.5" width="2" height="2" rx="1" className="fill-white dark:fill-zinc-900" />
        </svg>
        <span className={srOnly}>{label}</span>
      </span>
    );
  }
  const filled = priority === "high" ? 3 : priority === "normal" ? 2 : priority === "low" ? 1 : 0;
  return (
    <span className="inline-flex shrink-0 text-zinc-600 dark:text-zinc-300" title={label}>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
        {[0, 1, 2].map((i) => (
          <rect
            key={i}
            x={2 + i * 5}
            y={10 - i * 3}
            width="3"
            height={4 + i * 3}
            rx="1"
            fill="currentColor"
            opacity={i < filled ? 1 : 0.25}
          />
        ))}
      </svg>
      <span className={srOnly}>{label}</span>
    </span>
  );
}

const STATUS_DOT: Record<string, string> = {
  new: "bg-zinc-400",
  triaged: "bg-sky-500",
  assigned: "bg-indigo-500",
  in_progress: "bg-amber-500",
  resolved: "bg-emerald-500",
  closed: "bg-zinc-300 dark:bg-zinc-600",
};

export function StatusDot({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status] ?? "bg-zinc-400"}`} />
      <span>{capitalize(statusLabel(status))}</span>
    </span>
  );
}

// A dashed circle where an assignee's avatar would be.
export function UnassignedIcon({ size = 20 }: { size?: number }) {
  return (
    <span className="inline-flex shrink-0 text-zinc-400 dark:text-zinc-500" title="Unassigned">
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2.5" />
      </svg>
      <span className={srOnly}>Unassigned</span>
    </span>
  );
}

export type CardLabel = { text: string; dot: string; title?: string };

// The card's labels in order of importance -- the first two are shown:
// escalation risk and "AI unsure" (the AI asking not to be trusted) first,
// so they're never hidden behind "+N" (SUP-38); then the labels the team
// put on the ticket (SUP-39), the AI's category, frustration, and
// "AI unreviewed".
export function cardLabels(input: {
  teamLabels?: { name: string; color: string }[];
  category: string | null;
  escalation: boolean;
  frustrated: boolean;
  review?: "unsure" | "unreviewed" | null;
}): CardLabel[] {
  const labels: CardLabel[] = [];
  if (input.escalation) labels.push({ text: "Escalation risk", dot: "bg-red-500" });
  if (input.review === "unsure") {
    labels.push({ text: "AI unsure", dot: "bg-amber-500", title: "The AI flagged its own triage for a human to check" });
  }
  for (const l of input.teamLabels ?? []) labels.push({ text: l.name, dot: labelDot(l.color) });
  if (input.category) {
    labels.push({ text: capitalize(fieldLabel(input.category)), dot: "bg-zinc-400" });
  }
  if (input.frustrated) labels.push({ text: "Frustrated", dot: "bg-orange-500" });
  if (input.review === "unreviewed") {
    labels.push({ text: "AI unreviewed", dot: "bg-zinc-300 dark:bg-zinc-600", title: "Nobody has confirmed or corrected the AI's triage yet" });
  }
  return labels;
}

// Up to `max` thin outlined labels with a coloured dot, then "+N" whose
// tooltip (and screen-reader text) names the rest.
export function LabelRow({ labels, max = 2 }: { labels: CardLabel[]; max?: number }) {
  const shown = labels.slice(0, max);
  const hidden = labels.slice(max);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {shown.map((label, i) => (
        <span
          // Team label names are free text and can repeat an AI label's.
          key={`${i}:${label.text}`}
          title={label.title}
          className="inline-flex items-center gap-1 rounded-full border border-black/[.1] px-2 py-0.5 text-[11px] text-zinc-600 dark:border-white/[.15] dark:text-zinc-300"
        >
          <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${label.dot}`} />
          {label.text}
        </span>
      ))}
      {hidden.length > 0 ? (
        <span
          title={hidden.map((l) => l.text).join(", ")}
          className="rounded-full border border-black/[.1] px-1.5 py-0.5 text-[11px] text-zinc-500 dark:border-white/[.15] dark:text-zinc-400"
        >
          +{hidden.length}
          <span className={srOnly}> more: {hidden.map((l) => l.text).join(", ")}</span>
        </span>
      ) : null}
    </span>
  );
}

// The first-reply SLA as quiet text: red when overdue, amber when at risk
// or replied late; otherwise the same grey as everything else. At risk
// also says so in words, so it isn't told apart by colour alone.
export function SlaText({ label, state }: { label: string; state: string }) {
  const text = state === "at_risk" ? `At risk · ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label;
  const tone =
    state === "breached"
      ? "text-red-600 dark:text-red-400"
      : state === "at_risk" || state === "missed"
        ? "text-amber-700 dark:text-amber-400"
        : "text-zinc-500 dark:text-zinc-400";
  return <span className={`shrink-0 text-[11px] font-medium ${tone}`}>{text}</span>;
}
