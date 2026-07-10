/**
 * Per-workspace agent overrides (driver/model/enabled), shared between the
 * settings UI (writes) and the chat runtime (reads). The runtime libSQL store
 * is durable; this tiny localStorage mirror keeps session opening synchronous.
 */
import type {
  AgentCapabilityId,
  DriverType,
} from "@marketer/agent-runtime/types";

export interface AgentOverride {
  driver?: DriverType;
  model?: string;
  enabled?: boolean;
  capabilities?: AgentCapabilityId[];
  integrations?: string[];
}

export type AgentOverrides = Record<string, AgentOverride>;

const KEY = "marketer-agent-overrides";
const PROVIDER_KEY = "marketer-workspace-provider";
const APPROVALS_KEY = "marketer-tool-approvals";
const EVENT = "marketer-agent-overrides-changed";

/**
 * Workspace-level tool approvals. "auto" (the default) opens sessions with
 * full access so agents work without permission prompts; "ask" keeps the
 * guarded approval seam for every mutating tool call.
 */
export type ApprovalMode = "auto" | "ask";

export function getToolApprovals(
  workspaceId: string | null | undefined,
): ApprovalMode {
  if (!workspaceId) return "auto";
  const value = localStorage.getItem(workspaceKey(APPROVALS_KEY, workspaceId));
  return value === "ask" ? "ask" : "auto";
}

export function setToolApprovals(workspaceId: string, mode: ApprovalMode) {
  localStorage.setItem(workspaceKey(APPROVALS_KEY, workspaceId), mode);
  window.dispatchEvent(new CustomEvent(EVENT));
}

/**
 * The workspace's agent app, chosen explicitly during onboarding (or in
 * settings). There is deliberately no built-in default: resolution is
 * per-chat choice > per-agent override > workspace provider, and if none is
 * set the UI must ask, not assume.
 */
function workspaceKey(base: string, workspaceId: string) {
  return `${base}:${workspaceId}`;
}

function retireLegacyGlobalState() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(PROVIDER_KEY);
}

export function getWorkspaceProvider(
  workspaceId: string | null | undefined,
): DriverType | null {
  if (!workspaceId) return null;
  retireLegacyGlobalState();
  const value = localStorage.getItem(workspaceKey(PROVIDER_KEY, workspaceId));
  return value === "claude" || value === "codex" || value === "opencode"
    ? value
    : null;
}

export function setWorkspaceProvider(workspaceId: string, driver: DriverType) {
  retireLegacyGlobalState();
  localStorage.setItem(workspaceKey(PROVIDER_KEY, workspaceId), driver);
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function getAgentOverrides(workspaceId: string): AgentOverrides {
  retireLegacyGlobalState();
  try {
    return JSON.parse(
      localStorage.getItem(workspaceKey(KEY, workspaceId)) ?? "{}",
    );
  } catch {
    return {};
  }
}

export function getAgentOverride(
  workspaceId: string | null | undefined,
  agentKey: string,
): AgentOverride {
  return workspaceId ? (getAgentOverrides(workspaceId)[agentKey] ?? {}) : {};
}

export function setAgentOverride(
  workspaceId: string,
  agentKey: string,
  override: AgentOverride,
) {
  const all = getAgentOverrides(workspaceId);
  all[agentKey] = { ...all[agentKey], ...override };
  localStorage.setItem(workspaceKey(KEY, workspaceId), JSON.stringify(all));
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onAgentOverridesChange(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
