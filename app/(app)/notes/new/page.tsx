import { Breadcrumbs } from "@/app/components/Breadcrumbs";
import { NOTES_CRUMB } from "@/app/lib/crumbs";

import { requireStaff } from "@/app/lib/auth/session";
import { NoteForm } from "../NoteForm";
import { readablePageClass } from "@/app/lib/styles";

export default async function NewNotePage() {
  await requireStaff();

  return (
    <div className={readablePageClass}>
      <div>
        <Breadcrumbs parents={[NOTES_CRUMB]} current="New note" />
        <h1 className="mt-2 text-2xl font-semibold text-black dark:text-zinc-50">New note</h1>
      </div>
      <div className="rounded-xl border border-black/[.08] p-6 dark:border-white/[.145]">
        <NoteForm />
      </div>
    </div>
  );
}
