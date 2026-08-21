import Foundation
import os
import Security

let relayLog = Logger(subsystem: "sh.heychief.mobile", category: "relay")

protocol RelayServing: Sendable {
  func bindDeviceIdentity(accountToken: String) async throws
  func loadWorkspace() async throws -> WorkspaceSnapshot
  func createWorkspace(from draft: OnboardingDraft) async throws -> WorkspaceSnapshot
  func messages(
    workspaceID: String,
    conversationID: String,
    after sequence: Int?,
    signingIdentity: NostrIdentity?
  ) async throws -> [ConversationMessage]
  func send(
    body: String,
    workspaceID: String,
    conversationID: String,
    threadRootID: String?,
    mentions: [String],
    components: [MessageComponent]
  ) async throws -> ConversationMessage
  func claimAgentJob(workspaceID: String, agentID: String) async throws -> AgentJobLease?
  func agentJobs(workspaceID: String, agentID: String) async throws -> [AgentJobRecord]
  func retryAgentJob(
    workspaceID: String,
    agentID: String,
    jobID: String
  ) async throws -> AgentJobRecord
  func completeAgentJob(
    workspaceID: String,
    agentID: String,
    leaseToken: String,
    completion: AgentJobCompletion
  ) async throws
  func failAgentJob(
    workspaceID: String,
    agentID: String,
    leaseToken: String,
    error: String,
    retryAt: Date?
  ) async throws
  func recordLogs(workspaceID: String, _ entries: [RelayLogEntry]) async throws
  func registerAgentKey(
    workspaceID: String,
    agentID: String,
    pubkey: String
  ) async throws
  func sendAsAgent(
    body: String,
    workspaceID: String,
    conversationID: String,
    threadRootID: String?,
    mentions: [String],
    components: [MessageComponent],
    signingIdentity: NostrIdentity
  ) async throws -> ConversationMessage
  func uploadAttachment(
    workspaceID: String,
    conversationID: String,
    fileName: String,
    data: Data
  ) async throws -> String
  func listChannels(
    workspaceID: String,
    signingIdentity: NostrIdentity?
  ) async throws -> [ChannelRecord]
  func createChannel(
    workspaceID: String,
    conversationID: String,
    name: String,
    isPrivate: Bool,
    signingIdentity: NostrIdentity?
  ) async throws -> ChannelRecord
  func archiveChannel(workspaceID: String, conversationID: String, archived: Bool) async throws
  func joinChannel(workspaceID: String, conversationID: String) async throws
  func leaveChannel(workspaceID: String, conversationID: String) async throws
  func channelMembers(workspaceID: String, conversationID: String) async throws -> [ChannelMember]
  func addChannelMember(
    workspaceID: String,
    conversationID: String,
    kind: String,
    principalID: String,
    signingIdentity: NostrIdentity?
  ) async throws
  func addChannelMembers(
    workspaceID: String,
    conversationID: String,
    kind: String,
    principalIDs: [String],
    signingIdentity: NostrIdentity?
  ) async throws
  func removeChannelMember(
    workspaceID: String,
    conversationID: String,
    kind: String,
    principalID: String
  ) async throws
  func allChannelMemberships(workspaceID: String) async throws -> [ChannelMembership]
  func currentChannelMemberships(workspaceID: String) async throws -> [ChannelMembership]
  func editMessage(
    workspaceID: String,
    conversationID: String,
    messageID: String,
    body: String
  ) async throws -> ConversationMessage
  func deleteMessage(
    workspaceID: String,
    conversationID: String,
    messageID: String
  ) async throws -> ConversationMessage
  func workspaceMembers(
    workspaceID: String,
    signingIdentity: NostrIdentity?
  ) async throws -> [WorkspaceMember]
  func startDirectMessage(
    workspaceID: String,
    participantKind: String,
    participantID: String
  ) async throws -> ConversationSummary
  func loadAgentConfig(workspaceID: String, agentID: String) async throws -> AgentConfig?
  func saveAgentConfig(workspaceID: String, agentID: String, config: AgentConfig) async throws
  func replies(
    workspaceID: String,
    conversationID: String,
    rootMessageID: String,
    after sequence: Int?,
    signingIdentity: NostrIdentity?
  ) async throws -> [ConversationMessage]
  func searchMessages(
    workspaceID: String,
    conversationID: String,
    query: String,
    signingIdentity: NostrIdentity?
  ) async throws -> [ConversationMessage]
  func react(
    workspaceID: String,
    conversationID: String,
    messageID: String,
    emoji: String,
    add: Bool,
    signingIdentity: NostrIdentity
  ) async throws -> ConversationMessage
  func listWorkspaces() async throws -> [WorkspaceSummary]
  func switchWorkspace(id: String) async throws
  func createWorkspaceInvite(
    workspaceID: String,
    conversationID: String?
  ) async throws -> WorkspaceInviteLink
  func previewWorkspaceInvite(_ link: WorkspaceInviteLink) async throws -> WorkspaceInvite
  func claimWorkspaceInvite(_ link: WorkspaceInviteLink) async throws -> WorkspaceInviteClaim
  func loadBrandProfile(
    workspaceID: String,
    signingIdentity: NostrIdentity?
  ) async throws -> BrandProfileRecord?
  func saveBrandProfile(
    workspaceID: String,
    markdown: String,
    sourceURLs: [String],
    conversationID: String,
    signingIdentity: NostrIdentity
  ) async throws -> WorkspaceFileRecord
  func saveProspect(
    workspaceID: String,
    prospect: ProspectSaveInput,
    signingIdentity: NostrIdentity
  ) async throws -> ProspectRecord
  func listProspects(
    workspaceID: String,
    signingIdentity: NostrIdentity?
  ) async throws -> [ProspectRecord]
  func listWorkspaceFiles(
    workspaceID: String,
    signingIdentity: NostrIdentity?
  ) async throws -> [WorkspaceFileRecord]
}

