import { z } from "zod";

import type { WorkspaceSnapshot } from "@chief/relay-contracts";
import {
  agentConfigSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import type { TrustedRequestContext } from "./internal-context";
import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import { agentConfigsUpdateEnableHostedSpecialists } from "./queries/agent-configs/update-enable-hosted-specialists";
import { channelMembersAddAgentToExistingChannel } from "./queries/channel-members/add-agent-to-existing-channel";
import { workspaceUpdateVerifyConnection } from "./queries/workspace/update-verify-connection";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import {
  decodeWorkspaceSnapshot,
  workspaceAgentProfiles,
} from "./workspace-defaults";
import { enableHostedSpecialists } from "./workspace-hosted-specialists";
import { ensureWelcomeChannel } from "./workspace-welcome";
import {
  postAgentMessage,
  startWelcomeKickoff,
  welcomeKickoffTasks,
} from "./workspace-welcome-kickoff";

/** The owner finishes guided setup and enters their workspace. */
export async function finishWorkspaceSetup(
  storage: DurableObjectStorage,
  env: Env,
  request: Request,
) {
  const context = readTrustedContext(request);
  const settings = z
    .object({
      selectedApps: z
        .array(z.string().trim().min(1).max(256))
        .max(40)
        .optional(),
    })
    .strict()
    .parse(await parseJson(request));
  return json(
    await completeWorkspaceSetup(storage, env, context, settings.selectedApps),
  );
}

/**
 * Opens the workspace: the owner's agents are enabled, Chief welcomes them in
 * their private Welcome channel and each teammate picks up a first task there.
 * Human setup is separate from provider deployment or a model turn.
 */
export async function completeWorkspaceSetup(
  storage: DurableObjectStorage,
  env: Env,
  context: TrustedRequestContext,
  selectedApps?: readonly string[],
): Promise<WorkspaceSnapshot> {
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
  const stored = decodeWorkspaceSnapshot(workspace.snapshot_json);
  if (stored.setupComplete === true) return stored;
  const snapshot = {
    ...stored,
    selectedApps: selectedApps ? [...selectedApps] : stored.selectedApps,
  };
  const chief = snapshot.agents.find((a) => a.id === "chief");
  // Without a Chief cell, Chief runs on Vercel Eve and must be connected.
  const onEve = snapshot.runtime === null;
  if (
    onEve &&
    (chief?.runtime.kind !== "external-channel" ||
      chief.runtime.connectionStatus !== "connected")
  )
    throw new HttpError(
      409,
      "chief_not_connected",
      "Finish connecting Chief before entering your workspace.",
    );
  const now = new Date().toISOString();
  const tasks = welcomeKickoffTasks(snapshot);
  const welcome = storage.transactionSync(() => {
    if (onEve) enableHostedSpecialists(storage, channels, "chief", now);
    else
      for (const agent of workspaceAgentProfiles(snapshot))
        agentConfigsUpdateEnableHostedSpecialists(storage, {
          agentId: agent.id,
          configJson: JSON.stringify(
            agentConfigSchema.parse({
              ...channels.agentConfiguration(agent.id),
              enabled: true,
            }),
          ),
          updatedAt: now,
        });
    // The owner's private line to Chief; each teammate joins for its task.
    const conversationId = ensureWelcomeChannel(storage, {
      workspaceId: snapshot.id,
      userId: workspace.created_by_user_id,
      now,
    });
    for (const task of tasks)
      channelMembersAddAgentToExistingChannel(storage, {
        conversationId,
        agentId: task.agentId,
        joinedAt: now,
      });
    return conversationId;
  });
  const opener =
    snapshot.purpose === "personal"
      ? `Welcome to ${snapshot.name}. I'm Chief, your personal chief of staff. What would you like to work on first?`
      : `Welcome to ${snapshot.name}. I'm Chief, your team's chief of staff.${snapshot.companyName ? ` We're ready to work with ${snapshot.companyName}.` : ""} What would you like to work on first?`;
  await postAgentMessage(env, context, {
    workspaceId: snapshot.id,
    conversationId: welcome,
    agentId: "chief",
    body: opener,
    seed: "setup:chief",
    occurredAt: now,
  });
  await startWelcomeKickoff(env, context, snapshot, welcome, tasks);
  const completed = workspaceSnapshotSchema.parse({
    ...snapshot,
    setupComplete: true,
    onboardingComplete: true,
    agents: snapshot.agents.map((a) =>
      a.id === "chief" ? { ...a, status: "idle" } : a,
    ),
  });
  workspaceUpdateVerifyConnection(storage, JSON.stringify(completed));
  return completed;
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
