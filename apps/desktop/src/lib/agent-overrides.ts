/**
 * Per-workspace agent overrides (driver/model/enabled), shared between the
 * settings UI (writes) and the chat runtime (reads). The runtime libSQL store
 * is durable; this tiny localStorage mirror keeps session opening synchronous.
 */
import type {
  AgentApprovalMode,
  AgentCapabilityId,
  AgentToolPermission,
  DriverType,
} from "@chief/agent-runtime/types";

export interface AgentOverride {
  driver?: DriverType;
  model?: string;
  enabled?: boolean;
  approvals?: AgentApprovalMode;
  capabilities?: AgentCapabilityId[];
  integrations?: string[];
  toolPermissions?: AgentToolPermission[];
}

export type AgentOverrides = Record<string, AgentOverride>;

const KEY = "chief-agent-overrides";
const PROVIDER_KEY = "chief-workspace-provider";
const APPROVALS_KEY = "chief-tool-approvals";
const EVENT = "chief-agent-overrides-changed";
const LEGACY_KEY = "marketer-agent-overrides";
const LEGACY_PROVIDER_KEY = "marketer-workspace-provider";
const LEGACY_APPROVALS_KEY = "marketer-tool-approvals";

function migratedValue(
  currentBase: string,
  legacyBase: string,
  workspaceId: string,
) {
  const currentKey = workspaceKey(currentBase, workspaceId);
  const current = localStorage.getItem(currentKey);
  if (current !== null) return current;
  const legacyKey = workspaceKey(legacyBase, workspaceId);
  const legacy = localStorage.getItem(legacyKey);
  if (legacy !== null) {
    localStorage.setItem(currentKey, legacy);
    localStorage.removeItem(legacyKey);
  }
  return legacy;
}

/**
 * Workspace-level tool approvals. "auto" (the default) opens sessions with
 * full access so agents work without permission prompts; "ask" keeps the
 * guarded approval seam for every mutating tool call.
 */
export type ApprovalMode = AgentApprovalMode;

export function getToolApprovals(
  workspaceId: string | null | undefined,
): ApprovalMode {
  if (!workspaceId) return "auto";
  const value = migratedValue(APPROVALS_KEY, LEGACY_APPROVALS_KEY, workspaceId);
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
  localStorage.removeItem(LEGACY_KEY);
  localStorage.removeItem(LEGACY_PROVIDER_KEY);
}

export function getWorkspaceProvider(
  workspaceId: string | null | undefined,
): DriverType | null {
  if (!workspaceId) return null;
  retireLegacyGlobalState();
  const value = migratedValue(PROVIDER_KEY, LEGACY_PROVIDER_KEY, workspaceId);
  return value === "claude" ||
    value === "codex" ||
    value === "opencode" ||
    value === "remote"
    ? value
    : null;
}

export function setWorkspaceProvider(workspaceId: string, driver: DriverType) {
  retireLegacyGlobalState();
  localStorage.setItem(workspaceKey(PROVIDER_KEY, workspaceId), driver);
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function clearWorkspaceProvider(workspaceId: string) {
  retireLegacyGlobalState();
  localStorage.removeItem(workspaceKey(PROVIDER_KEY, workspaceId));
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function getAgentOverrides(workspaceId: string): AgentOverrides {
  retireLegacyGlobalState();
  try {
    return JSON.parse(migratedValue(KEY, LEGACY_KEY, workspaceId) ?? "{}");
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
