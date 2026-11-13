import Foundation

private struct PluginCatalogToolsResponse: Decodable {
  let tools: [WorkspacePluginConnection.Tool]
}

extension RelayServing {
  func pluginCatalogTools(workspaceID: String, domain: String) async throws -> [WorkspacePluginConnection.Tool] {
    throw RelayError.unavailable
  }
}

extension URLSessionRelayClient {
  /// A catalog plugin's tools before it is connected, as the relay last saw them.
  func pluginCatalogTools(workspaceID: String, domain: String) async throws -> [WorkspacePluginConnection.Tool] {
    let query = domain.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? domain
    let response: PluginCatalogToolsResponse = try await request(
      path: "/v1/workspaces/\(workspaceID)/plugin-tools?domain=\(query)", method: "GET")
    return response.tools
  }
}

private struct LocalProviderModelsResponse: Decodable {
  struct Model: Decodable { let value: String; let label: String; var description: String? }
  let models: [Model]
}

extension RelayServing {
  func localProviderModels(workspaceID: String, provider: String) async throws -> [ProviderModel] {
    throw RelayError.unavailable
  }
}

extension URLSessionRelayClient {
  /// The models a workspace computer's ChatGPT or Claude Code can run, as it last published them.
  func localProviderModels(workspaceID: String, provider: String) async throws -> [ProviderModel] {
    let response: LocalProviderModelsResponse = try await request(
      path: "/v1/workspaces/\(workspaceID)/provider-models/\(provider)", method: "GET")
    return response.models.map { ProviderModel(value: $0.value, label: $0.label, detail: $0.description) }
  }
}