extension RelayServing {
  func createWorkspaceInvite(
    workspaceID _: String,
    conversationID _: String?
  ) async throws -> WorkspaceInviteLink {
    throw RelayError.unavailable
  }

  func previewWorkspaceInvite(_ link: WorkspaceInviteLink) async throws -> WorkspaceInvite {
    _ = link
    throw RelayError.unavailable
  }

  func claimWorkspaceInvite(_ link: WorkspaceInviteLink) async throws -> WorkspaceInviteClaim {
    _ = link
    throw RelayError.unavailable
  }

  func addChannelMembers(
    workspaceID: String,
    conversationID: String,
    kind: String,
    principalIDs: [String],
    signingIdentity: NostrIdentity?
  ) async throws {
    for principalID in principalIDs {
      try await addChannelMember(
        workspaceID: workspaceID,
        conversationID: conversationID,
        kind: kind,
        principalID: principalID,
        signingIdentity: signingIdentity
      )
    }
  }

  func loadBrandProfile(
    workspaceID: String,
    signingIdentity: NostrIdentity?
  ) async throws -> BrandProfileRecord? { nil }

  func saveBrandProfile(
    workspaceID: String,
    markdown: String,
    sourceURLs: [String],
    conversationID: String,
    signingIdentity: NostrIdentity
  ) async throws -> WorkspaceFileRecord {
    throw RelayError.unavailable
  }

  func saveProspect(
    workspaceID: String,
    prospect: ProspectSaveInput,
    signingIdentity: NostrIdentity
  ) async throws -> ProspectRecord {
    throw RelayError.unavailable
  }

  func listProspects(
    workspaceID: String,
    signingIdentity: NostrIdentity?
  ) async throws -> [ProspectRecord] { [] }

  func listWorkspaceFiles(
    workspaceID: String,
    signingIdentity: NostrIdentity?
  ) async throws -> [WorkspaceFileRecord] { [] }

  func messages(
    workspaceID: String,
    conversationID: String,
    after sequence: Int?
  ) async throws -> [ConversationMessage] {
    try await messages(
      workspaceID: workspaceID,
      conversationID: conversationID,
      after: sequence,
      signingIdentity: nil
    )
  }

  func listChannels(workspaceID: String) async throws -> [ChannelRecord] {
    try await listChannels(workspaceID: workspaceID, signingIdentity: nil)
  }

  func createChannel(
    workspaceID: String,
    conversationID: String,
    name: String,
    isPrivate: Bool
  ) async throws -> ChannelRecord {
    try await createChannel(
      workspaceID: workspaceID,
      conversationID: conversationID,
      name: name,
      isPrivate: isPrivate,
      signingIdentity: nil
    )
  }

  func addChannelMember(
    workspaceID: String,
    conversationID: String,
    kind: String,
    principalID: String
  ) async throws {
    try await addChannelMember(
      workspaceID: workspaceID,
      conversationID: conversationID,
      kind: kind,
      principalID: principalID,
      signingIdentity: nil
    )
  }

  func workspaceMembers(workspaceID: String) async throws -> [WorkspaceMember] {
    try await workspaceMembers(workspaceID: workspaceID, signingIdentity: nil)
  }

  func replies(
    workspaceID: String,
    conversationID: String,
    rootMessageID: String,
    after sequence: Int?
  ) async throws -> [ConversationMessage] {
    try await replies(
      workspaceID: workspaceID,
      conversationID: conversationID,
      rootMessageID: rootMessageID,
      after: sequence,
      signingIdentity: nil
    )
  }

  func searchMessages(
    workspaceID: String,
    conversationID: String,
    query: String
  ) async throws -> [ConversationMessage] {
    try await searchMessages(
      workspaceID: workspaceID,
      conversationID: conversationID,
      query: query,
      signingIdentity: nil
    )
  }

  /// Convenience overloads for sends without attachments/components.
  func send(
    body: String,
    workspaceID: String,
    conversationID: String,
    threadRootID: String?,
    mentions: [String]
  ) async throws -> ConversationMessage {
    try await send(
      body: body,
      workspaceID: workspaceID,
      conversationID: conversationID,
      threadRootID: threadRootID,
      mentions: mentions,
      components: []
    )
  }

  func sendAsAgent(
    body: String,
    workspaceID: String,
    conversationID: String,
    threadRootID: String?,
    mentions: [String],
    signingIdentity: NostrIdentity
  ) async throws -> ConversationMessage {
    try await sendAsAgent(
      body: body,
      workspaceID: workspaceID,
      conversationID: conversationID,
      threadRootID: threadRootID,
      mentions: mentions,
      components: [],
      signingIdentity: signingIdentity
    )
  }
}

struct AgentJobCompletion: Sendable, Equatable {
  var openingMessage: String?
  var publishedMessage: AgentPublishedMessage?
}

struct AgentPublishedMessage: Sendable, Equatable, Codable {
  var conversationId: String
  var body: String
  var components: [MessageComponent] = []
}

struct RelayLogEntry: Sendable, Equatable, Codable {
  var id: String
  var correlationId: String
  var type: String
  var operation: String
  var agentId: String?
  var conversationId: String?
  var message: String
  var createdAt: String

  static func make(
    type: String = "info",
    operation: String,
    agentId: String? = nil,
    message: String
  ) -> RelayLogEntry {
    RelayLogEntry(
      id: UUID().uuidString,
      correlationId: UUID().uuidString,
      type: type,
      operation: operation,
      agentId: agentId,
      conversationId: nil,
      message: message,
      createdAt: ISO8601DateFormatter.chief().string(from: .now)
    )
  }
}

