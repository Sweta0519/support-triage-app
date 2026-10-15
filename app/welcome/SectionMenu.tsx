"use client";

import { useRef } from "react";

// The header's section links on phones and tablets: one "Menu" button
// (a native <details>), closed again once a section is picked.
export function SectionMenu({ sections, linkClass }: { sections: { href: string; label: string }[]; linkClass: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details ref={ref} className="relative lg:hidden">
      <summary className={`${linkClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>Menu</summary>
      <ul className="absolute right-0 z-20 mt-3 flex w-52 flex-col rounded-lg border border-[#E3E5EA] bg-white py-1.5 shadow-[0_12px_28px_-12px_rgba(21,23,28,0.25)]">
        {sections.map((section) => (
          <li key={section.href}>
            <a
              href={section.href}
              onClick={() => ref.current?.removeAttribute("open")}
              className="block px-4 py-2 text-[15px] hover:bg-[#F3F4F6] focus-visible:bg-[#F3F4F6] focus-visible:outline-none"
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
