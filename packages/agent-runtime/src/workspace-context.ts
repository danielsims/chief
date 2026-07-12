import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { workspaceRoot } from "./workspace-secrets.js";

function workspaceContextPath(workspaceId: string) {
  return join(workspaceRoot(workspaceId), "context.md");
}

function workspaceBrandProfilePath(workspaceId: string) {
  return join(workspaceRoot(workspaceId), "brand-profile.md");
}

/** Last brand context the app sent, kept for unattended recurring runs. */
export function readWorkspaceContext(workspaceId: string): string | undefined {
  try {
    const context = readFileSync(workspaceContextPath(workspaceId), "utf8");
    try {
      const brandProfile = readFileSync(
        workspaceBrandProfilePath(workspaceId),
        "utf8",
      );
      return `${context}\n\n# Approved brand profile\n\n${brandProfile}`;
    } catch {
      return context;
    }
  } catch {
    return undefined;
  }
}

export function writeWorkspaceBrandProfile(
  workspaceId: string,
  markdown: string,
) {
  mkdirSync(workspaceRoot(workspaceId), { recursive: true, mode: 0o700 });
  writeFileSync(workspaceBrandProfilePath(workspaceId), markdown, {
    mode: 0o600,
  });
}

export function writeWorkspaceContext(workspaceId: string, context: string) {
  try {
    mkdirSync(workspaceRoot(workspaceId), { recursive: true, mode: 0o700 });
    writeFileSync(workspaceContextPath(workspaceId), context, { mode: 0o600 });
  } catch (error) {
    console.error("[runtime] could not persist workspace context:", error);
  }
}
