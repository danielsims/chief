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
    .init(id: "slack", name: "Slack", domain: "slack.com"),
    .init(id: "granola", name: "Granola", domain: "granola.ai"),
    .init(id: "notion", name: "Notion", domain: "notion.com"),
    .init(
      id: "github",
      name: "GitHub",
      domain: "github.com",
      description: "Work with repositories, issues, pull requests, and code on GitHub."
    ),
    .init(id: "vercel", name: "Vercel", domain: "vercel.com"),
    .init(id: "posthog", name: "PostHog", domain: "posthog.com"),
    .init(id: "linear", name: "Linear", domain: "linear.app"),
    .init(id: "figma", name: "Figma", domain: "figma.com"),
    .init(id: "hubspot", name: "HubSpot", domain: "hubspot.com"),
    .init(id: "salesforce", name: "Salesforce", domain: "salesforce.com"),
    .init(id: "zoom", name: "Zoom", domain: "zoom.com"),
  ]
}

struct PluginRemoteServer: Equatable, Sendable {
  let name: String
  let endpoint: URL
}

@MainActor
@Observable
final class PluginCatalogClient {
  static let shared = PluginCatalogClient()

  /// Kept in sync with the desktop onboarding priority list so the mobile
  /// step presents the same providers in the same order.
  static let priorityDomains: [String] = [
    "workspace.google.com",
    "slack.com",
    "granola.ai",
    "notion.com",
    "github.com",
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

  /// The resolved onboarding list. Read synchronously so the Apps step never
  /// flickers between the short fallback and the full catalog.
  private(set) var cached: [PluginOption]?

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
    if let cached, !forceRefresh { return cached }
    guard let url = URL(string: "https://integrations.sh/api.json"),
      let (data, response) = try? await URLSession.shared.data(from: url),
      (response as? HTTPURLResponse)?.statusCode == 200,
      let envelope = try? JSONDecoder().decode(Envelope.self, from: data)
    else {
      cached = PluginOption.preferred
      return PluginOption.preferred
    }

    let parsed = envelope.data.compactMap { (entry) -> PluginOption? in
      guard entry.kind == "mcp",
        let name = entry.name?.trimmingCharacters(in: .whitespacesAndNewlines),
        !name.isEmpty,
        let domain = entry.domain?.trimmingCharacters(in: .whitespacesAndNewlines),
        domain.contains("."),
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
    let resolved = parsed.isEmpty ? PluginOption.preferred : Array(Self.ranked(parsed).prefix(30))
    cached = resolved
    return resolved
  }

  func installedPluginIDs(workspaceID: String) async -> Set<String> {
    await MobilePluginStore.shared.connectedPluginIDs(workspaceID: workspaceID)
  }

  func install(
    _ plugin: PluginOption,
    workspaceID: String,
    presenter: PluginAuthorizationPresenter
  ) async throws {
    await MobilePluginStore.shared.install(
      workspaceID: workspaceID,
      pluginID: plugin.id,
      trusted: true
    )
    let endpoints = try await MobilePluginRuntime.shared.connect(
      plugin: plugin,
      workspaceID: workspaceID,
      presenter: presenter
    )
    await MobilePluginStore.shared.markConnected(
      workspaceID: workspaceID,
      pluginID: plugin.id,
      serverEndpoints: endpoints
    )
  }

  func remoteMCPServers(for plugin: PluginOption) async throws -> [PluginRemoteServer] {
    if plugin.id == "google-workspace" {
      return [
        PluginRemoteServer(
          name: "gmail",
          endpoint: URL(string: "https://gmail.googleapis.com/mcp/")!
        ),
        PluginRemoteServer(
          name: "drive",
          endpoint: URL(string: "https://file.googleapis.com/mcp")!
        ),
      ]
    }
    if plugin.id == "github" {
      return [
        PluginRemoteServer(
          name: "github",
          endpoint: URL(string: "https://api.githubcopilot.com/mcp/")!
        )
      ]
    }
    struct Surface: Decodable {
      struct Entry: Decodable {
        let type: String
        let name: String?
        let url: URL?
        let transports: [String]?
      }
      let surfaces: [Entry]
    }

    guard let surfaceURL = URL(string: "https://integrations.sh/api/\(plugin.domain)/surface")
    else { throw MobilePluginRuntimeError.noRemoteServer(plugin.name) }
    let (data, response) = try await URLSession.shared.data(from: surfaceURL)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
      let surface = try? JSONDecoder().decode(Surface.self, from: data)
    else { throw MobilePluginRuntimeError.noRemoteServer(plugin.name) }
    let remote = surface.surfaces.filter {
      $0.type == "mcp" && $0.url?.scheme?.lowercased() == "https"
    }
    let streamable = remote.filter { $0.transports?.contains("streamable-http") == true }
    let selected = streamable.isEmpty ? remote : streamable
    var seen = Set<URL>()
    let servers = selected.compactMap { entry -> PluginRemoteServer? in
      guard let endpoint = entry.url, seen.insert(endpoint).inserted else { return nil }
      let fallback = endpoint.host?.split(separator: ".").first.map(String.init) ?? plugin.id
      return PluginRemoteServer(name: entry.name ?? fallback, endpoint: endpoint)
    }
    guard !servers.isEmpty else { throw MobilePluginRuntimeError.noRemoteServer(plugin.name) }
    return servers
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

struct MobilePluginInstallation: Codable, Sendable {
  let trusted: Bool
  let installedAt: Date
  var endpointURL: URL?
  var serverEndpoints: [String: URL]?
  var connectedAt: Date?
}

actor MobilePluginStore {
  static let shared = MobilePluginStore()
  private let defaultsKey = "chief.mobile.plugins.v1"
  private var values: [String: [String: MobilePluginInstallation]]

  init() {
    if let data = UserDefaults.standard.data(forKey: defaultsKey),
      let decoded = try? JSONDecoder().decode(
        [String: [String: MobilePluginInstallation]].self,
        from: data
      )
    {
      values = decoded
    } else {
      values = [:]
    }
  }

  func installation(workspaceID: String, pluginID: String) -> MobilePluginInstallation? {
    values[workspaceID]?[pluginID]
  }

  func install(workspaceID: String, pluginID: String, trusted: Bool) {
    let existing = values[workspaceID]?[pluginID]
    values[workspaceID, default: [:]][pluginID] = MobilePluginInstallation(
      trusted: trusted,
      installedAt: existing?.installedAt ?? .now,
      endpointURL: existing?.endpointURL,
      serverEndpoints: existing?.serverEndpoints,
      connectedAt: existing?.connectedAt
    )
    persist()
  }

  func markConnected(
    workspaceID: String,
    pluginID: String,
    serverEndpoints: [String: URL]
  ) {
    guard var installation = values[workspaceID]?[pluginID] else { return }
    installation.endpointURL = serverEndpoints.values.first
    installation.serverEndpoints = serverEndpoints
    installation.connectedAt = .now
    values[workspaceID]?[pluginID] = installation
    persist()
  }

  func uninstall(workspaceID: String, pluginID: String) {
    values[workspaceID]?[pluginID] = nil
    persist()
  }

  func connectedPluginIDs(workspaceID: String) -> Set<String> {
    Set(values[workspaceID]?.filter { $0.value.connectedAt != nil }.map(\.key) ?? [])
  }

  func installations(workspaceID: String) -> [String: MobilePluginInstallation] {
    values[workspaceID] ?? [:]
  }

  private func persist() {
    guard let data = try? JSONEncoder().encode(values) else { return }
    UserDefaults.standard.set(data, forKey: defaultsKey)
  }
}

struct PluginsListTool: RelayTool {
  static let name = "plugins_list"
  static let description =
    "Search the portable plugin catalog available to this on-device celld agent."
  static let parameters: [RelayToolParameter] = [
    .init(
      name: "refresh",
      kind: .boolean,
      description: "Refresh the catalog before listing plugins.",
      required: false
    )
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let options = await PluginCatalogClient.shared.preferredPlugins(
      forceRefresh: (arguments["refresh"] as? Bool) == true
    )
    var plugins: [[String: Any]] = []
    for option in options {
      let installation = await MobilePluginStore.shared.installation(
        workspaceID: context.workspaceID,
        pluginID: option.id
      )
      plugins.append(pluginResult(option, installation: installation))
    }
    return toolResultJSON(["plugins": plugins, "runtime": "celld-ios"])
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
    let catalog = await PluginCatalogClient.shared.preferredPlugins()
    let selected = pluginIDs.compactMap { id in catalog.first { $0.id == id } }
    guard selected.count == Set(pluginIDs).count else {
      throw ToolError.invalidArgument("unknown pluginIds")
    }
    var components: [MessageComponent] = []
    for option in selected {
      let installation = await MobilePluginStore.shared.installation(
        workspaceID: context.workspaceID,
        pluginID: option.id
      )
      var payload = recommendationPayload(
        option,
        context: context,
        conversationID: conversationID,
        threadRootID: threadRootID,
        installation: installation
      )
      if let rationale = arguments.optionalString("rationale") {
        payload["rationale"] = rationale
      }
      components.append(
        MessageComponent(
          id: deterministicPluginComponentID(
            "\(context.workspaceID):\(context.agentID):\(idempotencyKey):\(option.id)"
          ),
          kind: "plugin.recommendation",
          payload: payload
        )
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

struct PluginsInstallTool: RelayTool {
  static let name = "plugins_install"
  static let description =
    "Install a portable catalog plugin into this celld host after explicit user approval."
  static let parameters: [RelayToolParameter] = [
    .init(name: "pluginId", kind: .string, description: "Catalog plugin id."),
    .init(name: "trusted", kind: .boolean, description: "Whether the user approved the plugin."),
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let pluginID = try arguments.requiredString("pluginId")
    let trusted = (arguments["trusted"] as? Bool) == true
    guard trusted else { throw ToolError.permissionDenied("plugin installation approval") }
    let catalog = await PluginCatalogClient.shared.preferredPlugins()
    guard let option = catalog.first(where: { $0.id == pluginID }) else {
      throw ToolError.invalidArgument("pluginId")
    }
    await MobilePluginStore.shared.install(
      workspaceID: context.workspaceID,
      pluginID: pluginID,
      trusted: true
    )
    return toolResultJSON([
      "plugin": pluginResult(
        option,
        installation: MobilePluginInstallation(
          trusted: true,
          installedAt: .now,
          endpointURL: nil,
          serverEndpoints: nil,
          connectedAt: nil
        )
      ),
      "instruction": "The plugin is installed. Call plugins_authorize to connect its provider.",
    ])
  }
}

struct PluginsAuthorizeTool: RelayTool {
  static let name = "plugins_authorize"
  static let description =
    "Check authorization readiness for an installed portable plugin."
  static let parameters: [RelayToolParameter] = [
    .init(name: "pluginId", kind: .string, description: "Installed plugin id."),
    .init(
      name: "conversationId", kind: .string, description: "Conversation for authorization status."),
    .init(
      name: "threadRootId", kind: .string, description: "Optional thread root.", required: false),
    .init(name: "idempotencyKey", kind: .string, description: "Stable authorization key."),
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let pluginID = try arguments.requiredString("pluginId")
    guard
      let installation = await MobilePluginStore.shared.installation(
        workspaceID: context.workspaceID,
        pluginID: pluginID
      )
    else { throw ToolError.invalidArgument("pluginId is not installed") }
    return toolResultJSON([
      "pluginId": pluginID,
      "status": installation.connectedAt == nil ? "authorization_required" : "connected",
      "instruction": installation.connectedAt == nil
        ? "Ask the user to press Add on the plugin card to complete provider sign in."
        : "The provider is connected and its MCP tools are available to this celld agent.",
    ])
  }
}

struct PluginsUninstallTool: RelayTool {
  static let name = "plugins_uninstall"
  static let description = "Remove an installed plugin from this on-device celld host."
  static let parameters: [RelayToolParameter] = [
    .init(name: "pluginId", kind: .string, description: "Installed plugin id.")
  ]

  func run(arguments: [String: Any], context: ToolContext) async throws -> String {
    let pluginID = try arguments.requiredString("pluginId")
    await MobilePluginRuntime.shared.disconnect(
      workspaceID: context.workspaceID,
      pluginID: pluginID
    )
    await MobilePluginStore.shared.uninstall(
      workspaceID: context.workspaceID,
      pluginID: pluginID
    )
    return toolResultJSON(["pluginId": pluginID, "status": "uninstalled"])
  }
}

private func pluginResult(
  _ option: PluginOption,
  installation: MobilePluginInstallation?
) -> [String: Any] {
  var result: [String: Any] = [
    "id": option.id,
    "name": option.name,
    "description": option.description,
    "category": option.category,
    "domain": option.domain,
    "status": installation == nil
      ? "available" : (installation?.connectedAt == nil ? "authorization_required" : "connected"),
    "enabled": installation != nil,
    "trusted": installation?.trusted ?? false,
  ]
  if let iconURL = option.iconURL { result["iconUrl"] = iconURL.absoluteString }
  return result
}

private func recommendationPayload(
  _ option: PluginOption,
  context: ToolContext,
  conversationID: String,
  threadRootID: String?,
  installation: MobilePluginInstallation?
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
    "status": installation == nil
      ? "available" : (installation?.connectedAt == nil ? "authorization_required" : "connected"),
    "enabled": installation == nil ? "false" : "true",
    "trusted": installation?.trusted == true ? "true" : "false",
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
