import { z } from "zod";

import {
  agentIdSchema,
  conversationIdSchema,
  externalAgentDeliveryCommandSchema,
  messageIdSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { ExternalAgentAdministration } from "./external-agent-administration";
import { ExternalAgentChannelService } from "./external-agent-channel";

const externalAgentMessagePath = /\/agents\/([^/]+)\/channel\/messages$/u;
const externalAgentRequeuePath =
  /\/agents\/([^/]+)\/channel\/deliveries\/([^/]+)\/requeue$/u;
type ExternalAgentOperation =
  | "external-agent-register"
  | "external-agent-message"
  | "external-agent-activity"
  | "external-agent-enqueue"
  | "external-agent-requeue"
  | "external-agent-recover"
  | "external-agent-reconciliations"
  | "external-agent-disconnect"
  | "external-agent-verify"
  | "external-agent-rotate";

export const externalAgentRouter = {
  matches(value: string | null): value is ExternalAgentOperation {
    return (
      value === "external-agent-register" ||
      value === "external-agent-message" ||
      value === "external-agent-activity" ||
      value === "external-agent-enqueue" ||
      value === "external-agent-requeue" ||
      value === "external-agent-recover" ||
      value === "external-agent-reconciliations" ||
      value === "external-agent-disconnect" ||
      value === "external-agent-verify" ||
      value === "external-agent-rotate"
    );
  },
  route(
    storage: DurableObjectStorage,
    env: Env,
    request: Request,
    operation: ExternalAgentOperation,
  ) {
    const service = new ExternalAgentChannelService(storage, env);
    if (operation === "external-agent-register")
      return service.register(request);
    if (operation === "external-agent-verify") {
      const match = /\/agents\/([^/]+)\/external\/verify$/u.exec(
        new URL(request.url).pathname,
      );
      return new ExternalAgentAdministration(storage, env).verifyConnection(
        request,
        decodeURIComponent(match?.[1] ?? ""),
      );
    }
    if (operation === "external-agent-rotate") {
      const match = /\/agents\/([^/]+)\/external\/credentials\/rotate$/u.exec(
        new URL(request.url).pathname,
      );
      return new ExternalAgentAdministration(storage, env).rotateCredentials(
        request,
        decodeURIComponent(match?.[1] ?? ""),
      );
    }
    if (operation === "external-agent-enqueue")
      return enqueue(service, request);
    if (operation === "external-agent-requeue") {
      const match = externalAgentRequeuePath.exec(
        new URL(request.url).pathname,
      );
      return new ExternalAgentAdministration(storage, env).requeue(
        request,
        decodeURIComponent(match?.[1] ?? ""),
        decodeURIComponent(match?.[2] ?? ""),
      );
    }
    if (operation === "external-agent-recover") {
      const match = externalAgentRecoveryPath.exec(
        new URL(request.url).pathname,
      );
      return new ExternalAgentAdministration(storage, env).recover(
        request,
        decodeURIComponent(match?.[1] ?? ""),
        decodeURIComponent(match?.[2] ?? ""),
      );
    }
    if (operation === "external-agent-reconciliations") {
      const match =
        /\/agents\/([^/]+)\/channel\/deliveries\/reconciling$/u.exec(
          new URL(request.url).pathname,
        );
      return new ExternalAgentAdministration(storage, env).reconciliations(
        request,
        decodeURIComponent(match?.[1] ?? ""),
      );
    }
    if (operation === "external-agent-disconnect") {
      const match = /\/agents\/([^/]+)\/external$/u.exec(
        new URL(request.url).pathname,
      );
      return new ExternalAgentAdministration(storage, env).disconnect(
        request,
        decodeURIComponent(match?.[1] ?? ""),
      );
    }
    if (operation === "external-agent-activity") {
      const match = /\/agents\/([^/]+)\/channel\/activity$/u.exec(
        new URL(request.url).pathname,
      );
      return service.receiveActivity(
        request,
        decodeURIComponent(match?.[1] ?? ""),
      );
    }
    const match = externalAgentMessagePath.exec(new URL(request.url).pathname);
    return service.receive(request, decodeURIComponent(match?.[1] ?? ""));
  },
};

async function enqueue(service: ExternalAgentChannelService, request: Request) {
  const input = z
    .object({
      workspaceId: workspaceIdSchema,
      agentId: agentIdSchema,
      command: externalAgentDeliveryCommandSchema,
      conversationId: conversationIdSchema,
      threadRootId: messageIdSchema.optional(),
    })
    .strict()
    .parse(await request.json());
  const accepted = await service.enqueue(
    input.workspaceId,
    input.agentId,
    input.command,
    input.conversationId,
    input.threadRootId,
  );
  return new Response(JSON.stringify({ accepted }), {
    status: accepted ? 202 : 409,
    headers: { "content-type": "application/json" },
  });
}
const externalAgentRecoveryPath =
  /\/agents\/([^/]+)\/channel\/deliveries\/([^/]+)\/recover$/u;
