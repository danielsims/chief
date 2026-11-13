import { z } from "zod";

import {
  agentConfigSchema,
  agentIdSchema,
  appendMessageCommandSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import { deterministicUuid } from "./external-agent-channel-security";
import { HttpError, json, parseJson } from "./http";
import { readTrustedContext, withTrustedContext } from "./internal-context";
import { agentConfigsUpdateEnableHostedSpecialists } from "./queries/agent-configs/update-enable-hosted-specialists";
import { workspaceUpdateVerifyConnection } from "./queries/workspace/update-verify-connection";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import {
  decodeWorkspaceSnapshot,
  workspaceAgentProfiles,
} from "./workspace-defaults";
import { ensureWelcomeChannel } from "./workspace-welcome";

/** Human setup is separate from provider deployment or a model turn. */
export async function finishWorkspaceSetup(
  storage: DurableObjectStorage,
  env: Env,
  request: Request,
) {
  const context = readTrustedContext(request);
  const channels = new WorkspaceChannelStore(storage, env);
  channels.requirePrincipalMember(context.principal);
  const workspace = channels.requireWorkspace(context.workspaceId);
  if (
    context.principal.kind !== "user" ||
    context.principal.userId !== workspace.created_by_user_id
  )
    throw new HttpError(
      403,
      "owner_required",
      "Only the workspace creator can finish setup.",
    );
  if (!workspace.snapshot_json)
    throw new HttpError(
      409,
      "snapshot_missing",
      "Workspace setup is unavailable.",
    );
  const settings = z
    .object({
      selectedApps: z
        .array(z.string().trim().min(1).max(256))
        .max(40)
        .optional(),
    })
    .strict()
    .parse(await parseJson(request));
  const snapshot = {
    ...decodeWorkspaceSnapshot(workspace.snapshot_json),
    selectedApps:
      settings.selectedApps ??
      decodeWorkspaceSnapshot(workspace.snapshot_json).selectedApps,
  };
  if (snapshot.setupComplete !== false) return json(snapshot);
  const chief = snapshot.agents.find((a) => a.id === "chief");
  if (
    snapshot.runtime === null &&
    (chief?.runtime.kind !== "external-channel" ||
      chief.runtime.connectionStatus !== "connected")
  )
    throw new HttpError(
      409,
      "chief_not_connected",
      "Finish connecting Chief before entering your workspace.",
    );
  const now = new Date().toISOString();
  const welcome = storage.transactionSync(() => {
    for (const agent of workspaceAgentProfiles(snapshot)) {
      if (
        snapshot.agents.some(
          (parent) =>
            parent.id === agent.id &&
            parent.runtime.kind === "external-channel",
        )
      )
        continue;
      const config = agentConfigSchema.parse({
        ...channels.agentConfiguration(agent.id),
        enabled: true,
      });
      agentConfigsUpdateEnableHostedSpecialists(storage, {
        agentId: agent.id,
        configJson: JSON.stringify(config),
        updatedAt: now,
      });
    }
    // The owner's private line to Chief; teammates join when work needs them.
    return ensureWelcomeChannel(storage, {
      workspaceId: snapshot.id,
      userId: workspace.created_by_user_id,
      now,
    });
  });
  const opener =
    snapshot.purpose === "personal"
      ? `Welcome to ${snapshot.name}. I'm Chief, your personal chief of staff. What would you like to work on first?`
      : `Welcome to ${snapshot.name}. I'm Chief, your team's chief of staff.${snapshot.companyName ? ` We're ready to work with ${snapshot.companyName}.` : ""} What would you like to work on first?`;
  const greetings = [{ id: "chief", body: opener }];
  for (const greeting of greetings) {
    const commandId = await deterministicUuid(
      `${snapshot.id}:setup:${greeting.id}`,
    );
    const principal = {
      kind: "agent" as const,
      agentId: agentIdSchema.parse(greeting.id),
      workspaceId: snapshot.id,
      role: "member" as const,
      pubkey: "0".repeat(64),
    };
    const command = appendMessageCommandSchema.parse({
      commandId,
      protocolVersion: 1,
      occurredAt: snapshot.createdAt,
      payload: {
        messageId: commandId,
        conversationId: welcome,
        body: greeting.body,
        mentions: [],
        components: [],
      },
    });
    const response = await env.CONVERSATIONS.get(
      env.CONVERSATIONS.idFromName(`${snapshot.id}:${welcome}`),
    ).fetch(
      withTrustedContext(
        new Request("https://conversation.internal/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(command),
        }),
        {
          ...context,
          principal,
          conversationId: welcome,
          requestId: commandId,
        },
      ),
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(
        502,
        "welcome_failed",
        "Your welcome messages could not be saved. Please try again.",
      );
    }
    await response.body?.cancel();
  }
  const completed = workspaceSnapshotSchema.parse({
    ...snapshot,
    setupComplete: true,
    onboardingComplete: true,
    agents: snapshot.agents.map((a) =>
      a.id === "chief" ? { ...a, status: "idle" } : a,
    ),
  });
  workspaceUpdateVerifyConnection(storage, JSON.stringify(completed));
  return json(completed);
}
export function workspaceSetupSnapshot(
  storage: DurableObjectStorage,
  env: Env,
  request: Request,
) {
  const context = readTrustedContext(request);
  const channels = new WorkspaceChannelStore(storage, env);
  if (context.principal.kind !== "user")
    throw new HttpError(
      403,
      "member_required",
      "A workspace member is required.",
    );
  channels.requirePrincipalMember(context.principal);
  const workspace = channels.requireWorkspace(context.workspaceId);
  if (!workspace.snapshot_json)
    throw new HttpError(
      409,
      "snapshot_missing",
      "Workspace setup is unavailable.",
    );
  return json(decodeWorkspaceSnapshot(workspace.snapshot_json));
}
