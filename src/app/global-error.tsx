"use client";

export default function GlobalError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ display: "flex", minHeight: "100vh", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "4rem 1.5rem", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "40rem", width: "100%" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>Something went wrong</h1>
          <p style={{ color: "#666" }}>An unexpected error occurred. Please try again.</p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{ width: "fit-content", borderRadius: "9999px", background: "#2563eb", color: "#fff", padding: "0.5rem 1.25rem", fontSize: "0.875rem", fontWeight: 500, border: "none", cursor: "pointer" }}
          >
            Retry
          </button>
        </div>
      </body>
    </html>
  );
}
