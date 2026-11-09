import CryptoKit
import Foundation
import Observation

struct PluginOption: Equatable, Identifiable, Sendable {
  let id: String
  let name: String
  let domain: String
  let description: String
  let category: String
  let popularity: Double
  let iconURL: URL?
  let homepageURL: URL?

  init(
    id: String,
    name: String,
    domain: String,
    description: String = "Connect this service to your Chief agents.",
    category: String = "Integration",
    popularity: Double = 0,
    iconURL: URL? = nil,
    homepageURL: URL? = nil
  ) {
    self.id = id
    self.name = name
    self.domain = domain
    self.description = description
    self.category = category
    self.popularity = popularity
    // Keep this identical to desktop's ProviderLogo: catalog-specific icon
    // values are deliberately ignored in favor of the canonical domain URL.
    self.iconURL = URL(string: "https://integrations.sh/logo/\(domain)")
    self.homepageURL = homepageURL ?? URL(string: "https://integrations.sh/\(domain)/")
  }

  static let preferred: [PluginOption] = [
    .init(id: "google-workspace", name: "Google Workspace", domain: "workspace.google.com"),
    .init(id: "granola", name: "Granola", domain: "granola.ai"),
    .init(id: "notion", name: "Notion", domain: "notion.com"),
    .init(id: "vercel", name: "Vercel", domain: "vercel.com"),
    .init(id: "posthog", name: "PostHog", domain: "posthog.com"),
    .init(id: "linear", name: "Linear", domain: "linear.app"),
    .init(id: "figma", name: "Figma", domain: "figma.com"),
    .init(id: "hubspot", name: "HubSpot", domain: "hubspot.com"),
    .init(id: "salesforce", name: "Salesforce", domain: "salesforce.com"),
    .init(id: "zoom", name: "Zoom", domain: "zoom.com"),
  ]
}

/// A plugin whose MCP server takes a key in a header instead of OAuth.
struct PluginAPIKeyRequirement: Equatable, Identifiable, Sendable {
  let plugin: PluginOption
  let endpoint: URL
  let header: PluginKeyHeader

  var id: String { plugin.id }
}

@MainActor
@Observable
final class PluginCatalogClient {
  static let shared = PluginCatalogClient()

  /// Kept in sync with the desktop onboarding priority list so the mobile
  /// step presents the same providers in the same order.
  static let priorityDomains: [String] = [
    "workspace.google.com",
    "granola.ai",
    "notion.com",
    "vercel.com",
    "pscale.dev",
    "posthog.com",
    "linear.app",
    "atlassian.com",
    "figma.com",
    "hubspot.com",
    "canva.com",
    "zoom.com",
    "asana.com",
    "airtable.com",
    "clickup.com",
    "monday.com",
    "intercom.com",
    "convex.dev",
    "box.com",
    "miro.com",
    "resend.com",
    "sentry.io",
    "supabase.com",
    "stripe.com",
    "clay.com",
    "apollo.io",
    "fireflies.ai",
    "webflow.com",
    "cloudflare.com",
    "calendly.com",
  ]

  /// The desktop onboarding resolves the same aliases before ranking so one
  /// provider never appears twice under a different domain.
  static let domainAliases: [String: String] = [
    "notion.so": "notion.com",
    "zoom.us": "zoom.com",
    "intercom.io": "intercom.com",
    "gmail.googleapis.com": "workspace.google.com",
  ]

  static let preferredLimit = 30

  /// The resolved onboarding list. Read synchronously so the Apps step never
  /// flickers between the short fallback and the full catalog.
  private(set) var cached: [PluginOption]?
  private var fullCatalog: [PluginOption]?

  private struct Envelope: Decodable { let data: [Entry] }
  private struct Entry: Decodable {
    let slug: String?
    let name: String?
    let domain: String?
    let popularity: Double?
    let icon: String?
    let kind: String?
    let description: String?
    let categories: [String]?
    let url: String?
  }

  /// Resolves the onboarding plugin list once and caches it. Call early (for
  /// example when onboarding starts) so the Apps step is already populated.
  func preferredPlugins(forceRefresh: Bool = false) async -> [PluginOption] {
    _ = await catalog(forceRefresh: forceRefresh)
    return cached ?? PluginOption.preferred
  }

