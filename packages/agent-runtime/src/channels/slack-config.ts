import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import type { SlackChannelSettings } from "../types.js";
import type { SlackGatewayConfig } from "./slack-gateway.js";
import { workspaceRoot, workspaceSecrets } from "../workspace-secrets.js";

/**
 * Per-workspace Slack gateway settings. Only the toggle and driver choice
 * live in this file; the tokens (SLACK_BOT_TOKEN / SLACK_APP_TOKEN) live in
 * the workspace's Keychain-backed secrets vault and are read through
 * workspaceSecrets.materialize at start time.
 */
export type SlackGatewaySettings = SlackChannelSettings;

const slackGatewaySettingsSchema = z.object({
  enabled: z.boolean(),
  driver: z.enum(["claude", "codex", "opencode"]),
  model: z.string().optional(),
  allowedUserIds: z.array(z.string()),
  allowedChannelIds: z.array(z.string()),
});

function settingsPath(workspaceId: string) {
  return join(workspaceRoot(workspaceId), "slack.json");
}

export function readSlackGatewaySettings(
  workspaceId: string,
): SlackGatewaySettings | null {
  try {
    return slackGatewaySettingsSchema.parse(
      JSON.parse(readFileSync(settingsPath(workspaceId), "utf8")),
    );
  } catch {
    return null;
  }
}

export function writeSlackGatewaySettings(
  workspaceId: string,
  settings: SlackGatewaySettings,
) {
  mkdirSync(workspaceRoot(workspaceId), { recursive: true, mode: 0o700 });
  writeFileSync(
    settingsPath(workspaceId),
    `${JSON.stringify(settings, null, 2)}\n`,
    { mode: 0o600 },
  );
}

/**
 * Resolves a startable gateway config, or null when the gateway is disabled
 * or the Slack tokens have not been provided yet.
 */
export async function loadSlackGatewayConfig(
  workspaceId: string,
): Promise<SlackGatewayConfig | null> {
  const settings = readSlackGatewaySettings(workspaceId);
  if (!settings?.enabled) return null;
  const env = await workspaceSecrets.readEnv(workspaceId, [
    "SLACK_BOT_TOKEN",
    "SLACK_APP_TOKEN",
  ]);
  const botToken = env.SLACK_BOT_TOKEN;
  const appToken = env.SLACK_APP_TOKEN;
  if (!botToken || !appToken) return null;
  return {
    workspaceId,
    botToken,
    appToken,
    driver: settings.driver,
    model: settings.model,
    allowedUserIds: settings.allowedUserIds,
    allowedChannelIds: settings.allowedChannelIds,
  };
}
