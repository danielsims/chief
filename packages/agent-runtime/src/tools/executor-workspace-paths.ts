import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ExecutorCapability } from "../types.js";

export interface ExecutorWorkspace {
  scopeDir: string;
  dataDir: string;
  keychainServiceName: string;
}

function workspaceKey(workspaceId: string): string {
  return createHash("sha256").update(workspaceId).digest("hex").slice(0, 24);
}

export function capabilityKey(
  workspaceId: string,
  capability: ExecutorCapability,
): string {
  return createHash("sha256")
    .update(workspaceId)
    .update("\0")
    .update(capability.apiBaseUrl)
    .update("\0")
    .update(capability.token)
    .digest("hex");
}

export function pathsForWorkspace(workspaceId: string): ExecutorWorkspace {
  const key = workspaceKey(workspaceId);
  const relative = join("executor", "workspaces", key);
  const current = join(homedir(), ".chief", relative);
  const legacy = join(homedir(), ".marketer", relative);
  const root = !existsSync(current) && existsSync(legacy) ? legacy : current;
  return {
    scopeDir: join(root, "scope"),
    dataDir: join(root, "data"),
    keychainServiceName: `chief-executor-${key}`,
  };
}

function portForWorkspace(workspaceId: string): number {
  return (
    20_000 +
    (Number.parseInt(workspaceKey(workspaceId).slice(0, 6), 16) % 20_000)
  );
}

function portIsAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

export async function availableWorkspacePort(
  workspaceId: string,
): Promise<number> {
  const first = portForWorkspace(workspaceId);
  for (let offset = 0; offset < 64; offset += 1) {
    const port = 20_000 + ((first - 20_000 + offset) % 20_000);
    if (await portIsAvailable(port)) return port;
  }
  throw new Error("No local port is available for this workspace's tools.");
}
