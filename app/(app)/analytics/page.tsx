import { requireAdmin } from "@/app/lib/auth/session";
import { Breadcrumbs } from "@/app/components/Breadcrumbs";
import { computeAnalytics, formatRate, VOLUME_DAYS, type Analytics } from "@/app/lib/analytics";
import { listAnalyticsTickets } from "@/app/lib/db/analytics";
import { MAX_ROWS } from "@/app/lib/db/admin";
import { formatDuration, SLA_TARGET_MS } from "@/app/lib/sla";
import { TRIAGE_PRIORITIES } from "@/app/lib/triage-fields";

// Admin-only: under RLS an agent would aggregate just their own and the
// unassigned tickets, which would read as the whole picture and isn't.
// Everything is server-rendered; hover detail uses native title tooltips,
// so the page ships no chart JavaScript.

const cardClasses = "rounded-xl border border-black/[.08] p-4 dark:border-white/[.145]";
const sectionTitleClasses = "text-sm font-semibold text-black dark:text-zinc-50";
const mutedClasses = "text-xs text-zinc-500 dark:text-zinc-500";

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className={cardClasses}>
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-black dark:text-zinc-50">{value}</p>
      <p className={`mt-1 ${mutedClasses}`}>{detail}</p>
    </div>
  );
}

// A thin single-colour bar: one series, so one hue for every row.
function RateBar({ part, whole }: { part: number; whole: number }) {
  return (
    <div className="h-1.5 w-full min-w-12 overflow-hidden rounded-full bg-black/[.05] dark:bg-white/[.08]">
      <div
        className="h-full rounded-full bg-indigo-500"
        style={{ width: whole > 0 ? `${(part / whole) * 100}%` : "0%" }}
      />
    </div>
  );
}

function VolumeChart({ volume }: { volume: Analytics["volume"] }) {
  const max = Math.max(...volume.map((d) => d.count));
  const dayLabel = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <figure className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={`Tickets opened per day over the last ${VOLUME_DAYS} days, peak ${max}`}
        className="flex h-36 items-end gap-1 border-b border-black/10 dark:border-white/15"
      >
        {volume.map((d) => (
          // Full-height column as the hover target, so an empty day still explains itself.
          <div
            key={d.day}
            title={`${dayLabel(d.day)}: ${d.count} ticket${d.count === 1 ? "" : "s"}`}
            className="flex h-full flex-1 items-end"
          >
            {d.count > 0 ? (
              <div
                className="w-full rounded-t bg-indigo-500"
                style={{ height: `${Math.max(2, (d.count / max) * 100)}%` }}
              />
            ) : null}
          </div>
        ))}
      </div>
      <figcaption className={`flex justify-between ${mutedClasses}`}>
        <span>{dayLabel(volume[0].day)}</span>
        <span>Peak {max} / day</span>
        <span>{dayLabel(volume[volume.length - 1].day)} (UTC)</span>
      </figcaption>
    </figure>
  );
}