  /// The full integrations.sh MCP catalog. Recommendation cards and Add must
  /// look plugins up here — the onboarding list is only a ranked prefix.
  func catalog(forceRefresh: Bool = false) async -> [PluginOption] {
    if let fullCatalog, !forceRefresh { return fullCatalog }
    let parsed = await fetchRemoteCatalog()
    let resolved = parsed.isEmpty ? PluginOption.preferred : parsed
    fullCatalog = resolved
    cached = Array(Self.ranked(resolved).prefix(Self.preferredLimit))
    return resolved
  }

  func plugin(
    id: String,
    name: String? = nil,
    domain: String? = nil,
    description: String? = nil,
    forceRefresh: Bool = false
  ) async -> PluginOption? {
    Self.resolve(
      id: id,
      catalog: await catalog(forceRefresh: forceRefresh),
      name: name,
      domain: domain,
      description: description
    )
  }

  /// Finds a catalog plugin by id, then falls back to the card payload so a
  /// recommended plugin still connects when it sits outside the preferred 30.
  static func resolve(
    id: String,
    catalog: [PluginOption],
    name: String? = nil,
    domain: String? = nil,
    description: String? = nil
  ) -> PluginOption? {
    if let match = catalog.first(where: { $0.id == id }) { return match }
    let trimmedDomain = domain?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard trimmedDomain.contains(".") else { return nil }
    let trimmedName = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let trimmedDescription =
      description?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return PluginOption(
      id: id,
      name: trimmedName.isEmpty ? id : trimmedName,
      domain: trimmedDomain,
      description: trimmedDescription.isEmpty
        ? "Connect this service to your Chief agents."
        : trimmedDescription
    )
  }

  private func fetchRemoteCatalog() async -> [PluginOption] {
    guard let url = URL(string: "https://integrations.sh/api.json"),
      let (data, response) = try? await URLSession.shared.data(from: url),
      (response as? HTTPURLResponse)?.statusCode == 200,
      let envelope = try? JSONDecoder().decode(Envelope.self, from: data)
    else {
      return []
    }

    return envelope.data.compactMap { (entry) -> PluginOption? in
      guard entry.kind == "mcp",
        let name = entry.name?.trimmingCharacters(in: .whitespacesAndNewlines),
        !name.isEmpty,
        let domain = entry.domain?.trimmingCharacters(in: .whitespacesAndNewlines),
        domain.contains("."),
        // GitHub is a project provider, connected as a Git repository.
        domain != "github.com",
        let slug = entry.slug, !slug.isEmpty
      else { return nil }
      return PluginOption(
        id: slug,
        name: name,
        domain: domain,
        description: entry.description?.trimmingCharacters(in: .whitespacesAndNewlines)
          ?? "Connect \(name) to your Chief agents.",
        category: entry.categories?.first ?? "Integration",
        popularity: entry.popularity ?? 0,
        iconURL: entry.icon.flatMap(URL.init(string:)),
        homepageURL: entry.url.flatMap(URL.init(string:))
      )
    }
  }

