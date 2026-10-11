// The app's mark: a support speech bubble holding three bars sorted by
// length (triage), with a spark for the AI. Same artwork as app/icon.svg
// (the browser-tab icon) and app/apple-icon.png.
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <defs>
        {/* A fixed id: every copy on a page defines the same gradient. */}
        <linearGradient id="support-triage-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#support-triage-logo)" />
      <path
        d="M8.5 8h13a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-7.2l-4.3 3.4c-.5.4-1.2 0-1.2-.6V22.1A3 3 0 0 1 5.5 19v-8a3 3 0 0 1 3-3z"
        fill="#fff"
      />
      <rect x="9" y="11.6" width="11" height="2" rx="1" fill="#7c3aed" />
      <rect x="9" y="15" width="7.5" height="2" rx="1" fill="#818cf8" />
      <rect x="9" y="18.4" width="4" height="2" rx="1" fill="#c7d2fe" />
      <path d="M25.5 3.2l.75 1.95 1.95.75-1.95.75-.75 1.95-.75-1.95-1.95-.75 1.95-.75z" fill="#fde68a" />
    </svg>
  );
}

// Mark plus name, for the sidebar and the signed-out pages.
export function Logo({ size = 28, className = "text-base" }: { size?: number; className?: string }) {
  return (
    <span className={`flex items-center gap-2 font-semibold tracking-tight text-black dark:text-zinc-50 ${className}`}>
      <LogoMark size={size} />
      Support Triage
    </span>
  );
}
