"use client";

// Only when the root layout itself fails. It replaces the whole document,
// without globals.css, so it's styled inline (SUP-75).
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" style={{ colorScheme: "light dark" }}>
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, textAlign: "center" }}>
        <title>Support Triage</title>
        <main role="alert" style={{ maxWidth: 380, padding: 32 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#71717a" }}>
            Often it&apos;s too many requests at once, or a dropped connection. Wait a moment and try again.
          </p>
          <button type="button" onClick={() => retry()} style={{ fontSize: 14, color: "#4f46e5", background: "none", border: 0, cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
