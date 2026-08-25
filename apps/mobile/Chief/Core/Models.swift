import Foundation

extension ISO8601DateFormatter {
  /// Parses `2026-08-17T15:53:21.123Z` (relay `toISOString()` output) with
  /// fractional seconds. A fresh formatter per call keeps this safe to use
  /// from arbitrary concurrency domains.
  static func chief() -> ISO8601DateFormatter {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [
      .withInternetDateTime,
      .withFractionalSeconds,
    ]
    return formatter
  }

  static func noFraction() -> ISO8601DateFormatter {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
  }
}

struct ChiefUser: Codable, Equatable, Identifiable, Sendable {
  let id: String
  let name: String
  let imageURL: URL?
}

struct ChiefSession: Codable, Equatable, Sendable {
  let accessToken: String
  let sessionToken: String
  let refreshToken: String?
  let accessTokenExpiresAt: Date?
  let user: ChiefUser
  let workspaceID: String?

  static let fixture = ChiefSession(
    accessToken: "fixture-token",
    sessionToken: "fixture-session-token",
    refreshToken: nil,
    accessTokenExpiresAt: nil,
    user: ChiefUser(id: "daniel", name: "Daniel Sims", imageURL: nil),
    workspaceID: "chief-demo"
  )
}

struct WorkspaceSnapshot: Codable, Equatable, Identifiable, Sendable {
  let id: String
  let name: String
  let website: String?
  let selectedApps: [String]?
  let runtime: String?
  let imageURL: URL?
  let onboardingComplete: Bool
  let conversations: [ConversationSummary]
  let agents: [AgentSummary]
  let projects: [ProjectSummary]

  init(
    id: String,
    name: String,
    website: String? = nil,
    selectedApps: [String]? = nil,
    runtime: String? = nil,
    imageURL: URL? = nil,
    onboardingComplete: Bool,
    conversations: [ConversationSummary],
    agents: [AgentSummary],
    projects: [ProjectSummary]
  ) {
    self.id = id
    self.name = name
    self.website = website
    self.selectedApps = selectedApps
    self.runtime = runtime
    self.imageURL = imageURL
    self.onboardingComplete = onboardingComplete
    self.conversations = conversations
    self.agents = agents
    self.projects = projects
  }
}

/// A lightweight organization/workspace entry the switcher lists. The active
/// workspace's full snapshot is loaded on switch.
struct WorkspaceSummary: Codable, Equatable, Identifiable, Sendable {
  let id: String
  let name: String
  let website: String?
  let imageURL: URL?
  let isActive: Bool
  let onboardingComplete: Bool

  init(
    id: String,
    name: String,
    website: String? = nil,
    imageURL: URL? = nil,
    isActive: Bool,
    onboardingComplete: Bool
  ) {
    self.id = id
    self.name = name
    self.website = website
    self.imageURL = imageURL
    self.isActive = isActive
    self.onboardingComplete = onboardingComplete
  }
}

struct WorkspaceInvite: Codable, Equatable, Sendable {
  let workspaceId: String
  let workspaceName: String
  let website: String
  let conversationId: String?
  let conversationName: String?
  let expiresAt: String
}

struct WorkspaceInviteClaim: Codable, Equatable, Sendable {
  let workspaceId: String
  let workspaceName: String
  let website: String
  let conversationId: String?
  let conversationName: String?
  let expiresAt: String
  let alreadyMember: Bool
}

struct OrganizationWorkspaceJoinResult: Codable, Equatable, Sendable {
  let workspaceId: String
  let workspaceName: String
  let website: String
}

struct WorkspaceInviteLink: Equatable, Sendable {
  let relayURL: URL
  let workspaceID: String
  let secret: String

  var url: URL {
    relayURL
      .appending(path: "invite")
      .appending(path: workspaceID)
      .appending(path: secret)
  }

  init(relayURL: URL, workspaceID: String, secret: String) {
    self.relayURL = relayURL
    self.workspaceID = workspaceID
    self.secret = secret
  }

