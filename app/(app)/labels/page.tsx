import { requireStaff } from "@/app/lib/auth/session";
import { listLabels } from "@/app/lib/db/labels";
import { Breadcrumbs } from "@/app/components/Breadcrumbs";
import { readablePageClass } from "@/app/lib/styles";
import { LabelEditor, NewLabelForm } from "./LabelEditor";

// The team's labels (SUP-39). Any staff member can create, rename,
// recolour and delete them, as in Linear; deleting one takes it off every
// ticket that had it.
export default async function LabelsPage() {
  await requireStaff();
  const labels = await listLabels();

  return (
    <div className={readablePageClass}>
      <Breadcrumbs current="Labels" />
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Labels</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Labels the team adds to tickets. Staff only -- customers never see them.
        </p>
      </div>
      <NewLabelForm />
      {labels.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No labels yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-black/[.06] rounded-xl border border-black/[.08] dark:divide-white/[.08] dark:border-white/[.145]">
          {labels.map((label) => (
            <LabelEditor key={label.id} label={label} />
          ))}
        </ul>
      )}
    </div>
  );
}
