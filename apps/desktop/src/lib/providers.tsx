import type { ComponentType } from "react";
import { Claude, OpenAI, Vercel } from "@lobehub/icons";

/**
 * Provider metadata shared by the settings default-provider select and the
 * per-chat provider switcher. "Local" providers run on this machine via
 * their CLI; "Deployed" ones run remotely.
 */
export type Provider = "claude" | "codex" | "vercel";

export interface ProviderMeta {
  label: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
  location: "Local" | "Deployed";
}

export const PROVIDER_META: Record<Provider, ProviderMeta> = {
  claude: { label: "Claude", Icon: Claude.Color, location: "Local" },
  // Codex has no dedicated mark we ship; the OpenAI logo is the recognizable one.
  codex: { label: "Codex", Icon: OpenAI, location: "Local" },
  vercel: { label: "Vercel", Icon: Vercel, location: "Deployed" },
};
