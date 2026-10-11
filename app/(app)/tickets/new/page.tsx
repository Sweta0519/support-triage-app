import { Breadcrumbs } from "@/app/components/Breadcrumbs";
import { MY_TICKETS_CRUMB } from "@/app/lib/crumbs";

import { requireRole } from "@/app/lib/auth/session";
import { NewTicketForm } from "./NewTicketForm";
import { readablePageClass } from "@/app/lib/styles";

export default async function NewTicketPage() {
  await requireRole("customer");

  return (
    <div className={readablePageClass}>
      <div>
        <Breadcrumbs parents={[MY_TICKETS_CRUMB]} current="New ticket" />
        <h1 className="mt-2 text-2xl font-semibold text-black dark:text-zinc-50">New ticket</h1>
      </div>
      <div className="rounded-xl border border-black/[.08] p-6 dark:border-white/[.145]">
        <NewTicketForm />
      </div>
    </div>
  );
}
