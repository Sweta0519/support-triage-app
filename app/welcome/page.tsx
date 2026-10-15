import type { Metadata } from "next";
import Link from "next/link";
import { Source_Serif_4 } from "next/font/google";
import type { CSSProperties, ReactNode } from "react";

import { Logo } from "@/app/components/Logo";
import { MacWindow, Phone } from "./DeviceFrames";
import { getUser } from "@/app/lib/auth/session";
import styles from "./welcome.module.css";

// The public homepage (SUP-48). Signed-out visitors see it at / (the session
// proxy rewrites / here); it's also reachable at /welcome. The design plan,
// and why it looks the way it does, is docs/marketing/homepage-design.md.

// The customer's own words are set in a serif; everything the product says
// is in the app's sans.
const serif = Source_Serif_4({ subsets: ["latin"], style: ["normal"], weight: ["400"] });

export const metadata: Metadata = {
  // Served at / (signed out) and /welcome: / is the address to index.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  alternates: { canonical: "/" },
  title: "Support Triage: every ticket read and sorted before anyone opens it",
  description:
    "A help desk where AI reads each new ticket and suggests a category, a priority with its reason, the right team and a first reply. Your team confirms, corrects and sends.",
};

const ink = "text-[#15171C]";
const graphite = "text-[#5B606B]";
const primaryButton =
  "inline-flex items-center rounded-lg bg-[#4F46E5] px-4 py-2.5 text-[15px] font-medium text-white hover:bg-[#4338CA] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4F46E5]";
const quietFooterLink =
  "rounded underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4F46E5]";
const quietLink =
  "rounded text-[15px] font-medium text-[#15171C] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4F46E5]";

// The hero: the real demo ticket and the AI's real read of it.
const TICKET = {
  subject: "Charged twice for Pro this month, need a refund",
  body:
    "Hi, I just noticed two charges of $29 for my Pro plan on my card this month. This is the second time this has happened and I'm getting really frustrated. Please refund the duplicate charge as soon as possible.",
};

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className={styles.reveal} style={{ "--step": n } as CSSProperties}>
      {children}
    </div>
  );
}

// One term/definition pair, revealed in turn (a direct child of the <dl>).
function Field({ label, step, children }: { label: string; step: number; children: ReactNode }) {
  return (
    <div className={`${styles.reveal} grid grid-cols-[6.5rem_1fr] gap-3 py-1.5`} style={{ "--step": step } as CSSProperties}>
      <dt className={`text-[13px] ${graphite}`}>{label}</dt>
      <dd className={`text-[14px] ${ink}`}>{children}</dd>
    </div>
  );
}

function TriageMoment() {
  return (
    <figure
      aria-label="An example ticket and the AI's suggestions for it"
      className="overflow-hidden rounded-xl border border-[#E3E5EA] bg-white shadow-[0_1px_2px_rgba(21,23,28,0.04),0_8px_24px_-12px_rgba(21,23,28,0.12)]"
    >
      <div className="border-b border-[#E3E5EA] px-5 py-4">
        <p className={`text-[13px] ${graphite}`}>New ticket from a customer</p>
        <p className={`mt-1 text-[15px] font-semibold ${ink}`}>{TICKET.subject}</p>
        <blockquote className={`${serif.className} mt-2 text-[16px] leading-[1.6] text-[#2A2D35]`}>{TICKET.body}</blockquote>
      </div>
      <div className="bg-[#FBFBFC] px-5 py-4">
        <Step n={0}>
          <p className={`text-[13px] ${graphite}`}>Read by the AI as it arrives</p>
        </Step>
        <dl className="mt-2">
          <Field label="Category" step={1}>Billing</Field>
          <Field label="Priority" step={2}>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#F5A524]" />
              High
            </span>
            <span className={`mt-0.5 block text-[13px] leading-snug ${graphite}`}>
              Double-charged for the second time, frustrated, and asking for a refund.
            </span>
          </Field>
          <Field label="Team" step={3}>Billing</Field>
          <Field label="Still needed" step={4}>
            The account email or customer ID
          </Field>
        </dl>
        <Step n={5}>
          <div className="mt-3 rounded-lg border border-[#E3E5EA] bg-white px-4 py-3">
            <p className={`text-[13px] ${graphite}`}>Drafted reply, for an agent to edit and send</p>
            <p className={`mt-1 text-[14px] leading-relaxed ${ink}`}>
              Thanks for reaching out. I understand you&apos;ve noticed duplicate charges for your Pro plan this month, and
              I&apos;m sorry for the frustration. To help me investigate, could you share your account email?
            </p>
          </div>
        </Step>
      </div>
    </figure>
  );
}

