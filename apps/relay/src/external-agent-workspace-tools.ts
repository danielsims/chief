import { z } from "zod";

import type { ExternalAgentToolCall, JsonObject } from "@chief/relay-contracts";
import {
  channelCreateCommandSchema,
  channelJoinCommandSchema,
  channelMemberAddCommandSchema,
  missionCreateSchema,
  missionExperimentInputSchema,
  missionStatusUpdateSchema,
  parseJsonObject,
  workspaceFileSaveSchema,
  workspaceFileSchema,
  workspaceScheduleInputSchema,
} from "@chief/relay-contracts";

import type {
  ExternalAgentInboundHost,
  resolveExternalContinuation,
} from "./external-agent-continuation";
import { deterministicUuid } from "./external-agent-channel-security";
import {
  memberReferences,
  optionalString,
  requiredString,
} from "./hosted-agent-tools/input";
import { HttpError } from "./http";
import { withTrustedContext } from "./internal-context";
import { WorkspaceChannelMembership } from "./workspace-channel-membership";
import { WorkspaceChannelService } from "./workspace-channel-service";
import { routeWorkspaceData } from "./workspace-data-store";
import { routeWorkspaceMissions } from "./workspace-missions";
import { routeScheduleRuns } from "./workspace-schedule-run-service";
import { routeWorkspaceSchedule } from "./workspace-schedule-service";

type Continuation = Awaited<ReturnType<typeof resolveExternalContinuation>>;

export async function routeExternalWorkspaceTool(
  host: ExternalAgentInboundHost,
  resolved: Continuation,
  call: ExternalAgentToolCall,
): Promise<JsonObject | undefined> {
  const { input, operationId } = call;
  switch (operationId) {
    case "channels.join": {
      host.channels.requirePrincipalMember(resolved.principal);
      host.channels.requireAgentCapability(resolved.principal, "channels.read");
      const conversationId = requiredString(input, "channelId");
      const command = channelJoinCommandSchema.parse({
        commandId: await deterministicUuid(
          `${call.deliveryId}:join:${conversationId}`,
        ),
        protocolVersion: 1,
        occurredAt: new Date().toISOString(),
        payload: { conversationId },
      });
      return readResult(
        await new WorkspaceChannelService(host.channels).channelsJoin(
          requestFor(resolved, command),
          {
            ...resolved.context,
            principal: resolved.principal,
            conversationId,
          },
        ),
      );
    }
    case "channels.create":
      return createChannel(host, resolved, input);
    case "channels.members.add":
      return addMembers(host, resolved, call);
    case "files.list":
      return fileOperation(host, resolved, "data-files-list");
    case "files.read":
      return {
        file: await fileOperation(
          host,
          resolved,
          "data-file-get",
          undefined,
          requiredString(input, "fileId"),
        ),
      };
    case "files.write": {
      const existingId = optionalString(input, "id");
      const existing = existingId
        ? workspaceFileSchema.parse(
            await fileOperation(
              host,
              resolved,
              "data-file-get",
              undefined,
              existingId,
            ),
          )
        : undefined;
      const id =
        existingId ??
        (await deterministicUuid(
          `${resolved.context.workspaceId}:${resolved.agentId}:${call.deliveryId}:file:${requiredString(input, "name")}`,
        ));
      const file = await fileOperation(
        host,
        resolved,
        "data-file-save",
        workspaceFileSaveSchema.parse({
          id,
          path:
            optionalString(input, "path") ??
            existing?.path ??
            `artifacts/${id}.${input.format === "html" ? "html" : input.format === "csv" ? "csv" : input.format === "json" ? "json" : "md"}`,
          title: requiredString(input, "name"),
          mimeType:
            input.kind === "email"
              ? "message/rfc822"
              : input.format === "html"
                ? "text/html"
                : input.format === "csv"
                  ? "text/csv"
                  : input.format === "json"
                    ? "application/json"
                    : "text/markdown",
          content: requiredString(input, "content"),
          conversationId:
            optionalString(input, "conversationId") ??
            existing?.conversationId ??
            resolved.continuation.conversation_id,
          expectedVersion: input.expectedVersionId
            ? Number(requiredString(input, "expectedVersionId"))
            : undefined,
        }),
      );
      return { file };
    }
    case "missions.reportRunStep":
      return readResult(
        await routeScheduleRuns(
          host.storage,
          host.env,
          requestFor(resolved, input),
          "schedules-runs-report",
        ),
      );
    case "missions.list":
      return readResult(
        await routeWorkspaceMissions(
          host.storage,
          host.env,
          requestFor(resolved),
          "missions-list",
        ),
      );
    case "missions.create":
      return readResult(
        await routeWorkspaceMissions(
          host.storage,
          host.env,
          requestFor(resolved, missionCreateSchema.parse(input)),
          "missions-create",
        ),
      );
    case "missions.recordExperiment":
    case "missions.updateStatus": {
      const { missionId: _missionId, ...body } = input;
      const experiment = operationId === "missions.recordExperiment";
      const payload = experiment
        ? missionExperimentInputSchema.parse(body)
        : missionStatusUpdateSchema.parse(body);
      return readResult(
        await routeWorkspaceMissions(
          host.storage,
          host.env,
          requestFor(resolved, payload, {
            "x-chief-mission-id": requiredString(input, "missionId"),
          }),
          experiment ? "missions-experiment" : "missions-status",
        ),
      );
    }
    case "recurringWork.list":
      return readResult(
        await routeWorkspaceSchedule(
          host.storage,
          host.env,
          requestFor(resolved),
          "schedules-list",
        ),
      );
    case "recurringWork.propose": {
      const schedule = workspaceScheduleInputSchema.strict().parse({
        ...input,
        id:
          optionalString(input, "id") ??
          (await deterministicUuid(
            `${resolved.context.workspaceId}:${resolved.agentId}:${call.deliveryId}:schedule:${requiredString(input, "title")}`,
          )),
        conversationId:
          optionalString(input, "conversationId") ??
          resolved.continuation.conversation_id,
      });
      return readResult(
        await routeWorkspaceSchedule(
          host.storage,
          host.env,
          requestFor(resolved, schedule),
          "schedules-save",
        ),
      );
    }
    default:
      return undefined;
  }
}

