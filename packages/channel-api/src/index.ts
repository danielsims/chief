import { channelApiOperations, channelApiPrinciples } from "./reference";
import {
  scheduledWorkApiOperations,
  scheduledWorkApiPrinciples,
} from "./scheduled-work-reference";

export { channelApiOperations, channelApiPrinciples };
export { scheduledWorkApiOperations, scheduledWorkApiPrinciples };
export { channelOpenApiPaths, channelOpenApiSchemas } from "./openapi";
export {
  channelAgentPermissions,
  channelKinds,
  channelLifecycleStates,
  channelMemberRoles,
  channelVisibilities,
  channelWorkstreamStatuses,
  scheduledWorkStatuses,
} from "./types";
export type {
  AgentApiToolPermission,
  AgentApiGroup,
  ChannelActorIdentity,
  ChannelAgentPermission,
  ChannelApiOperation,
  ChannelApiPermission,
  ChannelAuditAction,
  ChannelAuditEntry,
  ChannelKind,
  ChannelLifecycleState,
  ChannelMemberIdentity,
  ChannelMemberRole,
  ChannelVisibility,
  ChannelWorkstream,
  ChannelWorkstreamStatus,
  ScheduledWorkStatus,
  ScheduledWorkTrigger,
} from "./types";

const escapePattern = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const operationPathPatterns = [
  ...channelApiOperations,
  ...scheduledWorkApiOperations,
].map((operation) => ({
  operation,
  pattern: new RegExp(
    `^${operation.path
      .split(/(\{[^}]+\})/g)
      .map((part) =>
        part.startsWith("{") && part.endsWith("}")
          ? "[^/]+"
          : escapePattern(part),
      )
      .join("")}$`,
  ),
}));

/** Resolves one documented operation from the concrete request path. */
export function agentApiOperationForRequest(method: string, pathname: string) {
  const verb = method.toUpperCase();
  return operationPathPatterns.find(
    ({ operation, pattern }) =>
      operation.method === verb && pattern.test(pathname),
  )?.operation;
}
