/**
 * Per-workspace agent overrides (driver/model/enabled), shared between the
 * settings UI (writes) and the chat runtime (reads). localStorage-backed for
 * now; will move behind a Convex adapter with the rest of workspace state.
 */
import type { DriverType } from "@marketer/agent-runtime/types";

export interface AgentOverride {
  driver?: DriverType;
  model?: string;
  enabled?: boolean;
}

export type AgentOverrides = Record<string, AgentOverride>;

const KEY = "marketer-agent-overrides";
const PROVIDER_KEY = "marketer-workspace-provider";
const EVENT = "marketer-agent-overrides-changed";

/**
 * The workspace's agent app, chosen explicitly during onboarding (or in
 * settings). There is deliberately no built-in default: resolution is
 * per-chat choice > per-agent override > workspace provider, and if none is
 * set the UI must ask, not assume.
 */
export function getWorkspaceProvider(): DriverType | null {
  const value = localStorage.getItem(PROVIDER_KEY);
  return value === "claude" || value === "codex" ? value : null;
}

export function setWorkspaceProvider(driver: DriverType) {
  localStorage.setItem(PROVIDER_KEY, driver);
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function getAgentOverrides(): AgentOverrides {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function getAgentOverride(agentKey: string): AgentOverride {
  return getAgentOverrides()[agentKey] ?? {};
}

export function setAgentOverride(agentKey: string, override: AgentOverride) {
  const all = getAgentOverrides();
  all[agentKey] = { ...all[agentKey], ...override };
  localStorage.setItem(KEY, JSON.stringify(all));
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
