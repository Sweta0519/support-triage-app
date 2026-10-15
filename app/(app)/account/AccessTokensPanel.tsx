"use client";

import { useActionState, useState, useTransition } from "react";

import { createAccessTokenAction, revokeAccessTokenAction } from "./actions";
import { MAX_ACTIVE_TOKENS, TOKEN_LIFETIMES, TOKEN_NAME_MAX_LENGTH } from "@/app/lib/access-token-options";
import type { AccessToken } from "@/app/lib/db/access-tokens";
import { formatRelativeTime } from "@/app/lib/format";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "@/app/lib/styles";

const labelClass = "text-xs font-medium text-zinc-600 dark:text-zinc-400";
const body = "text-sm text-zinc-600 dark:text-zinc-400";

function tokenState(t: AccessToken): "revoked" | "expired" | "active" {
  if (t.revoked_at) return "revoked";
  if (t.expires_at && new Date(t.expires_at) <= new Date()) return "expired";
  return "active";
}

// Personal access tokens for the MCP connector (SUP-53): create one (its
// secret is shown once, here), see when each was last used, revoke them.
export function AccessTokensPanel({ tokens }: { tokens: AccessToken[] }) {
  const [state, action, pending] = useActionState(createAccessTokenAction, undefined);
  const [copied, setCopied] = useState(false);
  const [revoking, startRevoke] = useTransition();
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-black dark:text-zinc-50">Access tokens</h3>
        <p className={body}>
          Tokens let an AI assistant that supports MCP (the Model Context Protocol) use Support Triage as you, with
          your account&apos;s permissions. Connecting assistants is coming soon; tokens you create now will work then.
          Treat a token like a password, and revoke it if it may have leaked.
        </p>
      </div>

      {state?.status === "created" ? (
        <div role="status" className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
          <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">
            Created &ldquo;{state.name}&rdquo;. Copy it now: you won&apos;t be able to see it again.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              readOnly
              aria-label="New access token"
              value={state.token}
              onFocus={(e) => e.currentTarget.select()}
              className={`${inputClass} min-w-0 flex-1 font-mono text-xs`}
            />
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={async () => {
                await navigator.clipboard.writeText(state.token);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}

      <form action={action} className="flex flex-wrap items-end gap-3" onSubmit={() => setCopied(false)}>
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <label htmlFor="token-name" className={labelClass}>
            Name
          </label>
          <input
            id="token-name"
            name="name"
            required
            maxLength={TOKEN_NAME_MAX_LENGTH}
            placeholder="e.g. Claude on my laptop"
            defaultValue={state?.status === "error" ? state.name : ""}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="token-lifetime" className={labelClass}>
            Expires after
          </label>
          <select id="token-lifetime" name="lifetime" defaultValue="90" className={inputClass}>
            {TOKEN_LIFETIMES.map((l) => (
              <option key={l.label} value={String(l.days ?? "never")}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Creating…" : "Create token"}
        </button>
      </form>
      {state?.status === "error" ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}

      {tokens.length ? (
        <ul aria-label="Your access tokens" className="flex flex-col divide-y divide-black/[.06] rounded-xl border border-black/[.08] dark:divide-white/[.08] dark:border-white/[.145]">
          {tokens.map((t) => {
            const s = tokenState(t);
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-black dark:text-zinc-50">{t.name}</span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="font-mono">{t.prefix}…</span>
                    {" · "}created {formatRelativeTime(t.created_at)}
                    {" · "}
                    {t.last_used_at ? `last used ${formatRelativeTime(t.last_used_at)}` : "never used"}
                    {s === "active" && t.expires_at ? ` · expires ${new Date(t.expires_at).toLocaleDateString()}` : ""}
                  </span>
                </div>
                {s !== "active" ? (
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{s === "revoked" ? "Revoked" : "Expired"}</span>
                ) : confirming === t.id ? (
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={revoking}
                      onClick={() => startRevoke(async () => {
                        await revokeAccessTokenAction(t.id);
                        setConfirming(null);
                      })}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
                    >
                      {revoking ? "Revoking…" : `Revoke ${t.name}`}
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} className="text-xs text-zinc-600 underline underline-offset-2 dark:text-zinc-400">
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirming(t.id)} className={`${secondaryButtonClass} !px-3 !py-1.5 !text-xs`}>
                    Revoke…
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={body}>No tokens yet. You can have up to {MAX_ACTIVE_TOKENS} active at a time.</p>
      )}
    </div>
  );
}
