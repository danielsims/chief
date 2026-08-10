const REMOTE_KEYS = [
  "CHIEF_REMOTE_AGENT_URL",
  "CHIEF_REMOTE_AGENT_TARGET",
  "CHIEF_EVE_ROUTE_PASSWORD",
] as const;

function agentSuffix(agentId: string) {
  const suffix = agentId.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (!suffix) throw new Error("Agent id cannot be empty.");
  return suffix;
}

export function agentEnvironmentKey(
  key: (typeof REMOTE_KEYS)[number],
  agentId: string,
) {
  return `${key}_${agentSuffix(agentId)}`;
}

/**
 * Project one agent's deployment credentials onto the generic names consumed
 * by the remote drivers. Specialists never silently inherit Chief's endpoint.
 */
export function scopeRemoteAgentEnvironment(
  environment: Record<string, string>,
  agentId: string,
) {
  const scoped = { ...environment };
  for (const key of REMOTE_KEYS) {
    const agentValue = environment[agentEnvironmentKey(key, agentId)];
    if (agentValue) scoped[key] = agentValue;
    else if (agentId !== "cmo") delete scoped[key];
  }
  return scoped;
}
