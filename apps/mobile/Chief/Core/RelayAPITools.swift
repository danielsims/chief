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
    let channels = try await context.relay.listChannels(
      workspaceID: context.workspaceID,
      signingIdentity: context.identity
    ).map {
      [
        "id": $0.id,
        "name": $0.name,
        "kind": "channel",
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
      after: arguments.optionalInt("after"),
      signingIdentity: context.identity
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
    .init(name: "artifactIds", kind: .string, description: "JSON array of file IDs created in this conversation. Inserts Canvas cards for the artifacts.", required: false),
    .init(name: "conversationId", kind: .string, description: "The conversation id to post to."),
    .init(name: "body", kind: .string, description: "The message text to post."),
    .init(
      name: "threadRootId",
      kind: .string,
      description: "Reply within a thread by passing its root message id.",
      required: false
    ),
    .init(
      name: "idempotencyKey",
      kind: .string,
      description: "A stable key for durable workflow messages. Reusing it returns the existing matching message instead of posting a duplicate.",
      required: false
    ),
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let conversationID = try arguments.requiredString("conversationId")
    let body = try arguments.requiredString("body")
    let threadRootID = arguments.optionalString("threadRootId")
    let artifactIDs = try arguments.optionalString("artifactIds").map { try JSONDecoder().decode([String].self, from: Data($0.utf8)) } ?? []
    guard artifactIDs.count <= 12 else { throw ToolError.invalidArgument("At most 12 artifacts can be attached") }
    let files = artifactIDs.isEmpty ? [] : try await context.relay.listWorkspaceFiles(workspaceID: context.workspaceID, signingIdentity: context.identity)
    let components = try Array(Set(artifactIDs)).sorted().map { id -> MessageComponent in
      guard let file = files.first(where: { $0.id == id && $0.conversationId == conversationID }) else { throw ToolError.invalidArgument("Artifact not found in this channel") }
      return MessageComponent(id: "artifact-\(id)", kind: "artifact.reference", payload: ["fileId": id, "conversationId": conversationID, "title": file.title, "mimeType": file.mimeType, "version": String(file.version)])
    }
    if arguments.optionalString("idempotencyKey") != nil {
      let existing = try await context.relay.messages(
        workspaceID: context.workspaceID,
        conversationID: conversationID,
        after: nil,
        signingIdentity: context.identity
      ).first { message in
        message.body == body
          && message.threadRootID == threadRootID
          && message.author.agentID == context.agentID
          && message.components == components
      }
      if let existing {
        return toolResultJSON([
          "messageId": existing.id,
          "sequence": existing.sequence,
          "duplicate": true,
        ])
      }
    }
    let message = try await context.relay.sendAsAgent(
      body: body,
      workspaceID: context.workspaceID,
      conversationID: conversationID,
      threadRootID: threadRootID,
      mentions: [],
      components: components,
      signingIdentity: context.identity
    )
    return toolResultJSON([
      "messageId": message.id,
      "sequence": message.sequence,
      "duplicate": false,
    ])
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
      after: nil,
      signingIdentity: context.identity
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
      query: query,
      signingIdentity: context.identity
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

/// Lists the workspace's members (users + agents) so an agent can find who to
/// invite to a channel it creates.
struct RelayWorkspaceMembersTool: RelayTool {
  static let name = "relay_workspace_members"
  static let description =
    "List the workspace members and their roles. Use to find the workspace owner's id before inviting them to a channel."
  static let parameters: [RelayToolParameter] = []

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let members = try await context.relay.workspaceMembers(
      workspaceID: context.workspaceID,
      signingIdentity: context.identity
    )
    return toolResultJSON([
      "members": members.map {
        ["kind": $0.kind, "principalId": $0.principalId, "role": $0.role]
      }
    ])
  }
}

/// Creates a workspace channel (agent-owned). Idempotent: creating an existing
/// channel succeeds quietly so delegated kick-off work can be re-run safely.
struct RelayChannelCreateTool: RelayTool {
  static let name = "relay_channels_create"
  static let description =
    "Create a workspace channel and make the agent the owner. Use to open a new channel for your own work. Idempotent: creating an existing channel succeeds and returns it."
  static let parameters: [RelayToolParameter] = [
    .init(name: "conversationId", kind: .string, description: "The channel id/slug to create."),
    .init(name: "name", kind: .string, description: "The channel name."),
    .init(
      name: "isPrivate",
      kind: .boolean,
      description: "Whether the channel is private.",
      required: false
    ),
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let conversationID = try arguments.requiredString("conversationId")
    let name = try arguments.requiredString("name")
    let isPrivate = (arguments["isPrivate"] as? Bool) ?? false
    let existing = try await context.relay.listChannels(
      workspaceID: context.workspaceID,
      signingIdentity: context.identity
    )
    if let channel = existing.first(where: { $0.id == conversationID }) {
      return toolResultJSON([
        "channelId": channel.id,
        "name": channel.name,
        "created": false,
      ])
    }
    let channel = try await context.relay.createChannel(
      workspaceID: context.workspaceID,
      conversationID: conversationID,
      name: name,
      isPrivate: isPrivate,
      signingIdentity: context.identity
    )
    return toolResultJSON([
      "channelId": channel.id,
      "name": channel.name,
      "created": true,
    ])
  }
}

/// Adds a member to a channel. Used at kick-off so an agent can invite the
/// workspace owner to the channel it just created.
struct RelayChannelMembersAddTool: RelayTool {
  static let name = "relay_channels_members_add"
  static let description =
    "Add one or several workspace users or agents to a channel in one durable operation. Prefer principalIds when inviting several participants together."
  static let parameters: [RelayToolParameter] = [
    .init(name: "conversationId", kind: .string, description: "The channel to add the member to."),
    .init(name: "kind", kind: .string, description: "The member kind: 'user' or 'agent'."),
    .init(
      name: "principalId",
      kind: .string,
      description: "One member's workspace id. Omit when principalIds is supplied.",
      required: false
    ),
    .init(
      name: "principalIds",
      kind: .stringArray,
      description: "Several workspace ids to invite together in one operation.",
      required: false
    ),
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let conversationID = try arguments.requiredString("conversationId")
    let kind = try arguments.requiredString("kind")
    let ids = orderedUniqueStrings(
      (arguments["principalIds"] as? [String])
        ?? arguments.optionalString("principalId").map { [$0] }
        ?? []
    )
    guard !ids.isEmpty else { throw ToolError.missingArgument("principalId or principalIds") }
    try await context.relay.addChannelMembers(
      workspaceID: context.workspaceID,
      conversationID: conversationID,
      kind: kind,
      principalIDs: ids,
      signingIdentity: context.identity
    )
    return toolResultJSON([
      "added": true,
      "conversationId": conversationID,
      "principalIds": ids,
    ])
  }
}

private func orderedUniqueStrings(_ values: [String]) -> [String] {
  var seen = Set<String>()
  return values.filter { !$0.isEmpty && seen.insert($0).inserted }
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

struct RelayChannelJoinTool: RelayTool {
  static let name = "relay_channel_join"
  static let description = "Join a public workspace channel as yourself before posting there. Private channels require an invitation."
  static let parameters: [RelayToolParameter] = [
    .init(name: "conversationId", kind: .string, description: "The public channel id from relay_channels_list.")
  ]
  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    try await context.relay.joinChannel(workspaceID: context.workspaceID, conversationID: arguments.requiredString("conversationId"), signingIdentity: context.identity)
    return toolResultJSON(["ok": true])
  }
}
