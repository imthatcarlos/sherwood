"use client";

export default function SyndicateError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        fontFamily: "var(--font-plus-jakarta), sans-serif",
        color: "rgba(255,255,255,0.7)",
        gap: "1.5rem",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <h2
        style={{
          fontSize: "1.5rem",
          fontWeight: 600,
          color: "#ff4d4d",
          margin: 0,
        }}
      >
        Failed to load syndicate
      </h2>
      <p
        style={{
          fontSize: "13px",
          color: "rgba(255,255,255,0.4)",
          maxWidth: "400px",
          margin: 0,
        }}
      >
        An unexpected error occurred. Please try again.
      </p>
      <button
        onClick={reset}
        style={{
          background: "rgba(46, 230, 166, 0.15)",
          color: "var(--color-accent)",
          border: "1px solid rgba(46, 230, 166, 0.3)",
          padding: "0.5rem 1.5rem",
          borderRadius: "4px",
          cursor: "pointer",
          fontSize: "12px",
          fontFamily: "var(--font-plus-jakarta), sans-serif",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}
      >
        Try Again
      </button>
    </div>
  );
}
