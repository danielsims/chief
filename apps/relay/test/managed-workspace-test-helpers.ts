import { expect } from "vitest";

import type { agentIdSchema, WorkspaceId } from "@chief/relay-contracts";
import { appendMessageCommandSchema } from "@chief/relay-contracts";

import type { createManagedWorkspace } from "../src/workspace-authority";
import { withTrustedContext } from "../src/internal-context";

export async function performChiefDelegation(input: {
  relay: Parameters<typeof createManagedWorkspace>[0];
  workspace: DurableObjectStub;
  workspaceId: WorkspaceId;
  chief: {
    kind: "agent";
    agentId: ReturnType<typeof agentIdSchema.parse>;
    pubkey: string;
    workspaceId: WorkspaceId;
    role: "owner" | "admin" | "member";
  };
}) {
  const openingMessage =
    "Hey, welcome to Chief. I'm getting the team together now.";
  const components: Array<{
    id: string;
    kind: "tool";
    version: 1;
    payload: Record<string, unknown>;
  }> = [];
  const post = async (body: string) => {
    const messageId = crypto.randomUUID();
    const command = appendMessageCommandSchema.parse({
      commandId: crypto.randomUUID(),
      protocolVersion: 1,
      occurredAt: new Date().toISOString(),
      payload: {
        messageId,
        conversationId: "mission-control",
        body,
        mentions: [],
        components: [],
      },
    });
    const conversation = input.relay.CONVERSATIONS.get(
      input.relay.CONVERSATIONS.idFromName(
        `${input.workspaceId}:mission-control`,
      ),
    );
    const response = await conversation.fetch(
      withTrustedContext(
        new Request("https://conversation.internal/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(command),
        }),
        {
          principal: input.chief,
          requestId: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          conversationId: "mission-control",
        },
      ),
    );
    expect(response.status).toBe(200);
    components.push(
      toolComponent(
        "relay_message_post",
        { conversationId: "mission-control", body },
        { messageId },
      ),
    );
    return messageId;
  };

  await post(openingMessage);
  const membershipCommand = {
    commandId: crypto.randomUUID(),
    protocolVersion: 1,
    occurredAt: new Date().toISOString(),
    payload: {
      conversationId: "mission-control",
      members: ["brand", "prospector", "engineer", "setup"].map(
        (principalId) => ({ kind: "agent", principalId }),
      ),
    },
  };
  const membershipResponse = await input.workspace.fetch(
    withTrustedContext(
      new Request("https://workspace.internal/channels", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": "channels-members-add",
        },
        body: JSON.stringify(membershipCommand),
      }),
      {
        principal: input.chief,
        requestId: crypto.randomUUID(),
        workspaceId: input.workspaceId,
      },
    ),
  );
  expect(membershipResponse.status).toBe(200);
  components.push(
    toolComponent(
      "relay_channels_members_add",
      {
        conversationId: "mission-control",
        kind: "agent",
        principalIds: ["brand", "prospector", "engineer", "setup"],
      },
      { ok: true },
    ),
  );
  await post("Hey @Marketer, start a useful working brand profile.");
  await post("Hey @Prospector, start looking for genuine buying signals.");
  await post(
    "Hey @Engineer, get oriented and prepare the Engineering workspace.",
  );
  await post("Hey @Setup, privately prepare the selected connections.");
  return { openingMessage, components };
}

function toolComponent(
  name: string,
  toolInput: Record<string, unknown>,
  output: Record<string, unknown>,
) {
  return {
    id: crypto.randomUUID(),
    kind: "tool" as const,
    version: 1 as const,
    payload: {
      name,
      status: "completed",
      input: JSON.stringify(toolInput),
      output: JSON.stringify(output),
    },
  };
}
