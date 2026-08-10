import type { ChannelApiOperation } from "@chief/channel-api";
import {
  channelApiOperations,
  channelOpenApiSchemas,
  scheduledWorkApiOperations,
} from "@chief/channel-api";

export interface DocField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface DocOperation extends ChannelApiOperation {
  id: string;
  params: DocField[];
  bodyFields: DocField[];
  responses: { status: string; description: string }[];
  requestSample: string;
  responseSample: string;
}

export interface DocGroup {
  name: ChannelApiOperation["group"];
  description: string;
  operations: DocOperation[];
}

export interface DocModel {
  name: string;
  description: string;
  fields: DocField[];
  sample: string;
}

export interface ChannelDocsModel {
  groups: DocGroup[];
  models: DocModel[];
}

interface JsonSchema {
  $ref?: string;
  type?: string;
  enum?: readonly unknown[];
  format?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  items?: JsonSchema;
}

const schemas = channelOpenApiSchemas as unknown as Record<string, JsonSchema>;
const bodySchemas: Record<string, string> = {
  "channels.create": "ChannelCreateInput",
  "channels.update": "ChannelUpdateInput",
  "channels.archive": "ChannelVersionInput",
  "channels.unarchive": "ChannelVersionInput",
  "channels.join": "ChannelVersionInput",
  "channels.leave": "ChannelVersionInput",
  "channels.members.add": "ChannelMembersAddInput",
  "channels.members.remove": "ChannelVersionInput",
  "channels.messages.post": "ChannelMessageInput",
  "channels.messages.update": "ChannelMessageEditInput",
  "channels.messages.delete": "ChannelMessageDeleteInput",
  "channels.reactions.add": "ChannelReactionInput",
  "channels.deletion.request": "ChannelDeletionRequestInput",
  "scheduledWork.create": "ScheduledWorkCreateInput",
  "scheduledWork.update": "ScheduledWorkUpdateInput",
  "scheduledWork.run": "ScheduledWorkRunInput",
};

const groupDescriptions: Record<ChannelApiOperation["group"], string> = {
  Discover: "Find existing channels before creating another.",
  Lifecycle: "Create, update, archive and restore channels.",
  Members: "Manage human and agent membership.",
  Messages: "Read, post, search, edit and delete messages.",
  Reactions: "Add and remove Nostr reactions.",
  "Scheduled work": "Define proactive work with one explicit trigger.",
  Triggers: "Inspect and rotate local trigger credentials.",
  Runs: "Queue, inspect, cancel and retry executions.",
  Agents: "Inspect the workspace agent roster.",
  Files: "Read and write durable workspace files.",
  Governance: "Audit changes and request owner-only deletion.",
};

const fieldDescriptions: Record<string, string> = {
  expectedVersion: "The version returned by the most recent channel read.",
  name: "Human-readable channel name. The stable slug is generated once.",
  description: "What belongs in this channel.",
  topic: "The short status or focus shown with the channel.",
  visibility:
    "Public channels are discoverable; private channels are invite-only.",
  kind: "Feature channels carry repository, branch and review state.",
  operationKey: "Stable lowercase key reused for retries of the same creation.",
  members: "Existing workspace humans or agents.",
  workstream: "Repository, branch, pull requests and delivery status.",
  content: "A concise progress update, result or decision request.",
  threadRootId: "Optional message id when the update belongs in a thread.",
  idempotencyKey: "Stable key that prevents a retry from posting twice.",
  reason: "A concrete explanation shown to the workspace owner.",
  trigger: "Cron, once, channel event, reaction or local webhook.",
  proposedToolPatterns: "Exact tools this work may use after approval.",
  approvalSummary: "Plain-language description shown before approval.",
};

const examples: Record<string, unknown> = {
  expectedVersion: 3,
  name: "Feature sharing",
  description: "Build and review the new sharing flow.",
  topic: "Implementation in review",
  visibility: "private",
  kind: "feature",
  operationKey: "feature-sharing-work",
  agentIds: ["engineer", "researcher"],
  members: [
    { type: "agent", id: "engineer" },
    { type: "agent", id: "researcher" },
  ],
  status: "active",
  repository: "danielsims/pets",
  baseBranch: "main",
  branch: "feature/sharing",
  pullRequestUrls: ["https://github.com/danielsims/pets/pull/42"],
  content: "The sharing flow is ready for review in pull request 42.",
  threadRootId: "message_01k2f4",
  idempotencyKey: "feature-sharing-review-ready",
  reason:
    "The feature was cancelled and the owner confirmed that its private history can be permanently removed.",
};

function resolve(schema: JsonSchema): JsonSchema {
  if (!schema.$ref) return schema;
  return schemas[schema.$ref.split("/").pop() ?? ""] ?? schema;
}

function typeLabel(schema: JsonSchema): string {
  if (schema.$ref) return schema.$ref.split("/").pop() ?? "object";
  if (schema.enum)
    return schema.enum.map((item) => JSON.stringify(item)).join(" | ");
  if (schema.type === "array") return `${typeLabel(schema.items ?? {})}[]`;
  if (schema.type === "string" && schema.format === "uri") return "url";
  return schema.type ?? "object";
}

