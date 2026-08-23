import type { WorkspaceSnapshot } from "@chief/relay-contracts";

export function shouldStartDesktopCells(runtime: WorkspaceSnapshot["runtime"]) {
  // Cloud workspaces keep their durable queue in the relay. Until a hosted
  // executor claims it, the signed desktop cell is a safe portable executor;
  // the relay lease still guarantees that only one executor runs each job.
  return runtime === "mac" || runtime === "cloud" || runtime === null;
}