const SEQUENCE = [
  {
    title: "A customer writes in",
    text: "Through the web form, or an agent logs a call or chat on the customer's behalf.",
  },
  {
    title: "The AI reads it in seconds",
    text: "It suggests a category, a priority and the reason for it, the right team, similar past tickets, how frustrated the customer is, and what's still missing.",
  },
  {
    title: "An agent decides",
    text: "They confirm the suggestions or correct them in one click, claim the ticket, and edit the drafted reply before sending it. The AI never changes a ticket or replies on its own.",
  },
  {
    title: "The next ticket gets it right",
    text: "Staff corrections are fed back as examples on similar tickets, and analytics show whether the AI's suggestions are being accepted more often.",
  },
];

const ALSO = [
  { name: "Sage", text: "A private assistant for each agent that answers from their own notes and says which note it used." },
  {
    name: "Incident detection",
    text: "When several customers report the same problem within an hour, their tickets are grouped and one update is drafted for staff to review and post to all of them.",
  },
  { name: "Queue and board", text: "Response-time targets for each priority, urgent work first, and drag and drop between statuses." },
  { name: "Analytics", text: "Response times, customer ratings, and how often the AI's suggestions are kept as they are." },
  { name: "Status pages", text: "Share a read-only summary of any ticket through a link." },
  { name: "Customer ratings", text: "Customers rate resolved tickets, and admins see the results for each person on the team." },
];

