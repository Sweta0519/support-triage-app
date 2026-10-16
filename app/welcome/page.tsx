import type { Metadata } from "next";
import Link from "next/link";
import { Source_Serif_4 } from "next/font/google";
import type { CSSProperties, ReactNode } from "react";

import { Logo } from "@/app/components/Logo";
import { MacWindow, Phone } from "./DeviceFrames";
import { SectionMenu } from "./SectionMenu";
import { Enlargeable } from "./Enlargeable";
import { McpConnect } from "@/app/components/mcp/McpConnect";
import { AssistantLogo, ASSISTANTS } from "@/app/components/mcp/AssistantLogos";
import { PUBLIC_SITE_URL } from "@/app/lib/site-url";
import { getProfile, getUser } from "@/app/lib/auth/session";
import styles from "./welcome.module.css";

// The public homepage (SUP-48). Signed-out visitors see it at / (the session
// proxy rewrites / here); it's also reachable at /welcome. The design plan,
// and why it looks the way it does, is docs/marketing/homepage-design.md.

// The customer's own words are set in a serif; everything the product says
// is in the app's sans.
const serif = Source_Serif_4({ subsets: ["latin"], style: ["normal"], weight: ["400"] });

// The share card's wording (scripts/render-og-image.mjs) says the same thing.
const TITLE = "Support Triage: every new ticket, read and sorted before anyone opens it";
const DESCRIPTION =
  "A help desk where AI reads each new ticket and suggests a category, a priority with its reason, the right team and a first reply. Your team confirms, corrects and sends.";

export const metadata: Metadata = {
  // Served at / (signed out) and /welcome: / is the address to index. The
  // base URL comes from the root layout's metadataBase.
  alternates: { canonical: "/" },
  title: TITLE,
  description: DESCRIPTION,
  // The share card (SUP-52), rendered by scripts/render-og-image.mjs.
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Support Triage",
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: "/marketing/og.png",
        width: 1200,
        height: 630,
        alt: "Support Triage: every new ticket, read and sorted before anyone opens it. An AI help desk where people decide.",
      },
    ],
  },
  // Title, description and image come from openGraph (Next copies them).
  twitter: { card: "summary_large_image" },
};

// The MCP connector (SUP-65). Every step and tool named here works today;
// docs/mcp.md is the reference.
const MCP_STEPS = [
  { title: "Create an access token", text: "On your Account page. It's shown once, and you can revoke it any time." },
  { title: "Add Support Triage to your assistant", text: "One command, or a few lines of its config." },
  {
    title: "Ask in your own words",
    text: "\u201cFile a ticket: my invoice won't download.\u201d \u201cAny news on #1484?\u201d The assistant does the rest.",
  },
];

// Every "Get in touch" button: the sign-up form with the questions about the
// visitor's team, which files their message as a ticket (SUP-58). It was
// "Request access" until SUP-72: the app has one support team, so this is a
// way to reach that team, not access to a team of your own.
// (Custom's "Contact us" is a plain sign-up, to file a ticket.)
const REQUEST_ACCESS = "/signup?access=1";

const ink = "text-[#15171C]";
const graphite = "text-[#5B606B]";
// Copy on the dark product band (about 9:1 on its lightest stop).
const onDarkCopy = "text-[#C4C0E8]";

// Typography (SUP-61): one section-heading style, and one vertical rhythm for
// the content sections. The hero and the closing call to action keep their
// own, tighter padding on purpose. Line wrapping is set once on <main>:
// balanced headings, "pretty" paragraphs (no lonely last word).
const sectionHeading = "max-w-2xl text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[38px]";
const sectionPad = "py-24";
const primaryButton =
  "inline-flex items-center whitespace-nowrap rounded-lg bg-[#4F46E5] px-4 py-2.5 text-[15px] font-medium text-white hover:bg-[#4338CA] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4F46E5]";
