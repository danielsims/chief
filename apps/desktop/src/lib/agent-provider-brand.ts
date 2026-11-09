/** Normalized keys for the provider marks used by registered local agents. */
export function agentProviderBrand(
  provider?: string,
): "claude" | "codex" | "opencode" | undefined {
  switch (provider) {
    case "claude":
      return "claude";
    case "codex":
      return "codex";
    case "opencode":
    case "openCodeGo":
      return "opencode";
    default:
      return undefined;
  }
}
