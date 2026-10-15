import { SignupForm } from "./SignupForm";

// /signup?access=1 is "Request access" from the homepage (SUP-58): the same
// customer sign-up, with a few optional questions that become an
// access-request ticket once the email is confirmed.
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ access?: string | string[] }> }) {
  const { access } = await searchParams;
  const requestingAccess = (Array.isArray(access) ? access[0] : access) === "1";
  return (
    <div className="flex w-full flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">
          {requestingAccess ? "Request access" : "Create an account"}
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          {requestingAccess
            ? "Create your account, and tell us about your team if you like. Once you confirm your email, your request reaches our team as a ticket."
            : "File and track your own support tickets."}
        </p>
      </div>
      <SignupForm requestingAccess={requestingAccess} />
    </div>
  );
}