function SlaTable({ sla }: { sla: Analytics["sla"] }) {
  // Highest priority first, matching how the queue is worked.
  const rows = [...sla.byPriority].reverse();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-zinc-500 dark:text-zinc-500">
            <th className="pb-2 font-medium">Priority</th>
            <th className="pb-2 font-medium">Target</th>
            <th className="w-1/3 pb-2 font-medium">First replies on time</th>
            <th className="pb-2 text-right font-medium">At risk</th>
            <th className="pb-2 text-right font-medium">Overdue</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/[.06] dark:divide-white/[.08]">
          {rows.map((r) => (
            <tr key={r.priority}>
              <td className="py-2 capitalize text-zinc-700 dark:text-zinc-300">{r.priority}</td>
              <td className="py-2 tabular-nums text-zinc-500 dark:text-zinc-500">
                {formatDuration(SLA_TARGET_MS[r.priority])}
              </td>
              <td className="py-2">
                <div className="flex items-center gap-3">
                  <RateBar part={r.met} whole={r.answered} />
                  <span className="w-24 shrink-0 text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                    {formatRate(r.met, r.answered)} ({r.met}/{r.answered})
                  </span>
                </div>
              </td>
              <td className="py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{r.openAtRisk}</td>
              <td
                className={`py-2 text-right tabular-nums ${
                  r.openBreached > 0 ? "font-semibold text-red-700 dark:text-red-400" : "text-zinc-700 dark:text-zinc-300"
                }`}
              >
                {r.openBreached}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// AI priority (rows) against the reviewer's priority (columns). The
// diagonal is agreement; everything off it is a correction, and which side
// of the diagonal shows whether the AI over- or under-rates urgency.
function PriorityMatrix({ matrix }: { matrix: Analytics["triage"]["priorityMatrix"] }) {
  const order = [...TRIAGE_PRIORITIES].reverse();
  const max = Math.max(1, ...order.flatMap((ai) => order.map((s) => matrix[ai][s])));
  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <caption className={`mb-2 text-left ${mutedClasses}`}>
          Rows: the AI&apos;s priority. Columns: what the reviewer kept or changed it to.
        </caption>
        <thead>
          <tr>
            <th className="p-1" />
            {order.map((s) => (
              <th key={s} scope="col" className="p-1 font-medium capitalize text-zinc-500 dark:text-zinc-500">
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.map((ai) => (
            <tr key={ai}>
              <th scope="row" className="p-1 pr-2 text-right font-medium capitalize text-zinc-500 dark:text-zinc-500">
                AI: {ai}
              </th>
              {order.map((s) => {
                const count = matrix[ai][s];
                const strength = count / max;
                return (
                  <td key={s} className="p-0.5">
                    <div
                      title={`AI said ${ai}, reviewer set ${s}: ${count}`}
                      className={`flex h-10 w-14 items-center justify-center rounded-md tabular-nums ${
                        ai === s ? "ring-1 ring-inset ring-black/20 dark:ring-white/25" : ""
                      } ${count === 0 ? "bg-black/[.03] text-zinc-400 dark:bg-white/[.04] dark:text-zinc-600" : strength > 0.5 ? "text-white" : "text-black dark:text-zinc-50"}`}
                      style={count > 0 ? { backgroundColor: `rgb(99 102 241 / ${0.15 + strength * 0.85})` } : undefined}
                    >
                      {count}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AnalyticsPage() {
  await requireAdmin();
  const { recent, waiting, sampled } = await listAnalyticsTickets();
  const a = computeAnalytics(recent, new Date(), waiting);

  const openAtRisk = a.sla.byPriority.reduce((sum, r) => sum + r.openAtRisk, 0);
  const openBreached = a.sla.byPriority.reduce((sum, r) => sum + r.openBreached, 0);
  const aiReviewed = a.triage.confirmed + a.triage.corrected;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 p-8">
      <div>
        <Breadcrumbs current="Analytics" />
        <h1 className="mt-2 text-2xl font-semibold text-black dark:text-zinc-50">Analytics</h1>
        <p className={`mt-1 ${mutedClasses}`}>
          Ticket volume, first-response SLA, and how often staff agree with the AI&apos;s triage.
        </p>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={sampled ? `Tickets (most recent ${MAX_ROWS.toLocaleString()})` : "Tickets"}
          value={a.ticketCount.toLocaleString()}
          detail={`${a.volume.reduce((sum, d) => sum + d.count, 0)} in the last ${VOLUME_DAYS} days`}
        />
        <Stat
          label="First replies on time"
          value={formatRate(a.sla.met, a.sla.answered)}
          detail={`${a.sla.met} of ${a.sla.answered} answered tickets`}
        />
        <Stat
          label="Open and overdue"
          value={openBreached.toLocaleString()}
          detail={`${openAtRisk} more at risk`}
        />
        <Stat
          label="AI triage accepted as-is"
          value={formatRate(a.triage.confirmed, aiReviewed)}
          detail={`${a.triage.confirmed} of ${aiReviewed} reviewed AI assessments`}
        />
      </section>

      <section className={`${cardClasses} flex flex-col gap-3`}>
        <h2 className={sectionTitleClasses}>Tickets opened per day</h2>
        <VolumeChart volume={a.volume} />
      </section>

      <section className={`${cardClasses} flex flex-col gap-3`}>
        <div>
          <h2 className={sectionTitleClasses}>First-response SLA by priority</h2>
          <p className={`mt-1 ${mutedClasses}`}>
            On time means the first public staff reply came within the target. At risk and overdue
            count open tickets still waiting for one.
          </p>
        </div>
        <SlaTable sla={a.sla} />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className={sectionTitleClasses}>Triage quality</h2>
          <p className={`mt-1 ${mutedClasses}`}>
            Each review compares the reviewer&apos;s priority, category and team with the AI run they
            were shown. Unreviewed tickets aren&apos;t counted, so this measures the AI only where a
            human checked it.
          </p>
        </div>

        {a.triage.reviewed === 0 ? (
          <p className={`${cardClasses} ${mutedClasses}`}>
            No reviewed tickets yet. Confirm or correct the AI&apos;s triage on a ticket to start
            measuring it.
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <div className={`${cardClasses} flex flex-col gap-4`}>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: "Confirmed", value: a.triage.confirmed },
                  { label: "Corrected", value: a.triage.corrected },
                  { label: "No AI run", value: a.triage.manual },
                ].map((item) => (
                  <div key={item.label}>
                    <p className="text-xl font-semibold tabular-nums text-black dark:text-zinc-50">{item.value}</p>
                    <p className={mutedClasses}>{item.label}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-500">
                  Field agreement with the AI
                </p>
                {a.triage.fieldAgreement.map((f) => (
                  <div key={f.field} className="flex items-center gap-3 text-sm">
                    <span className="w-20 shrink-0 capitalize text-zinc-700 dark:text-zinc-300">{f.field}</span>
                    <RateBar part={f.agreed} whole={f.compared} />
                    <span className="w-24 shrink-0 text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                      {formatRate(f.agreed, f.compared)} ({f.agreed}/{f.compared})
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className={cardClasses}>
              <PriorityMatrix matrix={a.triage.priorityMatrix} />
            </div>
          </div>
        )}
      </section>

      {sampled ? (
        <p className={mutedClasses}>Figures are computed over the most recent {MAX_ROWS.toLocaleString()} tickets.</p>
      ) : null}
    </div>
  );
}
