"use client";

// global-error.tsx replaces the root layout when an error is thrown during
// rendering of the layout itself, so next-intl's provider is unavailable here.
// Text is therefore fixed (Japanese primary + English) and styling is inline so
// the fallback renders even if the app stylesheet failed to load.
// Sentry capture is wired in a later change.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          fontFamily: "system-ui, sans-serif",
          color: "#18181b",
          backgroundColor: "#fafafa",
          padding: "1.5rem",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>エラーが発生しました</h1>
        <p style={{ color: "#71717a", margin: 0 }}>
          予期しないエラーが発生しました。もう一度お試しください。
          <br />
          Something went wrong. Please try again.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            cursor: "pointer",
            border: "none",
            borderRadius: "0.5rem",
            backgroundColor: "#18181b",
            color: "#fafafa",
            padding: "0.5rem 1.25rem",
            fontSize: "0.875rem",
          }}
        >
          再読み込み / Retry
        </button>
      </body>
    </html>
  );
}
