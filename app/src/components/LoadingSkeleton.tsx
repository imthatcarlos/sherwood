export default function LoadingSkeleton() {
  return (
    <div style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      minHeight: "60vh",
    }}>
      <div className="loading-spinner" />
    </div>
  );
}
