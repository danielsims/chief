import type { Principal } from "@chief/relay-contracts";

import type { WorkspaceChannelStore } from "./workspace-channel-store";
import { HttpError } from "./http";

export function requireWorkspaceAdministrator(
  channels: WorkspaceChannelStore,
  principal: Principal,
) {
  const member = channels.requirePrincipalMember(principal);
  if (
    principal.kind !== "user" ||
    (member.role !== "owner" && member.role !== "admin")
  ) {
    throw new HttpError(
      403,
      "workspace_administration_denied",
      "Only a workspace owner or admin can perform this operation.",
    );
  }
  return member;
}
