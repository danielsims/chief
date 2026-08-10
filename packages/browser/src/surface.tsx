import type { ReactNode } from "react";

export interface BrowserSurfaceProps {
  children: ReactNode;
  className?: string;
  loading?: boolean;
  loadingFallback?: ReactNode;
  overlay?: ReactNode;
}

/**
 * Transport-neutral browser presentation shell. The host supplies any stream
 * renderer as children and composes its own operating/loading UI around it.
 */
export function BrowserSurface({
  children,
  className,
  loading = false,
  loadingFallback,
  overlay,
}: BrowserSurfaceProps) {
  return (
    <div
      className={className}
      style={{
        minHeight: 0,
        minWidth: 0,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {loading ? loadingFallback : children}
      {!loading ? overlay : null}
    </div>
  );
}
