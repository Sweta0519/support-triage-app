import { requireRole } from "@/app/lib/auth/session";
import { NewTicketForm } from "./NewTicketForm";

export default async function NewTicketPage() {
  await requireRole("customer");

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        New ticket
      </h1>
      <NewTicketForm />
    </div>
  );
}
