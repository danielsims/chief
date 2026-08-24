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

struct ProspectRecord: Codable, Equatable, Identifiable, Sendable {
  let id: String
  let name: String
  let company: String?
  let source: String
  let sourceUrl: String
  let summary: String
  let evidence: String
  let outreachAngle: String
  let relevance: String
  let status: String
  let authorAgentId: String
  let foundAt: String
  let updatedAt: String
}

struct ProspectSaveInput: Codable, Equatable, Sendable {
  let id: String
  let name: String
  let company: String?
  let source: String
  let sourceUrl: String
  let summary: String
  let evidence: String
  let outreachAngle: String
  let relevance: String
  let status: String
}
