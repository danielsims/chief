import type { WorkspaceSnapshot } from "@chief/relay-contracts";
import { agentIdSchema, welcomeChannelId } from "@chief/relay-contracts";

import { deterministicUuid } from "./external-agent-channel-security";
import { HttpError, json } from "./http";
import { readTrustedContext } from "./internal-context";
import { channelMembersAddAgentToExistingChannel } from "./queries/channel-members/add-agent-to-existing-channel";
import { channelsFindCreateChannel } from "./queries/channels/find-create-channel";
import { WorkspaceChannelMembership } from "./workspace-channel-membership";
import { firstRow } from "./workspace-channel-rows";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import { decodeWorkspaceSnapshot } from "./workspace-defaults";
import { ensureWelcomeChannel } from "./workspace-welcome";
import {
  postAgentMessage,
  startWelcomeKickoff,
  welcomeKickoffTasks,
} from "./workspace-welcome-kickoff";

/** The desktop calls this only after its workspace live subscription is ready. */
export async function startWorkspaceWelcome(
  storage: DurableObjectStorage,
  env: Env,
  request: Request,
) {
  const context = readTrustedContext(request);
  const channels = new WorkspaceChannelStore(storage, env);
  channels.requirePrincipalMember(context.principal);
  const workspace = channels.requireWorkspace(context.workspaceId);
  if (context.principal.kind !== "user")
    throw new HttpError(
      403,
      "member_required",
      "A workspace member is required.",
    );
  const snapshot: WorkspaceSnapshot = decodeWorkspaceSnapshot(
    workspace.snapshot_json ?? "{}",
  );
  if (context.principal.userId !== workspace.created_by_user_id)
    return json(snapshot);
  if (snapshot.setupComplete !== true)
    throw new HttpError(
      409,
      "setup_required",
      "Finish setup before entering your workspace.",
    );
  // Existing workspaces have no marker. New starts persist their phase before
  // creating the channel, so a retry after a partial kickoff remains safe.
  const existingWelcome = Boolean(
    firstRow(
      channelsFindCreateChannel(
        storage,
        welcomeChannelId(context.principal.userId),
      ),
    ),
  );
  const shouldStart = await storage.transaction(async (transaction) => {
    if (await transaction.get<boolean>("workspace:welcome-started"))
      return false;
    if (
      !(await transaction.get<boolean>("workspace:welcome-starting")) &&
      existingWelcome
    ) {
      await transaction.put("workspace:welcome-started", true);
      return false;
    }
    await transaction.put("workspace:welcome-starting", true);
    return true;
  });
  if (!shouldStart) return json(snapshot);
  const now = new Date().toISOString();
  const tasks = welcomeKickoffTasks(snapshot);
  const welcome = storage.transactionSync(() => {
    // Create the channel only once the person is in the workspace.
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
  const membershipId = await deterministicUuid(
    `${snapshot.id}:welcome-membership`,
  );
  await new WorkspaceChannelMembership(channels).publishMemberAddedEvent(
    snapshot.id,
    welcome,
    {
      commandId: membershipId,
      messageId: membershipId,
      actor: {
        kind: "agent",
        agentId: agentIdSchema.parse("chief"),
        workspaceId: snapshot.id,
        role: "member",
        pubkey: "0".repeat(64),
      },
      targets: [{ kind: "user", id: context.principal.userId, name: "you" }],
      occurredAt: now,
    },
  );
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
  await storage.put("workspace:welcome-started", true);
  await storage.delete("workspace:welcome-starting");
  return json(snapshot);
}
