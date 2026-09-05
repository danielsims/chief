import { isTauri } from "@tauri-apps/api/core";
import { z } from "zod";

import type { ClientMessage } from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";
import { relayProjectCreateSchema } from "@chief/relay-contracts";

import { requestDesktopPluginHost } from "./desktop-plugin-host";

const preparedSchema = z.object({
  connectionId: z.string().uuid(),
  project: relayProjectCreateSchema,
});

export async function connectRelayProject(
  relay: Pick<RelayClient, "createProject" | "listProjects">,
  workspaceId: string,
  message: Extract<ClientMessage, { type: "attachProject" | "cloneProject" }>,
) {
  if (!isTauri())
    throw new Error(
      "Open Chief on your Mac to connect a repository using your Git credentials.",
    );
  const prepared = preparedSchema.parse(
    await requestDesktopPluginHost(
      "/projects/prepare",
      message.type === "attachProject"
        ? { workspaceId, source: "attach", path: message.path }
        : { workspaceId, source: "clone", remoteUrl: message.remoteUrl },
    ),
  );
  const metadata = {
    ...prepared.project,
    ...(message.name?.trim() ? { name: message.name.trim() } : undefined),
    ...(message.description?.trim()
      ? { description: message.description.trim() }
      : undefined),
  };
  const existing = metadata.canonicalRemoteUrl
    ? (await relay.listProjects()).find(
        (project) => project.canonicalRemoteUrl === metadata.canonicalRemoteUrl,
      )
    : undefined;
  const project = existing ?? (await relay.createProject(metadata));
  await requestDesktopPluginHost("/projects/bind", {
    workspaceId,
    connectionId: prepared.connectionId,
    projectId: project.id,
  });
  return project;
}