/// Best-effort, never-fatal log sink to the relay's retained workspace log.
struct RelayLogSink {
  private let relay: any RelayServing
  private let workspaceID: String

  init(relay: any RelayServing, workspaceID: String) {
    self.relay = relay
    self.workspaceID = workspaceID
  }

  func record(_ entries: [RelayLogEntry]) {
    Task { try? await relay.recordLogs(workspaceID: workspaceID, entries) }
  }

  func record(_ entry: RelayLogEntry) {
    record([entry])
  }
}

actor URLSessionRelayClient: RelayServing {
  private let configuration: AppConfiguration
  private let session: URLSession
  private let decoder: JSONDecoder

  init(configuration: AppConfiguration, session: URLSession? = nil) {
    self.configuration = configuration
    let configured = session ?? Self.makeSession()
    self.session = configured
    self.decoder = JSONDecoder()
  }

  private static func makeSession() -> URLSession {
    let config = URLSessionConfiguration.default
    config.timeoutIntervalForRequest = 20
    config.timeoutIntervalForResource = 30
    return URLSession(configuration: config)
  }

  func bindDeviceIdentity(accountToken: String) async throws {
    struct Payload: Encodable { let accountToken: String }
    struct Result: Decodable {
      let userId: String
      let pubkey: String
      let deviceAuthorization: String
      let expiresAt: String
    }
    let result: Result = try await request(
      path: "/v1/identity/device",
      method: "POST",
      body: try JSONEncoder().encode(Payload(accountToken: accountToken))
    )
    guard result.deviceAuthorization.count >= 32 else {
      throw RelayError.unauthorized
    }
    await DeviceAuthorizationVault.shared.store(result.deviceAuthorization)
  }

  func loadWorkspace() async throws -> WorkspaceSnapshot {
    try await request(path: "/v1/me/workspace", method: "GET")
  }

  func listWorkspaces() async throws -> [WorkspaceSummary] {
    let page: WorkspaceListResult = try await request(
      path: "/v1/workspaces",
      method: "GET"
    )
    return page.workspaces
  }

  func startDirectMessage(
    workspaceID: String,
    participantKind: String,
    participantID: String
  ) async throws -> ConversationSummary {
    struct Participant: Encodable {
      let kind: String
      let principalId: String
    }
    struct Payload: Encodable { let participant: Participant }
    struct Result: Decodable { let conversation: ConversationSummary }
    let body = try JSONEncoder().encode(
      CommandEnvelope(
        payload: Payload(
          participant: Participant(kind: participantKind, principalId: participantID)
        )
      )
    )
    let result: Result = try await request(
      path: "/v1/workspaces/\(workspaceID)/directs",
      method: "POST",
      body: body
    )
    return result.conversation
  }

  func listChannels(
    workspaceID: String,
    signingIdentity: NostrIdentity?
  ) async throws -> [ChannelRecord] {
    struct ChannelListResult: Decodable { let channels: [ChannelRecord] }
    let page: ChannelListResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/channels",
      method: "GET",
      signer: signingIdentity
    )
    return page.channels
  }

  func createChannel(
    workspaceID: String,
    conversationID: String,
    name: String,
    isPrivate: Bool,
    signingIdentity: NostrIdentity?
  ) async throws -> ChannelRecord {
    let payload = ChannelCommandPayload(
      conversationId: conversationID,
      name: name,
      isPrivate: isPrivate
    )
    let envelope = CommandEnvelope(payload: payload)
    let body = try JSONEncoder().encode(envelope)
    struct ChannelDetailResult: Decodable { let channel: ChannelRecord }
    let result: ChannelDetailResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/channels",
      method: "POST",
      body: body,
      signer: signingIdentity
    )
    return result.channel
  }

  func archiveChannel(workspaceID: String, conversationID: String, archived: Bool) async throws {
    let payload = ChannelCommandPayload(
      conversationId: conversationID,
      name: nil,
      isPrivate: nil
    )
    let body = try JSONEncoder().encode(CommandEnvelope(payload: payload))
    struct ActionResult: Decodable { let ok: Bool }
    let _: ActionResult = try await request(
      path:
        "/v1/workspaces/\(workspaceID)/channels/\(conversationID)/\(archived ? "archive" : "unarchive")",
      method: "POST",
      body: body
    )
  }

  func leaveChannel(workspaceID: String, conversationID: String) async throws {
    let payload = ChannelCommandPayload(
      conversationId: conversationID,
      name: nil,
      isPrivate: nil
    )
    let body = try JSONEncoder().encode(CommandEnvelope(payload: payload))
    struct ActionResult: Decodable { let ok: Bool }
    let _: ActionResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/channels/\(conversationID)/leave",
      method: "POST",
      body: body
    )
  }

  func joinChannel(workspaceID: String, conversationID: String) async throws {
    let payload = ChannelCommandPayload(
      conversationId: conversationID,
      name: nil,
      isPrivate: nil
    )
    let body = try JSONEncoder().encode(CommandEnvelope(payload: payload))
    struct ActionResult: Decodable { let ok: Bool }
    let _: ActionResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/channels/\(conversationID)/join",
      method: "POST",
      body: body
    )
  }

  func channelMembers(workspaceID: String, conversationID: String) async throws -> [ChannelMember] {
    struct MemberResult: Decodable { let members: [ChannelMember] }
    let result: MemberResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/channels/\(conversationID)/members",
      method: "GET"
    )
    return result.members
  }

  func addChannelMember(
    workspaceID: String,
    conversationID: String,
    kind: String,
    principalID: String,
    signingIdentity: NostrIdentity?
  ) async throws {
    try await addChannelMembers(
      workspaceID: workspaceID,
      conversationID: conversationID,
      kind: kind,
      principalIDs: [principalID],
      signingIdentity: signingIdentity
    )
  }

  func addChannelMembers(
    workspaceID: String,
    conversationID: String,
    kind: String,
    principalIDs: [String],
    signingIdentity: NostrIdentity?
  ) async throws {
    struct MemberAddPayload: Encodable {
      let conversationId: String
      let members: [Member]

      struct Member: Encodable {
        let kind: String
        let principalId: String
      }
    }
    struct MemberAddEnvelope: Encodable {
      let commandId: String
      let protocolVersion: Int
      let occurredAt: String
      let payload: MemberAddPayload
    }
    let envelope = MemberAddEnvelope(
      commandId: UUID().uuidString,
      protocolVersion: 1,
      occurredAt: ISO8601DateFormatter.chief().string(from: .now),
      payload: MemberAddPayload(
        conversationId: conversationID,
        members: principalIDs.map {
          MemberAddPayload.Member(kind: kind, principalId: $0)
        }
      )
    )
    let body = try JSONEncoder().encode(envelope)
    struct ActionResult: Decodable { let ok: Bool }
    let _: ActionResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/channels/\(conversationID)/members/add",
      method: "POST",
      body: body,
      signer: signingIdentity
    )
  }

  func editMessage(
    workspaceID: String,
    conversationID: String,
    messageID: String,
    body: String
  ) async throws -> ConversationMessage {
    struct EditPayload: Encodable {
      let messageId: String
      let body: String
    }
    struct EditEnvelope: Encodable {
      let commandId: String
      let protocolVersion: Int
      let occurredAt: String
      let payload: EditPayload
    }
    let envelope = EditEnvelope(
      commandId: UUID().uuidString,
      protocolVersion: 1,
      occurredAt: ISO8601DateFormatter.chief().string(from: .now),
      payload: EditPayload(messageId: messageID, body: body)
    )
    let encoded = try JSONEncoder().encode(envelope)
    struct EditResult: Decodable { let message: ConversationMessage }
    let result: EditResult = try await request(
      path:
        "/v1/workspaces/\(workspaceID)/conversations/\(conversationID)/messages/\(messageID)/edit",
      method: "POST",
      body: encoded
    )
    return result.message
  }

  func deleteMessage(
    workspaceID: String,
    conversationID: String,
    messageID: String
  ) async throws -> ConversationMessage {
    struct DeletePayload: Encodable {
      let messageId: String
    }
    struct DeleteEnvelope: Encodable {
      let commandId: String
      let protocolVersion: Int
      let occurredAt: String
      let payload: DeletePayload
    }
    let envelope = DeleteEnvelope(
      commandId: UUID().uuidString,
      protocolVersion: 1,
      occurredAt: ISO8601DateFormatter.chief().string(from: .now),
      payload: DeletePayload(messageId: messageID)
    )
    let encoded = try JSONEncoder().encode(envelope)
    struct DeleteResult: Decodable { let message: ConversationMessage }
    let result: DeleteResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/conversations/\(conversationID)/messages/\(messageID)",
      method: "DELETE",
      body: encoded
    )
    return result.message
  }

  func workspaceMembers(
    workspaceID: String,
    signingIdentity: NostrIdentity?
  ) async throws -> [WorkspaceMember] {
    struct MemberResult: Decodable { let members: [WorkspaceMember] }
    let result: MemberResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/members",
      method: "GET",
      signer: signingIdentity
    )
    return result.members
  }

  func loadAgentConfig(workspaceID: String, agentID: String) async throws -> AgentConfig? {
    struct ConfigResult: Decodable { let config: AgentConfig }
    let result: ConfigResult? = try await request(
      path: "/v1/workspaces/\(workspaceID)/agents/\(agentID)/config",
      method: "GET"
    )
    return result?.config.normalized
  }

  func saveAgentConfig(workspaceID: String, agentID: String, config: AgentConfig) async throws {
    struct ConfigInput: Encodable {
      let agentId: String
      let config: AgentConfig
    }
    let body = try JSONEncoder().encode(
      ConfigInput(agentId: agentID, config: config.normalized)
    )
    let _: EmptyResponse = try await request(
      path: "/v1/workspaces/\(workspaceID)/agents/\(agentID)/config",
      method: "POST",
      body: body
    )
  }

  func removeChannelMember(
    workspaceID: String,
    conversationID: String,
    kind: String,
    principalID: String
  ) async throws {
    struct MemberRemovePayload: Encodable {
      let conversationId: String
      let kind: String
      let principalId: String
    }
    let envelope = CommandEnvelope(
      payload: MemberRemovePayload(
        conversationId: conversationID,
        kind: kind,
        principalId: principalID
      )
    )
    let body = try JSONEncoder().encode(envelope)
    struct ActionResult: Decodable { let ok: Bool }
    let _: ActionResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/channels/\(conversationID)/members/remove",
      method: "POST",
      body: body
    )
  }

  func allChannelMemberships(workspaceID: String) async throws -> [ChannelMembership] {
    struct MembershipsResult: Decodable { let memberships: [ChannelMembership] }
    let result: MembershipsResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/channels/memberships",
      method: "GET"
    )
    return result.memberships
  }

  func currentChannelMemberships(workspaceID: String) async throws -> [ChannelMembership] {
    struct MembershipsResult: Decodable { let memberships: [ChannelMembership] }
    let result: MembershipsResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/channels/memberships/self",
      method: "GET"
    )
    return result.memberships
  }

  func switchWorkspace(id: String) async throws {
    struct SwitchInput: Encodable {
      let workspaceId: String
    }
    let body = try JSONEncoder().encode(SwitchInput(workspaceId: id))
    let _: WorkspaceSwitchResult = try await request(
      path: "/v1/workspaces/\(id)/switch",
      method: "POST",
      body: body
    )
  }

  func createWorkspaceInvite(
    workspaceID: String,
    conversationID: String?
  ) async throws -> WorkspaceInviteLink {
    struct Input: Encodable {
      let commandId: String
      let secret: String
      let conversationId: String?
      let expiresAt: String
    }
    let secret = Self.randomInviteSecret()
    let input = Input(
      commandId: UUID().uuidString,
      secret: secret,
      conversationId: conversationID,
      expiresAt: ISO8601DateFormatter.chief().string(
        from: Date.now.addingTimeInterval(7 * 24 * 60 * 60)
      )
    )
    let _: WorkspaceInvite = try await request(
      path: "/v1/workspaces/\(workspaceID)/invites",
      method: "POST",
      body: try JSONEncoder().encode(input)
    )
    return WorkspaceInviteLink(
      relayURL: configuration.relayURL,
      workspaceID: workspaceID,
      secret: secret
    )
  }

  func previewWorkspaceInvite(_ link: WorkspaceInviteLink) async throws -> WorkspaceInvite {
    try requireConfiguredRelay(link.relayURL)
    struct Input: Encodable { let secret: String }
    return try await request(
      path: "/v1/workspaces/\(link.workspaceID)/invites/preview",
      method: "POST",
      body: try JSONEncoder().encode(Input(secret: link.secret))
    )
  }

  func claimWorkspaceInvite(_ link: WorkspaceInviteLink) async throws -> WorkspaceInviteClaim {
    try requireConfiguredRelay(link.relayURL)
    struct Input: Encodable {
      let commandId: String
      let secret: String
    }
    return try await request(
      path: "/v1/workspaces/\(link.workspaceID)/invites/claim",
      method: "POST",
      body: try JSONEncoder().encode(
        Input(commandId: UUID().uuidString, secret: link.secret)
      )
    )
  }

  func createWorkspace(from draft: OnboardingDraft) async throws -> WorkspaceSnapshot {
    let body = try JSONEncoder().encode(CreateWorkspaceInput(draft: draft))
    return try await request(path: "/v1/workspaces", method: "POST", body: body)
  }

  func messages(
    workspaceID: String,
    conversationID: String,
    after sequence: Int?,
    signingIdentity: NostrIdentity?
  ) async throws -> [ConversationMessage] {
    var path =
      "/v1/workspaces/\(workspaceID)/conversations/\(conversationID)/messages?limit=200"
    if let sequence { path += "&after=\(sequence)" }
    let page: MessagePage = try await request(
      path: path,
      method: "GET",
      signer: signingIdentity
    )
    return page.messages
  }

  func send(
    body: String,
    workspaceID: String,
    conversationID: String,
    threadRootID: String?,
    mentions: [String],
    components: [MessageComponent]
  ) async throws -> ConversationMessage {
    let command = AppendMessageInput(
      commandId: UUID().uuidString,
      occurredAt: ISO8601DateFormatter.chief().string(from: .now),
      payload: .init(
        messageId: UUID().uuidString,
        conversationId: conversationID,
        threadRootId: threadRootID,
        body: body,
        mentions: mentions,
        components: components
      )
    )
    let encoded = try JSONEncoder().encode(command)
    let result: AppendMessageResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/conversations/\(conversationID)/messages",
      method: "POST",
      body: encoded
    )
    return result.message
  }

  func registerAgentKey(
    workspaceID: String,
    agentID: String,
    pubkey: String
  ) async throws {
    struct RegisterAgentKey: Encodable {
      let agentId: String
      let pubkey: String
    }
    let body = try JSONEncoder().encode(
      RegisterAgentKey(agentId: agentID, pubkey: pubkey)
    )
    let _: RegisterAgentKeyResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/agents/\(agentID)/keys",
      method: "POST",
      body: body
    )
  }

  func sendAsAgent(
    body: String,
    workspaceID: String,
    conversationID: String,
    threadRootID: String?,
    mentions: [String],
    components: [MessageComponent],
    signingIdentity: NostrIdentity
  ) async throws -> ConversationMessage {
    let command = AppendMessageInput(
      commandId: UUID().uuidString,
      occurredAt: ISO8601DateFormatter.chief().string(from: .now),
      payload: .init(
        messageId: UUID().uuidString,
        conversationId: conversationID,
        threadRootId: threadRootID,
        body: body,
        mentions: mentions,
        components: components
      )
    )
    let encoded = try JSONEncoder().encode(command)
    let result: AppendMessageResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/conversations/\(conversationID)/messages",
      method: "POST",
      body: encoded,
      signer: signingIdentity
    )
    return result.message
  }

  func uploadAttachment(
    workspaceID: String,
    conversationID: String,
    fileName: String,
    data: Data
  ) async throws -> String {
    struct UploadInput: Encodable {
      let fileName: String
      let contentType: String
      let base64: String
    }
    let contentType = Self.guessContentType(fileName: fileName, data: data)
    let body = try JSONEncoder().encode(
      UploadInput(fileName: fileName, contentType: contentType, base64: data.base64EncodedString())
    )
    struct UploadResult: Decodable { let url: String }
    let result: UploadResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/conversations/\(conversationID)/attachments",
      method: "POST",
      body: body
    )
    return result.url
  }

  func loadBrandProfile(
    workspaceID: String,
    signingIdentity: NostrIdentity?
  ) async throws -> BrandProfileRecord? {
    do {
      return try await request(
        path: "/v1/workspaces/\(workspaceID)/data/brand-profile",
        method: "GET",
        signer: signingIdentity
      )
    } catch RelayError.httpStatus(204) {
      return nil
    }
  }

  func saveBrandProfile(
    workspaceID: String,
    markdown: String,
    sourceURLs: [String],
    conversationID: String,
    signingIdentity: NostrIdentity
  ) async throws -> WorkspaceFileRecord {
    struct Input: Encodable {
      let markdown: String
      let sourceUrls: [String]
      let conversationId: String
    }
    struct Result: Decodable { let file: WorkspaceFileRecord }
    let result: Result = try await request(
      path: "/v1/workspaces/\(workspaceID)/data/brand-profile",
      method: "PUT",
      body: try JSONEncoder().encode(
        Input(markdown: markdown, sourceUrls: sourceURLs, conversationId: conversationID)
      ),
      signer: signingIdentity
    )
    return result.file
  }

  func saveProspect(
    workspaceID: String,
    prospect: ProspectSaveInput,
    signingIdentity: NostrIdentity
  ) async throws -> ProspectRecord {
    try await request(
      path: "/v1/workspaces/\(workspaceID)/data/prospects",
      method: "POST",
      body: try JSONEncoder().encode(prospect),
      signer: signingIdentity
    )
  }

  func listProspects(
    workspaceID: String,
    signingIdentity: NostrIdentity?
  ) async throws -> [ProspectRecord] {
    struct Result: Decodable { let prospects: [ProspectRecord] }
    let result: Result = try await request(
      path: "/v1/workspaces/\(workspaceID)/data/prospects",
      method: "GET",
      signer: signingIdentity
    )
    return result.prospects
  }

  func listWorkspaceFiles(
    workspaceID: String,
    signingIdentity: NostrIdentity?
  ) async throws -> [WorkspaceFileRecord] {
    struct Result: Decodable { let files: [WorkspaceFileRecord] }
    let result: Result = try await request(
      path: "/v1/workspaces/\(workspaceID)/files",
      method: "GET",
      signer: signingIdentity
    )
    return result.files
  }

  private static func guessContentType(fileName: String, data: Data) -> String {
    let ext = (fileName as NSString).pathExtension.lowercased()
    switch ext {
    case "png": return "image/png"
    case "jpg", "jpeg": return "image/jpeg"
    case "webp": return "image/webp"
    case "gif": return "image/gif"
    default:
      return data.starts(with: [0x89, 0x50, 0x4E, 0x47]) ? "image/png" : "application/octet-stream"
    }
  }

  func claimAgentJob(workspaceID: String, agentID: String) async throws -> AgentJobLease? {
    let identity = try AgentIdentityStore(
      workspaceID: workspaceID,
      agentID: agentID
    ).ensure()
    let body = try JSONEncoder().encode(
      ClaimAgentJobInput(workerId: "chief-mobile-\(UUID().uuidString)", leaseSeconds: 120)
    )
    do {
      return try await request(
        path: "/v1/workspaces/\(workspaceID)/agents/\(agentID)/jobs/claim",
        method: "POST",
        body: body,
        signer: identity
      )
    } catch RelayError.httpStatus(204) {
      return nil
    }
  }

  func agentJobs(workspaceID: String, agentID: String) async throws -> [AgentJobRecord] {
    let result: AgentJobListResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/agents/\(agentID)/jobs",
      method: "GET"
    )
    return result.jobs
  }

  func retryAgentJob(
    workspaceID: String,
    agentID: String,
    jobID: String
  ) async throws -> AgentJobRecord {
    let result: RetryAgentJobResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/agents/\(agentID)/jobs/\(jobID)/retry",
      method: "POST"
    )
    return result.job
  }

  func replies(
    workspaceID: String,
    conversationID: String,
    rootMessageID: String,
    after sequence: Int?,
    signingIdentity: NostrIdentity?
  ) async throws -> [ConversationMessage] {
    var path =
      "/v1/workspaces/\(workspaceID)/conversations/\(conversationID)/messages/\(rootMessageID)/replies?limit=200"
    if let sequence { path += "&after=\(sequence)" }
    let page: MessagePage = try await request(
      path: path,
      method: "GET",
      signer: signingIdentity
    )
    return page.messages
  }

  func searchMessages(
    workspaceID: String,
    conversationID: String,
    query: String,
    signingIdentity: NostrIdentity?
  ) async throws -> [ConversationMessage] {
    guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
    let encodedQuery = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
    let path =
      "/v1/workspaces/\(workspaceID)/conversations/\(conversationID)/messages?limit=50&q=\(encodedQuery)"
    let page: MessagePage = try await request(
      path: path,
      method: "GET",
      signer: signingIdentity
    )
    return page.messages
  }

  func react(
    workspaceID: String,
    conversationID: String,
    messageID: String,
    emoji: String,
    add: Bool,
    signingIdentity: NostrIdentity
  ) async throws -> ConversationMessage {
    struct ReactInput: Encodable {
      let messageId: String
      let emoji: String
    }
    let body = try JSONEncoder().encode(ReactInput(messageId: messageID, emoji: emoji))
    let result: ReactResult = try await request(
      path:
        "/v1/workspaces/\(workspaceID)/conversations/\(conversationID)/messages/\(messageID)/reactions",
      method: add ? "POST" : "DELETE",
      body: body,
      signer: signingIdentity
    )
    return result.message
  }

  func completeAgentJob(
    workspaceID: String,
    agentID: String,
    leaseToken: String,
    completion: AgentJobCompletion
  ) async throws {
    let identity = try AgentIdentityStore(
      workspaceID: workspaceID,
      agentID: agentID
    ).ensure()
    let body = try JSONEncoder().encode(
      CompleteAgentJobInput(leaseToken: leaseToken, completion: completion)
    )
    let _: CompleteAgentJobResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/agents/\(agentID)/jobs/complete",
      method: "POST",
      body: body,
      signer: identity
    )
  }

  func failAgentJob(
    workspaceID: String,
    agentID: String,
    leaseToken: String,
    error: String,
    retryAt: Date?
  ) async throws {
    let identity = try AgentIdentityStore(
      workspaceID: workspaceID,
      agentID: agentID
    ).ensure()
    let body = try JSONEncoder().encode(
      FailAgentJobInput(
        leaseToken: leaseToken,
        outcome: .init(
          status: "failed",
          error: error,
          retryAt: retryAt.map { ISO8601DateFormatter().string(from: $0) }
        )
      )
    )
    let _: CompleteAgentJobResult = try await request(
      path: "/v1/workspaces/\(workspaceID)/agents/\(agentID)/jobs/complete",
      method: "POST",
      body: body,
      signer: identity
    )
  }

  func recordLogs(workspaceID: String, _ entries: [RelayLogEntry]) async throws {
    guard !entries.isEmpty else { return }
    let batch = RelayLogBatch(
      logs: entries.map { entry in
        RelayLogEnvelope(entry, workspaceID: workspaceID)
      })
    let _: LogReceipt = try await request(
      path: "/v1/workspaces/\(workspaceID)/logs",
      method: "POST",
      body: try JSONEncoder().encode(batch)
    )
  }

  private func request<Response: Decodable>(
    path: String,
    method: String,
    body: Data? = nil,
    signer: NostrIdentity? = nil
  ) async throws -> Response {
    let url = URL(string: path, relativeTo: configuration.relayURL)!.absoluteURL
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.timeoutInterval = 20
    request.httpBody = body
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    // Authenticate with NIP-98: sign an ephemeral kind-27235 event with a
    // secp256k1 identity. Agent sends use the agent's own key so the relay
    // resolves the author to the agent; otherwise the device user's key.
    let identity =
      signer ?? (try? NostrKeychainStore().load())
    if let identity {
      let header = try NIP98Signer(identity: identity)
        .header(method: method, url: url, body: body ?? Data())
      request.setValue(header, forHTTPHeaderField: "authorization")
    }
    if signer == nil,
      let deviceAuthorization = await DeviceAuthorizationVault.shared.load()
    {
      request.setValue(
        deviceAuthorization,
        forHTTPHeaderField: "x-chief-device-authorization"
      )
    }
    var data: Data
    var response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch {
      if error is CancellationError
        || (error as? URLError)?.code == .cancelled
      {
        throw CancellationError()
      }
      relayLog.error("\(method) \(path) failed: \(error.localizedDescription)")
      print("[Chief] relay \(method) \(path) failed: \(error.localizedDescription)")
      throw RelayError.unavailable
    }
    guard let http = response as? HTTPURLResponse else {
      relayLog.error("\(method) \(path) non-HTTP response")
      throw RelayError.unavailable
    }
    guard (200..<300).contains(http.statusCode) else {
      let detail = String(data: data, encoding: .utf8) ?? ""
      relayLog.error("\(method) \(path) -> \(http.statusCode): \(detail.prefix(300))")
      print("[Chief] relay \(method) \(path) -> \(http.statusCode): \(detail.prefix(300))")
      if http.statusCode == 401 { throw RelayError.unauthorized }
      if let envelope = try? decoder.decode(RelayFailureEnvelope.self, from: data),
        envelope.error.code == "relay_capacity_exhausted"
      {
        throw RelayError.capacity
      }
      throw RelayError.httpStatus(http.statusCode)
    }
    relayLog.info("\(method) \(path) -> \(http.statusCode)")
    print("[Chief] relay \(method) \(path) -> \(http.statusCode)")
    if http.statusCode == 204 { throw RelayError.httpStatus(204) }
    return try decoder.decode(Response.self, from: data)
  }

  private func requireConfiguredRelay(_ relayURL: URL) throws {
    guard relayURL.scheme?.lowercased() == configuration.relayURL.scheme?.lowercased(),
      relayURL.host?.lowercased() == configuration.relayURL.host?.lowercased(),
      relayURL.port == configuration.relayURL.port
    else {
      throw RelayError.unsupportedRelay
    }
  }

  private static func randomInviteSecret() -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    return Data(bytes).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}