export default async function WelcomePage() {
  const signedIn = Boolean(await getUser());
  return (
    // A light-only design: data-theme="light" turns off the app's dark:
    // variants inside and paints the page background light (globals.css).
    <div data-theme="light" className={`flex min-h-screen flex-col bg-[#FBFBFC] font-sans ${ink}`}>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#4F46E5]">
          <Logo size={28} />
        </Link>
        <nav aria-label="Account" className="flex items-center gap-5">
          {signedIn ? (
            <Link href="/" className={primaryButton}>
              Open the app
            </Link>
          ) : (
            <>
              <Link href="/login" className={quietLink}>
                Sign in
              </Link>
              <Link href="/signup" className={primaryButton}>
                Request access
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:pt-16">
          <div className="max-w-xl">
            <h1 className="text-[40px] font-semibold leading-[1.08] tracking-[-0.02em] sm:text-[56px]">
              Every new ticket, read and sorted before anyone opens it.
            </h1>
            <p className={`mt-6 text-[17px] leading-[1.65] ${graphite}`}>
              Support Triage is a help desk with an AI that reads each ticket as it arrives. It suggests a category, a priority
              with its reason, the right team and a first reply. Your team confirms or corrects it, and a person always sends
              the reply.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-6">
              <Link href={signedIn ? "/" : "/signup"} className={primaryButton}>
                {signedIn ? "Open the app" : "Request access"}
              </Link>
              <a href="#demo" className={quietLink}>
                Watch the 2-minute demo
              </a>
            </div>
          </div>
          <TriageMoment />
        </section>

        <section id="demo" aria-labelledby="demo-title" className="scroll-mt-6 border-t border-[#E3E5EA]">
          <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8">
            <h2 id="demo-title" className="max-w-xl text-[30px] font-semibold leading-tight tracking-[-0.015em] sm:text-[36px]">
              See it work in two minutes
            </h2>
            <p className={`mt-4 max-w-xl text-[17px] leading-[1.65] ${graphite}`}>
              A ticket arrives, the AI reads it, an agent decides, and Sage answers from the team&apos;s own notes. Narrated,
              with captions.
            </p>
            {/* Nothing downloads until play is pressed (preload="none"); the
                file is the full-quality master, not a compressed copy. */}
            <video
              controls
              playsInline
              preload="none"
              poster="/marketing/demo-poster.webp"
              aria-label="Support Triage product demo, 2 minutes, narrated"
              className="mt-10 aspect-video w-full rounded-xl border border-black/[.12] bg-[#0A0A1A] shadow-[0_1px_2px_rgba(21,23,28,0.06),0_24px_48px_-24px_rgba(21,23,28,0.28)]"
            >
              <source src="/marketing/demo.mp4" type="video/mp4" />
              <track kind="captions" src="/marketing/demo.vtt" srcLang="en" label="English" />
            </video>
          </div>
        </section>

        <section aria-labelledby="sequence" className="border-t border-[#E3E5EA]">
          <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8">
            <h2 id="sequence" className="max-w-xl text-[30px] font-semibold leading-tight tracking-[-0.015em] sm:text-[36px]">
              How a ticket moves through Support Triage
            </h2>
            <ol className="mt-10 grid gap-x-12 gap-y-8 border-l border-[#E3E5EA] pl-6 sm:grid-cols-2 sm:border-l-0 sm:pl-0 lg:grid-cols-4">
              {SEQUENCE.map((step, i) => (
                <li key={step.title} className="sm:border-t sm:border-[#E3E5EA] sm:pt-5">
                  <p className={`text-[14px] tabular-nums ${graphite}`}>{i + 1}</p>
                  <h3 className="mt-1 text-[18px] font-semibold leading-snug">{step.title}</h3>
                  <p className={`mt-2 text-[15px] leading-[1.6] ${graphite}`}>{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="in-the-app" className="border-t border-[#E3E5EA]">
          <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8">
            <h2 id="in-the-app" className="max-w-xl text-[30px] font-semibold leading-tight tracking-[-0.015em] sm:text-[36px]">
              On the desk and on the phone
            </h2>
            <p className={`mt-4 max-w-xl text-[17px] leading-[1.65] ${graphite}`}>
              Your team works the queue on a laptop. Customers file and follow their tickets from wherever they are.
            </p>
            <div className="relative mt-12 pb-10 lg:pb-0 lg:pr-36">
              <MacWindow
                src="/marketing/desktop-queue.webp"
                alt="The queue: tickets assigned to the agent, each with its priority, AI signals and response-time status"
                title="Queue"
              />
              <div className="mt-10 flex justify-center lg:absolute lg:-bottom-10 lg:right-0 lg:mt-0">
                <Phone
                  src="/marketing/phone-ticket.webp"
                  alt="A customer's view of their ticket on a phone, with the agent's reply"
                />
              </div>
            </div>
            <div className="mt-24 grid gap-10 lg:grid-cols-2">
              <figure>
                <MacWindow
                  src="/marketing/desktop-incident.webp"
                  alt="An incident: three tickets about the same webhook problem from different customers, with an AI-drafted update for staff to post"
                  title="Incident"
                />
                <figcaption className={`mt-3 text-[15px] ${graphite}`}>One problem, many tickets: grouped, with one update for staff to post.</figcaption>
              </figure>
              <figure>
                <MacWindow
                  src="/marketing/desktop-analytics.webp"
                  alt="Analytics: tickets per day, replies on time, customer satisfaction and how often the AI's triage is accepted"
                  title="Analytics"
                />
                <figcaption className={`mt-3 text-[15px] ${graphite}`}>Response times, ratings and how often the AI gets it right, in one place.</figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section aria-labelledby="also" className="border-t border-[#E3E5EA]">
          <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8">
            <h2 id="also" className="text-[30px] font-semibold leading-tight tracking-[-0.015em] sm:text-[36px]">
              Also included
            </h2>
            <dl className="mt-10 grid gap-x-12 gap-y-7 sm:grid-cols-2">
              {ALSO.map((item) => (
                <div key={item.name} className="max-w-md">
                  <dt className="text-[17px] font-semibold">{item.name}</dt>
                  <dd className={`mt-1 text-[15px] leading-[1.6] ${graphite}`}>{item.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section aria-labelledby="mcp" className="border-t border-[#E3E5EA]">
          <div className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-20 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12">
            <div>
              <h2 id="mcp" className="text-[30px] font-semibold leading-tight tracking-[-0.015em] sm:text-[36px]">
                From your AI assistant, too
              </h2>
              <p className={`mt-2 text-[15px] ${graphite}`}>Coming soon</p>
            </div>
            <div className={`max-w-xl text-[17px] leading-[1.65] ${graphite}`}>
              <p>
                Support Triage will work as an MCP server, so you can use it from Claude, Cursor or any other assistant that
                speaks the Model Context Protocol. Connect with a personal access token from your account page.
              </p>
              <p className="mt-4">
                Customers will be able to file and follow their tickets. Agents will be able to work the queue: read a ticket
                with the AI&apos;s suggestions, claim it, reply and change its status. It acts with your own account&apos;s
                permissions, nothing more.
              </p>
            </div>
          </div>
        </section>

        <section className="border-t border-[#E3E5EA]">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-5 py-16 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div>
              <h2 className="text-[26px] font-semibold tracking-[-0.01em]">Use it with your team.</h2>
              <p className={`mt-1 max-w-xl text-[15px] leading-[1.6] ${graphite}`}>
                Create an account, then open a ticket telling us about your team. We&apos;ll set you up with agent
                access. It&apos;s free.
              </p>
            </div>
            <Link href={signedIn ? "/" : "/signup"} className={primaryButton}>
              {signedIn ? "Open the app" : "Request access"}
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#E3E5EA]">
        <div className={`mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-6 text-[14px] sm:px-8 ${graphite}`}>
          <span>Support Triage</span>
          <Link href="/privacy" className={quietFooterLink}>
            Privacy policy
          </Link>
          {signedIn ? null : (
            <Link href="/login" className={quietFooterLink}>
              Sign in
            </Link>
          )}
        </div>
      </footer>
    </div>
  );
}