function fieldsOf(schemaName?: string): DocField[] {
  if (!schemaName) return [];
  const schema = resolve(schemas[schemaName] ?? {});
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, field]) => ({
    name,
    type: typeLabel(field),
    required: required.has(name),
    description: resolve(field).description ?? fieldDescriptions[name],
  }));
}

function exampleOf(schema: JsonSchema, name?: string, depth = 0): unknown {
  if (name && examples[name] !== undefined) return examples[name];
  const resolved = resolve(schema);
  if (depth > 5) return null;
  if (resolved.enum) return resolved.enum[0];
  if (resolved.type === "array") {
    return [exampleOf(resolved.items ?? {}, name, depth + 1)];
  }
  if (resolved.type === "object" || resolved.properties) {
    return Object.fromEntries(
      Object.entries(resolved.properties ?? {}).map(([key, field]) => [
        key,
        exampleOf(field, key, depth + 1),
      ]),
    );
  }
  if (resolved.type === "integer" || resolved.type === "number") return 1;
  if (resolved.type === "boolean") return true;
  return "string";
}

const channelExample = {
  id: "chn_01k2f4",
  slug: "feature-sharing",
  name: "Feature sharing",
  topic: "Implementation in review",
  description: "Build and review the new sharing flow.",
  visibility: "private",
  kind: "feature",
  lifecycle: "active",
  createdBy: { type: "agent", id: "engineer", name: "Engineer" },
  agentIds: ["engineer", "researcher"],
  agentPermissions: [
    "update_metadata",
    "manage_members",
    "manage_workstream",
    "archive",
  ],
  workstream: {
    status: "review",
    repository: "danielsims/pets",
    baseBranch: "main",
    branch: "feature/sharing",
    pullRequestUrls: ["https://github.com/danielsims/pets/pull/42"],
  },
  version: 3,
  createdAt: 1786219200000,
  updatedAt: 1786222800000,
};

function responseFor(operationId: string) {
  if (operationId.startsWith("scheduledWork.runs")) {
    return {
      run: {
        id: "run_01k2f7",
        triggerId: "channel-event:evt_01k2f5",
        status: "completed",
        attempt: 1,
      },
    };
  }
  if (operationId.startsWith("scheduledWork")) {
    return {
      scheduledWork: {
        id: "work_01k2f6",
        title: "Review new pull requests",
        status: "active",
        trigger: {
          type: "channel_message",
          channelId: "engineering",
          contains: "pull request",
        },
        version: 2,
      },
    };
  }
  if (operationId === "channels.list") return { channels: [channelExample] };
  if (operationId === "channels.members.list") {
    return {
      members: [
        { id: "workspace-owner", type: "user", role: "owner" },
        { id: "engineer", type: "agent", role: "member" },
      ],
    };
  }
  if (operationId.startsWith("channels.messages")) {
    return {
      event: {
        id: "evt_01k2f5",
        channelId: channelExample.id,
        kind: 9,
        content: examples.content,
        actor: { type: "agent", id: "engineer", name: "Engineer" },
        createdAt: 1786222800000,
      },
    };
  }
  if (operationId.startsWith("channels.reactions")) {
    return { reactions: [{ emoji: "👀", count: 1 }] };
  }
  if (operationId === "channels.activity.list") {
    return {
      activity: [
        {
          id: "aud_01k2f6",
          channelId: channelExample.id,
          action: "channel.updated",
          actor: { type: "agent", id: "engineer", name: "Engineer" },
          detail: { version: 3 },
          sequence: 4,
          previousHash: "9e3d…",
          hash: "e8ac…",
          createdAt: 1786222800000,
        },
      ],
    };
  }
  if (operationId === "channels.deletion.request") {
    return {
      actionItem: {
        id: `channel-delete-${channelExample.id}`,
        title: "Delete #Feature sharing?",
        status: "open",
      },
    };
  }
  return { channel: channelExample };
}

