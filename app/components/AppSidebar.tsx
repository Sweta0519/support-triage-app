"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

import { signOutAction } from "@/app/lib/auth/actions";
import { roleBadgeClasses } from "@/app/lib/badges";
import type { AppRole } from "@/app/lib/db/profiles";

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
  shield: (
    <svg {...iconProps}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
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

function navItems(role: AppRole): NavItem[] {
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
    // Logging a ticket for a customer who called or emailed.
    { href: "/tickets/new", label: "New ticket", icon: icons.plus, isActive: (p) => p === "/tickets/new" },
    { href: "/notes", label: "Notes", icon: icons.note, isActive: under("/notes") },
  ];
  if (role === "admin") {
    staff.push(
      { href: "/analytics", label: "Analytics", icon: icons.chart, isActive: under("/analytics") },
      { href: "/admin", label: "Admin", icon: icons.shield, isActive: under("/admin") }
    );
  }
  return staff;
}

const linkBase =
  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors";
const linkIdle =
  "text-zinc-600 hover:bg-black/[.04] hover:text-black dark:text-zinc-400 dark:hover:bg-white/[.06] dark:hover:text-zinc-50";
const linkActive = "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300";

// Only what the sidebar shows, not the whole profile row.
export function AppSidebar({ profile }: { profile: { email: string; role: AppRole } }) {
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

  const items = navItems(profile.role);

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
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight text-black dark:text-zinc-50"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">
            S
          </span>
          Support Triage
        </Link>
        <button
          ref={menuButton}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="app-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          className="rounded-lg p-1.5 text-zinc-600 hover:bg-black/[.05] lg:hidden dark:text-zinc-400 dark:hover:bg-white/[.06]"
        >
          {open ? icons.close : icons.menu}
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
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-2 border-t border-black/[.08] px-3 py-3 dark:border-white/[.145]">
          <div className="flex items-center gap-2.5 px-3 py-1">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {profile.email.charAt(0).toUpperCase()}
            </span>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-xs font-medium text-black dark:text-zinc-50" title={profile.email}>
                {profile.email}
              </span>
              <span
                className={`mt-0.5 w-fit rounded-full px-1.5 py-0 text-[10px] font-medium capitalize ${roleBadgeClasses(profile.role)}`}
              >
                {profile.role}
              </span>
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
