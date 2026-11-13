import {
  accessibleChannels,
  challenge,
  connect,
  credential,
  describeSelf,
  listenerMayConnect,
  requireActiveAgent,
  requireAgentChannel,
  routeAgent,
  token,
} from "./owned-agent-connection";
import {
  addToChannel,
  createConnectCode,
  decide,
  list,
  pendingRequests,
  removeFromChannel,
  requireManagedAgent,
  requireMember,
  revoke,
  revokeAgent,
  route,
  summary,
  viewerSees,
} from "./owned-agent-members";
import {
  authorOf,
  consumePostAllowance,
  conversation,
  decode,
  post,
  principalFor,
  project,
  readMessages,
  socketTicket,
  wake,
  wakeReason,
} from "./owned-agent-messaging";
import { audit, auditAgent, owners, writeAudit } from "./owned-agent-support";
import { WorkspaceChannelStore } from "./workspace-channel-store";

export class OwnedAgentService {
  readonly channels: WorkspaceChannelStore;
  constructor(
    readonly storage: DurableObjectStorage,
    readonly env: Env,
  ) {
    this.channels = new WorkspaceChannelStore(storage, env);
  }
  route = route;
  requireMember = requireMember;
  createConnectCode = createConnectCode;
  pendingRequests = pendingRequests;
  decide = decide;
  list = list;
  summary = summary;
  viewerSees = viewerSees;
  requireManagedAgent = requireManagedAgent;
  revoke = revoke;
  revokeAgent = revokeAgent;
  addToChannel = addToChannel;
  removeFromChannel = removeFromChannel;
  routeAgent = routeAgent;
  connect = connect;
  token = token;
  requireActiveAgent = requireActiveAgent;
  listenerMayConnect = listenerMayConnect;
  challenge = challenge;
  credential = credential;
  describeSelf = describeSelf;
  accessibleChannels = accessibleChannels;
  requireAgentChannel = requireAgentChannel;
  readMessages = readMessages;
  decode = decode;
  project = project;
  authorOf = authorOf;
  wakeReason = wakeReason;
  wake = wake;
  principalFor = principalFor;
  conversation = conversation;
  post = post;
  consumePostAllowance = consumePostAllowance;
  socketTicket = socketTicket;
  owners = owners;
  audit = audit;
  auditAgent = auditAgent;
  writeAudit = writeAudit;
}
export * from "./owned-agent-shared";
export { ownedAgentChannelsDeleteForConversation } from "./queries/owned-agents/agents";
