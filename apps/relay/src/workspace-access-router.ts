import { readTrustedIdentity } from "./internal-context";
import { WorkspaceAccessService } from "./workspace-access-service";
import { WorkspaceAgentAccessService } from "./workspace-agent-access-service";

const operations = new Set([
  "members-list",
  "member-role-set",
  "members-remove",
  "agent-configs-list",
  "agent-config-get",
  "agent-create",
  "agent-runtime-get",
  "agent-config-set",
  "agent-avatar-set",
  "agent-remove",
  "authorize-conversation",
  "authorize-identity-conversation",
  "authorize-agent-runtime",
  "authorize-native-agent",
  "agent-hosting-context",
  "register-agent-key",
  "agent-keys",
]);

export const workspaceAccessRouter = {
  matches(operation: string | null) {
    return operation !== null && operations.has(operation);
  },

  route(
    storage: DurableObjectStorage,
    env: Env,
    request: Request,
    operation: string | null,
  ) {
    const access = new WorkspaceAccessService(storage, env);
    const agents = new WorkspaceAgentAccessService(storage, env);
    switch (operation) {
      case "members-list":
        return access.membersList(request);
      case "member-role-set":
        return access.memberRoleSet(request);
      case "members-remove":
        return access.memberRemove(request);
      case "agent-configs-list":
        return agents.configList(request);
      case "agent-config-get":
        return agents.configGet(request);
      case "agent-create":
        return agents.create(request);
      case "agent-runtime-get":
        return agents.runtimeDescriptor(request);
      case "agent-config-set":
        return agents.configSet(request);
      case "agent-avatar-set":
        return agents.avatarSet(request);
      case "agent-remove":
        return agents.remove(request);
      case "authorize-conversation":
        return agents.authorizeConversation(request);
      case "authorize-identity-conversation":
        return agents.authorizeIdentityConversation(request);
      case "authorize-agent-runtime":
        return agents.authorizeRuntime(request);
      case "authorize-native-agent":
        return agents.authorizeNativeAgent(request);
      case "agent-hosting-context":
        return agents.hostingContext(request);
      case "register-agent-key":
        return access.registerAgentKey(request, readTrustedIdentity(request));
      case "agent-keys":
        return Promise.resolve(access.agentKeys());
      default:
        throw new Error(`Unsupported workspace access operation: ${operation}`);
    }
  },
};
