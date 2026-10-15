import type { Metadata } from "next";
import Link from "next/link";
import { Source_Serif_4 } from "next/font/google";
import type { CSSProperties, ReactNode } from "react";

import { Logo } from "@/app/components/Logo";
import { MacWindow, Phone } from "./DeviceFrames";
import { SectionMenu } from "./SectionMenu";
import { getProfile, getUser } from "@/app/lib/auth/session";
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
  "inline-flex items-center whitespace-nowrap rounded-lg bg-[#4F46E5] px-4 py-2.5 text-[15px] font-medium text-white hover:bg-[#4338CA] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4F46E5]";
const secondaryButton =
  "inline-flex items-center rounded-lg border border-[#C9CCD3] bg-white px-4 py-2.5 text-[15px] font-medium text-[#15171C] hover:border-[#9EA3AE] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4F46E5]";
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

// The page's sections, linked from the header.
const SECTIONS = [
  { href: "#demo", label: "Demo" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#product", label: "Product" },
  { href: "#features", label: "Features" },
  { href: "#ai-assistants", label: "AI assistants" },
  { href: "#pricing", label: "Pricing" },
];

// What the Free tier includes: the shipped app (README), nothing promised.
const FREE_INCLUDES = [
  "AI triage on every ticket, with a drafted first reply",
  "Queue and board with response-time targets",
  "Sage, the private assistant for agents",
  "Incident detection and learning from corrections",
  "Analytics, customer ratings and status pages",
];

export default async function WelcomePage() {
  const signedIn = Boolean(await getUser());
  // Staff are the team "Contact us" would reach, and /tickets/new shows them
  // the log-a-ticket-for-a-customer form, so the Custom plan points them at
  // the app instead. (getProfile ensures the profile row first.)
  const isStaff = signedIn && (await getProfile())?.role !== "customer";
  return (
    // A light-only design: data-theme="light" turns off the app's dark:
    // variants inside and paints the page background light (globals.css).
    <div data-theme="light" className={`flex min-h-screen flex-col bg-[#FBFBFC] font-sans ${ink}`}>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="whitespace-nowrap rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#4F46E5]">
          <Logo size={28} />
        </Link>
        <nav aria-label="Page" className="hidden items-center gap-6 xl:flex">
          {SECTIONS.map((section) => (
            <a key={section.href} href={section.href} className={quietLink}>
              {section.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-4 sm:gap-5">
          {/* Below xl: the same section links behind one button; on phones it
              also carries Sign in, which the header has no room for there. */}
          <SectionMenu
            links={signedIn ? SECTIONS : [...SECTIONS, { href: "/login", label: "Sign in", className: "sm:hidden" }]}
            linkClass={quietLink}
          />
          <nav aria-label="Account" className="flex items-center gap-4 sm:gap-5">
            {signedIn ? (
              <Link href="/" className={primaryButton}>
                Open the app
              </Link>
            ) : (
              <>
                <Link href="/login" className={`${quietLink} hidden sm:inline`}>
                  Sign in
                </Link>
                <Link href="/signup" className={primaryButton}>
                  Request access
                </Link>
              </>
            )}
          </nav>
        </div>
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
              {/* On by default: the section promises captions. */}
              <track kind="captions" src="/marketing/demo.vtt" srcLang="en" label="English" default />
              <p>
                Your browser can&apos;t play this video.{" "}
                <a href="/marketing/demo.mp4" className="underline underline-offset-4">
                  Download the demo (MP4, 30 MB)
                </a>
                .
              </p>
            </video>
          </div>
        </section>

        <section id="how-it-works" aria-labelledby="sequence" className="scroll-mt-6 border-t border-[#E3E5EA]">
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

        <section
          id="product"
          aria-labelledby="in-the-app"
          // The page's one dark moment (SUP-60): the video's deep indigo, so
          // the devices sit on a stage.
          className="scroll-mt-6 bg-[radial-gradient(120%_80%_at_20%_0%,#2A2170_0%,#14112F_45%,#0B0A1A_100%)] text-white"
        >
          <div className="mx-auto w-full max-w-6xl px-5 py-24 sm:px-8">
            <h2 id="in-the-app" className="max-w-xl text-[30px] font-semibold leading-tight tracking-[-0.015em] sm:text-[36px]">
              On the desk and on the phone
            </h2>
            <p className="mt-4 max-w-xl text-[17px] leading-[1.65] text-[#C4C0E8]">
              Your team works the queue on a laptop. Customers file and follow their tickets from wherever they are.
            </p>
            <div className="relative mt-12 pb-10 lg:pb-0 lg:pr-36">
              <MacWindow
                src="/marketing/desktop-queue.webp"
                alt="The queue: tickets assigned to the agent, each with its priority, AI signals and response-time status"
                title="Queue"
                sizes="(min-width: 1152px) 944px, (min-width: 1024px) calc(100vw - 208px), calc(100vw - 40px)"
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
                  sizes="(min-width: 1152px) 528px, (min-width: 1024px) calc(50vw - 64px), calc(100vw - 40px)"
                />
                <figcaption className="mt-3 text-[15px] text-[#C4C0E8]">One problem, many tickets: grouped, with one update for staff to post.</figcaption>
              </figure>
              <figure>
                <MacWindow
                  src="/marketing/desktop-analytics.webp"
                  alt="Analytics: tickets per day, replies on time, customer satisfaction and how often the AI's triage is accepted"
                  title="Analytics"
                  sizes="(min-width: 1152px) 528px, (min-width: 1024px) calc(50vw - 64px), calc(100vw - 40px)"
                />
                <figcaption className="mt-3 text-[15px] text-[#C4C0E8]">Response times, ratings and how often the AI gets it right, in one place.</figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section id="features" aria-labelledby="also" className="scroll-mt-6">
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

        <section id="ai-assistants" aria-labelledby="mcp" className="scroll-mt-6 border-t border-[#E3E5EA]">
          <div className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-20 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12">
            <div>
              <h2 id="mcp" className="text-[30px] font-semibold leading-tight tracking-[-0.015em] sm:text-[36px]">
                From your AI assistant, too
              </h2>
              <p className={`mt-2 text-[15px] ${graphite}`}>Coming soon</p>
            </div>
            <div className={`max-w-xl text-[17px] leading-[1.65] ${graphite}`}>
              <p>
                We&apos;re building an MCP server for Support Triage, so you&apos;ll be able to use it from AI assistants
                that speak the Model Context Protocol.
              </p>
              <p className="mt-4">
                The plan: customers file and follow their tickets, and agents work the queue, reading a ticket with the
                AI&apos;s suggestions, replying and changing its status. It isn&apos;t available yet.
              </p>
            </div>
          </div>
        </section>

        <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-6 border-t border-[#E3E5EA]">
          <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8">
            <h2 id="pricing-title" className="text-[30px] font-semibold leading-tight tracking-[-0.015em] sm:text-[36px]">
              Pricing
            </h2>
            <div className="mt-10 grid border-y border-[#E3E5EA] md:grid-cols-2">
              <div className="py-8 md:pr-10">
                <h3 className="text-[20px] font-semibold">Free</h3>
                <p className="mt-3 text-[40px] font-semibold leading-none tracking-[-0.02em]">€0</p>
                <p className={`mt-3 text-[15px] leading-[1.6] ${graphite}`}>
                  Every feature listed here, at no cost. Your team gets agent access once you request it.
                </p>
                <ul className={`mt-6 flex flex-col gap-2.5 text-[15px] leading-[1.5] ${ink}`}>
                  {FREE_INCLUDES.map((item) => (
                    <li key={item} className="flex gap-3">
                      <span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#30A46C]" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Link href={signedIn ? "/" : "/signup"} className={`${primaryButton} mt-8`}>
                  {signedIn ? "Open the app" : "Request access"}
                </Link>
              </div>
              <div className="border-t border-[#E3E5EA] py-8 md:border-l md:border-t-0 md:pl-10">
                <h3 className="text-[20px] font-semibold">Custom</h3>
                <p className="mt-3 text-[40px] font-semibold leading-none tracking-[-0.02em]">Let&apos;s talk</p>
                <p className={`mt-3 text-[15px] leading-[1.6] ${graphite}`}>For larger teams, or teams with particular needs.</p>
                <p className={`mt-6 max-w-md text-[15px] leading-[1.6] ${ink}`}>
                  Tell us about rolling it out to a bigger team, moving your existing tickets over, or something you need that
                  isn&apos;t here yet. We&apos;ll work it out with you.
                </p>
                {isStaff ? (
                  <p className={`mt-8 text-[15px] ${graphite}`}>
                    You&apos;re on the team: requests from customers arrive in your queue.
                  </p>
                ) : (
                  <>
                    <Link href={signedIn ? "/tickets/new" : "/signup"} className={`${secondaryButton} mt-8`}>
                      Contact us
                    </Link>
                    <p className={`mt-3 text-[13px] ${graphite}`}>
                      {signedIn
                        ? "Opens a new ticket: tell us what you need."
                        : "Create an account, then open a ticket telling us what you need."}
                    </p>
                  </>
                )}
              </div>
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
