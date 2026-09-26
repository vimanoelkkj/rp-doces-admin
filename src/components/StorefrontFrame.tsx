import type { ReactNode } from "react";
import Header from "./Header";
import StorefrontWave from "./StorefrontWave";
import "./StorefrontFrame.css";


interface StorefrontFrameProps {
  children: ReactNode;
  className?: string;
  headerVariant?: "storefront" | "admin";
}

export default function StorefrontFrame({
  children,
  className = "",
  headerVariant = "storefront",
}: StorefrontFrameProps) {
  return (
    <div className={`storefront-frame ${className}`.trim()}>
      <StorefrontWave />

      <Header variant={headerVariant} />
      <div className="storefront-frame__scroll">{children}</div>
    </div>
  );
}
