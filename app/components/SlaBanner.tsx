import { formatDuration, type Sla } from "@/app/lib/sla";

// The first-response SLA as a banner across the staff ticket page: the
// colour carries urgency, the text carries everything (so colour is never
// the only cue).
const TONE: Record<Sla["state"], { box: string; title: string }> = {
  breached: {
    box: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300",
    title: "First reply overdue",
  },
  at_risk: {
    box: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300",
    title: "First reply due soon",
  },
  on_track: {
    box: "border-black/[.08] bg-black/[.02] text-zinc-700 dark:border-white/[.145] dark:bg-white/[.03] dark:text-zinc-300",
    title: "First reply on track",
  },
  met: {
    box: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300",
    title: "Replied in time",
  },
  missed: {
    box: "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-300",
    title: "Replied late",
  },
};

// The title already says what happened; this adds the numbers.
function detail(sla: Sla): string {
  const target = `${formatDuration(sla.targetMs)} target for ${sla.priority} priority`;
  switch (sla.state) {
    case "breached":
      return `Overdue by ${formatDuration(sla.remainingMs)} · ${target}.`;
    case "on_track":
    case "at_risk":
      return `${formatDuration(sla.remainingMs)} left · ${target}.`;
    case "met":
    case "missed":
      return `Answered after ${formatDuration(sla.responseMs)} · ${target}.`;
  }
}

// Day and month too: a ticket overdue for days would otherwise point at
// the wrong week ("Mon 02:30 PM").
const timeFormat = new Intl.DateTimeFormat("en", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export function SlaBanner({ sla }: { sla: Sla }) {
  const tone = TONE[sla.state];
  const waiting = sla.state === "on_track" || sla.state === "at_risk" || sla.state === "breached";
  return (
    <div
      role={sla.state === "breached" ? "alert" : "status"}
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border px-4 py-2.5 text-sm ${tone.box}`}
    >
      <p>
        <span className="font-semibold">{tone.title}.</span> {detail(sla)}
      </p>
      {waiting ? <p className="text-xs opacity-80">Due {timeFormat.format(sla.dueAt)} UTC</p> : null}
    </div>
  );
}
