import Foundation

// Package-level relay API tools for the on-device agent. Each tool runs
// natively in Swift through `RelayServing` and signs requests with the agent's
// own identity so the workspace attributes the action to the agent. They mirror
// the PRD toolset: channels, messages, thread replies, reactions, search.

/// Lists the workspace conversations the agent can address.
struct RelayChannelsListTool: RelayTool {
  static let name = "relay_channels_list"
  static let description =
    "List the workspace conversations the agent can participate in, including channels and direct messages, with their kind and whether they are private. Use to find a conversation id before reading or posting."
  static let parameters: [RelayToolParameter] = []

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let channels = context.channels.map {
      [
        "id": $0.id,
        "name": $0.name,
        "kind": $0.kind.rawValue,
        "isPrivate": $0.isPrivate,
      ]
    }
    return toolResultJSON(["channels": channels])
  }
}

/// Reads recent messages from a conversation.
struct RelayMessagesListTool: RelayTool {
  static let name = "relay_messages_list"
  static let description =
    "List recent messages in a workspace conversation. Provide the conversationId and optionally an after sequence to page through older messages."
  static let parameters: [RelayToolParameter] = [
    .init(name: "conversationId", kind: .string, description: "The conversation id to read."),
    .init(
      name: "after",
      kind: .integer,
      description: "Only return messages with a sequence greater than this value.",
      required: false
    ),
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let conversationID = try arguments.requiredString("conversationId")
    let messages = try await context.relay.messages(
      workspaceID: context.workspaceID,
      conversationID: conversationID,
      after: arguments.optionalInt("after")
    )
    return toolResultJSON([
      "messages": messages.map {
        [
          "id": $0.id,
          "author": $0.author.displayName,
          "body": $0.body,
          "sequence": $0.sequence,
        ]
      }
    ])
  }
}

/// Posts a message to a conversation as the agent.
struct RelayMessagePostTool: RelayTool {
  static let name = "relay_message_post"
  static let description =
    "Post a message to a workspace conversation as the agent. Use to report progress, ask the user a question, or share a result in a channel or direct message."
  static let parameters: [RelayToolParameter] = [
    .init(name: "conversationId", kind: .string, description: "The conversation id to post to."),
    .init(name: "body", kind: .string, description: "The message text to post."),
    .init(
      name: "threadRootId",
      kind: .string,
      description: "Reply within a thread by passing its root message id.",
      required: false
    ),
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let conversationID = try arguments.requiredString("conversationId")
    let body = try arguments.requiredString("body")
    let message = try await context.relay.sendAsAgent(
      body: body,
      workspaceID: context.workspaceID,
      conversationID: conversationID,
      threadRootID: arguments.optionalString("threadRootId"),
      mentions: [],
      signingIdentity: context.identity
    )
    return toolResultJSON(["messageId": message.id, "sequence": message.sequence])
  }
}

/// Reads the replies in a thread.
struct RelayThreadRepliesTool: RelayTool {
  static let name = "relay_thread_replies"
  static let description =
    "List the replies in a thread given its root message id."
  static let parameters: [RelayToolParameter] = [
    .init(name: "conversationId", kind: .string, description: "The conversation id that holds the thread."),
    .init(name: "rootMessageId", kind: .string, description: "The root message id of the thread."),
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let conversationID = try arguments.requiredString("conversationId")
    let rootMessageID = try arguments.requiredString("rootMessageId")
    let messages = try await context.relay.replies(
      workspaceID: context.workspaceID,
      conversationID: conversationID,
      rootMessageID: rootMessageID,
      after: nil
    )
    return toolResultJSON([
      "messages": messages.map {
        ["id": $0.id, "author": $0.author.displayName, "body": $0.body]
      }
    ])
  }
}

/// Searches message bodies in a conversation.
struct RelayMessageSearchTool: RelayTool {
  static let name = "relay_message_search"
  static let description =
    "Search message bodies in a conversation for a query string. Use to find prior discussion or decisions before answering."
  static let parameters: [RelayToolParameter] = [
    .init(name: "conversationId", kind: .string, description: "The conversation id to search."),
    .init(name: "query", kind: .string, description: "Search text to match in message bodies."),
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let conversationID = try arguments.requiredString("conversationId")
    let query = try arguments.requiredString("query")
    let messages = try await context.relay.searchMessages(
      workspaceID: context.workspaceID,
      conversationID: conversationID,
      query: query
    )
    return toolResultJSON([
      "messages": messages.map {
        ["id": $0.id, "author": $0.author.displayName, "body": $0.body]
      }
    ])
  }
}

/// Adds a reaction emoji to a message.
struct RelayReactionAddTool: RelayTool {
  static let name = "relay_reaction_add"
  static let description = "Add a reaction emoji to a message."
  static let parameters: [RelayToolParameter] = [
    .init(name: "conversationId", kind: .string, description: "The conversation id that holds the message."),
    .init(name: "messageId", kind: .string, description: "The message id to react to."),
    .init(name: "emoji", kind: .string, description: "A single emoji to add."),
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    try await performReaction(arguments: arguments, context: context, add: true)
  }
}

/// Removes a reaction emoji from a message.
struct RelayReactionRemoveTool: RelayTool {
  static let name = "relay_reaction_remove"
  static let description = "Remove a reaction emoji from a message."
  static let parameters: [RelayToolParameter] = [
    .init(name: "conversationId", kind: .string, description: "The conversation id that holds the message."),
    .init(name: "messageId", kind: .string, description: "The message id to unreact."),
    .init(name: "emoji", kind: .string, description: "A single emoji to remove."),
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    try await performReaction(arguments: arguments, context: context, add: false)
  }
}

private func performReaction(
  arguments: [String: Any],
  context: ToolContext,
  add: Bool
) async throws -> String {
  let conversationID = try arguments.requiredString("conversationId")
  let messageID = try arguments.requiredString("messageId")
  let emoji = try arguments.requiredString("emoji")
  let message = try await context.relay.react(
    workspaceID: context.workspaceID,
    conversationID: conversationID,
    messageID: messageID,
    emoji: emoji,
    add: add,
    signingIdentity: context.identity
  )
  return toolResultJSON(["messageId": message.id])
}
