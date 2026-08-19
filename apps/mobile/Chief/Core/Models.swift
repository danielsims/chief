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
  let user: ChiefUser
  let workspaceID: String?

  static let fixture = ChiefSession(
    accessToken: "fixture-token",
    sessionToken: "fixture-session-token",
    user: ChiefUser(id: "daniel", name: "Daniel Sims", imageURL: nil),
    workspaceID: "chief-demo"
  )
}

struct WorkspaceSnapshot: Codable, Equatable, Identifiable, Sendable {
  let id: String
  let name: String
  let imageURL: URL?
  let onboardingComplete: Bool
  let conversations: [ConversationSummary]
  let agents: [AgentSummary]
  let projects: [ProjectSummary]

  init(
    id: String,
    name: String,
    imageURL: URL? = nil,
    onboardingComplete: Bool,
    conversations: [ConversationSummary],
    agents: [AgentSummary],
    projects: [ProjectSummary]
  ) {
    self.id = id
    self.name = name
    self.imageURL = imageURL
    self.onboardingComplete = onboardingComplete
    self.conversations = conversations
    self.agents = agents
    self.projects = projects
  }
}

struct ConversationSummary: Codable, Equatable, Identifiable, Sendable {
  enum Kind: String, Codable, Sendable { case channel, direct }
  let id: String
  let name: String
  let kind: Kind
  let isPrivate: Bool
  let unreadCount: Int
  let requiresAttention: Bool
  let lastMessage: String?
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
  let name: String
  let repository: String
  let branch: String
  let changedFiles: Int
}

struct ConversationMessage: Codable, Equatable, Identifiable, Sendable {
  enum Author: Equatable, Sendable {
    case user(id: String, name: String)
    case agent(id: String, name: String)
    case system
  }

  let id: String
  let workspaceID: String
  let conversationID: String
  let threadRootID: String?
  let author: Author
  let body: String
  let mentions: [String]
  let components: [MessageComponent]
  let createdAt: Date
  let sequence: Int

  enum CodingKeys: String, CodingKey {
    case id
    case workspaceId
    case conversationId
    case threadRootId
    case author
    case body
    case mentions
    case components
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
    self.sequence = try values.decode(Int.self, forKey: .sequence)
    self.createdAt = try Self.decodeDate(from: values, forKey: .createdAt)
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

  private static func decodeDate(
    from container: KeyedDecodingContainer<CodingKeys>,
    forKey key: CodingKeys
  ) throws -> Date {
    let raw = try container.decode(String.self, forKey: key)
    if let date = ISO8601DateFormatter.chief().date(from: raw) { return date }
    if let date = ISO8601DateFormatter.noFraction().date(from: raw) {
      return date
    }
    throw DecodingError.dataCorruptedError(
      forKey: key,
      in: container,
      debugDescription: "Unrecognized date: \(raw)"
    )
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
    return id.capitalized
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

  private static func flatten(_ value: JSONValue) -> String {
    switch value {
    case .string(let s): s
    case .number(let n): String(n)
    case .bool(let b): String(b)
    case .null: ""
    }
  }
}

enum JSONValue: Decodable, Sendable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case null

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else {
      _ = try container.decodeNil()
      self = .null
    }
  }
}

struct OnboardingDraft: Equatable, Sendable {
  enum RuntimeLocation: String, CaseIterable, Sendable { case phone, cloud }
  enum InferenceProvider: String, CaseIterable, Sendable {
    case openCodeGo
    case onDevice
  }

  var step = 0
  var runtime: RuntimeLocation?
  var inferenceProvider: InferenceProvider?
  var inferenceModel = "deepseek-v4-flash"
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
