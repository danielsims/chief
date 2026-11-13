import Foundation

/// Where an agent runs and the providers each place offers, as on desktop.
enum AgentRuntimeOption: String, CaseIterable, Identifiable {
  case relay, onDevice
  var id: String { rawValue }

  init(deploymentTarget: String) {
    self = deploymentTarget == "cloud" ? .relay : .onDevice
  }

  var title: String {
    switch self {
    case .relay: "Chief relay"
    case .onDevice: "On device"
    }
  }

  var location: String {
    switch self {
    case .relay: "through the Chief relay"
    case .onDevice: "on your device"
    }
  }

  var providers: [AgentProviderOption] {
    switch self {
    case .relay: [.vercelAIGateway, .openCode]
    case .onDevice: [.openCode, .chatGPT, .claude]
    }
  }

  /// On device keeps a phone target the agent already has; otherwise the computer.
  func deploymentTarget(current: String) -> String {
    switch self {
    case .relay: "cloud"
    case .onDevice: current == "phone" ? "phone" : "desktop"
    }
  }
}

enum AgentProviderOption: String, CaseIterable, Identifiable {
  case vercelAIGateway = "vercel-ai-gateway"
  case openCode = "opencode"
  case chatGPT = "codex"
  case claude
  var id: String { rawValue }

  var title: String {
    switch self {
    case .vercelAIGateway: "Vercel AI Gateway"
    case .openCode: "OpenCode"
    case .chatGPT: "ChatGPT"
    case .claude: "Claude Code"
    }
  }

  /// The workspace key it signs in with; local providers use the computer's own sign-in.
  var secretRef: String? {
    switch self {
    case .vercelAIGateway: "vercel-ai-gateway"
    case .openCode: "opencode"
    case .chatGPT, .claude: nil
    }
  }

  /// Where a newly chosen provider starts; the gateway has no Auto.
  var defaultInference: AgentInferenceConfig {
    switch self {
    case .vercelAIGateway:
      AgentInferenceConfig(provider: rawValue, model: "deepseek/deepseek-v4-flash", secretRef: secretRef)
    case .openCode:
      AgentInferenceConfig(provider: rawValue, model: "opencode-go/deepseek-v4-flash", secretRef: secretRef)
    case .chatGPT, .claude:
      AgentInferenceConfig(provider: rawValue, model: "auto", secretRef: nil)
    }
  }
}

struct ProviderModel: Identifiable, Hashable {
  let value: String
  let label: String
  var detail: String? = nil
  var id: String { value }
}

@MainActor
enum ProviderModelCatalog {
  private static var cache: [AgentProviderOption: [ProviderModel]] = [:]

  /// The provider's models. ChatGPT and Claude Code are listed by the
  /// workspace's computer, which publishes them to the relay.
  static func models(
    for provider: AgentProviderOption, current: String, relay: any RelayServing, workspaceID: String?
  ) async -> [ProviderModel] {
    var models = cache[provider] ?? []
    if models.isEmpty {
      switch provider {
      case .chatGPT, .claude:
        if let workspaceID {
          models = (try? await relay.localProviderModels(workspaceID: workspaceID, provider: provider.rawValue)) ?? []
        }
      case .vercelAIGateway, .openCode:
        models = (try? await fetch(provider)) ?? []
      }
      if !models.isEmpty { cache[provider] = models }
    }
    if provider == .chatGPT || provider == .claude {
      models.insert(ProviderModel(value: "auto", label: "Auto", detail: "The provider's default"), at: 0)
    }
    if !current.isEmpty, !models.contains(where: { $0.value == current }) {
      models.insert(ProviderModel(value: current, label: label(current)), at: 0)
    }
    return models
  }

  private struct GatewayCatalog: Decodable {
    struct Model: Decodable { let id: String; let name: String?; let type: String? }
    let data: [Model]
  }

  nonisolated private static func fetch(_ provider: AgentProviderOption) async throws -> [ProviderModel] {
    switch provider {
    case .vercelAIGateway:
      let (data, _) = try await URLSession.shared.data(from: URL(string: "https://ai-gateway.vercel.sh/v1/models")!)
      return try JSONDecoder().decode(GatewayCatalog.self, from: data).data
        .filter { $0.type == "language" }
        .map { ProviderModel(value: $0.id, label: $0.name ?? $0.id, detail: $0.id) }
        .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
    case .openCode:
      let (data, _) = try await URLSession.shared.data(from: URL(string: "https://opencode.ai/zen/go/v1/models")!)
      return try JSONDecoder().decode(GatewayCatalog.self, from: data).data
        .map { ProviderModel(value: "opencode-go/\($0.id)", label: label($0.id), detail: $0.id) }
        .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
    case .chatGPT, .claude:
      return []
    }
  }

  nonisolated static func label(_ value: String) -> String {
    if value == "auto" || value.isEmpty { return "Auto" }
    let name = value.split(separator: "/").last.map(String.init) ?? value
    return name.split(separator: "-").map { part in
      part.lowercased() == "gpt" ? "GPT" : part.first?.isNumber == true ? String(part) : part.capitalized
    }.joined(separator: " ")
  }
}
