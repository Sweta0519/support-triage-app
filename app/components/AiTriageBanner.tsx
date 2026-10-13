import { aiTriageBannerCopy, type AiTriageHealth } from "@/app/lib/triage-status";

// The staff-wide "AI triage is off / failing" banner (SUP-36). The
// product's value is the triage, so its absence is said plainly on every
// staff page rather than leaving untriaged tickets looking normal. Server
// component; the layout passes the health in. The words are in
// aiTriageBannerCopy() so they're unit-tested.
export function AiTriageBanner({ health, isAdmin }: { health: AiTriageHealth; isAdmin: boolean }) {
  const copy = aiTriageBannerCopy(health, isAdmin);
  if (!copy) return null;
  return (
    <div
      role="status"
      aria-label="AI triage status"
      className="border-b border-amber-200 bg-amber-50 px-8 py-2.5 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <p className="max-w-screen-2xl">
        <span className="font-semibold">{copy.title}</span> {copy.body}
      </p>
    </div>
  );
}
