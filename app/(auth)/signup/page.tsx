import { SignupForm } from "./SignupForm";

export default function SignupPage() {
  return (
    <div className="flex w-full flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Create an account</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          File and track your own support tickets.
        </p>
      </div>
      <SignupForm />
    </div>
  );
}