enum RelayError: LocalizedError, Equatable {
  case unauthorized
  case unavailable
  case capacity
  case httpStatus(Int)
  case unsupportedRelay

  var errorDescription: String? {
    switch self {
    case .unauthorized:
      "Chief could not verify this device with the relay. Sign in again and retry."
    case .unavailable:
      "Chief could not reach the relay. Check your connection and retry."
    case .capacity:
      "This relay is temporarily at capacity. Your workspace is safe; try again after its usage window resets."
    case .unsupportedRelay:
      "This invite belongs to another Chief relay. Add that relay before joining."
    case .httpStatus(404):
      "This Chief app requires a newer relay version. Update the relay and retry."
    case .httpStatus(let status) where status >= 500:
      "The relay could not finish workspace setup. Retry in a moment."
    case .httpStatus:
      "The relay rejected workspace setup. Review the setup details and retry."
    }
  }
}

private struct RelayFailureEnvelope: Decodable {
  struct Failure: Decodable { let code: String }
  let error: Failure
}

private struct MessagePage: Codable { let messages: [ConversationMessage] }
private struct AppendMessageResult: Codable { let message: ConversationMessage }
private struct ReactResult: Codable { let message: ConversationMessage }
private struct WorkspaceListResult: Codable { let workspaces: [WorkspaceSummary] }
private struct WorkspaceSwitchResult: Codable {
  let workspaceId: String
  let isActive: Bool
}
private struct RegisterAgentKeyResult: Codable {
  let agentId: String
  let pubkey: String
}
struct AgentJobLease: Codable, Equatable, Sendable {
  struct Job: Codable, Equatable, Sendable {
    struct Payload: Codable, Equatable, Sendable {
      let conversationId: String?
      let instruction: String?
      let title: String?
      let name: String?
      let website: String?
      let selectedApps: [String]?
      let threadRootId: String?
      let skillId: String?

