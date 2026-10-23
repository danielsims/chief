import Foundation

struct BrandProfileRecord: Codable, Equatable, Sendable {
  let markdown: String
  let sourceUrls: [String]
  let version: Int
  let authorAgentId: String
  let updatedAt: String
}

struct WorkspaceFileRecord: Codable, Equatable, Identifiable, Sendable {
  let id: String
  let path: String
  let title: String
  let mimeType: String
  let content: String
  let conversationId: String
  let authorAgentId: String
  let version: Int
  let createdAt: String
  let updatedAt: String
}

struct WorkspaceFileSaveInput: Encodable, Sendable {
  let id: String?
  let path: String
  let title: String
  let mimeType: String
  let content: String
  let conversationId: String
  let expectedVersion: Int?
}
