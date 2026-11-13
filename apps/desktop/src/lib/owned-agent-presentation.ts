export function agentName(provider: string, name: string) {
  const key = name.trim().toLowerCase() || provider;
  if (key === "codex" || key === "chatgpt") return "ChatGPT";
  if (key === "claude") return "Claude";
  if (key === "grok") return "Grok";
  return name.charAt(0).toUpperCase() + name.slice(1);
}
