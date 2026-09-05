import { isTauri } from "@tauri-apps/api/core";
import { z } from "zod";

import type {
  ClientMessage,
  ProjectRepositorySnapshot,
  ServerMessage,
} from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";
import { relayProjectCreateSchema } from "@chief/relay-contracts";

import { requestDesktopPluginHost } from "./desktop-plugin-host";
import {
  localProjectBrowserSchema,
  localProjectCommitSchema,
  localProjectComparisonSchema,
  localProjectSnapshotsSchema,
} from "./local-project-view";

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

export async function localProjectSnapshots(
  workspaceId: string,
  snapshots: ProjectRepositorySnapshot[],
): Promise<ProjectRepositorySnapshot[]> {
  if (!isTauri()) return snapshots;
  const response = await requestDesktopPluginHost("/projects/query", {
    workspaceId,
    operation: "snapshots",
  });
  const local = new Map(
    localProjectSnapshotsSchema
      .parse(response.snapshots)
      .map((snapshot) => [snapshot.project.id, snapshot]),
  );
  return snapshots.map((snapshot) => {
    const connected = local.get(snapshot.project.id);
    return connected
      ? {
          ...snapshot,
          ...connected,
          error: connected.error,
          project: snapshot.project,
        }
      : snapshot;
  });
}

export async function queryRelayProject(
  workspaceId: string,
  message: Extract<
    ClientMessage,
    {
      type: "browseProject" | "inspectProjectCommit" | "compareProjectBranches";
    }
  >,
): Promise<ServerMessage> {
  const scope = { workspaceId, projectId: message.projectId };
  switch (message.type) {
    case "browseProject": {
      const response = await requestDesktopPluginHost("/projects/query", {
        ...scope,
        operation: "browse",
        ref: message.ref ?? "HEAD",
        path: message.path,
      });
      return {
        type: "projectBrowser",
        workspaceId,
        requestId: message.requestId,
        browser: localProjectBrowserSchema.parse(response.browser),
      };
    }
    case "inspectProjectCommit": {
      const response = await requestDesktopPluginHost("/projects/query", {
        ...scope,
        operation: "commit",
        ref: message.ref ?? "HEAD",
        commit: message.commit,
      });
      return {
        type: "projectCommit",
        workspaceId,
        requestId: message.requestId,
        detail: localProjectCommitSchema.parse(response.detail),
      };
    }
    case "compareProjectBranches": {
      const response = await requestDesktopPluginHost("/projects/query", {
        ...scope,
        operation: "compare",
        baseRef: message.baseRef,
        compareRef: message.compareRef,
      });
      return {
        type: "projectComparison",
        workspaceId,
        requestId: message.requestId,
        comparison: localProjectComparisonSchema.parse(response.comparison),
      };
    }
  }
}
