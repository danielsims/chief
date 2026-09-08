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
  const driver = desktopDriver(config.inference.provider);
  return {
    agentId: result.agentId,
    enabled: config.enabled,
    deploymentTarget: config.deploymentTarget,
    ...(driver
      ? { driver, model: autoModel(config.inference.model) }
      : undefined),
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
  const deploymentTarget =
    preference.deploymentTarget ?? current.deploymentTarget;
  const selectedModel = preference.model ?? current.inference.model;
  return agentConfigSchema.parse({
    ...current,
    enabled: preference.enabled,
    deploymentTarget,
    inference: assignedDriver
      ? assignedDriver === "remote"
        ? {
            provider: "vercel-ai-gateway",
            model: selectedModel,
            secretRef: "vercel-ai-gateway",
          }
        : assignedDriver === "claude" || assignedDriver === "codex"
          ? {
              provider: assignedDriver,
              model: preference.model ?? "auto",
            }
          : {
              provider: "opencode",
              model: selectedModel,
              secretRef: "opencode",
            }
      : current.inference,
    approvals: preference.approvals ?? current.approvals,
    capabilities: preference.capabilities ?? current.capabilities,
    integrations: preference.integrations ?? current.integrations,
    toolPermissions: preference.toolPermissions ?? current.toolPermissions,
  });
}

function desktopDriver(value: string): DriverType | undefined {
  if (value === "vercel-ai-gateway") return "remote";
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

function autoModel(value: string) {
  return value.toLowerCase() === "auto" ? undefined : value;
}

function isAgentCapability(value: string): value is AgentCapabilityId {
  return CAPABILITIES.has(value);
}

function isAgentToolPermission(value: string): value is AgentToolPermission {
  return TOOL_PERMISSIONS.has(value);
}
