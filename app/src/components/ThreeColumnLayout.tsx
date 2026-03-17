interface ThreeColumnLayoutProps {
  leftSidebar: React.ReactNode;
  rightSidebar: React.ReactNode;
  children: React.ReactNode;
  blendMode?: "difference" | "normal";
}

export default function ThreeColumnLayout({
  leftSidebar,
  rightSidebar,
  children,
  blendMode = "difference",
}: ThreeColumnLayoutProps) {
  return (
    <div
      className={`layout three-col-grid ${blendMode === "normal" ? "layout-normal" : ""}`}
    >
      <aside className="meta-col left">{leftSidebar}</aside>
      <main>{children}</main>
      <aside className="meta-col right">{rightSidebar}</aside>
    </div>
  );
}
