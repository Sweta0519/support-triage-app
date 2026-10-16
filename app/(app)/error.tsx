"use client";

import { ErrorFallback } from "@/app/components/ErrorFallback";

// Inside the app's layout, so the sidebar stays and only the page is replaced.
export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorFallback retry={retry} />;
}
