import type {
  AgentCapabilityId,
  AgentPreference,
  AgentToolPermission,
  DriverType,
} from "@chief/agent-runtime/types";
import type { AgentConfig, AgentConfigResult } from "@chief/relay-contracts";
import { agentConfigSchema } from "@chief/relay-contracts";

const CAPABILITIES: ReadonlySet<string> = new Set([
  "analytics-chart",
  "prospect-memory",
  "trend-memory",
  "content-calendar",
  "campaign-memory",
  "schedule-manager",
]);

const TOOL_PERMISSIONS: ReadonlySet<string> = new Set([
  "workspace.read",
  "workspace.write",
  "projects.read",
  "projects.write",
  "channels.read",
  "channels.create",
  "channels.update",
  "channels.archive",
  "members.read",
  "members.manage",
  "messages.read",
  "messages.send",
  "messages.manage",
  "schedules.read",
  "schedules.manage",
  "schedules.run",
  "webhooks.manage",
  "browser.use",
  "integrations.manage",
  "agents.delegate",
]);

export function relayAgentPreference(
  result: AgentConfigResult,
): AgentPreference {
  const config = result.config;
  const driver = config.providerAssigned
    ? desktopDriver(config.driver)
    : undefined;
  return {
    agentId: result.agentId,
    enabled: config.enabled,
    ...(driver ? { driver, model: autoModel(config.model) } : undefined),
    approvals: config.approvals,
    capabilities: config.capabilities.filter(isAgentCapability),
    integrations: config.integrations,
    toolPermissions: config.toolPermissions.filter(isAgentToolPermission),
  };
}

export function relayAgentConfig(
  current: AgentConfig,
  preference: AgentPreference,
): AgentConfig {
  const assignedDriver = preference.driver;
  return agentConfigSchema.parse({
    ...current,
    enabled: preference.enabled,
    providerAssigned: assignedDriver ? true : current.providerAssigned,
    deploymentTarget: assignedDriver
      ? assignedDriver === "remote"
        ? "cloud"
        : "desktop"
      : current.deploymentTarget,
    driver: assignedDriver ? relayDriver(assignedDriver) : current.driver,
    model: assignedDriver ? assignedModel(preference.model) : current.model,
    approvals: preference.approvals ?? current.approvals,
    capabilities: preference.capabilities ?? current.capabilities,
    integrations: preference.integrations ?? current.integrations,
    toolPermissions: preference.toolPermissions ?? current.toolPermissions,
  });
}

function desktopDriver(value: string): DriverType | undefined {
  if (value === "openCodeGo") return "opencode";
  if (
    value === "claude" ||
    value === "codex" ||
    value === "opencode" ||
    value === "remote"
  ) {
    return value;
  }
  return undefined;
}

function relayDriver(value: DriverType) {
  return value === "opencode" ? "openCodeGo" : value;
}

function autoModel(value: string) {
  return value.toLowerCase() === "auto" ? undefined : value;
}

function assignedModel(value: string | undefined) {
  const model = value?.trim();
  return model && model.length > 0 ? model : "auto";
}

function isAgentCapability(value: string): value is AgentCapabilityId {
  return CAPABILITIES.has(value);
}

function isAgentToolPermission(value: string): value is AgentToolPermission {
  return TOOL_PERMISSIONS.has(value);
}
