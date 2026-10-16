"use client";

import { ErrorFallback } from "@/app/components/ErrorFallback";

// Every page, including the app's own layout (its sidebar's sign out).
export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorFallback retry={retry} />;
}
