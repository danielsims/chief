import Foundation
import Observation

struct PluginOption: Equatable, Identifiable, Sendable {
  let id: String
  let name: String
  let domain: String
  let popularity: Double
  let iconURL: URL?

  init(
    id: String,
    name: String,
    domain: String,
    popularity: Double = 0,
    iconURL: URL? = nil
  ) {
    self.id = id
    self.name = name
    self.domain = domain
    self.popularity = popularity
    self.iconURL = iconURL ?? URL(string: "https://integrations.sh/logo/\(domain)")
  }

  static let preferred: [PluginOption] = [
    .init(id: "google-workspace", name: "Google Workspace", domain: "workspace.google.com"),
    .init(id: "slack", name: "Slack", domain: "slack.com"),
    .init(id: "granola", name: "Granola", domain: "granola.ai"),
    .init(id: "notion", name: "Notion", domain: "notion.com"),
    .init(id: "github", name: "GitHub", domain: "github.com"),
    .init(id: "vercel", name: "Vercel", domain: "vercel.com"),
    .init(id: "posthog", name: "PostHog", domain: "posthog.com"),
    .init(id: "linear", name: "Linear", domain: "linear.app"),
    .init(id: "figma", name: "Figma", domain: "figma.com"),
    .init(id: "hubspot", name: "HubSpot", domain: "hubspot.com"),
    .init(id: "salesforce", name: "Salesforce", domain: "salesforce.com"),
    .init(id: "zoom", name: "Zoom", domain: "zoom.com"),
  ]
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
        popularity: entry.popularity ?? 0,
        iconURL: entry.icon.flatMap(URL.init(string:))
      )
    }
    let resolved = parsed.isEmpty ? PluginOption.preferred : Array(Self.ranked(parsed).prefix(30))
    cached = resolved
    return resolved
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
        popularity: option.popularity,
        iconURL: option.iconURL
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
