import { SignupForm } from "./SignupForm";

// A plain sign-up creates a workspace, with the new account as its admin
// (SUP-82). /signup?access=1 is "Get in touch" from the homepage (SUP-58,
// SUP-72): a customer sign-up in the default workspace, with a few optional
// questions that become an access-request ticket once the email is confirmed.
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ access?: string | string[] }> }) {
  const { access } = await searchParams;
  const requestingAccess = (Array.isArray(access) ? access[0] : access) === "1";
  return (
    <div className="flex w-full flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">
          {requestingAccess ? "Get in touch" : "Create an account"}
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          {requestingAccess
            ? "Create an account and tell us about your team. Once your account is ready, your message reaches our team as a ticket, and we reply there."
            : "Set up a support workspace for your team. You'll be its admin, and can invite agents and share a sign-up link with your customers."}
        </p>
      </div>
      <SignupForm requestingAccess={requestingAccess} />
    </div>
  );
}
