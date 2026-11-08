import Foundation

/// A workspace database (`databaseSchema`). Boards are the ones with a board view.
struct WorkspaceDatabase: Decodable, Identifiable, Sendable {
  /// The board every workspace starts with (`workspaceBoardId`).
  static let workspaceBoardID = "workspace-board"

  struct Option: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let color: String
  }

  struct Field: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let type: String
    var options: [Option]? = nil
  }

  struct View: Decodable, Sendable {
    let layout: String
    var groupBy: String? = nil
  }

  let id: String
  /// The channels it shows in.
  var channels: [String]? = nil
  let name: String
  let fields: [Field]
  let views: [View]
  /// Milliseconds since 1970.
  var updatedAt: Double = 0

  var isBoard: Bool { views.contains { $0.layout == "board" } }

  /// The select field the board groups its cards by.
  var group: Field? {
    let id = views.first { $0.layout == "board" }?.groupBy
    return fields.first { $0.id == id && $0.type == "select" }
  }
}

/// A database row (`databaseRowSchema`): cells by field id and a Markdown page.
struct WorkspaceDatabaseRow: Decodable, Identifiable, Sendable {
  let id: String
  var values: [String: JSONValue]
  let body: String
  let position: Double
}

/// A database and its rows (`databaseWithRowsSchema`).
struct WorkspaceDatabaseWithRows: Decodable, Sendable {
  let database: WorkspaceDatabase
  let rows: [WorkspaceDatabaseRow]
}

extension RelayServing {
  func databases(workspaceID: String) async throws -> [WorkspaceDatabase] {
    throw RelayError.unavailable
  }

  func database(workspaceID: String, databaseID: String) async throws -> WorkspaceDatabaseWithRows {
    throw RelayError.unavailable
  }

  func saveDatabaseRow(
    workspaceID: String,
    databaseID: String,
    rowID: String,
    values: [String: JSONValue]
  ) async throws -> WorkspaceDatabaseRow {
    throw RelayError.unavailable
  }
}

extension URLSessionRelayClient {
  func databases(workspaceID: String) async throws -> [WorkspaceDatabase] {
    struct Result: Decodable { let databases: [WorkspaceDatabase] }
    let result: Result = try await request(
      path: "/v1/workspaces/\(workspaceID)/databases",
      method: "GET"
    )
    return result.databases
  }

  func database(workspaceID: String, databaseID: String) async throws -> WorkspaceDatabaseWithRows {
    try await request(path: "/v1/workspaces/\(workspaceID)/databases/\(databaseID)", method: "GET")
  }

  /// Changes only the cells sent; the relay keeps the rest of the row.
  func saveDatabaseRow(
    workspaceID: String,
    databaseID: String,
    rowID: String,
    values: [String: JSONValue]
  ) async throws -> WorkspaceDatabaseRow {
    struct Input: Encodable {
      let id: String
      let values: [String: JSONValue]
    }
    return try await request(
      path: "/v1/workspaces/\(workspaceID)/databases/\(databaseID)/rows",
      method: "POST",
      body: try JSONEncoder().encode(Input(id: rowID, values: values))
    )
  }
}
