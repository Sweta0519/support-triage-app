import type { Metadata } from "next";
import Link from "next/link";

import { linkClass } from "@/app/lib/styles";

export const metadata: Metadata = {
  title: "Privacy policy · Support Ticket Triage",
};

// Deliberately outside the (app) route group and listed in PUBLIC_PATHS
// (app/lib/auth/proxy.ts): GDPR Art. 13 requires this notice to be readable
// *before* someone hands over their email on the signup form, so it cannot
// sit behind a login.
//
// Everything below describes what this codebase actually does. If a data
// flow changes (a new column, a new outside service, a retention job), this
// page must change in the same PR -- a policy that drifts from the app is a
// documented mismatch, which regulators treat as worse than no policy.

const sectionTitle = "text-base font-semibold text-black dark:text-zinc-50";
const body = "text-sm leading-relaxed text-zinc-700 dark:text-zinc-300";
const list = "list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300";
const cell = "border-b border-black/[.06] px-3 py-2 align-top text-sm text-zinc-700 dark:border-white/[.08] dark:text-zinc-300";
const head = "border-b border-black/[.12] px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-white/[.16]";

export default function PrivacyPolicyPage() {
  const contact = process.env.PRIVACY_CONTACT_EMAIL;

  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-6 py-12 dark:bg-black">
      <article className="flex w-full max-w-2xl flex-col gap-8">
        <div className="flex items-center gap-2 text-base font-semibold tracking-tight text-black dark:text-zinc-50">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-sm font-bold text-white">
            S
          </span>
          Support Triage
        </div>

        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Privacy policy</h1>
          <p className={body}>
            This page explains what personal data Support Triage collects, why it is allowed to
            hold it, who else receives it, how long it is kept, and what you can ask us to do with
            it. It describes this app as it is actually built. Last updated 15 September 2026.
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className={sectionTitle}>Who is responsible</h2>
          <p className={body}>
            The controller is the team operating this deployment of Support Triage.{" "}
            {contact ? (
              <>
                For any privacy request or question, email{" "}
                <a href={`mailto:${contact}`} className={linkClass}>
                  {contact}
                </a>
                .
              </>
            ) : (
              <>
                For any privacy request or question, contact the team that gave you access to this
                app.
              </>
            )}
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className={sectionTitle}>What we collect and why</h2>
          <p className={body}>
            We only collect what the ticketing service needs to work. There is no advertising, no
            analytics, no tracking scripts, and no marketing list.
          </p>
          <div className="overflow-x-auto rounded-xl border border-black/[.08] dark:border-white/[.08]">
            <table className="w-full min-w-[36rem] border-collapse">
              <thead>
                <tr>
                  <th className={head}>Data</th>
                  <th className={head}>Why we hold it</th>
                  <th className={head}>Lawful basis</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className={cell}>Email address and password</td>
                  <td className={cell}>
                    To create your account, sign you in, and send the confirmation email. The
                    password is stored only as a hash by our authentication provider; we never see
                    it.
                  </td>
                  <td className={cell}>Contract: we cannot give you an account without it.</td>
                </tr>
                <tr>
                  <td className={cell}>Your role (customer, agent, or admin)</td>
                  <td className={cell}>To decide which parts of the app you can use.</td>
                  <td className={cell}>Contract.</td>
                </tr>
                <tr>
                  <td className={cell}>Ticket subject, description, and comments</td>
                  <td className={cell}>
                    To let you report a problem and let support staff answer it. Anything you type
                    here is stored, so please do not include more personal detail than the issue
                    needs.
                  </td>
                  <td className={cell}>Contract: this is the service you asked for.</td>
                </tr>
                <tr>
                  <td className={cell}>AI triage output about your ticket</td>
                  <td className={cell}>
                    When you submit a ticket, an AI model reads it and produces a summary, a suggested
                    category, priority and team, a draft first reply, and flags such as escalation
                    risk. These are suggestions shown only to staff; they never change your ticket
                    or reply to you on their own.
                  </td>
                  <td className={cell}>
                    Legitimate interest: routing tickets to the right person faster, with a human
                    always making the decision.
                  </td>
                </tr>
                <tr>
                  <td className={cell}>Ticket history (status changes, assignments)</td>
                  <td className={cell}>To keep an accurate record of what happened to each ticket.</td>
                  <td className={cell}>Legitimate interest: an auditable support record.</td>
                </tr>
                <tr>
                  <td className={cell}>IP address (public share links only)</td>
                  <td className={cell}>
                    If staff share a public status link for a ticket, visitors&apos; IP addresses
                    are used to limit how often that link can be loaded, to protect it from abuse.
                  </td>
                  <td className={cell}>Legitimate interest: security and abuse prevention.</td>
                </tr>
                <tr>
                  <td className={cell}>Session cookie</td>
                  <td className={cell}>
                    One or more strictly-necessary session cookies keep you signed in. They are
                    HTTP-only, secure, and not used for tracking. Because they are essential, no
                    cookie banner is needed and there are no optional cookies to accept or reject.
                  </td>
                  <td className={cell}>Contract.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className={body}>
            Staff members additionally have private working notes and a private assistant chat.
            Those are the staff member&apos;s own data, visible only to them, and may contain
            customer context they paste in while working a ticket.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className={sectionTitle}>Who else receives your data</h2>
          <p className={body}>
            We do not sell or rent personal data. The following providers process it on our behalf
            so the app can run:
          </p>
          <ul className={list}>
            <li>
              <strong>Supabase</strong> hosts the database and the authentication service. Your
              account, tickets, comments, and AI triage output live there.
            </li>
            <li>
              <strong>Vercel</strong> hosts the application. Like any web host, it sees the
              requests your browser makes and keeps short-lived server logs.
            </li>
            <li>
              <strong>OpenRouter</strong> is the gateway we use for AI calls. The text of your
              ticket (subject and description) and, for staff, note text and assistant messages are
              sent through it to the model providers below. We request that OpenRouter route only
              to providers that do not retain or train on the data.
            </li>
            <li>
              <strong>Anthropic</strong> runs the language model that reads tickets and produces
              triage suggestions and assistant replies.
            </li>
            <li>
              <strong>OpenAI</strong> runs the embedding model that turns ticket and note text into
              numeric vectors so we can find similar or duplicate tickets and search staff notes.
            </li>
          </ul>
          <p className={body}>
            When a new ticket is triaged, the subjects and AI summaries of up to five similar
            existing tickets are also included in the model request so it can spot duplicates.
            Those may be other customers&apos; tickets or your own; ticket descriptions are never
            included, and the result is visible only to staff.
          </p>
          <p className={body}>
            Support staff can create a public status link for a ticket. That link shows the
            ticket subject, its current status, and the AI-written summary to anyone who has the
            URL, without signing in. Links expire after 30 days and staff can revoke them earlier.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className={sectionTitle}>How long we keep it</h2>
          <ul className={list}>
            <li>
              Your account, tickets, comments, ticket history, and AI triage output are kept for as
              long as your account exists, and are removed when you delete it. The app does not
              delete them automatically after a fixed period.
            </li>
            <li>Public share links expire 30 days after they are created.</li>
            <li>
              IP addresses used for rate limiting are deleted about a day after they are
              recorded. The clean-up runs opportunistically, so the exact moment varies by a few
              requests.
            </li>
            <li>Staff notes and assistant chats are kept until the staff member deletes them.</li>
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className={sectionTitle}>Your rights and how to use them</h2>
          <p className={body}>
            If you are in the EU or the UK you have the right to access the data we hold about you,
            receive a copy in a machine-readable format, have it corrected, have it erased, restrict
            or object to how it is used, and complain to your data protection authority.
          </p>
          <p className={body}>
            Both are self-service on your{" "}
            <Link href="/account" className={linkClass}>
              account page
            </Link>
            . &quot;Download my data&quot; gives you a JSON file of everything you can see in the
            app: your profile and your tickets with their comments, plus, for staff, ticket history,
            your notes, assistant chats and ticket actions. AI triage suggestions about your tickets are
            internal staff notes and are not in the file; ask the contact above if you want them.
          </p>
          <p className={body}>
            &quot;Delete my account&quot; permanently removes your sign-in, your profile, your
            tickets and their comments, and your notes and chats. Replies you wrote on other
            people&apos;s tickets are kept without your name so the other party&apos;s record stays
            intact. Your sign-in identity is shared with another app run by the same team, so
            deleting it here deletes it there too. Anything else, including correction or
            objection, goes to the contact above and is answered within one month.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className={sectionTitle}>If something goes wrong</h2>
          <p className={body}>
            If we become aware of a breach that puts your personal data at risk, we will notify the
            relevant supervisory authority within 72 hours of becoming aware of it and, where the
            risk to you is high, tell you directly without undue delay.
          </p>
        </section>

        <footer className="border-t border-black/[.08] pt-6 text-sm dark:border-white/[.08]">
          <Link href="/" className={linkClass}>
            Back to Support Triage
          </Link>
        </footer>
      </article>
    </div>
  );
}