      init(
        conversationId: String? = nil,
        instruction: String? = nil,
        title: String? = nil,
        name: String? = nil,
        website: String? = nil,
        selectedApps: [String]? = nil,
        threadRootId: String? = nil,
        skillId: String? = nil
      ) {
        self.conversationId = conversationId
        self.instruction = instruction
        self.title = title
        self.name = name
        self.website = website
        self.selectedApps = selectedApps
        self.threadRootId = threadRootId
        self.skillId = skillId
      }
    }

    let id: String
    let agentId: String
    let kind: String
    let attempt: Int
    let payload: Payload
  }
  let job: Job
  let leaseToken: String
}

struct AgentJobRecord: Codable, Equatable, Identifiable, Sendable {
  struct Payload: Codable, Equatable, Sendable {
    let conversationId: String?
    let instruction: String?
    let title: String?
    let name: String?
    let website: String?
    let selectedApps: [String]?
    let threadRootId: String?
    let skillId: String?
  }

  let id: String
  let workspaceId: String
  let agentId: String
  let kind: String
  let payload: Payload
  let status: String
  let attempt: Int
  let lastError: String?
  let availableAt: String
  let leaseExpiresAt: String?
  let createdAt: String
  let updatedAt: String

  var updatedDate: Date {
    ISO8601DateFormatter.chief().date(from: updatedAt)
      ?? ISO8601DateFormatter.noFraction().date(from: updatedAt)
      ?? .distantPast
  }
}

