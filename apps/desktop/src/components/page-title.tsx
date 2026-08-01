import type { ReactNode } from "react";

export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="m-0 text-[clamp(25px,3vw,36px)] leading-[1.06] font-normal tracking-[-0.04em]">
      {children}
    </h1>
  );
}