const secondaryButton =
  "inline-flex items-center rounded-lg border border-[#C9CCD3] bg-white px-4 py-2.5 text-[15px] font-medium text-[#15171C] hover:border-[#9EA3AE] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4F46E5]";
// Navigation links (SUP-64): quiet grey that darkens on hover, no underline.
// Underlines are kept for links inside sentences.
const linkBase =
  "rounded text-[#5B606B] transition-colors duration-150 hover:text-[#15171C] focus-visible:text-[#15171C] focus-visible:outline-2 focus-visible:outline-[#4F46E5]";
const navLink = `${linkBase} text-[15px] font-medium focus-visible:outline-offset-4`;
const footerLink = `${linkBase} text-[14px] focus-visible:outline-offset-2`;
// A text action next to a primary button (hero): ink, and lighter on hover,
// like the other links' quiet change; no underline, no brand colour.
const quietLink =
  "rounded text-[15px] font-medium text-[#15171C] transition-colors duration-150 hover:text-[#5B606B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4F46E5]";

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
  { name: "Team labels and flags", text: "Labels the team defines, edited right on the cards, and private flags for what to follow up." },
  {
    name: "MCP connector",
    text: "Use Support Triage from Claude Code, Cursor, VS Code or Codex with a personal access token. The assistant acts as you, with exactly your permissions, and each action it takes is a step you see in it. Support Triage's own AI still only suggests.",
  },
];

