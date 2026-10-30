import type { ReactNode } from "react";
import { createContext, useContext, useState } from "react";
import { createPortal } from "react-dom";

const SidePanelTarget = createContext<HTMLDivElement | null>(null);

/** A workspace panel sits beside the content card, like conversation threads. */
export function WorkspaceSidePanelHost({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  return (
    <SidePanelTarget value={target}>
      {children}
      <div ref={setTarget} className="contents" />
    </SidePanelTarget>
  );
}

export function WorkspaceSidePanel({ children }: { children: ReactNode }) {
  const target = useContext(SidePanelTarget);
  return target ? createPortal(children, target) : children;
}