  init?(url: URL) {
    guard url.user == nil, url.password == nil, url.fragment == nil else { return nil }
    if ["chief", "chief-mobile"].contains(url.scheme?.lowercased() ?? ""),
      url.host?.lowercased() == "join"
    {
      guard
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
        let relay = components.queryItems?.first(where: { $0.name == "relay" })?.value,
        let relayURL = URL(string: relay),
        let workspaceID = components.queryItems?.first(where: { $0.name == "workspace" })?.value,
        let secret = components.queryItems?.first(where: { $0.name == "code" })?.value,
        Self.valid(relayURL: relayURL, workspaceID: workspaceID, secret: secret)
      else { return nil }
      self.init(relayURL: relayURL, workspaceID: workspaceID, secret: secret)
      return
    }
    let parts = url.pathComponents.filter { $0 != "/" }
    guard
      ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
      parts.count == 3,
      parts[0] == "invite",
      Self.valid(relayURL: url, workspaceID: parts[1], secret: parts[2])
    else { return nil }
    var relay = URLComponents(url: url, resolvingAgainstBaseURL: false)
    relay?.path = ""
    relay?.query = nil
    guard let relayURL = relay?.url else { return nil }
    self.init(relayURL: relayURL, workspaceID: parts[1], secret: parts[2])
  }

  private static func valid(relayURL: URL, workspaceID: String, secret: String) -> Bool {
    validRelayURL(relayURL) && workspaceID.hasPrefix("workspace-")
      && (43...128).contains(secret.count)
      && secret.allSatisfy { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }
  }

  static func validRelayURL(_ relayURL: URL) -> Bool {
    guard relayURL.user == nil, relayURL.password == nil, relayURL.fragment == nil else {
      return false
    }
    let scheme = relayURL.scheme?.lowercased()
    let local = relayURL.host == "localhost" || relayURL.host == "127.0.0.1"
    return scheme == "https" || (scheme == "http" && local)
  }
}

struct OrganizationInviteLink: Equatable, Sendable {
  let relayURL: URL
  let workspaceID: String

  init?(url: URL) {
    guard ["chief-mobile", "chief"].contains(url.scheme?.lowercased() ?? ""),
      url.host?.lowercased() == "organization-invite",
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      let relay = components.queryItems?.first(where: { $0.name == "relay" })?.value,
      let relayURL = URL(string: relay),
      let workspaceID = components.queryItems?.first(where: { $0.name == "workspace" })?.value,
      workspaceID.hasPrefix("workspace-"),
      WorkspaceInviteLink.validRelayURL(relayURL)
    else { return nil }
    self.relayURL = relayURL
    self.workspaceID = workspaceID
  }
}

struct ConversationSummary: Codable, Equatable, Identifiable, Sendable {
  enum Kind: String, Codable, Sendable { case channel, direct }
  let id: String
  let name: String
  let kind: Kind
  let isPrivate: Bool
  var archived: Bool
  var unreadCount: Int
  let requiresAttention: Bool
  var lastMessage: String?

  enum CodingKeys: String, CodingKey {
    case id, name, kind, isPrivate, archived, unreadCount, requiresAttention, lastMessage
  }

  init(
    id: String,
    name: String,
    kind: Kind,
    isPrivate: Bool,
    unreadCount: Int,
    requiresAttention: Bool,
    lastMessage: String?,
    archived: Bool = false
  ) {
    self.id = id
    self.name = name
    self.kind = kind
    self.isPrivate = isPrivate
    self.archived = archived
    self.unreadCount = unreadCount
    self.requiresAttention = requiresAttention
    self.lastMessage = lastMessage
  }

  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    id = try values.decode(String.self, forKey: .id)
    name = try values.decode(String.self, forKey: .name)
    kind = try values.decode(Kind.self, forKey: .kind)
    isPrivate = try values.decode(Bool.self, forKey: .isPrivate)
    archived = try values.decodeIfPresent(Bool.self, forKey: .archived) ?? false
    unreadCount = try values.decodeIfPresent(Int.self, forKey: .unreadCount) ?? 0
    requiresAttention = try values.decodeIfPresent(Bool.self, forKey: .requiresAttention) ?? false
    lastMessage = try values.decodeIfPresent(String.self, forKey: .lastMessage)
  }
}

