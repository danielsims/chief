import type { WorkspaceSnapshot } from "@chief/relay-contracts";

export function shouldStartDesktopCells(runtime: WorkspaceSnapshot["runtime"]) {
  return runtime === "mac";
}
