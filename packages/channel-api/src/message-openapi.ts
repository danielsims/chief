type RequestBody = (schema: string) => Record<string, unknown>;

const channelParameter = {
  name: "channelId",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const messageParameter = {
  name: "messageId",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const paging = [
  { name: "cursor", in: "query", schema: { type: "string" } },
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
  },
];

const responses = (description: string) => ({
  "200": { description },
  "400": { description: "Invalid input" },
  "403": { description: "Channel membership is required" },
  "404": { description: "Message or channel not found" },
  "409": { description: "Version conflict" },
});

export function messageOpenApiPaths(body: RequestBody) {
  return {
    "/local-tools/channels/{channelId}/messages": {
      get: {
        operationId: "channels.messages.list",
        summary: "List channel roots with recent thread replies",
        parameters: [channelParameter, ...paging],
        responses: responses(
          "Cursor-paginated root messages with reply counts and recent reply previews",
        ),
      },
      post: {
        operationId: "channels.messages.post",
        summary: "Publish a message or thread reply",
        description:
          "Publishes deliberate user-facing content into a shared channel. Ordinary agent working output is private and does not appear in the channel.",
        parameters: [channelParameter],
        requestBody: body("ChannelMessageInput"),
        responses: responses("Created kind:9 channel event"),
      },
    },
    "/local-tools/channels/{channelId}/messages/{messageId}": {
      get: {
        operationId: "channels.messages.get",
        summary: "Get a message with its immediate thread context",
        parameters: [channelParameter, messageParameter],
        responses: responses(
          "Message with edits, reactions, reply count, and recent thread context",
        ),
      },
      patch: {
        operationId: "channels.messages.update",
        summary: "Edit the caller's message",
        parameters: [channelParameter, messageParameter],
        requestBody: body("ChannelMessageEditInput"),
        responses: responses("Updated message projection"),
      },
      delete: {
        operationId: "channels.messages.delete",
        summary: "Tombstone the caller's message",
        parameters: [channelParameter, messageParameter],
        requestBody: body("ChannelMessageDeleteInput"),
        responses: responses("Deleted message projection"),
      },
    },
    "/local-tools/channels/{channelId}/messages/{messageId}/replies": {
      get: {
        operationId: "channels.messages.replies",
        summary: "Read a complete thread before acting on its root",
        parameters: [channelParameter, messageParameter, ...paging],
        responses: responses("Root message and ordered replies"),
      },
    },
    "/local-tools/channels/{channelId}/messages/{messageId}/reactions": {
      get: {
        operationId: "channels.reactions.list",
        summary: "List reactions",
        parameters: [channelParameter, messageParameter],
        responses: responses("Grouped reactions"),
      },
      post: {
        operationId: "channels.reactions.add",
        summary: "Add an idempotent reaction",
        parameters: [channelParameter, messageParameter],
        requestBody: body("ChannelReactionInput"),
        responses: responses("Created kind:7 reaction event"),
      },
    },
    "/local-tools/channels/{channelId}/messages/{messageId}/reactions/{emoji}":
      {
        delete: {
          operationId: "channels.reactions.remove",
          summary: "Remove the caller's reaction",
          parameters: [
            channelParameter,
            messageParameter,
            {
              name: "emoji",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: responses("Created kind:5 reaction tombstone"),
        },
      },
    "/local-tools/messages/search": {
      get: {
        operationId: "channels.messages.search",
        summary: "Search visible roots and thread replies",
        parameters: [
          {
            name: "query",
            in: "query",
            required: true,
            schema: { type: "string", minLength: 2 },
          },
          { name: "channelId", in: "query", schema: { type: "string" } },
          { name: "authorId", in: "query", schema: { type: "string" } },
          { name: "after", in: "query", schema: { type: "integer" } },
          { name: "before", in: "query", schema: { type: "integer" } },
          ...paging,
        ],
        responses: responses(
          "Matching roots and replies with their immediate thread context",
        ),
      },
    },
  };
}

export const messageOpenApiSchemas = {
  ChannelMessageInput: {
    type: "object",
    additionalProperties: false,
    required: ["content"],
    properties: {
      content: { type: "string", minLength: 1, maxLength: 8000 },
      threadRootId: {
        type: "string",
        maxLength: 160,
        description:
          "Reply inside this thread. Read the current thread before following up on an existing root.",
      },
      mentions: {
        type: "array",
        maxItems: 20,
        items: { type: "string", maxLength: 120 },
      },
      idempotencyKey: { type: "string", maxLength: 120 },
    },
  },
  ChannelMessageEditInput: {
    type: "object",
    additionalProperties: false,
    required: ["content"],
    properties: {
      content: { type: "string", minLength: 1, maxLength: 8000 },
      expectedVersion: { type: "integer", minimum: 1 },
      idempotencyKey: { type: "string", maxLength: 120 },
    },
  },
  ChannelMessageDeleteInput: {
    type: "object",
    additionalProperties: false,
    properties: { reason: { type: "string", maxLength: 240 } },
  },
  ChannelReactionInput: {
    type: "object",
    additionalProperties: false,
    required: ["emoji"],
    properties: { emoji: { type: "string", minLength: 1, maxLength: 80 } },
  },
} as const;
