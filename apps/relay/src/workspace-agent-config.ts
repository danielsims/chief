import { agentConfigSchema, defaultAgentConfig } from "@chief/relay-contracts";

const collaborationPermissions = [
  "workspace.read",
  "workspace.write",
  "channels.read",
  "channels.create",
  "members.read",
  "members.manage",
  "messages.read",
  "messages.send",
] as const;

const pluginPermissions = ["integrations.manage"] as const;

export function defaultAgentConfigFor(agentId: string) {
  if (agentId === "chief") {
    return agentConfigSchema.parse({
      ...defaultAgentConfig,
      toolPermissions: [
        ...collaborationPermissions,
        ...pluginPermissions,
        "channels.update",
        "channels.archive",
        "messages.manage",
        "schedules.read",
        "schedules.manage",
        "schedules.run",
        "agents.delegate",
        "projects.read",
        "browser.use",
      ],
    });
  }
  if (agentId === "brand") {
    return agentConfigSchema.parse({
      ...defaultAgentConfig,
      capabilities: ["brand-memory", "advanced"],
      toolPermissions: [
        ...collaborationPermissions,
        ...pluginPermissions,
        "brand-profile-write",
        "browser.use",
      ],
    });
  }
  if (agentId === "prospector") {
    return agentConfigSchema.parse({
      ...defaultAgentConfig,
      capabilities: ["prospect-memory", "advanced"],
      toolPermissions: [
        ...collaborationPermissions,
        ...pluginPermissions,
        "prospects-write",
        "browser.use",
      ],
    });
  }
  if (agentId === "ads") {
    return agentConfigSchema.parse({
      ...defaultAgentConfig,
      capabilities: ["advanced"],
      toolPermissions: [
        ...collaborationPermissions,
        ...pluginPermissions,
        "browser.use",
      ],
    });
  }
  if (agentId === "setup") {
    return agentConfigSchema.parse({
      ...defaultAgentConfig,
      capabilities: ["advanced"],
      toolPermissions: [
        ...collaborationPermissions,
        ...pluginPermissions,
        "browser.use",
      ],
    });
  }
  if (agentId === "engineer") {
    return agentConfigSchema.parse({
      ...defaultAgentConfig,
      capabilities: ["advanced"],
      toolPermissions: [
        ...collaborationPermissions,
        ...pluginPermissions,
        "browser.use",
        "projects.read",
        "projects.write",
      ],
    });
  }
  return agentConfigSchema.parse({
    ...defaultAgentConfig,
    toolPermissions: [...collaborationPermissions, ...pluginPermissions],
  });
}

export function effectiveAgentConfigFor(
  agentId: string,
  config: ReturnType<typeof agentConfigSchema.parse>,
) {
  const permissions = new Set(config.toolPermissions);
  let capabilities = config.capabilities;
  // Owner-facing clients expose one understandable `workspace.write` switch.
  // Specialist record writes remain agent-bound relay capabilities, so derive
  // them only for the matching durable identity when that switch is enabled.
  // This also repairs configs saved by clients that correctly omit the relay's
  // internal compatibility permission strings from their settings payload.
  if (agentId === "brand" && permissions.has("workspace.write")) {
    permissions.add("brand-profile-write");
  }
  if (agentId === "prospector" && permissions.has("workspace.write")) {
    permissions.add("prospects-write");
  }
  const legacyIntegrationConfig =
    (agentId === "ads" || agentId === "setup") &&
    config.capabilities.length === 0 &&
    config.toolPermissions.length === collaborationPermissions.length &&
    collaborationPermissions.every((permission) => permissions.has(permission));
  if (legacyIntegrationConfig) {
    capabilities = ["advanced"];
    permissions.add("browser.use");
  }
  // Plugin discovery and connection cards are an authored-agent baseline.
  // Browser access remains specialized; this grant only enables structured,
  // user-approved connection flows and the tools exposed by those plugins.
  permissions.add("integrations.manage");
  return agentConfigSchema.parse({
    ...config,
    capabilities,
    toolPermissions: [...permissions],
  });
}

export function hasAgentPermission(
  granted: readonly string[],
  required: string,
) {
  if (granted.includes(required)) return true;
  const legacy: Record<string, readonly string[]> = {
    "workspace.read": ["workspace"],
    "workspace.write": ["workspace", "brand-profile-write", "prospects-write"],
    "channels.read": ["channels"],
    "channels.create": ["channels"],
    "channels.update": ["channels"],
    "channels.archive": ["channels"],
    "members.read": ["workspace", "channels"],
    "members.manage": ["channels"],
    "messages.read": ["messages"],
    "messages.send": ["messages"],
    "messages.manage": ["messages"],
    "schedules.read": ["scheduled-work"],
    "schedules.manage": ["scheduled-work"],
    "schedules.run": ["scheduled-work"],
    "browser.use": ["advanced"],
  };
  return (legacy[required] ?? []).some((permission) =>
    granted.includes(permission),
  );
}
