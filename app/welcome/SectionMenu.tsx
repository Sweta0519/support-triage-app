"use client";

import { useEffect, useRef, useState } from "react";

export type MenuLink = { href: string; label: string; className?: string };

// The header's section links below the xl breakpoint: one "Menu" button (a
// native <details>) in its own "Page" navigation landmark. It closes when a
// link is picked, on Escape (focus back to the button) and on a click
// outside it.
export function SectionMenu({ links, linkClass }: { links: MenuLink[]; linkClass: string }) {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => details.current?.removeAttribute("open");
    const onPointer = (e: PointerEvent) => {
      if (!details.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  return (
    <nav aria-label="Page" className="xl:hidden">
      <details
        ref={details}
        className="relative"
        onToggle={(e) => setOpen(e.currentTarget.open)}
        // Escape is handled here (focus is on the button or a link inside),
        // so it works from the first key press after opening.
        onKeyDown={(e) => {
          if (e.key === "Escape" && details.current?.open) {
            details.current.removeAttribute("open");
            summary.current?.focus();
          }
        }}
      >
        <summary ref={summary} className={`${linkClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
          Menu
        </summary>
        <ul className="absolute right-0 z-20 mt-3 flex w-52 flex-col rounded-lg border border-[#E3E5EA] bg-white py-1.5 shadow-[0_12px_28px_-12px_rgba(21,23,28,0.25)]">
          {links.map((link) => (
            <li key={link.href} className={link.className}>
              <a
                href={link.href}
                onClick={() => details.current?.removeAttribute("open")}
                className="block px-4 py-2 text-[15px] hover:bg-[#F3F4F6] focus-visible:bg-[#F3F4F6] focus-visible:outline-none"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}
