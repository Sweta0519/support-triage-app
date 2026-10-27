"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { signOutAction } from "@/app/lib/auth/actions";
import { pendingAccessRequestCountAction } from "@/app/(app)/admin/actions";
import { Avatar } from "@/app/components/Avatar";
import { Logo } from "@/app/components/Logo";
import { PresenceSelect } from "@/app/components/PresenceSelect";
import { roleBadgeClasses } from "@/app/lib/badges";
import type { AppRole } from "@/app/lib/db/profiles";
import type { Presence } from "@/app/lib/presence";

// The app's navigation, the same shape for every role: a left sidebar on
// wide screens, a top bar with a menu button on phones. Which links show
// depends on the role, but that's cosmetic -- every page still checks the
// role server-side (requireRole and friends).

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  // Paths that count as "here" for highlighting.
  isActive: (path: string) => boolean;
  // Something waiting there (access requests): a number beside the label.
  count?: number;
};

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const icons = {
  inbox: (
    <svg {...iconProps}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  ),
  board: (
    <svg {...iconProps}>
      <rect x="3" y="3" width="5" height="18" rx="1" />
      <rect x="10" y="3" width="5" height="12" rx="1" />
      <rect x="17" y="3" width="4" height="8" rx="1" />
    </svg>
  ),
  plus: (
    <svg {...iconProps}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  note: (
    <svg {...iconProps}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </svg>
  ),
  chart: (
    <svg {...iconProps}>
      <path d="M3 3v18h18" />
      <path d="M8 17v-5M13 17V8M18 17v-9" />
    </svg>
  ),
  // A person with a plus: access requests (SUP-68).
  userPlus: (
    <svg {...iconProps}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </svg>
  ),
  shield: (
    <svg {...iconProps}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  // A pulse line: incidents (SUP-42).
  pulse: (
    <svg {...iconProps}>
      <path d="M3 12h4l2-5 4 10 2-5h6" />
    </svg>
  ),
  tag: (
    <svg {...iconProps}>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </svg>
  ),
  menu: (
    <svg {...iconProps} width={20} height={20}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
  close: (
    <svg {...iconProps} width={20} height={20}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
};

// A link is active on its own page and anything below it.
const under = (href: string) => (p: string) => p === href || p.startsWith(`${href}/`);

// The access section: Users and Access requests share one heading and tab
// set (the (access) route group under /admin).
const underAccess = (p: string) => under("/admin/access-requests")(p) || under("/admin/users")(p);

function navItems(role: AppRole, accessRequests: number): NavItem[] {
  if (role === "customer") {
    return [
      {
        href: "/tickets",
        label: "My tickets",
        icon: icons.inbox,
        isActive: (p) => p === "/tickets" || (p.startsWith("/tickets/") && p !== "/tickets/new"),
      },
      { href: "/tickets/new", label: "New ticket", icon: icons.plus, isActive: (p) => p === "/tickets/new" },
    ];
  }
  const staff: NavItem[] = [
    // A ticket page is opened from the queue, so it highlights Queue.
    {
      href: "/queue",
      label: "Queue",
      icon: icons.inbox,
      isActive: (p) => p === "/queue" || (p.startsWith("/tickets/") && p !== "/tickets/new"),
    },
    { href: "/board", label: "Board", icon: icons.board, isActive: (p) => p === "/board" },
    // Logging a ticket for a customer who called or emailed.
    { href: "/tickets/new", label: "New ticket", icon: icons.plus, isActive: (p) => p === "/tickets/new" },
    { href: "/notes", label: "Notes", icon: icons.note, isActive: under("/notes") },
    { href: "/labels", label: "Labels", icon: icons.tag, isActive: under("/labels") },
    { href: "/incidents", label: "Incidents", icon: icons.pulse, isActive: under("/incidents") },
  ];
  if (role === "admin") {
    staff.push(
      { href: "/analytics", label: "Analytics", icon: icons.chart, isActive: under("/analytics") },
      {
        href: "/admin/access-requests",
        label: "Access requests",
        icon: icons.userPlus,
        isActive: underAccess,
        count: accessRequests,
      },
      {
        href: "/admin",
        label: "Admin",
        icon: icons.shield,
        isActive: (p) => under("/admin")(p) && !underAccess(p),
      }
    );
  }
  return staff;
}

const linkBase =
  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors";
const linkIdle =
  "text-zinc-600 hover:bg-black/[.04] hover:text-black dark:text-zinc-400 dark:hover:bg-white/[.06] dark:hover:text-zinc-50";
const linkActive = "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300";

// "(3) Support Ticket Triage": the waiting access requests in front of the
// tab title (SUP-71), so an admin notices them with the app in a background
// tab. Only while some are waiting. Next can rewrite or replace the <title>
// element (on navigation, or once titles vary by page), so an observer puts
// the prefix back; only the prefix this hook added is ever removed.
function useTitleCount(count: number) {
  useEffect(() => {
    if (count <= 0) return;
    const prefix = `(${count}) `;
    let watched: Element | null = null;
    const observer = new MutationObserver(() => apply());
    function apply() {
      if (!document.title.startsWith(prefix)) document.title = prefix + document.title;
      const el = document.querySelector("title");
      if (el && el !== watched) {
        watched = el;
        observer.observe(el, { childList: true, characterData: true, subtree: true });
      }
    }
    observer.observe(document.head, { childList: true });
    apply();
    return () => {
      observer.disconnect();
      if (document.title.startsWith(prefix)) document.title = document.title.slice(prefix.length);
    };
  }, [count]);
}

// How often an admin's open tab re-checks the count (SUP-71).
const ACCESS_REQUEST_POLL_MS = 60_000;

// The waiting count, from the layout on each page load and re-checked every
// minute while the tab stays open, so a new request reaches a background tab.
function useAccessRequestCount(isAdmin: boolean, fromServer: number): number {
  const [count, setCount] = useState(fromServer);
  const [seen, setSeen] = useState(fromServer);
  if (fromServer !== seen) {
    setSeen(fromServer);
    setCount(fromServer);
  }
  useEffect(() => {
    if (!isAdmin) return;
    const timer = setInterval(() => {
      pendingAccessRequestCountAction().then(setCount, () => {
        // Offline or signed out: keep the last count.
      });
    }, ACCESS_REQUEST_POLL_MS);
    return () => clearInterval(timer);
  }, [isAdmin]);
  return count;
}

// Only what the sidebar shows, not the whole profile row.
export function AppSidebar({
  profile,
  accessRequests = 0,
}: {
  profile: {
    id: string;
    email: string;
    fullName: string | null;
    avatarPath: string | null;
    role: AppRole;
    // Staff only (SUP-76): customers have no presence to show or set.
    // byHours: their working hours set it, not their own pick (SUP-85).
    presence: { shown: Presence; byHours: boolean } | null;
  };
  // Pending access requests, for admins (SUP-68).
  accessRequests?: number;
}) {
  const pathname = usePathname();
  const menuButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Close the phone menu whenever the page changes (adjusting state during
  // render rather than in an effect). Tapping the current page's link
  // doesn't change the path, so links also close it on click.
  const [shownPath, setShownPath] = useState(pathname);
  if (pathname !== shownPath) {
    setShownPath(pathname);
    setOpen(false);
  }
  const close = () => setOpen(false);

  const waitingCount = useAccessRequestCount(profile.role === "admin", accessRequests);
  const items = navItems(profile.role, waitingCount);
  useTitleCount(waitingCount);
  const waiting = waitingCount === 1 ? "1 access request waiting" : `${waitingCount} access requests waiting`;

  return (
    <aside
      // Above the Sage button (z-50) while the phone menu is open; scrolls
      // instead of clipping Account / Sign out on short screens.
      className={`sticky top-0 flex max-h-dvh flex-col overflow-y-auto border-b border-black/[.08] bg-[var(--background)] lg:h-dvh lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r dark:border-white/[.145] ${
        open ? "z-[60]" : "z-20"
      }`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          close();
          menuButton.current?.focus();
        }
      }}
    >
      <div className="flex h-14 items-center justify-between px-4 lg:h-16 lg:px-5">
        <Link href="/" aria-label="Support Triage home">
          <Logo size={28} textSize="text-sm" />
        </Link>
        <button
          ref={menuButton}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="app-nav"
          // The count only while closed: open, the nav link says it.
          aria-label={open ? "Close menu" : `Open menu${waitingCount > 0 ? `, ${waiting}` : ""}`}
          className="relative rounded-lg p-1.5 text-zinc-600 hover:bg-black/[.05] lg:hidden dark:text-zinc-400 dark:hover:bg-white/[.06]"
        >
          {open ? icons.close : icons.menu}
          {/* Access requests are in the closed menu on phones (SUP-71). */}
          {waitingCount > 0 && !open ? (
            <span
              aria-hidden="true"
              data-testid="menu-dot"
              className="absolute right-1 top-1 h-2 w-2 rounded-full bg-indigo-600 ring-2 ring-[var(--background)] dark:bg-indigo-400"
            />
          ) : null}
        </button>
      </div>

      {/* One element for both layouts: always shown from lg up, toggled below. */}
      <div id="app-nav" className={`${open ? "flex" : "hidden"} flex-1 flex-col lg:flex`}>
        <nav aria-label="Main" className="flex flex-col gap-0.5 px-3 py-2">
          <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            {profile.role === "customer" ? "Support" : "Workspace"}
          </p>
          {items.map((item) => {
            const active = item.isActive(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={close}
                className={`${linkBase} ${active ? linkActive : linkIdle}`}
              >
                {item.icon}
                {item.label}
                {item.count ? (
                  <span className="ml-auto rounded-full bg-indigo-600 px-1.5 py-px text-[11px] font-semibold leading-4 text-white dark:bg-indigo-500">
                    {item.count}
                    <span className="sr-only"> waiting</span>
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-2 border-t border-black/[.08] px-3 py-3 dark:border-white/[.145]">
          <div className="flex items-center gap-2.5 px-3 py-1">
            <Avatar id={profile.id} name={profile.fullName ?? profile.email} avatarPath={profile.avatarPath} size={32} />
            <div className="flex min-w-0 flex-col leading-tight">
              {/* The display name from account settings, else the email. */}
              <span className="truncate text-xs font-medium text-black dark:text-zinc-50" title={profile.email}>
                {profile.fullName ?? profile.email}
              </span>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span
                  className={`w-fit rounded-full px-1.5 py-0 text-[10px] font-medium capitalize ${roleBadgeClasses(profile.role)}`}
                >
                  {profile.role}
                </span>
                {profile.presence ? (
                  <PresenceSelect presence={profile.presence.shown} byHours={profile.presence.byHours} />
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex gap-1.5 px-1">
            <Link
              href="/account"
              aria-current={pathname === "/account" ? "page" : undefined}
              onClick={close}
              className={`flex-1 rounded-lg px-3 py-1.5 text-center text-xs font-medium ${
                pathname === "/account" ? linkActive : `border border-black/[.08] dark:border-white/[.145] ${linkIdle}`
              }`}
            >
              Account
            </Link>
            <form action={signOutAction} className="flex-1">
              <button
                type="submit"
                className={`w-full rounded-lg border border-black/[.08] px-3 py-1.5 text-xs font-medium dark:border-white/[.145] ${linkIdle}`}
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    </aside>
  );
}
