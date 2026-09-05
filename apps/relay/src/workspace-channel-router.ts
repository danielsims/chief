import type { WorkspaceSnapshot } from "@chief/relay-contracts";
import {
  channelArchiveCommandSchema,
  channelUnarchiveCommandSchema,
} from "@chief/relay-contracts";

import { relayError } from "./http";
import { readTrustedContext } from "./internal-context";
import { WorkspaceChannelMembership } from "./workspace-channel-membership";
import { WorkspaceChannelService } from "./workspace-channel-service";
import { WorkspaceChannelStore } from "./workspace-channel-store";

export async function routeWorkspaceDirect(
  storage: DurableObjectStorage,
  env: Env,
  request: Request,
) {
  return new WorkspaceChannelService(
    new WorkspaceChannelStore(storage, env),
  ).directsStart(request);
}

export async function routeWorkspaceChannel(
  storage: DurableObjectStorage,
  env: Env,
  request: Request,
  operation: string,
) {
  const context = readTrustedContext(request);
  const store = new WorkspaceChannelStore(storage, env);
  store.requirePrincipalMember(context.principal);
  store.requireAgentCapability(
    context.principal,
    permissionForChannelOperation(operation),
  );
  const channels = new WorkspaceChannelService(store);
  const membership = new WorkspaceChannelMembership(store);

  switch (operation) {
    case "channels-create":
      return await channels.channelsCreate(request, context);
    case "channels-list":
      return channels.channelsList(context);
    case "channels-get":
      return channels.channelsGet(request, context);
    case "channels-update":
      return await channels.channelsUpdate(request, context);
    case "channels-archive":
      return await channels.channelsArchive(
        request,
        channelArchiveCommandSchema,
        true,
        context,
      );
    case "channels-unarchive":
      return await channels.channelsArchive(
        request,
        channelUnarchiveCommandSchema,
        false,
        context,
      );
    case "channels-join":
      return await channels.channelsJoin(request, context);
    case "channels-leave":
      return await channels.channelsLeave(request, context);
    case "channels-members-list":
      return await membership.channelsMembersList(request, context);
    case "channels-memberships-list":
      return membership.channelsMembershipsList(context);
    case "channels-memberships-self":
      return membership.currentPrincipalMembershipsList(context);
    case "channels-members-add":
      return await membership.channelsMembersAdd(request, context);
    case "channels-members-remove":
      return await membership.channelsMembersRemove(request, context);
    default:
      return relayError(404, "not_found", "Channel operation not found.");
  }
}

function permissionForChannelOperation(operation: string) {
  switch (operation) {
    case "channels-list":
    case "channels-get":
      return "channels.read";
    case "channels-create":
      return "channels.create";
    case "channels-update":
      return "channels.update";
    case "channels-archive":
    case "channels-unarchive":
      return "channels.archive";
    case "channels-members-list":
    case "channels-memberships-list":
      return "members.read";
    case "channels-memberships-self":
      return "channels.read";
    case "channels-join":
    case "channels-leave":
    case "channels-members-add":
    case "channels-members-remove":
      return "members.manage";
    default:
      return "channels.read";
  }
}

export function ensureSnapshotChannels(
  storage: DurableObjectStorage,
  env: Env,
) {
  new WorkspaceChannelStore(storage, env).ensureSnapshotChannels();
}

export function seedSnapshotChannels(
  storage: DurableObjectStorage,
  env: Env,
  snapshot: WorkspaceSnapshot,
  ownerId: string,
  createdAt: string,
) {
  new WorkspaceChannelStore(storage, env).seedSnapshotChannels(
    snapshot,
    ownerId,
    createdAt,
  );
}
