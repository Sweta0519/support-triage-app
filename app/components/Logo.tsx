// The app's mark -- a support speech bubble holding three bars sorted by
// length (triage), with a spark for the AI -- next to its name. The
// artwork lives only in app/icon.svg (also the browser-tab icon);
// scripts/render-icons.mjs renders apple-icon.png and favicon.ico from it.
export function Logo({ size = 28, textSize = "text-base" }: { size?: number; textSize?: string }) {
  return (
    <span className={`flex items-center gap-2 font-semibold tracking-tight text-black dark:text-zinc-50 ${textSize}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a tiny static SVG; next/image adds nothing */}
      <img src="/icon.svg" alt="" width={size} height={size} className="shrink-0" />
      Support Triage
    </span>
  );
}
