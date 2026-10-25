"use client";

import { useState, useTransition } from "react";

import { createInviteAction, revokeInviteAction, rotateJoinLinkAction } from "../actions";
import { useCopy } from "@/app/components/useCopy";
import { useSafeActionState } from "@/app/components/useSafeActionState";
import type { WorkspaceInvite } from "@/app/lib/db/workspaces";
import { formatRelativeTime } from "@/app/lib/format";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "@/app/lib/styles";

const labelClass = "text-xs font-medium text-zinc-600 dark:text-zinc-400";
const body = "text-sm text-zinc-600 dark:text-zinc-400";
const sectionTitle = "text-base font-semibold text-black dark:text-zinc-50";
// A fixed locale and time zone, so the server render and hydration agree.
const expiryDate = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

// `now` comes from the server render, so hydration reaches the same answer.
function inviteState(i: WorkspaceInvite, now: number): "accepted" | "revoked" | "expired" | "pending" {
  if (i.accepted_at) return "accepted";
  if (i.revoked_at) return "revoked";
  if (new Date(i.expires_at).getTime() <= now) return "expired";
  return "pending";
}

const STATE_LABEL = { accepted: "Joined", revoked: "Revoked", expired: "Expired" } as const;

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, copy] = useCopy();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        readOnly
        aria-label={label}
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className={`${inputClass} min-w-0 flex-1 font-mono text-xs`}
      />
      <button type="button" className={secondaryButtonClass} onClick={() => copy(value)}>
        {copied === "copied" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy"}
      </button>
    </div>
  );
}

// The workspace's customer sign-up link (copy, or replace it so the old one
// stops working) and agent invites (made per email, shown once, revocable).
export function WorkspacePanel({ joinUrl, invites, now }: { joinUrl: string; invites: WorkspaceInvite[]; now: number }) {
  const [rotating, startRotate] = useTransition();
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [state, action, pending, formRef] = useSafeActionState(createInviteAction, undefined, (error, sent) => ({
    status: "error" as const,
    error,
    email: String(sent.get("email") ?? ""),
  }));
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [revoking, startRevoke] = useTransition();
  const [revokeError, setRevokeError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className={sectionTitle}>Customer sign-up link</h3>
          <p className={body}>
            Share it with your customers (on your site or help page). Anyone who signs up through it joins this
            workspace as a customer and can file tickets.
          </p>
        </div>
        <CopyField label="Customer sign-up link" value={joinUrl} />
        {confirmRotate ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className={body}>The current link stops working at once.</span>
            <button
              type="button"
              disabled={rotating}
              onClick={() =>
                startRotate(async () => {
                  try {
                    const result = await rotateJoinLinkAction();
                    setRotateError(result.ok ? null : result.error);
                  } catch {
                    setRotateError("That didn't work. Try again.");
                  }
                  setConfirmRotate(false);
                })
              }
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {rotating ? "Replacing…" : "Replace the link"}
            </button>
            <button type="button" onClick={() => setConfirmRotate(false)} className="text-xs text-zinc-600 underline underline-offset-2 dark:text-zinc-400">
              Cancel
            </button>
          </div>
        ) : (
          <div>
            <button type="button" onClick={() => setConfirmRotate(true)} className={`${secondaryButtonClass} !px-3 !py-1.5 !text-xs`}>
              Make a new link…
            </button>
          </div>
        )}
        {rotateError ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {rotateError}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className={sectionTitle}>Invite agents</h3>
          <p className={body}>
            Each invite works once, for the email it was made for, and expires after 7 days. Send the link to the
            agent yourself.
          </p>
        </div>

        {state?.status === "created" && dismissed !== state.url ? (
          <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
            <p role="status" className="text-sm font-medium text-emerald-900 dark:text-emerald-200">
              Invite for {state.email} created. Copy the link now: you won&apos;t be able to see it again.
            </p>
            <CopyField label="Invite link" value={state.url} />
            <div>
              <button type="button" className={secondaryButtonClass} onClick={() => setDismissed(state.url)}>
                Done
              </button>
            </div>
          </div>
        ) : null}

        <form ref={formRef} action={action} className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <label htmlFor="invite-email" className={labelClass}>
              Agent&apos;s email
            </label>
            <input
              id="invite-email"
              name="email"
              type="email"
              required
              defaultValue={state?.status === "error" ? state.email : ""}
              className={inputClass}
            />
          </div>
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            {pending ? "Creating…" : "Create invite"}
          </button>
        </form>
        {state?.status === "error" ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        ) : null}
        {revokeError ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {revokeError}
          </p>
        ) : null}

        {invites.length ? (
          <ul aria-label="Agent invites" className="flex flex-col divide-y divide-black/[.06] rounded-xl border border-black/[.08] dark:divide-white/[.08] dark:border-white/[.145]">
            {invites.map((i) => {
              const s = inviteState(i, now);
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-black dark:text-zinc-50">{i.email}</span>
                    {/* Relative times can tick over between the server render and hydration. */}
                    <span suppressHydrationWarning className="text-xs text-zinc-500 dark:text-zinc-400">
                      created {formatRelativeTime(i.created_at)}
                      {s === "pending" ? ` · expires ${expiryDate.format(new Date(i.expires_at))}` : ""}
                    </span>
                  </div>
                  {s === "pending" ? (
                    <button
                      type="button"
                      disabled={revoking}
                      onClick={() =>
                        startRevoke(async () => {
                          try {
                            const result = await revokeInviteAction(i.id);
                            setRevokeError(result.ok ? null : result.error);
                          } catch {
                            setRevokeError("That didn't work. Try again.");
                          }
                        })
                      }
                      aria-label={`Revoke the invite for ${i.email}`}
                      className={`${secondaryButtonClass} !px-3 !py-1.5 !text-xs`}
                    >
                      Revoke
                    </button>
                  ) : (
                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{STATE_LABEL[s]}</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={body}>No invites yet.</p>
        )}
      </section>
    </div>
  );
}
