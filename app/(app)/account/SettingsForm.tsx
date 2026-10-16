"use client";


import { updateSettingsAction } from "./actions";
import { FULL_NAME_MAX_LENGTH, THEMES, type Theme } from "@/app/lib/preferences";
import { QUEUE_FILTERS, type QueueFilterKey } from "@/app/lib/queue-filters";
import { QUEUE_SORTS, type QueueSort } from "@/app/lib/queue";
import { inputClass, primaryButtonClass } from "@/app/lib/styles";
import { useSafeActionState } from "@/app/components/useSafeActionState";

const labelClass = "text-xs font-medium text-zinc-600 dark:text-zinc-400";
const legendClass = "text-base font-semibold text-black dark:text-zinc-50";

export function SettingsForm({
  email,
  fullName,
  theme,
  isStaff,
  queueDefaultFilter,
  queueDefaultSort,
}: {
  email: string;
  fullName: string;
  theme: Theme;
  isStaff: boolean;
  queueDefaultFilter: QueueFilterKey;
  queueDefaultSort: QueueSort;
}) {
  const [state, action, pending, formRef] = useSafeActionState(updateSettingsAction, undefined, (error) => ({ status: "error" as const, error }));
  // After a refused save, show what was submitted rather than the stored
  // values (React resets the form to these defaults after the action).
  const shown = state?.status === "error" ? (state.values ?? null) : null;

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className={`mb-3 ${legendClass}`}>Profile</legend>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="fullName" className={labelClass}>
            Display name
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            autoComplete="name"
            defaultValue={shown?.fullName ?? fullName}
            maxLength={FULL_NAME_MAX_LENGTH}
            placeholder="How your name appears in the app"
            className={inputClass}
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            Leave it blank to be shown by your email address.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={labelClass}>Email</span>
          <p className="text-sm text-black dark:text-zinc-50">{email}</p>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className={`mb-3 ${legendClass}`}>Preferences</legend>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="theme" className={labelClass}>
            Theme
          </label>
          <select id="theme" name="theme" defaultValue={shown?.theme ?? theme} className={inputClass}>
            {(Object.keys(THEMES) as Theme[]).map((key) => (
              <option key={key} value={key}>
                {THEMES[key]}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            Applies while you&apos;re signed in; the sign-in page follows your device.
          </p>
        </div>
        {isStaff ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="queueDefaultFilter" className={labelClass}>
                Queue opens on
              </label>
              <select
                id="queueDefaultFilter"
                name="queueDefaultFilter"
                defaultValue={shown?.queueDefaultFilter ?? queueDefaultFilter}
                className={inputClass}
              >
                {QUEUE_FILTERS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="queueDefaultSort" className={labelClass}>
                Queue sorted by
              </label>
              <select
                id="queueDefaultSort"
                name="queueDefaultSort"
                defaultValue={shown?.queueDefaultSort ?? queueDefaultSort}
                className={inputClass}
              >
                {(Object.keys(QUEUE_SORTS) as QueueSort[]).map((key) => (
                  <option key={key} value={key}>
                    {QUEUE_SORTS[key]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
      </fieldset>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Saving..." : "Save settings"}
        </button>
        <p role="status" className="text-sm">
          {state?.status === "saved" ? (
            <span className="text-emerald-700 dark:text-emerald-400">Settings saved.</span>
          ) : state?.status === "error" ? (
            <span className="text-red-600 dark:text-red-400">{state.error}</span>
          ) : null}
        </p>
      </div>
    </form>
  );
}
