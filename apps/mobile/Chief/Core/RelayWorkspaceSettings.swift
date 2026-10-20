import Foundation

extension RelayServing {
  func deleteWorkspaceSecret(workspaceID: String, name: String) async throws {
    throw RelayError.unavailable
  }
}

extension URLSessionRelayClient {
  func deleteWorkspaceSecret(workspaceID: String, name: String) async throws {
    var components = URLComponents()
    components.path = "/v1/workspaces/\(workspaceID)/secrets"
    components.queryItems = [URLQueryItem(name: "name", value: name)]
    let _: JSONValue = try await request(path: components.string ?? "", method: "DELETE")
  }
}