private struct ClaimAgentJobInput: Codable {
  let workerId: String
  let leaseSeconds: Int
}

private struct CompleteAgentJobInput: Encodable {
  struct Outcome: Encodable {
    struct Result: Encodable {
      let openingMessage: String?
      let publishedMessage: AgentPublishedMessage?

      init(completion: AgentJobCompletion) {
        openingMessage = completion.openingMessage
        publishedMessage = completion.publishedMessage
      }
    }
    let status: String
    let result: Result
  }
  let leaseToken: String
  let outcome: Outcome

  init(leaseToken: String, completion: AgentJobCompletion) {
    self.leaseToken = leaseToken
    outcome = .init(status: "completed", result: .init(completion: completion))
  }
}

private struct FailAgentJobInput: Encodable {
  struct Outcome: Encodable {
    let status: String
    let error: String
    let retryAt: String?
  }
  let leaseToken: String
  let outcome: Outcome
}

private struct CompleteAgentJobResult: Codable {}
private struct AgentJobListResult: Codable { let jobs: [AgentJobRecord] }
private struct RetryAgentJobResult: Codable { let job: AgentJobRecord }

private struct RelayLogEnvelope: Encodable {
  let id: String
  let correlationId: String
  let workspaceId: String
  let type: String
  let operation: String
  let agentId: String?
  let conversationId: String?
  let message: String
  let createdAt: String