/// A channel record from the relay (`channelRecordSchema`).
struct ChannelRecord: Codable, Equatable, Identifiable, Sendable {
  let id: String
  let workspaceId: String
  let name: String
  let isPrivate: Bool
  let archived: Bool
  let createdAt: Date

  enum CodingKeys: String, CodingKey {
    case id, workspaceId, name, isPrivate, archived, createdAt
  }

  init(
    id: String, workspaceId: String, name: String, isPrivate: Bool, archived: Bool, createdAt: Date
  ) {
    self.id = id
    self.workspaceId = workspaceId
    self.name = name
    self.isPrivate = isPrivate
    self.archived = archived
    self.createdAt = createdAt
  }

  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    id = try values.decode(String.self, forKey: .id)
    workspaceId = try values.decode(String.self, forKey: .workspaceId)
    name = try values.decode(String.self, forKey: .name)
    isPrivate = try values.decode(Bool.self, forKey: .isPrivate)
    archived = try values.decodeIfPresent(Bool.self, forKey: .archived) ?? false
    createdAt = try ModelsDate.decode(from: values, forKey: .createdAt)
  }

  func encode(to encoder: Encoder) throws {
    var values = encoder.container(keyedBy: CodingKeys.self)
    try values.encode(id, forKey: .id)
    try values.encode(workspaceId, forKey: .workspaceId)
    try values.encode(name, forKey: .name)
    try values.encode(isPrivate, forKey: .isPrivate)
    try values.encode(archived, forKey: .archived)
    try values.encode(createdAt, forKey: .createdAt)
  }
}

/// A workspace-level membership row from the relay (`members` table).
struct WorkspaceMember: Codable, Equatable, Identifiable, Sendable {
  let kind: String
  let principalId: String
  let role: String
  var id: String { "\(kind):\(principalId)" }
}

struct DirectMessageRecipient: Equatable, Identifiable, Sendable {
  let kind: String
  let principalID: String
  let name: String
  let role: String

  var id: String { "\(kind):\(principalID)" }
  var isAgent: Bool { kind == "agent" }
}

/// A channel membership record from the relay (`channelMemberSchema`).
struct ChannelMember: Codable, Equatable, Identifiable, Sendable {
  let kind: String
  let principalId: String
  let role: String
  let joinedAt: Date
  let name: String?

  var id: String { "\(kind):\(principalId)" }

  enum CodingKeys: String, CodingKey {
    case kind, principalId, role, joinedAt, name
  }

  init(kind: String, principalId: String, role: String, joinedAt: Date, name: String? = nil) {
    self.kind = kind
    self.principalId = principalId
    self.role = role
    self.joinedAt = joinedAt
    self.name = name
  }

  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    kind = try values.decode(String.self, forKey: .kind)
    principalId = try values.decode(String.self, forKey: .principalId)
    role = try values.decode(String.self, forKey: .role)
    name = try values.decodeIfPresent(String.self, forKey: .name)
    joinedAt = try ModelsDate.decode(from: values, forKey: .joinedAt)
  }
}

/// A workspace-wide channel membership row (memberships endpoint): adds the
/// conversation the membership belongs to.
struct ChannelMembership: Codable, Equatable, Identifiable, Sendable {
  let conversationId: String
  let kind: String
  let principalId: String
  let role: String
  let joinedAt: Date

  var id: String { "\(conversationId):\(kind):\(principalId)" }

  enum CodingKeys: String, CodingKey {
    case conversationId, kind, principalId, role, joinedAt
  }