// "Safe by design" (SUP-63): each line is how the app actually works
// (CLAUDE.md: advisory triage, RLS on every table, untrusted ticket text in
// a delimited prompt with strict JSON-schema output). CLAUDE.md points back
// here, so a change to any of those keeps this copy true.
const SAFETY = [
  {
    title: "The AI only suggests",
    text: "It never changes a ticket's status and never replies to a customer. A person on your team does both.",
  },
  {
    title: "Customers see only their own tickets",
    // The one exception is a status page staff choose to publish (read via
    // the service role by token), so the copy says so.
    text: "Enforced by the database itself, with row-level security on every table. The only way a ticket is seen outside its owner's account is a read-only status page that staff choose to publish.",
  },
  {
    // Mitigations, not a guarantee against prompt injection: worded as what
    // the code does (delimited prompt, strict JSON schema, validated output).
    title: "Ticket text is information, not instructions",
    text: "The AI is told to treat what customers write as information to assess, never as instructions to follow, and its answers are checked against a strict format.",
  },
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

// The footer's link groups: the page's sections (the header's own list, so
// the two can't drift), the account links for the visitor's state, and legal.
const FOOTER_PRODUCT = { id: "product", title: "Product", links: SECTIONS };
const FOOTER_LEGAL = { id: "legal", title: "Legal", links: [{ href: "/privacy", label: "Privacy policy" }] };
function footerGroups(signedIn: boolean) {
  const account = signedIn
    ? [{ href: "/", label: "Open the app" }]
    : [
        { href: "/login", label: "Sign in" },
        { href: REQUEST_ACCESS, label: "Get in touch" },
      ];
  return [FOOTER_PRODUCT, { id: "account", title: "Account", links: account }, FOOTER_LEGAL];
}

// What the Free tier includes: the shipped app (README), nothing promised.
const FREE_INCLUDES = [
  "AI triage on every ticket, with a drafted first reply",
  "Queue and board with response-time targets",
  "Sage, the private assistant for agents",
  "Incident detection and learning from corrections",
  "Analytics, customer ratings and status pages",
  "The MCP connector for your AI assistant",
];

export default async function WelcomePage() {
  const signedIn = Boolean(await getUser());
  // Staff are the team "Contact us" would reach, and /tickets/new shows them
  // the log-a-ticket-for-a-customer form, so the Custom plan points them at
  // the app instead. (getProfile ensures the profile row first.)
  const isStaff = signedIn && (await getProfile())?.role !== "customer";
  return (
    // A light design with one dark band (the screenshots, SUP-60):
    // data-theme="light" turns off the app's dark: variants inside and paints
    // the page background light (globals.css).
    <div data-theme="light" className={`flex min-h-screen flex-col bg-[#FBFBFC] font-sans ${ink}`}>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="whitespace-nowrap rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#4F46E5]">
          <Logo size={28} />
        </Link>
        <nav aria-label="Page" className="hidden items-center gap-6 xl:flex">
          {SECTIONS.map((section) => (
            <a key={section.href} href={section.href} className={navLink}>
              {section.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-4 sm:gap-5">
          {/* Below xl: the same section links behind one button; on phones it
              also carries Sign in, which the header has no room for there. */}
          <SectionMenu
            links={signedIn ? SECTIONS : [...SECTIONS, { href: "/login", label: "Sign in", className: "sm:hidden" }]}
            linkClass={navLink}
          />
          <nav aria-label="Account" className="flex items-center gap-4 sm:gap-5">
            {signedIn ? (
              <Link href="/" className={primaryButton}>
                Open the app
              </Link>
            ) : (
              <>
                <Link href="/login" className={`${navLink} hidden sm:inline`}>
                  Sign in
                </Link>
                <Link href={REQUEST_ACCESS} className={primaryButton}>
                  Get in touch
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1 text-pretty [&_h1]:text-balance [&_h2]:text-balance [&_h3]:text-balance">
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:pt-16">
          <div className="max-w-xl">
            <h1 className="text-[40px] font-semibold leading-[1.07] tracking-[-0.025em] sm:text-[56px] lg:text-[52px] xl:text-[64px]">
              Every new ticket, read and sorted before anyone opens it.
            </h1>
            <p className={`mt-6 text-[17px] leading-[1.65] ${graphite}`}>
              Support Triage is a help desk with an AI that reads each ticket as it arrives. It suggests a category, a priority
              with its reason, the right team and a first reply. Your team confirms or corrects it, and a person always sends
              the reply.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-6">
              <Link href={signedIn ? "/" : REQUEST_ACCESS} className={primaryButton}>
                {signedIn ? "Open the app" : "Get in touch"}
              </Link>
              <a href="#demo" className={quietLink}>
                Watch the 2-minute demo
              </a>
            </div>
          </div>
          <TriageMoment />
        </section>

        <section id="demo" aria-labelledby="demo-title" className="scroll-mt-6 border-t border-[#E3E5EA]">
          <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${sectionPad}`}>
            <h2 id="demo-title" className={sectionHeading}>
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
          <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${sectionPad}`}>
            <h2 id="sequence" className={sectionHeading}>
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

        {/* The page's one dark moment (SUP-60): the video's deep indigo, so
            the devices sit on a stage. */}
        <section
          id="product"
          aria-labelledby="in-the-app"
          className="scroll-mt-6 bg-[#14112F] bg-[radial-gradient(120%_80%_at_20%_0%,#2A2170_0%,#14112F_45%,#0B0A1A_100%)] text-white print:bg-white print:text-[#15171C] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]"
        >
          <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${sectionPad}`}>
            <h2 id="in-the-app" className={sectionHeading}>
              On the desk and on the phone
            </h2>
            <p className={`mt-4 max-w-xl text-[17px] leading-[1.65] ${onDarkCopy}`}>
              Your team works the queue on a laptop. Customers file and follow their tickets from wherever they are.
            </p>
            <div className="relative mt-12 pb-10 lg:pb-0 lg:pr-36">
              <Enlargeable src="/marketing/desktop-queue.webp" alt="The queue: tickets assigned to the agent, each with its priority, AI signals and response-time status">
                <MacWindow
                  src="/marketing/desktop-queue.webp"
                  alt="The queue: tickets assigned to the agent, each with its priority, AI signals and response-time status"
                  title="Queue"
                  sizes="(min-width: 1152px) 944px, (min-width: 1024px) calc(100vw - 208px), calc(100vw - 40px)"
                />
              </Enlargeable>
              <div className="mt-10 flex justify-center lg:absolute lg:-bottom-10 lg:right-0 lg:mt-0">
                <Enlargeable src="/marketing/phone-ticket.webp" alt="A customer's view of their ticket on a phone, with the agent's reply" fit>
                  <Phone
                    src="/marketing/phone-ticket.webp"
                    alt="A customer's view of their ticket on a phone, with the agent's reply"
                  />
                </Enlargeable>
              </div>
            </div>
            <div className="mt-24 grid gap-10 lg:grid-cols-2">
              <figure>
                <Enlargeable src="/marketing/desktop-incident.webp" alt="An incident: three tickets about the same webhook problem from different customers, with an AI-drafted update for staff to post">
                  <MacWindow
                    src="/marketing/desktop-incident.webp"
                    alt="An incident: three tickets about the same webhook problem from different customers, with an AI-drafted update for staff to post"
                    title="Incident"
                    sizes="(min-width: 1152px) 528px, (min-width: 1024px) calc(50vw - 64px), calc(100vw - 40px)"
                  />
                </Enlargeable>
                <figcaption className={`mt-3 text-[15px] ${onDarkCopy}`}>One problem, many tickets: grouped, with one update for staff to post.</figcaption>
              </figure>
              <figure>
                <Enlargeable src="/marketing/desktop-analytics.webp" alt="Analytics: tickets per day, replies on time, customer satisfaction and how often the AI's triage is accepted">
                  <MacWindow
                    src="/marketing/desktop-analytics.webp"
                    alt="Analytics: tickets per day, replies on time, customer satisfaction and how often the AI's triage is accepted"
                    title="Analytics"
                    sizes="(min-width: 1152px) 528px, (min-width: 1024px) calc(50vw - 64px), calc(100vw - 40px)"
                  />
                </Enlargeable>
                <figcaption className={`mt-3 text-[15px] ${onDarkCopy}`}>Response times, ratings and how often the AI gets it right, in one place.</figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section id="features" aria-labelledby="also" className="scroll-mt-6">
          <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${sectionPad}`}>
            <h2 id="also" className={sectionHeading}>
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

        <section aria-labelledby="safe" className="border-t border-[#E3E5EA]">
          <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${sectionPad}`}>
            <h2 id="safe" className={sectionHeading}>
              Safe by design
            </h2>
            <ul className="mt-10 grid gap-x-12 gap-y-8 md:grid-cols-3">
              {SAFETY.map((item) => (
                <li key={item.title} className="border-t border-[#E3E5EA] pt-5">
                  <h3 className="text-balance text-[18px] font-semibold leading-snug">{item.title}</h3>
                  <p className={`mt-2 text-pretty text-[15px] leading-[1.6] ${graphite}`}>{item.text}</p>
                </li>
              ))}
            </ul>
            <p className={`mt-10 text-[15px] ${graphite}`}>
              What we collect and why is in the{" "}
              <Link
                href="/privacy"
                className="rounded font-medium text-[#15171C] underline underline-offset-4 hover:text-[#4F46E5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4F46E5]"
              >
                privacy policy
              </Link>
              .
            </p>
          </div>
        </section>

        <section id="ai-assistants" aria-labelledby="mcp" className="scroll-mt-6 border-t border-[#E3E5EA]">
          <div className={`mx-auto grid w-full max-w-6xl items-start gap-12 px-5 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] ${sectionPad}`}>
            <div>
              <h2 id="mcp" className={sectionHeading}>
                From your AI assistant, too
              </h2>
              <p className={`mt-5 max-w-xl text-[17px] leading-[1.65] ${graphite}`}>
                Support Triage is an MCP server. Connect an AI assistant that speaks the Model Context Protocol, and it
                works with your tickets as you, with exactly your permissions.
              </p>
              <ol className="mt-8 flex max-w-xl flex-col gap-5">
                {MCP_STEPS.map((step, i) => (
                  <li key={step.title} className="flex gap-4">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#E3E5EA] text-[13px] font-medium text-[#5B606B]">
                      {i + 1}
                    </span>
                    <div>
                      <h3 className="text-[16px] font-semibold leading-snug">{step.title}</h3>
                      <p className={`mt-1 text-[15px] leading-[1.6] ${graphite}`}>{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className={`mt-8 max-w-xl text-[15px] leading-[1.6] ${graphite}`}>
                Customers file, follow and reply to their tickets. Support agents work the queue: read a ticket with the
                AI&apos;s triage, claim it, reply, and move it on. The AI&apos;s draft reply is only ever a suggestion.
              </p>
            </div>
            <div className="min-w-0">
              <McpConnect endpoint={`${PUBLIC_SITE_URL}/api/mcp`} showExample />
              <div className="mt-6">
                <p className={`text-[13px] font-medium ${graphite}`}>Works with</p>
                <ul aria-label="Works with" className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
                  {ASSISTANTS.map((tool) => (
                    <li key={tool.id} className="flex items-center gap-2 text-[14px] font-medium text-[#3D414B]">
                      <AssistantLogo mark={tool.mark} className={`h-[18px] w-[18px] ${tool.colorClass ?? "text-[#15171C]"}`} />
                      {tool.name}
                    </li>
                  ))}
                </ul>
                <p className={`mt-4 text-[13px] leading-[1.6] ${graphite}`}>
                  Any MCP client that can send a token works. ChatGPT and the Claude apps&apos; connectors sign in with
                  OAuth, which isn&apos;t supported yet. Product names and logos are trademarks of their owners.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-6 border-t border-[#E3E5EA]">
          <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${sectionPad}`}>
            <h2 id="pricing-title" className={sectionHeading}>
              Pricing
            </h2>
            <div className="mt-10 grid border-y border-[#E3E5EA] md:grid-cols-2">
              <div className="py-8 md:pr-10">
                <h3 className="text-[20px] font-semibold">Free</h3>
                <p className="mt-3 text-[44px] font-semibold leading-none tracking-[-0.025em]">€0</p>
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
                <Link href={signedIn ? "/" : REQUEST_ACCESS} className={`${primaryButton} mt-8`}>
                  {signedIn ? "Open the app" : "Get in touch"}
                </Link>
              </div>
              <div className="border-t border-[#E3E5EA] py-8 md:border-l md:border-t-0 md:pl-10">
                <h3 className="text-[20px] font-semibold">Custom</h3>
                <p className="mt-3 text-[44px] font-semibold leading-none tracking-[-0.025em]">Let&apos;s talk</p>
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
              <h2 className="text-[26px] font-semibold tracking-[-0.015em]">Use it with your team.</h2>
              <p className={`mt-1 max-w-xl text-[15px] leading-[1.6] ${graphite}`}>
                Create an account, then open a ticket telling us about your team. We&apos;ll set you up with agent
                access. It&apos;s free.
              </p>
            </div>
            <Link href={signedIn ? "/" : REQUEST_ACCESS} className={primaryButton}>
              {signedIn ? "Open the app" : "Get in touch"}
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#E3E5EA]">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="max-w-xs">
            <Logo size={24} />
            <p className={`mt-3 text-[14px] leading-[1.6] ${graphite}`}>
              A help desk where AI reads every ticket and people make every decision.
            </p>
          </div>
          {/* One footer landmark; each group is a list named by its title
              (a label, not a heading: these aren't page sections). Two
              columns on phones, three from md. */}
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-3">
            {footerGroups(signedIn).map((group) => (
              <div key={group.id}>
                <p id={`footer-${group.id}`} className="text-[13px] font-semibold text-[#15171C]">
                  {group.title}
                </p>
                <ul aria-labelledby={`footer-${group.id}`} className="mt-3 flex flex-col gap-2.5">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      {link.href.startsWith("#") ? (
                        <a href={link.href} className={footerLink}>
                          {link.label}
                        </a>
                      ) : (
                        <Link href={link.href} className={footerLink}>
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
