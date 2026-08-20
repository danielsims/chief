import Foundation

struct OpenCodeModelOption: Identifiable, Equatable, Sendable {
  enum Access: String, Sendable {
    case free = "Free"
    case go = "Go"
  }

  let id: String
  let displayName: String
  let access: Access
}

enum OpenCodeModelCatalog {
  private struct Response: Decodable {
    struct Model: Decodable { let id: String }
    let data: [Model]
  }

  static let recommendedFreeModelID = "deepseek-v4-flash-free"

  static let fallback: [OpenCodeModelOption] = [
    option(recommendedFreeModelID, access: .free),
    option("mimo-v2.5-free", access: .free),
    option("nemotron-3-ultra-free", access: .free),
    option("nemotron-3.5-lightning-free", access: .free),
    option("laguna-s-2.1-free", access: .free),
    option("deepseek-v4-flash", access: .go),
    option("deepseek-v4-pro", access: .go),
    option("glm-5.2", access: .go),
    option("kimi-k3", access: .go),
    option("mimo-v2.5", access: .go),
  ]

  static func load(session: URLSession = .shared) async -> [OpenCodeModelOption] {
    do {
      async let zen = fetch(
        URL(string: "https://opencode.ai/zen/v1/models")!,
        session: session
      )
      async let go = fetch(
        URL(string: "https://opencode.ai/zen/go/v1/models")!,
        session: session
      )
      return options(zenIDs: try await zen, goIDs: try await go)
    } catch {
      return fallback
    }
  }

  static func completionEndpoint(for modelID: String) -> URL {
    let path = isFree(modelID)
      ? "https://opencode.ai/zen/v1/chat/completions"
      : "https://opencode.ai/zen/go/v1/chat/completions"
    return URL(string: path)!
  }

  static func options(zenIDs: [String], goIDs: [String]) -> [OpenCodeModelOption] {
    let free = Set(zenIDs.filter { isFree($0) && supportsChatCompletions($0) })
    // OpenCode publishes Responses, Anthropic Messages, and Chat Completions
    // models in the same catalogues. Chief's native streaming/tool loop
    // currently speaks the Chat Completions shape, so only offer models that
    // can genuinely run instead of allowing a doomed onboarding selection.
    let go = Set(goIDs.filter(supportsChatCompletions))
    return free.map { option($0, access: .free) }.sorted(by: sort)
      + go.map { option($0, access: .go) }.sorted(by: sort)
  }

  private static func fetch(_ url: URL, session: URLSession) async throws -> [String] {
    var request = URLRequest(url: url)
    request.timeoutInterval = 12
    request.cachePolicy = .reloadRevalidatingCacheData
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse,
      (200..<300).contains(http.statusCode)
    else { throw URLError(.badServerResponse) }
    return try JSONDecoder().decode(Response.self, from: data).data.map(\.id)
  }

  private static func isFree(_ id: String) -> Bool {
    id.hasSuffix("-free") || id == "big-pickle"
  }

  private static func supportsChatCompletions(_ id: String) -> Bool {
    if id == "big-pickle" { return true }
    return ["deepseek-", "glm-", "hy3", "kimi-", "laguna-", "mimo-", "nemotron-"]
      .contains { id.hasPrefix($0) }
  }

  private static func option(_ id: String, access: OpenCodeModelOption.Access)
    -> OpenCodeModelOption
  {
    OpenCodeModelOption(id: id, displayName: displayName(id), access: access)
  }

  private static func displayName(_ id: String) -> String {
    if id == "deepseek-v4-flash-free" { return "DeepSeek V4 Flash" }
    if id == "deepseek-v4-flash" { return "DeepSeek V4 Flash" }
    if id == "deepseek-v4-pro" { return "DeepSeek V4 Pro" }
    return id.split(separator: "-")
      .filter { $0.lowercased() != "free" }
      .map { token in
        let value = String(token)
        if value.allSatisfy(\.isNumber) { return value }
        if value.count <= 3 { return value.uppercased() }
        return value.prefix(1).uppercased() + value.dropFirst()
      }
      .joined(separator: " ")
  }

  private static func sort(_ lhs: OpenCodeModelOption, _ rhs: OpenCodeModelOption) -> Bool {
    if lhs.id == recommendedFreeModelID, rhs.id != recommendedFreeModelID { return true }
    if rhs.id == recommendedFreeModelID, lhs.id != recommendedFreeModelID { return false }
    return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
  }
}