  init(conversationId: String, kind: String, principalId: String, role: String, joinedAt: Date) {
    self.conversationId = conversationId
    self.kind = kind
    self.principalId = principalId
    self.role = role
    self.joinedAt = joinedAt
  }

  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    conversationId = try values.decode(String.self, forKey: .conversationId)
    kind = try values.decode(String.self, forKey: .kind)
    principalId = try values.decode(String.self, forKey: .principalId)
    role = try values.decode(String.self, forKey: .role)
    joinedAt = try ModelsDate.decode(from: values, forKey: .joinedAt)
  }
}

/// Shared ISO8601 (with or without fractional seconds) date decoding helper.
enum ModelsDate {
  static func decode<Key: CodingKey>(
    from container: KeyedDecodingContainer<Key>,
    forKey key: Key
  ) throws -> Date {
    let raw = try container.decode(String.self, forKey: key)
    if let date = ISO8601DateFormatter.chief().date(from: raw) { return date }
    if let date = ISO8601DateFormatter.noFraction().date(from: raw) { return date }
    throw DecodingError.dataCorruptedError(
      forKey: key,
      in: container,
      debugDescription: "Unrecognized date: \(raw)"
    )
  }
}

struct AgentSummary: Codable, Equatable, Identifiable, Sendable {
  enum Status: String, Codable, Sendable { case idle, working, needsYou, offline }
  let id: String
  let name: String
  let role: String
  let status: Status
}

struct ProjectSummary: Codable, Equatable, Identifiable, Sendable {
  let id: String
  let organizationID: String
  let name: String
  let description: String?
  let repositoryKind: String
  let providerID: String
  let canonicalRemoteURL: String?
  let repositoryWebURL: String?
  let defaultBranch: String
  let createdAt: String
  let updatedAt: String

  var repository: String { repositoryWebURL ?? canonicalRemoteURL ?? name }
  var branch: String { defaultBranch }
  var changedFiles: Int { 0 }

  enum CodingKeys: String, CodingKey {
    case id, name, description, repositoryKind, defaultBranch, createdAt, updatedAt
    case organizationID = "organizationId"
    case providerID = "providerId"
    case canonicalRemoteURL = "canonicalRemoteUrl"
    case repositoryWebURL = "repositoryWebUrl"
  }
}

struct ConversationMessage: Codable, Equatable, Identifiable, Sendable {
  enum Author: Equatable, Sendable {
    case user(id: String, name: String)
    case agent(id: String, name: String)
    case system
  }

  /// An aggregate reaction: an emoji plus the pubkeys that added it.
  struct Reaction: Codable, Equatable, Sendable {
    let emoji: String
    let pubkeys: [String]
  }

  let id: String
  let workspaceID: String
  let conversationID: String
  let threadRootID: String?
  let author: Author
  var body: String
  let mentions: [String]
  let components: [MessageComponent]
  let reactions: [Reaction]
  var edited: Bool
  var deleted: Bool
  let createdAt: Date
  let sequence: Int

  /// Durable cell telemetry shares the conversation stream for ordering and
  /// replay, but it is not an authored chat message and must never affect
  /// previews, unread counts, haptics, or notifications.
  var isAgentActivityProjection: Bool {
    guard case .agent = author else { return false }
    return body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && !components.isEmpty
      && components.allSatisfy { ["agent.activity", "thinking", "tool", "error"].contains($0.kind) }
  }

  enum CodingKeys: String, CodingKey {
    case id
    case workspaceId
    case conversationId
    case threadRootId
    case author
    case body
    case mentions
    case components
    case reactions
    case edited
    case deleted
    case createdAt
    case sequence
  }