function requestFor(
  resolved: Continuation,
  body?: JsonObject,
  extraHeaders?: Record<string, string>,
) {
  return withTrustedContext(
    new Request("https://workspace.internal", {
      method: "POST",
      headers: { "content-type": "application/json", ...extraHeaders },
      ...(body ? { body: JSON.stringify(body) } : undefined),
    }),
    {
      principal: resolved.principal,
      workspaceId: resolved.context.workspaceId,
      requestId: resolved.context.requestId,
      conversationId: resolved.continuation.conversation_id,
    },
  );
}

async function fileOperation(
  host: ExternalAgentInboundHost,
  resolved: Continuation,
  operation: "data-files-list" | "data-file-get" | "data-file-save",
  body?: JsonObject,
  fileId?: string,
) {
  host.channels.requirePrincipalMember(resolved.principal);
  host.channels.requireAgentCapability(
    resolved.principal,
    operation === "data-file-save" ? "messages.send" : "workspace.read",
  );
  const response = await routeWorkspaceData(
    host.storage,
    requestFor(
      resolved,
      body,
      fileId ? { "x-chief-workspace-file-id": fileId } : undefined,
    ),
    operation,
    resolved.principal,
    resolved.context.workspaceId,
    host.channels,
  );
  if (!response) throw new Error("Workspace files are unavailable.");
  return readResult(response);
}

async function createChannel(
  host: ExternalAgentInboundHost,
  resolved: Continuation,
  input: JsonObject,
) {
  host.channels.requirePrincipalMember(resolved.principal);
  host.channels.requireAgentCapability(resolved.principal, "channels.create");
  const operationKey = requiredString(input, "operationKey");
  const commandId = await deterministicUuid(
    `${resolved.context.workspaceId}:${resolved.agentId}:channel:${operationKey}`,
  );
  const conversationId = `channel-${commandId}`;
  const existing = host.storage.sql
    .exec(
      "SELECT conversation_id FROM channels WHERE conversation_id = ?",
      conversationId,
    )
    .toArray()[0];
  if (existing)
    host.channels.requireChannelVisible(conversationId, resolved.principal);
  const command = channelCreateCommandSchema.parse({
    commandId,
    protocolVersion: 1,
    occurredAt: new Date().toISOString(),
    payload: {
      conversationId,
      name: requiredString(input, "name"),
      isPrivate:
        z
          .enum(["public", "private"])
          .default("public")
          .parse(input.visibility) === "private",
    },
  });
  return readResult(
    await new WorkspaceChannelService(host.channels).channelsCreate(
      requestFor(resolved, command),
      { ...resolved.context, principal: resolved.principal, conversationId },
    ),
  );
}

async function addMembers(
  host: ExternalAgentInboundHost,
  resolved: Continuation,
  call: ExternalAgentToolCall,
) {
  host.channels.requirePrincipalMember(resolved.principal);
  host.channels.requireAgentCapability(resolved.principal, "members.manage");
  const conversationId =
    optionalString(call.input, "channelId") ??
    resolved.continuation.conversation_id;
  host.channels.requireChannelVisible(conversationId, resolved.principal);
  const members = memberReferences(call.input);
  const key =
    optionalString(call.input, "idempotencyKey") ??
    `${call.deliveryId}:${JSON.stringify(members)}`;
  const command = channelMemberAddCommandSchema.parse({
    commandId: await deterministicUuid(
      `${resolved.context.workspaceId}:${resolved.agentId}:members:${conversationId}:${key}`,
    ),
    protocolVersion: 1,
    occurredAt: new Date().toISOString(),
    payload: { conversationId, members },
  });
  return readResult(
    await new WorkspaceChannelMembership(host.channels).channelsMembersAdd(
      requestFor(resolved, command),
      { ...resolved.context, principal: resolved.principal, conversationId },
    ),
  );
}

async function readResult(response: Response): Promise<JsonObject> {
  if (!response.ok)
    throw new HttpError(
      response.status,
      "external_workspace_tool_failed",
      await response.text(),
    );
  const parsed = parseJsonObject(await response.json());
  if (!parsed) throw new Error("The workspace tool returned invalid JSON.");
  return parsed;
}