  /// The remote MCP server a catalog plugin publishes and how it signs in.
  /// Desktop's `catalogSurface`, reading the same integrations.sh document as
  /// `parseMcpSurfaceFromDocument`.
  func surface(for plugin: PluginOption) async throws -> PluginSurface {
    guard let surfaceURL = URL(string: "https://integrations.sh/api/\(plugin.domain)/surface"),
      let (data, response) = try? await URLSession.shared.data(from: surfaceURL),
      let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
      let document = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw PluginConnectError("Could not find \(plugin.name)’s MCP server.") }
    guard
      let surface = (document["surfaces"] as? [[String: Any]])?.first(where: {
        $0["type"] as? String == "mcp" && $0["url"] is String
      }),
      let endpoint = (surface["url"] as? String).flatMap(URL.init(string:)),
      endpoint.scheme?.lowercased() == "https"
    else { throw PluginConnectError("\(plugin.name) doesn’t publish a secure MCP server yet.") }
    let auth = surface["auth"] as? [String: Any]
    if auth?["status"] as? String == "none" { return PluginSurface(endpoint: endpoint, auth: .none) }
    let uses = (auth?["entries"] as? [[String: Any]] ?? []).flatMap { entry in
      let evidence = (entry["basis"] as? [String: Any])?["evidence"] as? [Any] ?? []
      return (entry["use"] as? [[String: Any]] ?? []).map { use in
        (
          id: use["id"] as? String,
          mechanics: use["mechanics"] as? [String: Any] ?? [:],
          evidence: evidence.compactMap { $0 as? String }
        )
      }
    }
    // Servers that publish OAuth metadata sign in through it; a header-only
    // server needs a key the person pastes.
    let sources = uses.map { $0.mechanics["source"] as? String }
    if sources.isEmpty || sources.contains("well-known") || !sources.contains("http") {
      return PluginSurface(endpoint: endpoint, auth: .oauth)
    }
    // Alternatives for the same key are listed side by side; prefer the
    // standard Bearer header when a server takes either.
    let candidates = uses.compactMap { use -> PluginKeyHeader? in
      let mechanics = use.mechanics
      guard mechanics["source"] as? String == "http", mechanics["in"] as? String == "header"
      else { return nil }
      let scheme = mechanics["scheme"] as? String
      guard scheme == nil || scheme == "Bearer",
        let headerName = mechanics["headerName"] as? String
          ?? (scheme == "Bearer" ? "Authorization" : nil)
      else { return nil }
      return PluginKeyHeader(
        name: headerName,
        scheme: scheme,
        label: Self.keyLabel(use.id),
        docsURL: use.evidence.first { $0.hasPrefix("https://") }.flatMap(URL.init(string:))
          ?? plugin.homepageURL
      )
    }
    guard let header = candidates.first(where: { $0.scheme == "Bearer" }) ?? candidates.first
    else {
      throw PluginConnectError(
        "\(plugin.name) needs an API key. Add it with Add MCP server on desktop.")
    }
    return PluginSurface(
      endpoint: endpoint,
      auth: .key(PluginAPIKeyRequirement(plugin: plugin, endpoint: endpoint, header: header))
    )
  }

  /// The header a connection's key goes in: the catalog's when it knows the
  /// plugin, else the header the connection already sends.
  func keyHeader(for connection: WorkspacePluginConnection) async -> PluginKeyHeader? {
    if let catalogID = connection.catalogId,
      let plugin = await plugin(id: catalogID, name: connection.name, domain: connection.domain),
      case .key(let requirement) = try? await surface(for: plugin).auth
    {
      return requirement.header
    }
    guard let name = connection.auth?.headerNames?.first else { return nil }
    return PluginKeyHeader(
      name: name,
      scheme: name.caseInsensitiveCompare("Authorization") == .orderedSame ? "Bearer" : nil,
      label: "API key",
      docsURL: connection.domain.flatMap { URL(string: "https://integrations.sh/\($0)/") }
    )
  }

  /// Adds a catalog plugin to the workspace. Desktop's `addCatalogPlugin`.
  func create(
    _ plugin: PluginOption,
    endpoint: URL,
    auth: JSONValue,
    workspaceID: String,
    relay: any RelayServing
  ) async throws -> WorkspacePluginConnection {
    var input: [String: JSONValue] = [
      "id": .string(Self.connectionID(plugin.id)),
      "name": .string(String(plugin.name.prefix(80))),
      "description": .string(String(plugin.description.prefix(1_000))),
      "url": .string(endpoint.absoluteString),
      "domain": .string(plugin.domain),
      "catalogId": .string(plugin.id),
      "auth": auth,
    ]
    if let iconURL = plugin.iconURL { input["iconUrl"] = .string(iconURL.absoluteString) }
    return try await relay.createPluginConnection(workspaceID: workspaceID, input: input)
  }

  /// Adds a key-only plugin to the workspace, keeping it only if the server
  /// accepts the key. The relay seals the key; members only see the header name.
  func connect(
    _ requirement: PluginAPIKeyRequirement,
    key: String,
    workspaceID: String,
    relay: any RelayServing
  ) async throws {
    let plugin = requirement.plugin
    let connection = try await create(
      plugin,
      endpoint: requirement.endpoint,
      auth: .object([
        "kind": .string("headers"),
        "headers": .array([requirement.header.json(key: key)]),
      ]),
      workspaceID: workspaceID,
      relay: relay
    )
    let accepted: Bool
    do {
      if case .connected(let checked) = try await relay.authorizePluginConnection(
        workspaceID: workspaceID, connectionID: connection.id)
      {
        accepted = checked.isConnected
      } else {
        accepted = false
      }
    } catch {
      try? await relay.deletePluginConnection(workspaceID: workspaceID, connectionID: connection.id)
      throw error
    }
    guard accepted else {
      try? await relay.deletePluginConnection(workspaceID: workspaceID, connectionID: connection.id)
      throw PluginConnectError("\(plugin.name) rejected this key.")
    }
  }

  /// Desktop's `connectionIdFor`.
  static func connectionID(_ slug: String) -> String {
    let dashed = slug.lowercased()
      .replacingOccurrences(of: "[^a-z0-9-]+", with: "-", options: .regularExpression)
      .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    return String(dashed.prefix(64)).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
  }

  private static let keyLabels: [(String, String)] = [
    (#"(^| )(pat|personal (access )?token)$"#, "personal access token"),
    (#"api ?token$"#, "API token"),
    (#"access token$"#, "access token"),
    (#"secret key$"#, "secret key"),
    (#"access key$"#, "access key"),
    (#"token$"#, "API token"),
  ]

  /// "browser_use_api_key" reads as "API key".
  static func keyLabel(_ id: String?) -> String {
    let words = (id ?? "").lowercased()
      .replacingOccurrences(of: "[^a-z0-9]+", with: " ", options: .regularExpression)
      .trimmingCharacters(in: .whitespaces)
    return keyLabels.first { words.range(of: $0.0, options: .regularExpression) != nil }?.1
      ?? "API key"
  }

  /// One option per canonical provider, keeping the preferred order first,
  /// then featured providers, then alphabetical. Shared with tests.
  static func ranked(_ options: [PluginOption]) -> [PluginOption] {
    var byCanonicalDomain: [String: PluginOption] = [:]
    for option in options {
      let canonical = domainAliases[option.domain] ?? option.domain
      let candidate = PluginOption(
        id: option.id,
        name: option.name,
        domain: canonical,
        description: option.description,
        category: option.category,
        popularity: option.popularity,
        iconURL: option.iconURL,
        homepageURL: option.homepageURL
      )
      if byCanonicalDomain[canonical] == nil {
        byCanonicalDomain[canonical] = candidate
      }
    }
    return byCanonicalDomain.values.sorted { left, right in
      let leftPriority = priorityDomains.firstIndex(of: left.domain) ?? Int.max
      let rightPriority = priorityDomains.firstIndex(of: right.domain) ?? Int.max
      if leftPriority != rightPriority { return leftPriority < rightPriority }
      let leftFeatured = left.popularity > 10_000
      let rightFeatured = right.popularity > 10_000
      if leftFeatured != rightFeatured { return leftFeatured }
      return left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending
    }
  }
}

extension RelayServing {
  func createPluginConnection(
    workspaceID: String, input: [String: JSONValue]
  ) async throws -> WorkspacePluginConnection {
    throw RelayError.unavailable
  }

  func authorizePluginConnection(
    workspaceID: String, connectionID: String
  ) async throws -> PluginAuthorization {
    throw RelayError.unavailable
  }

  func configurePluginClient(
    workspaceID: String, connectionID: String, clientID: String, clientSecret: String?
  ) async throws -> PluginAuthorization {
    throw RelayError.unavailable
  }

  func replacePluginHeaders(
    workspaceID: String, connectionID: String, headers: [PluginHeader]
  ) async throws -> WorkspacePluginConnection {
    throw RelayError.unavailable
  }

  func deletePluginConnection(workspaceID: String, connectionID: String) async throws {
    throw RelayError.unavailable
  }

  func callPluginTool(
    workspaceID: String, connectionID: String, name: String, arguments: JSONValue,
    signingIdentity: NostrIdentity
  ) async throws -> PluginToolCallResult {
    throw RelayError.unavailable
  }

  func pluginOAuthCallbackURL() async -> URL? { nil }
}

extension URLSessionRelayClient {
  private func pluginPath(_ workspaceID: String, _ connectionID: String, _ action: String? = nil)
    -> String
  {
    let id = connectionID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? connectionID
    return "/v1/workspaces/\(workspaceID)/plugins/\(id)" + (action.map { "/\($0)" } ?? "")
  }

  func createPluginConnection(
    workspaceID: String, input: [String: JSONValue]
  ) async throws -> WorkspacePluginConnection {
    try await request(
      path: "/v1/workspaces/\(workspaceID)/plugins", method: "POST",
      body: try JSONEncoder().encode(input))
  }

  /// Starts signing in. A plugin without OAuth lists its tools instead, which
  /// checks its key.
  func authorizePluginConnection(
    workspaceID: String, connectionID: String
  ) async throws -> PluginAuthorization {
    try await request(
      path: pluginPath(workspaceID, connectionID, "authorize"), method: "POST",
      body: Data("{}".utf8))
  }

  /// Stores an OAuth app the person registered with the provider, then
  /// starts signing in with it.
  func configurePluginClient(
    workspaceID: String, connectionID: String, clientID: String, clientSecret: String?
  ) async throws -> PluginAuthorization {
    var body = ["clientId": clientID]
    if let clientSecret { body["clientSecret"] = clientSecret }
    return try await request(
      path: pluginPath(workspaceID, connectionID, "client"), method: "POST",
      body: try JSONEncoder().encode(body))
  }

  /// Replaces a key. The relay keeps the old one if the server rejects it.
  func replacePluginHeaders(
    workspaceID: String, connectionID: String, headers: [PluginHeader]
  ) async throws -> WorkspacePluginConnection {
    struct Body: Encodable { let headers: [PluginHeader] }
    return try await request(
      path: pluginPath(workspaceID, connectionID, "headers"), method: "POST",
      body: try JSONEncoder().encode(Body(headers: headers)))
  }

  func deletePluginConnection(workspaceID: String, connectionID: String) async throws {
    let _: JSONValue = try await request(
      path: pluginPath(workspaceID, connectionID), method: "DELETE")
  }

  /// Calls a plugin tool as the agent. The relay checks the plugin is still
  /// assigned to it and connected; the phone never holds its credentials.
  func callPluginTool(
    workspaceID: String, connectionID: String, name: String, arguments: JSONValue,
    signingIdentity: NostrIdentity
  ) async throws -> PluginToolCallResult {
    try await request(
      path: pluginPath(workspaceID, connectionID, "tools/call"), method: "POST",
      body: try JSONEncoder().encode(["name": JSONValue.string(name), "arguments": arguments]),
      signer: signingIdentity)
  }
}

/// A plugin's MCP server and how it signs in.
struct PluginSurface: Sendable {
  enum Auth: Sendable {
    case none
    case oauth
    case key(PluginAPIKeyRequirement)
  }

  let endpoint: URL
  let auth: Auth
}

/// Where a key goes. Desktop's `McpSurfaceApiKey`.
struct PluginKeyHeader: Equatable, Sendable {
  let name: String
  let scheme: String?
  /// What the provider calls the key, e.g. "API key".
  let label: String
  let docsURL: URL?

  func header(key: String) -> PluginHeader {
    PluginHeader(name: name, value: scheme.map { "\($0) \(key)" } ?? key)
  }

  func json(key: String) -> JSONValue {
    let header = header(key: key)
    return .object(["name": .string(header.name), "value": .string(header.value)])
  }
}

struct PluginHeader: Encodable, Sendable {
  let name: String
  let value: String
}

/// The relay's answer to authorize (`mcpConnectionAuthorizeResultSchema`).
enum PluginAuthorization: Decodable, Sendable {
  case connected(WorkspacePluginConnection)
  /// A one-time relay page that confirms, then sends the person to the provider.
  case signIn(URL)
  /// The provider needs an OAuth app the person registers by hand.
  case clientRequired

  private enum CodingKeys: String, CodingKey { case status, connection, startUrl }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(String.self, forKey: .status) {
    case "connected":
      self = .connected(try container.decode(WorkspacePluginConnection.self, forKey: .connection))
    case "authorize":
      let raw = try container.decode(String.self, forKey: .startUrl)
      guard let url = URL(string: raw), url.scheme?.lowercased() == "https" else {
        throw DecodingError.dataCorruptedError(
          forKey: .startUrl, in: container, debugDescription: "Sign-in links must use https.")
      }
      self = .signIn(url)
    default:
      self = .clientRequired
    }
  }
}

/// `mcpToolCallResultSchema`.
struct PluginToolCallResult: Decodable, Sendable {
  let isError: Bool
  let content: JSONValue
  let truncated: Bool
}

struct PluginConnectError: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

/// The workspace's plugin connections keyed by catalog plugin, for the agent
/// tools below. Plugins are workspace connections held by the relay.
private func workspacePluginConnections(
  _ context: ToolContext
) async -> [String: WorkspacePluginConnection] {
  let connections =
    (try? await context.relay.pluginConnections(workspaceID: context.workspaceID)) ?? []
  return Dictionary(connections.map { ($0.pluginKey, $0) }, uniquingKeysWith: { first, _ in first })
}

struct PluginsListTool: RelayTool {
  static let name = "plugins_list"
  static let description =
    "Search the plugin catalog and see which plugins this workspace has connected."
  static let parameters: [RelayToolParameter] = [
    .init(
      name: "refresh",
      kind: .boolean,
      description: "Refresh the catalog before listing plugins.",
      required: false
    )
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let options = await PluginCatalogClient.shared.catalog(
      forceRefresh: (arguments["refresh"] as? Bool) == true
    )
    let connections = await workspacePluginConnections(context)
    let plugins = options.map { pluginResult($0, connection: connections[$0.id]) }
    return toolResultJSON(["plugins": plugins])
  }
}

struct PluginsRecommendTool: RelayTool {
  static let name = "plugins_recommend"
  static let description =
    "Present real clickable plugin cards in a relay conversation. Use this whenever the user asks to see, choose, connect, or install plugins."
  static let parameters: [RelayToolParameter] = [
    .init(name: "conversationId", kind: .string, description: "The conversation for the cards."),
    .init(
      name: "threadRootId", kind: .string, description: "Optional thread root.", required: false),
    .init(name: "pluginIds", kind: .stringArray, description: "One to eight catalog plugin ids."),
    .init(
      name: "rationale", kind: .string, description: "Short recommendation text.", required: false),
    .init(
      name: "idempotencyKey", kind: .string, description: "Stable key for this recommendation."),
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let conversationID = try arguments.requiredString("conversationId")
    let threadRootID = arguments.optionalString("threadRootId")
    let idempotencyKey = try arguments.requiredString("idempotencyKey")
    guard let pluginIDs = arguments["pluginIds"] as? [String],
      !pluginIDs.isEmpty, pluginIDs.count <= 8
    else { throw ToolError.invalidArgument("pluginIds") }
    let catalog = await PluginCatalogClient.shared.catalog()
    let selected = pluginIDs.compactMap { id in catalog.first { $0.id == id } }
    guard selected.count == Set(pluginIDs).count else {
      throw ToolError.invalidArgument("unknown pluginIds")
    }
    let connections = await workspacePluginConnections(context)
    let components = selected.map { option in
      var payload = recommendationPayload(
        option,
        context: context,
        conversationID: conversationID,
        threadRootID: threadRootID,
        connection: connections[option.id]
      )
      if let rationale = arguments.optionalString("rationale") {
        payload["rationale"] = rationale
      }
      return MessageComponent(
        id: deterministicPluginComponentID(
          "\(context.workspaceID):\(context.agentID):\(idempotencyKey):\(option.id)"
        ),
        kind: "plugin.recommendation",
        payload: payload
      )
    }
    let message = try await context.relay.sendAsAgent(
      body: arguments.optionalString("rationale") ?? "Here are the plugins I recommend.",
      workspaceID: context.workspaceID,
      conversationID: conversationID,
      threadRootID: threadRootID,
      mentions: [],
      components: components,
      signingIdentity: context.identity
    )
    return toolResultJSON(["messageId": message.id, "pluginIds": pluginIDs])
  }
}

/// Plugins are added by a person: the card's Add signs in on their device.
struct PluginsInstallTool: RelayTool {
  static let name = "plugins_install"
  static let description =
    "Check whether a catalog plugin is added to this workspace after explicit user approval."
  static let parameters: [RelayToolParameter] = [
    .init(name: "pluginId", kind: .string, description: "Catalog plugin id."),
    .init(name: "trusted", kind: .boolean, description: "Whether the user approved the plugin."),
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let pluginID = try arguments.requiredString("pluginId")
    guard (arguments["trusted"] as? Bool) == true else {
      throw ToolError.permissionDenied("plugin installation approval")
    }
    let catalog = await PluginCatalogClient.shared.catalog()
    guard let option = catalog.first(where: { $0.id == pluginID }) else {
      throw ToolError.invalidArgument("pluginId")
    }
    let connection = await workspacePluginConnections(context)[pluginID]
    return toolResultJSON([
      "plugin": pluginResult(option, connection: connection),
      "instruction": connection?.isConnected == true
        ? "The plugin is connected to this workspace."
        : "Call plugins_recommend so the user can press Add on the plugin card and sign in.",
    ])
  }
}

struct PluginsAuthorizeTool: RelayTool {
  static let name = "plugins_authorize"
  static let description =
    "Check whether a workspace plugin is connected."
  static let parameters: [RelayToolParameter] = [
    .init(name: "pluginId", kind: .string, description: "Catalog plugin id."),
    .init(
      name: "conversationId", kind: .string, description: "Conversation for authorization status."),
    .init(
      name: "threadRootId", kind: .string, description: "Optional thread root.", required: false),
    .init(name: "idempotencyKey", kind: .string, description: "Stable authorization key."),
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let pluginID = try arguments.requiredString("pluginId")
    let connection = await workspacePluginConnections(context)[pluginID]
    return toolResultJSON([
      "pluginId": pluginID,
      "status": pluginStatus(connection),
      "instruction": connection?.isConnected == true
        ? "The plugin is connected. Its tools are available once it is assigned to you."
        : "Ask the user to press Add on the plugin card to sign in.",
    ])
  }
}

struct PluginsUninstallTool: RelayTool {
  static let name = "plugins_uninstall"
  static let description = "Explain how to remove a workspace plugin."
  static let parameters: [RelayToolParameter] = [
    .init(name: "pluginId", kind: .string, description: "Catalog plugin id.")
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let pluginID = try arguments.requiredString("pluginId")
    return toolResultJSON([
      "pluginId": pluginID,
      "status": pluginStatus(await workspacePluginConnections(context)[pluginID]),
      "instruction": "A workspace admin removes plugins from the Plugins page.",
    ])
  }
}

/// Desktop's `connectionStatus`.
private func pluginStatus(_ connection: WorkspacePluginConnection?) -> String {
  switch connection?.status {
  case nil: "available"
  case "connected": "connected"
  case "error": "failed"
  default: "authorization_required"
  }
}

private func pluginResult(
  _ option: PluginOption,
  connection: WorkspacePluginConnection?
) -> [String: Any] {
  var result: [String: Any] = [
    "id": option.id,
    "name": option.name,
    "description": option.description,
    "category": option.category,
    "domain": option.domain,
    "status": pluginStatus(connection),
    "enabled": connection != nil,
  ]
  if let iconURL = option.iconURL { result["iconUrl"] = iconURL.absoluteString }
  return result
}

private func recommendationPayload(
  _ option: PluginOption,
  context: ToolContext,
  conversationID: String,
  threadRootID: String?,
  connection: WorkspacePluginConnection?
) -> [String: String] {
  var payload = [
    "workspaceId": context.workspaceID,
    "conversationId": conversationID,
    "agentId": context.agentID,
    "pluginId": option.id,
    "name": option.name,
    "description": option.description,
    "category": option.category,
    "sourceType": "discovery",
    "status": pluginStatus(connection),
    "enabled": connection == nil ? "false" : "true",
    "trusted": connection == nil ? "false" : "true",
    "domain": option.domain,
  ]
  if let threadRootID { payload["threadRootId"] = threadRootID }
  if let iconURL = option.iconURL { payload["iconUrl"] = iconURL.absoluteString }
  return payload
}

private func deterministicPluginComponentID(_ value: String) -> String {
  let bytes = Array(SHA256.hash(data: Data(value.utf8)).prefix(16))
  let hex = bytes.map { String(format: "%02x", $0) }.joined()
  return
    "\(hex.prefix(8))-\(hex.dropFirst(8).prefix(4))-5\(hex.dropFirst(13).prefix(3))-a\(hex.dropFirst(17).prefix(3))-\(hex.dropFirst(20).prefix(12))"
}