const cliCommands: Record<string, string> = {
  "channels.list": "channels list",
  "channels.get": "channels get <channel>",
  "channels.create": "channels create",
  "channels.update": "channels update <channel>",
  "channels.archive": "channels archive <channel>",
  "channels.unarchive": "channels restore <channel>",
  "channels.join": "channels join <channel>",
  "channels.leave": "channels leave <channel>",
  "channels.members.list": "channels members <channel>",
  "channels.members.add": "channels add-member <channel>",
  "channels.members.remove": "channels remove-member <channel> <member>",
  "channels.messages.list": "messages list <channel>",
  "channels.messages.get": "messages get <channel> <message>",
  "channels.messages.post": "messages send <channel>",
  "channels.messages.update": "messages edit <channel> <message>",
  "channels.messages.delete": "messages delete <channel> <message>",
  "channels.messages.replies": "messages thread <channel> <message>",
  "channels.messages.search": "messages search",
  "channels.reactions.list": "reactions list <channel> <message>",
  "channels.reactions.add": "reactions add <channel> <message>",
  "channels.reactions.remove": "reactions remove <channel> <message> <emoji>",
  "channels.activity.list": "channels activity <channel>",
  "channels.deletion.request": "channels request-delete <channel>",
  "scheduledWork.list": "scheduled list",
  "scheduledWork.get": "scheduled get <scheduled-work>",
  "scheduledWork.create": "scheduled create",
  "scheduledWork.update": "scheduled update <scheduled-work>",
  "scheduledWork.pause": "scheduled pause <scheduled-work>",
  "scheduledWork.resume": "scheduled resume <scheduled-work>",
  "scheduledWork.delete": "scheduled delete <scheduled-work>",
  "scheduledWork.run": "scheduled run <scheduled-work>",
  "scheduledWork.runs.list": "scheduled runs <scheduled-work>",
  "scheduledWork.runs.get": "scheduled run-get <scheduled-work> <run>",
  "scheduledWork.runs.cancel": "scheduled cancel <scheduled-work> <run>",
  "scheduledWork.runs.retry": "scheduled retry <scheduled-work> <run>",
  "scheduledWork.webhook.get": "scheduled webhook <scheduled-work>",
  "scheduledWork.webhook.rotate": "scheduled rotate-webhook <scheduled-work>",
};

function requestFor(operation: ChannelApiOperation, schemaName?: string) {
  const command = cliCommands[operation.operationId];
  if (!command) {
    return `curl http://127.0.0.1:4318${operation.path} \\
  -H "Idempotency-Key: provider-event-id" \\
  -H "Content-Type: application/json" \\
  -d '{ "event": "pull_request.opened" }'`;
  }
  const lines = [`chief-agent ${command}`];
  if (schemaName) {
    const body = JSON.stringify(exampleOf(schemas[schemaName] ?? {}), null, 2)
      .split("\n")
      .map((line, index) => (index === 0 ? line : `  ${line}`))
      .join("\n");
    lines[0] += " \\";
    lines.push(`  --json '${body}'`);
  }
  return lines.join("\n");
}

function operationModel(operation: ChannelApiOperation): DocOperation {
  const schemaName = bodySchemas[operation.operationId];
  const params = [...operation.path.matchAll(/\{([^}]+)\}/g)].map(
    ([, name]) => ({
      name: name ?? "id",
      type: "string",
      required: true,
      description:
        name === "channelId"
          ? "Stable channel id or slug."
          : `Stable ${name ?? "resource"}.`,
    }),
  );
  if (operation.operationId === "channels.list") {
    params.push(
      {
        name: "includeArchived",
        type: "boolean",
        required: false,
        description: "Include archived channels. Defaults to false.",
      },
      {
        name: "query",
        type: "string",
        required: false,
        description: "Search names, slugs and descriptions.",
      },
    );
  }
  return {
    ...operation,
    id: operation.operationId.replaceAll(".", "-"),
    params,
    bodyFields: fieldsOf(schemaName),
    responses: [
      { status: "200", description: "The operation completed." },
      { status: "400", description: "The request is invalid." },
      { status: "403", description: "Workspace or channel policy blocked it." },
      { status: "404", description: "The channel or member is not visible." },
      {
        status: "409",
        description: "The channel changed or is in the wrong state.",
      },
    ],
    requestSample: requestFor(operation, schemaName),
    responseSample: JSON.stringify(responseFor(operation.operationId), null, 2),
  };
}

export function buildChannelDocsModel(): ChannelDocsModel {
  const groupNames: ChannelApiOperation["group"][] = [
    "Discover",
    "Lifecycle",
    "Members",
    "Messages",
    "Reactions",
    "Scheduled work",
    "Triggers",
    "Runs",
    "Governance",
  ];
  const operations = [...channelApiOperations, ...scheduledWorkApiOperations];
  return {
    groups: groupNames.map((name) => ({
      name,
      description: groupDescriptions[name],
      operations: operations
        .filter((operation) => operation.group === name)
        .map(operationModel),
    })),
    models: [
      "Channel",
      "ChannelWorkstreamInput",
      "ChannelAuditEntry",
      "ScheduledWorkCreateInput",
      "ChannelErrorResponse",
    ].map((name) => ({
      name,
      description:
        name === "Channel"
          ? "The durable room, its policy and optional feature-work state."
          : name === "ChannelWorkstreamInput"
            ? "Repository and delivery state attached to a feature channel."
            : name === "ChannelAuditEntry"
              ? "One hash-chained lifecycle, membership, policy or message event."
              : name === "ScheduledWorkCreateInput"
                ? "A proactive task, one trigger and its requested tool grant."
                : "The consistent machine-readable failure envelope.",
      fields: fieldsOf(name),
      sample: JSON.stringify(
        name === "Channel" ? channelExample : exampleOf(schemas[name] ?? {}),
        null,
        2,
      ),
    })),
  };
}
