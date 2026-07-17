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

/**
 * Saves one user-supplied business fact without replacing onboarding context.
 * Stable markers make a later answer an update rather than an accumulating
 * duplicate, while keeping the result readable to both people and agents.
 */
export function writeWorkspaceContextValue(
  workspaceId: string,
  key: string,
  value: string,
) {
  const safeKey = key
    .trim()
    .replaceAll(/[^a-zA-Z0-9 _-]/g, "")
    .slice(0, 80);
  const normalizedValue = value.trim();
  if (!safeKey || !normalizedValue) return;

  let current = "";
  try {
    current = readFileSync(workspaceContextPath(workspaceId), "utf8");
  } catch {
    // A direct question can be the first durable context in a workspace.
  }

  const slug = safeKey.toLowerCase().replaceAll(/\s+/g, "-");
  const start = `<!-- chief-context:${slug}:start -->`;
  const end = `<!-- chief-context:${slug}:end -->`;
  const block = `${start}\n## ${safeKey}\n\n${normalizedValue}\n${end}`;
  const startIndex = current.indexOf(start);
  const endIndex = current.indexOf(end, startIndex + start.length);
  const next =
    startIndex >= 0 && endIndex >= 0
      ? `${current.slice(0, startIndex)}${block}${current.slice(endIndex + end.length)}`
      : `${current.trim()}${current.trim() ? "\n\n" : ""}# User-provided context\n\n${block}\n`;
  writeWorkspaceContext(workspaceId, next);
}