  init(
    id: String,
    workspaceID: String,
    conversationID: String,
    threadRootID: String?,
    author: Author,
    body: String,
    mentions: [String] = [],
    components: [MessageComponent],
    reactions: [Reaction] = [],
    edited: Bool = false,
    deleted: Bool = false,
    createdAt: Date,
    sequence: Int
  ) {
    self.id = id
    self.workspaceID = workspaceID
    self.conversationID = conversationID
    self.threadRootID = threadRootID
    self.author = author
    self.body = body
    self.mentions = mentions
    self.components = components
    self.reactions = reactions
    self.edited = edited
    self.deleted = deleted
    self.createdAt = createdAt
    self.sequence = sequence
  }

  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    self.id = try values.decode(String.self, forKey: .id)
    self.workspaceID = try values.decode(String.self, forKey: .workspaceId)
    self.conversationID = try values.decode(String.self, forKey: .conversationId)
    self.threadRootID = try values.decodeIfPresent(String.self, forKey: .threadRootId)
    self.body = try values.decode(String.self, forKey: .body)
    self.mentions =
      try values.decodeIfPresent([String].self, forKey: .mentions) ?? []
    self.components =
      try values.decodeIfPresent([MessageComponent].self, forKey: .components) ?? []
    self.reactions =
      try values.decodeIfPresent([Reaction].self, forKey: .reactions) ?? []
    self.edited = try values.decodeIfPresent(Bool.self, forKey: .edited) ?? false
    self.deleted = try values.decodeIfPresent(Bool.self, forKey: .deleted) ?? false
    self.sequence = try values.decode(Int.self, forKey: .sequence)
    self.createdAt = try ModelsDate.decode(from: values, forKey: .createdAt)
    let authorContainer = try values.nestedContainer(
      keyedBy: AuthorCodingKeys.self,
      forKey: .author
    )
    self.author = try Author(fromRelay: authorContainer)
  }

  func encode(to encoder: Encoder) throws {
    var values = encoder.container(keyedBy: CodingKeys.self)
    try values.encode(id, forKey: .id)
    try values.encode(workspaceID, forKey: .workspaceId)
    try values.encode(conversationID, forKey: .conversationId)
    try values.encodeIfPresent(threadRootID, forKey: .threadRootId)
    try values.encode(body, forKey: .body)
    try values.encode(mentions, forKey: .mentions)
    try values.encode(components, forKey: .components)
    try values.encode(reactions, forKey: .reactions)
    try values.encode(edited, forKey: .edited)
    try values.encode(deleted, forKey: .deleted)
    try values.encode(sequence, forKey: .sequence)
    try values.encode(ISO8601DateFormatter.chief().string(from: createdAt), forKey: .createdAt)
    var authorEnc = values.nestedContainer(
      keyedBy: AuthorCodingKeys.self,
      forKey: .author
    )
    switch author {
    case .system:
      try authorEnc.encode("system", forKey: .kind)
      try authorEnc.encode("chief-relay", forKey: .id)
    case .user(let id, _):
      try authorEnc.encode("user", forKey: .kind)
      try authorEnc.encode(id, forKey: .id)
    case .agent(let id, _):
      try authorEnc.encode("agent", forKey: .kind)
      try authorEnc.encode(id, forKey: .id)
    }
  }

  enum AuthorCodingKeys: String, CodingKey {
    case kind
    case id
    case name
  }
}

extension ConversationMessage.Author {
  var displayName: String {
    switch self {
    case .user(_, let name): name.isEmpty ? "You" : name
    case .agent(_, let name): name.isEmpty ? "Agent" : name
    case .system: "Chief"
    }
  }
}

extension ConversationMessage.Author {
  init(fromRelay container: KeyedDecodingContainer<ConversationMessage.AuthorCodingKeys>)
    throws
  {
    // Relay messages carry `kind` + `id` but no display `name`; derive a
    // friendly label so every message (not just the opening) decodes.
    let kind = (try? container.decode(String.self, forKey: .kind)) ?? "system"
    let id = (try? container.decode(String.self, forKey: .id)) ?? "chief-relay"
    let name =
      (try? container.decodeIfPresent(String.self, forKey: .name))
      ?? Self.displayName(kind: kind, id: id)
    switch kind {
    case "user":
      self = .user(id: id, name: name)
    case "agent", "assistant":
      self = .agent(id: id, name: name)
    default:
      self = .system
    }
  }

