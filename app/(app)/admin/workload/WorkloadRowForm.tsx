"use client";

import { setWorkloadAction } from "../actions";
import { Avatar } from "@/app/components/Avatar";
import { useSafeActionState } from "@/app/components/useSafeActionState";
import { PRESENCE_DOT, PRESENCES } from "@/app/lib/presence";
import type { WorkloadRow } from "@/app/lib/db/workload";
import { DAILY_CAP_MAX } from "@/app/lib/workload";
import { WEEKDAYS } from "@/app/lib/work-hours";

const fieldClass =
  "rounded-lg border border-black/[.08] bg-white px-2 py-1 text-xs text-black dark:border-white/[.145] dark:bg-black dark:text-zinc-50";

export type ZoneGroup = { region: string; zones: { value: string; label: string }[] };

// One person's row on Admin > Workload (SUP-77). The fields sit in table
// cells, so they join the row's form through the form attribute.
export function WorkloadRowForm({
  row,
  name,
  isSelf,
  localTime,
  zoneGroups,
}: {
  row: WorkloadRow;
  name: string;
  isSelf: boolean;
  // The time now in their timezone, as the page rendered it.
  localTime: string;
  zoneGroups: ZoneGroup[];
}) {
  const [state, action, pending, formRef] = useSafeActionState(setWorkloadAction, undefined, (error) => ({
    status: "error" as const,
    error,
  }));
  const formId = `workload-${row.id}`;
  const atCap = row.daily_case_cap !== null && row.assigned_today >= row.daily_case_cap;
  const hasHours = row.work_days !== null;
  const hoursKey = `${row.work_days?.join(",") ?? "none"}|${row.work_start}|${row.work_end}`;

  return (
    <tr className="border-b border-black/[.06] align-top last:border-0 dark:border-white/[.08]">
      <td className="px-4 py-3 text-black dark:text-zinc-50">
        <div className="flex items-center gap-2.5">
          <Avatar id={row.id} name={name} avatarPath={row.avatar_path} size={28} />
          <div className="flex min-w-0 flex-col">
            <span>
              {name}
              {isSelf ? <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-500">(you)</span> : null}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-500">
              {row.full_name ? `${row.email} · ` : null}
              <span className="capitalize">{row.role}</span>
            </span>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${PRESENCE_DOT[row.presence]}`} />
          {PRESENCES[row.presence]}
        </span>
        {hasHours ? (
          <span className="mt-1 block text-[11px] text-zinc-500 dark:text-zinc-500">
            {row.presence_source === "schedule"
              ? "By working hours"
              : row.presence_source === "signed_out"
                ? "Signed out"
                : "Set by hand"}
          </span>
        ) : null}
      </td>
      <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400">
        <span className={atCap ? "font-medium text-black dark:text-zinc-50" : undefined}>
          {row.daily_case_cap === null ? row.assigned_today : `${row.assigned_today} of ${row.daily_case_cap}`}
        </span>
        {atCap ? <span className="block text-[11px] text-zinc-500 dark:text-zinc-500">At today&apos;s cap</span> : null}
      </td>
      <td className="px-4 py-3">
        {/* Keyed by the saved value: after a save React resets the form to
            each field's first-rendered default, so a field remounts with the
            new one instead of snapping back. */}
        <input
          key={row.daily_case_cap ?? "none"}
          form={formId}
          name="cap"
          type="number"
          inputMode="numeric"
          min={0}
          max={DAILY_CAP_MAX}
          step={1}
          defaultValue={row.daily_case_cap ?? ""}
          placeholder="No cap"
          aria-label={`Daily cap for ${name}`}
          className={`${fieldClass} w-24`}
        />
      </td>
      <td className="px-4 py-3">
        <select
          key={row.timezone}
          form={formId}
          name="timezone"
          defaultValue={row.timezone}
          aria-label={`Timezone for ${name}`}
          className={`${fieldClass} max-w-56`}
        >
          {zoneGroups.map((group) => (
            <optgroup key={group.region} label={group.region}>
              {group.zones.map((z) => (
                <option key={z.value} value={z.value}>
                  {z.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="mt-1 block text-[11px] text-zinc-500 dark:text-zinc-500">{localTime} there now</span>
      </td>
      <td className="px-4 py-3">
        {/* Keyed like the cap above. No days and no times = no schedule. */}
        <div key={hoursKey} className="flex flex-col gap-1.5">
          <fieldset className="flex gap-0.5">
            <legend className="sr-only">Working days for {name}</legend>
            {WEEKDAYS.map((d) => (
              <label key={d.day} title={d.short} className="relative cursor-pointer">
                <input
                  form={formId}
                  type="checkbox"
                  name="day"
                  value={d.day}
                  defaultChecked={row.work_days?.includes(d.day) ?? false}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-black/[.08] text-[11px] font-medium text-zinc-500 peer-checked:border-transparent peer-checked:bg-zinc-900 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 dark:border-white/[.145] dark:text-zinc-400 dark:peer-checked:bg-zinc-100 dark:peer-checked:text-black"
                >
                  {d.letter}
                </span>
                <span className="sr-only">{d.short}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-500">
            <input
              form={formId}
              type="time"
              name="start"
              defaultValue={row.work_start?.slice(0, 5) ?? ""}
              aria-label={`Shift start for ${name}`}
              className={fieldClass}
            />
            <span aria-hidden="true">–</span>
            <input
              form={formId}
              type="time"
              name="end"
              defaultValue={row.work_end?.slice(0, 5) ?? ""}
              aria-label={`Shift end for ${name}`}
              className={fieldClass}
            />
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <form id={formId} ref={formRef} action={action} className="flex flex-col items-start gap-1">
          <input type="hidden" name="userId" value={row.id} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-full border border-black/[.08] px-3 py-1 text-xs font-medium transition-colors hover:bg-black/[.05] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-white/[.06]"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          {state?.status === "saved" ? (
            <span role="status" className="text-[11px] text-zinc-500 dark:text-zinc-500">
              Saved.
            </span>
          ) : state?.status === "error" ? (
            <span role="alert" className="max-w-48 text-[11px] text-red-600 dark:text-red-400">
              {state.error}
            </span>
          ) : null}
        </form>
      </td>
    </tr>
  );
}
