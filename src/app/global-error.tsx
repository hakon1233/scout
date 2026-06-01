"use client";

export default function GlobalError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ display: "flex", minHeight: "100vh", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "4rem 1.5rem", fontFamily: "Georgia, ui-serif, serif", background: "#f6f2ea", color: "#1c1a17" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "40rem", width: "100%" }}>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 600, letterSpacing: "-0.02em" }}>Something went wrong</h1>
          <p style={{ color: "#6f685d" }}>An unexpected error occurred. Please try again.</p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{ width: "fit-content", borderRadius: "6px", background: "#1c1a17", color: "#f6f2ea", padding: "0.6rem 1.4rem", fontSize: "0.9375rem", fontWeight: 500, border: "none", cursor: "pointer", fontFamily: "system-ui, sans-serif" }}
          >
            Retry
          </button>
        </div>
      </body>
    </html>
  );
}
