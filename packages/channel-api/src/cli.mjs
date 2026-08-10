#!/usr/bin/env node
// @ts-nocheck -- executable JavaScript so the packaged CLI runs without a TS loader.
import { pathToFileURL } from "node:url";

const commands = {
  "channels list": ["GET", "/local-tools/channels"],
  "channels get": ["GET", "/local-tools/channels/{channelId}", ["channelId"]],
  "channels create": ["POST", "/local-tools/channels"],
  "channels update": [
    "PATCH",
    "/local-tools/channels/{channelId}",
    ["channelId"],
  ],
  "channels archive": [
    "POST",
    "/local-tools/channels/{channelId}/archive",
    ["channelId"],
  ],
  "channels restore": [
    "POST",
    "/local-tools/channels/{channelId}/unarchive",
    ["channelId"],
  ],
  "channels join": [
    "POST",
    "/local-tools/channels/{channelId}/join",
    ["channelId"],
  ],
  "channels leave": [
    "POST",
    "/local-tools/channels/{channelId}/leave",
    ["channelId"],
  ],
  "channels members": [
    "GET",
    "/local-tools/channels/{channelId}/members",
    ["channelId"],
  ],
  "channels add-member": [
    "POST",
    "/local-tools/channels/{channelId}/members",
    ["channelId"],
  ],
  "channels remove-member": [
    "DELETE",
    "/local-tools/channels/{channelId}/members/{memberId}",
    ["channelId", "memberId"],
  ],
  "channels activity": [
    "GET",
    "/local-tools/channels/{channelId}/activity",
    ["channelId"],
  ],
  "channels request-delete": [
    "POST",
    "/local-tools/channels/{channelId}/deletion-request",
    ["channelId"],
  ],
  "messages list": [
    "GET",
    "/local-tools/channels/{channelId}/messages",
    ["channelId"],
  ],
  "messages get": [
    "GET",
    "/local-tools/channels/{channelId}/messages/{messageId}",
    ["channelId", "messageId"],
  ],
  "messages send": [
    "POST",
    "/local-tools/channels/{channelId}/messages",
    ["channelId"],
  ],
  "messages edit": [
    "PATCH",
    "/local-tools/channels/{channelId}/messages/{messageId}",
    ["channelId", "messageId"],
  ],
  "messages delete": [
    "DELETE",
    "/local-tools/channels/{channelId}/messages/{messageId}",
    ["channelId", "messageId"],
  ],
  "messages thread": [
    "GET",
    "/local-tools/channels/{channelId}/messages/{messageId}/replies",
    ["channelId", "messageId"],
  ],
  "messages search": ["GET", "/local-tools/messages/search"],
  "reactions list": [
    "GET",
    "/local-tools/channels/{channelId}/messages/{messageId}/reactions",
    ["channelId", "messageId"],
  ],
  "reactions add": [
    "POST",
    "/local-tools/channels/{channelId}/messages/{messageId}/reactions",
    ["channelId", "messageId"],
  ],
  "reactions remove": [
    "DELETE",
    "/local-tools/channels/{channelId}/messages/{messageId}/reactions/{emoji}",
    ["channelId", "messageId", "emoji"],
  ],
  "scheduled list": ["GET", "/local-tools/scheduled-work"],
  "scheduled get": [
    "GET",
    "/local-tools/scheduled-work/{scheduledWorkId}",
    ["scheduledWorkId"],
  ],
  "scheduled create": ["POST", "/local-tools/scheduled-work"],
  "scheduled update": [
    "PATCH",
    "/local-tools/scheduled-work/{scheduledWorkId}",
    ["scheduledWorkId"],
  ],
  "scheduled pause": [
    "POST",
    "/local-tools/scheduled-work/{scheduledWorkId}/pause",
    ["scheduledWorkId"],
  ],
  "scheduled resume": [
    "POST",
    "/local-tools/scheduled-work/{scheduledWorkId}/resume",
    ["scheduledWorkId"],
  ],
  "scheduled delete": [
    "DELETE",
    "/local-tools/scheduled-work/{scheduledWorkId}",
    ["scheduledWorkId"],
  ],
  "scheduled run": [
    "POST",
    "/local-tools/scheduled-work/{scheduledWorkId}/runs",
    ["scheduledWorkId"],
  ],
  "scheduled runs": [
    "GET",
    "/local-tools/scheduled-work/{scheduledWorkId}/runs",
    ["scheduledWorkId"],
  ],
  "scheduled run-get": [
    "GET",
    "/local-tools/scheduled-work/{scheduledWorkId}/runs/{runId}",
    ["scheduledWorkId", "runId"],
  ],
  "scheduled cancel": [
    "POST",
    "/local-tools/scheduled-work/{scheduledWorkId}/runs/{runId}/cancel",
    ["scheduledWorkId", "runId"],
  ],
  "scheduled retry": [
    "POST",
    "/local-tools/scheduled-work/{scheduledWorkId}/runs/{runId}/retry",
    ["scheduledWorkId", "runId"],
  ],
  "scheduled webhook": [
    "GET",
    "/local-tools/scheduled-work/{scheduledWorkId}/webhook",
    ["scheduledWorkId"],
  ],
  "scheduled rotate-webhook": [
    "POST",
    "/local-tools/scheduled-work/{scheduledWorkId}/webhook/rotate",
    ["scheduledWorkId"],
  ],
};

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function resolveCliRequest(args, sessionId) {
  const key = `${args[0] ?? ""} ${args[1] ?? ""}`.trim();
  const definition = commands[key];
  if (!definition) throw new Error(`Unknown command: ${key || "none"}`);
  const [method, template, parameterNames = []] = definition;
  const positional = args.slice(2).filter((value, index, all) => {
    if (value.startsWith("--")) return false;
    return index === 0 || !all[index - 1]?.startsWith("--");
  });
  let path = template;
  parameterNames.forEach((name, index) => {
    const value = positional[index];
    if (!value) throw new Error(`${name} is required.`);
    path = path.replace(`{${name}}`, encodeURIComponent(value));
  });
  const query = option(args, "--query");
  const cursor = option(args, "--cursor");
  const limit = option(args, "--limit");
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", limit);
  if (sessionId) params.set("sessionId", sessionId);
  const rawBody = option(args, "--json");
  const body = rawBody ? JSON.parse(rawBody) : undefined;
  return {
    method,
    path: `${path}${params.size ? `?${params}` : ""}`,
    body,
  };
}

async function main() {
  if (process.argv.includes("--help") || process.argv.length < 4) {
    process.stdout.write(
      "chief-agent <channels|messages|reactions|scheduled> <command> [ids] [--json '{}']\n",
    );
    return;
  }
  const token = process.env.CHIEF_LOCAL_CAPABILITY;
  if (!token) throw new Error("CHIEF_LOCAL_CAPABILITY is required.");
  const request = resolveCliRequest(
    process.argv.slice(2),
    process.env.CHIEF_SESSION_ID,
  );
  const baseUrl = process.env.CHIEF_LOCAL_URL ?? "http://127.0.0.1:4318";
  const response = await fetch(new URL(request.path, baseUrl), {
    method: request.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(request.body ? { "Content-Type": "application/json" } : {}),
    },
    body: request.body ? JSON.stringify(request.body) : undefined,
  });
  const result = await response.text();
  process.stdout.write(`${result}\n`);
  if (!response.ok) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
