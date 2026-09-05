import type { AgentConfig } from "@chief/relay-contracts";

export function isDesktopNativeCell(
  config: Pick<AgentConfig, "deploymentTarget">,
) {
  return config.deploymentTarget === "desktop";
}