  init(_ entry: RelayLogEntry, workspaceID: String) {
    id = entry.id
    correlationId = entry.correlationId
    workspaceId = workspaceID
    type = entry.type
    operation = entry.operation
    agentId = entry.agentId
    conversationId = entry.conversationId
    message = entry.message
    createdAt = entry.createdAt
  }
}

private struct RelayLogBatch: Encodable { let logs: [RelayLogEnvelope] }
private struct LogReceipt: Decodable { let accepted: Int }
private struct EmptyResponse: Decodable {}
private struct CreateWorkspaceInput: Codable {
  let commandId: String
  let name: String
  let website: String
  let runtime: String
  let inferenceProvider: String
  let inferenceModel: String
  let selectedApps: [String]

  init(draft: OnboardingDraft) {
    commandId = UUID().uuidString
    name = draft.companyName
    website = draft.website
    runtime = draft.runtime?.rawValue ?? "phone"
    inferenceProvider = draft.inferenceProvider?.rawValue ?? "openCodeGo"
    inferenceModel = draft.inferenceModel
    selectedApps = draft.selectedApps.sorted()
  }
}

private struct AppendMessageInput: Codable {
  struct Payload: Codable {
    let messageId: String
    let conversationId: String
    let threadRootId: String?
    let body: String
    let mentions: [String]
    let components: [MessageComponent]
  }
  let commandId: String
  let protocolVersion: Int
  let occurredAt: String
  let payload: Payload

  init(
    commandId: String,
    occurredAt: String,
    payload: Payload
  ) {
    self.commandId = commandId
    self.protocolVersion = 1
    self.occurredAt = occurredAt
    self.payload = payload
  }
}

private struct ChannelCommandPayload: Encodable {
  let conversationId: String
  let name: String?
  let isPrivate: Bool?

  init(conversationId: String, name: String?, isPrivate: Bool?) {
    self.conversationId = conversationId
    self.name = name
    self.isPrivate = isPrivate
  }
}

private struct CommandEnvelope<Payload: Encodable>: Encodable {
  let commandId: String
  let protocolVersion: Int
  let occurredAt: String
  let payload: Payload

  init(payload: Payload) {
    self.commandId = UUID().uuidString
    self.protocolVersion = 1
    self.occurredAt = ISO8601DateFormatter.chief().string(from: .now)
    self.payload = payload
  }
}
