import { SignupForm } from "./SignupForm";

export default function SignupPage() {
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-6">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Sign up
      </h1>
      <SignupForm />
    </div>
  );
}
