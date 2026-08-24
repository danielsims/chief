import type {
  AuthenticatedIdentity,
  Principal,
  WorkspaceId,
} from "@chief/relay-contracts";
import { workspaceAuthorizationResultSchema } from "@chief/relay-contracts";

import { AuthorizationError } from "./auth";
import { withTrustedContext, withTrustedIdentity } from "./internal-context";
import { workspaceStub } from "./workspace-stubs";

export async function authorizeWorkspace(
  env: Env,
  input: {
    identity: AuthenticatedIdentity;
    requestId: string;
    workspaceId: WorkspaceId;
  },
): Promise<Principal> {
  const response = await workspaceStub(env, input.workspaceId).fetch(
    withTrustedIdentity(input, {
      method: "POST",
      headers: { "x-chief-internal-operation": "authorize" },
    }),
  );
  if (!response.ok) {
    throw new AuthorizationError(
      "The workspace is not available to this identity.",
    );
  }
  const { principal } = workspaceAuthorizationResultSchema.parse(
    await response.json(),
  );
  // The workspace Durable Object is the request-time authority for both human
  // and agent membership. Better Auth organization membership is synchronized
  // during create/join and verified when switching workspaces; repeating the
  // same D1 lookup for every channel request and live connection amplifies one
  // signed client action into thousands of billable database reads.
  return principal;
}

export async function authorizeConversation(
  env: Env,
  input: {
    principal: Principal;
    requestId: string;
    workspaceId: WorkspaceId;
    conversationId: string;
    permission: "messages.read" | "messages.send" | "messages.manage";
  },
) {
  const url = new URL("https://workspace.internal/authorize-conversation");
  url.searchParams.set("conversationId", input.conversationId);
  const response = await workspaceStub(env, input.workspaceId).fetch(
    withTrustedContext(
      new Request(url, {
        method: "POST",
        headers: {
          "x-chief-internal-operation": "authorize-conversation",
          "x-chief-required-permission": input.permission,
        },
      }),
      input,
    ),
  );
  if (!response.ok) {
    throw new AuthorizationError(
      "The conversation is not available to this identity.",
    );
  }
}
