import type { ReactNode } from "react";

export function RailsLayout({ children }: { children: ReactNode }) {
  return <div className="rails-layout">{children}</div>;
}
