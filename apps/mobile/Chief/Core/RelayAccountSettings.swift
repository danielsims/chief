import Foundation

struct WorkspaceSettingsData: Codable, Equatable, Sendable {
  var name: String
  var website: String
  var imageURL: URL?
}

extension RelayServing {
  func uploadIdentityImage(workspaceID: String?, data: Data) async throws -> URL { throw RelayError.unavailable }
  func removeProfileImage() async throws { throw RelayError.unavailable }
  func workspaceSettings(workspaceID: String) async throws -> WorkspaceSettingsData { throw RelayError.unavailable }
  func saveWorkspaceSettings(workspaceID: String, settings: WorkspaceSettingsData) async throws { throw RelayError.unavailable }
  func deleteWorkspace(workspaceID: String) async throws { throw RelayError.unavailable }
}

extension URLSessionRelayClient {
  func uploadIdentityImage(workspaceID: String?, data: Data) async throws -> URL {
    struct Input: Encodable { let fileName: String; let contentType: String; let base64: String }
    struct Output: Decodable { let url: URL }
    let path = workspaceID.map { "/v1/workspaces/\($0)/logo" } ?? "/v1/me/avatar"
    let result: Output = try await request(path: path, method: "POST", body: JSONEncoder().encode(
      Input(fileName: "profile.jpg", contentType: "image/jpeg", base64: data.base64EncodedString())))
    return result.url
  }

  func removeProfileImage() async throws {
    let _: JSONValue = try await request(path: "/v1/me/avatar", method: "DELETE")
  }

  func workspaceSettings(workspaceID: String) async throws -> WorkspaceSettingsData {
    try await request(path: "/v1/workspaces/\(workspaceID)/settings", method: "GET")
  }

  func saveWorkspaceSettings(workspaceID: String, settings: WorkspaceSettingsData) async throws {
    // Encode a removed logo explicitly; synthesized Optional encoding omits nil.
    let body: JSONValue = .object(["name": .string(settings.name), "website": .string(settings.website),
      "imageURL": settings.imageURL.map { .string($0.absoluteString) } ?? .null])
    let _: WorkspaceSettingsData = try await request(path: "/v1/workspaces/\(workspaceID)/settings",
      method: "PATCH", body: JSONEncoder().encode(body))
  }

  func deleteWorkspace(workspaceID: String) async throws {
    let _: JSONValue = try await request(path: "/v1/workspaces/\(workspaceID)", method: "DELETE")
  }
}
