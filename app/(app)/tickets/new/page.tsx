import { Breadcrumbs } from "@/app/components/Breadcrumbs";
import { MY_TICKETS_CRUMB } from "@/app/lib/crumbs";

import { requireProfile } from "@/app/lib/auth/session";
import { queueBreadcrumb } from "@/app/lib/queue-filters";
import { NewTicketForm } from "./NewTicketForm";
import { StaffNewTicketForm } from "./StaffNewTicketForm";
import { readablePageClass } from "@/app/lib/styles";

// Customers file their own tickets; staff file one on a customer's behalf.
// Each form posts to its own Server Action, which checks the role again.
export default async function NewTicketPage() {
  const profile = await requireProfile();
  const isStaff = profile.role !== "customer";

  return (
    <div className={readablePageClass}>
      <div>
        <Breadcrumbs parents={isStaff ? queueBreadcrumb("all") : [MY_TICKETS_CRUMB]} current="New ticket" />
        <h1 className="mt-2 text-2xl font-semibold text-black dark:text-zinc-50">New ticket</h1>
        {isStaff ? (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
            Log a ticket for a customer who contacted you by phone, chat or email.
          </p>
        ) : null}
      </div>
      <div className="rounded-xl border border-black/[.08] p-6 dark:border-white/[.145]">
        {isStaff ? <StaffNewTicketForm /> : <NewTicketForm />}
      </div>
    </div>
  );
}