  private static func displayName(kind: String, id: String) -> String {
    let lower = id.lowercased()
    if lower == "chief" { return "Chief" }
    if kind == "user" { return "You" }
    return WorkspaceAgentCatalog.agent(forID: id)?.name ?? id.capitalized
  }
}

struct MessageComponent: Codable, Equatable, Identifiable, Sendable {
  let id: String
  let kind: String
  let version: Int
  let payload: [String: String]

  init(
    id: String,
    kind: String,
    version: Int = 1,
    payload: [String: String]
  ) {
    self.id = id
    self.kind = kind
    self.version = version
    self.payload = payload
  }

  enum CodingKeys: String, CodingKey {
    case id
    case kind
    case version
    case payload
  }

  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    self.id = try values.decode(String.self, forKey: .id)
    self.kind = try values.decode(String.self, forKey: .kind)
    self.version = try values.decodeIfPresent(Int.self, forKey: .version) ?? 1
    let rawPayload =
      try values.decodeIfPresent([String: JSONValue].self, forKey: .payload) ?? [:]
    self.payload = rawPayload.mapValues(Self.flatten)
  }

  func encode(to encoder: Encoder) throws {
    var values = encoder.container(keyedBy: CodingKeys.self)
    try values.encode(id, forKey: .id)
    try values.encode(kind, forKey: .kind)
    try values.encode(version, forKey: .version)
    var rawPayload = payload.mapValues(JSONValue.string)
    if kind == "plugin.recommendation" {
      for key in ["enabled", "trusted"] {
        if let value = payload[key].flatMap(Bool.init) {
          rawPayload[key] = .bool(value)
        }
      }
    }
    try values.encode(rawPayload, forKey: .payload)
  }

  private static func flatten(_ value: JSONValue) -> String {
    switch value {
    case .string(let s): s
    case .number(let n): String(n)
    case .bool(let b): String(b)
    case .array(let values):
      "[\(values.map(flatten).joined(separator: ","))]"
    case .object(let values):
      flattenObject(values)
    case .null: ""
    }
  }

  private static func flattenObject(_ values: [String: JSONValue]) -> String {
    let members = values.keys.sorted().map { key in
      "\(key):\(flatten(values[key] ?? .null))"
    }
    return "{\(members.joined(separator: ","))}"
  }
}

enum JSONValue: Codable, Sendable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case array([JSONValue])
  case object([String: JSONValue])
  case null

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode([JSONValue].self) {
      self = .array(value)
    } else if let value = try? container.decode([String: JSONValue].self) {
      self = .object(value)
    } else {
      guard container.decodeNil() else {
        throw DecodingError.typeMismatch(
          JSONValue.self,
          .init(codingPath: decoder.codingPath, debugDescription: "Unsupported JSON value")
        )
      }
      self = .null
    }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .string(let value): try container.encode(value)
    case .number(let value): try container.encode(value)
    case .bool(let value): try container.encode(value)
    case .array(let value): try container.encode(value)
    case .object(let value): try container.encode(value)
    case .null: try container.encodeNil()
    }
  }
}

struct OnboardingDraft: Equatable, Sendable {
  enum RuntimeLocation: String, CaseIterable, Sendable { case phone, cloud }
  enum InferenceProvider: String, CaseIterable, Sendable {
    case cloud = "remote"
    case openCodeGo
    #if DEBUG
      /// Development-only inference supplied by this Mac's signed-in Codex
      /// app-server. This case is compiled out of release builds.
      case codexBridge
    #endif
    case onDevice
  }

  var step = 0
  var runtime: RuntimeLocation?
  var inferenceProvider: InferenceProvider?
  var inferenceModel = OpenCodeModelCatalog.recommendedFreeModelID
  var deviceModelID: String?
  var companyName = ""
  var website = ""
  var selectedApps: Set<String> = []

  var canContinue: Bool {
    runtime != nil
      && inferenceProvider != nil
      && !companyName.trimmingCharacters(in: .whitespaces).isEmpty
  }
}
