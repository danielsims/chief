#if DEBUG
import Foundation

final class DevCodexSocket: @unchecked Sendable {
  private let task: URLSessionWebSocketTask

  init(task: URLSessionWebSocketTask) {
    self.task = task
  }

  func start() { task.resume() }

  func send(text: String) async throws {
    try await task.send(.string(text))
  }

  func receiveText() async throws -> String {
    switch try await task.receive() {
    case .string(let text):
      return text
    case .data(let data):
      guard let text = String(data: data, encoding: .utf8) else {
        throw DevCodexBridgeError.invalidResponse("Codex sent non-UTF-8 data.")
      }
      return text
    @unknown default:
      throw DevCodexBridgeError.invalidResponse("Codex sent an unknown WebSocket frame.")
    }
  }

  func close() {
    task.cancel(with: .goingAway, reason: nil)
  }
}

struct DevCodexRPC {
  let socket: DevCodexSocket
  private let timeout: TimeInterval = 180

  func send(_ object: [String: Any]) async throws {
    let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    guard let text = String(data: data, encoding: .utf8) else {
      throw DevCodexBridgeError.invalidResponse("Chief could not encode a Codex request.")
    }
    do {
      try await withThrowingTaskGroup(of: Void.self) { group in
        group.addTask { try await socket.send(text: text) }
        group.addTask {
          try await Task.sleep(for: .seconds(20))
          throw DevCodexBridgeError.connection("The bridge did not accept the request.")
        }
        _ = try await group.next()
        group.cancelAll()
      }
    } catch {
      if error is CancellationError { throw error }
      if let bridgeError = error as? DevCodexBridgeError { throw bridgeError }
      throw DevCodexBridgeError.connection(error.localizedDescription)
    }
  }

  func receive() async throws -> [String: Any] {
    let text: String
    do {
      text = try await withThrowingTaskGroup(of: String.self) { group in
        group.addTask { try await socket.receiveText() }
        group.addTask {
          try await Task.sleep(for: .seconds(timeout))
          throw DevCodexBridgeError.connection("The Codex turn timed out.")
        }
        guard let result = try await group.next() else {
          throw DevCodexBridgeError.connection("The Codex connection ended.")
        }
        group.cancelAll()
        return result
      }
    } catch {
      if error is CancellationError { throw error }
      if let bridgeError = error as? DevCodexBridgeError { throw bridgeError }
      throw DevCodexBridgeError.connection(error.localizedDescription)
    }
    guard let data = text.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      throw DevCodexBridgeError.invalidResponse("Codex sent malformed JSON-RPC.")
    }
    return object
  }

  func awaitResult(id: Int) async throws -> [String: Any] {
    while true {
      let object = try await receive()
      if try await declineHostRequest(object) { continue }
      guard (object["id"] as? Int) == id else { continue }
      if let message = Self.errorMessage(in: object) {
        throw DevCodexBridgeError.invalidResponse(message)
      }
      return object["result"] as? [String: Any] ?? [:]
    }
  }

  func declineHostRequest(_ object: [String: Any]) async throws -> Bool {
    guard let id = object["id"] as? Int,
      let method = object["method"] as? String
    else { return false }

    let result: [String: Any]
    switch method {
    case "item/commandExecution/requestApproval", "item/fileChange/requestApproval":
      result = ["decision": "decline"]
    case "item/tool/requestUserInput":
      result = ["answers": [:]]
    case "mcpServer/elicitation/request":
      result = ["action": "decline", "content": NSNull(), "_meta": NSNull()]
    case "item/tool/call":
      result = [
        "success": false,
        "contentItems": [[
          "type": "inputText",
          "text": "Mac-host tools are disabled for this inference connection.",
        ]],
      ]
    case "item/permissions/requestApproval":
      try await send([
        "id": id,
        "error": ["code": -32601, "message": "Additional host permissions are disabled"],
      ])
      throw DevCodexBridgeError.invalidResponse(
        "Codex requested additional permissions on the Mac."
      )
    default:
      try await send([
        "id": id,
        "error": ["code": -32601, "message": "Unsupported server request"],
      ])
      throw DevCodexBridgeError.invalidResponse(
        "Codex requested unsupported Mac action \(method)."
      )
    }
    try await send(["id": id, "result": result])
    return true
  }

  static func errorMessage(in object: [String: Any]) -> String? {
    guard let error = object["error"] as? [String: Any] else { return nil }
    return error["message"] as? String ?? "Unknown Codex JSON-RPC error."
  }
}

struct DevCodexTurnAccumulator {
  private(set) var text = ""
  private var completedText = ""
  private var failure: String?

  var output: String {
    (text.isEmpty ? completedText : text)
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }

  mutating func consume(method: String, params: [String: Any]) throws -> String {
    switch method {
    case "item/agentMessage/delta":
      text += Self.string(params["delta"]) ?? Self.string(params["text"]) ?? ""
    case "item/reasoning/summaryTextDelta":
      return Self.string(params["delta"]) ?? ""
    case "item/completed":
      guard let item = params["item"] as? [String: Any],
        ["agentMessage", "agent_message"].contains(item["type"] as? String ?? "")
      else { return "" }
      completedText = Self.string(item["text"])
        ?? Self.string(item["content"])
        ?? completedText
    case "turn/completed":
      let turn = params["turn"] as? [String: Any] ?? params
      let status = (turn["status"] as? String ?? "").lowercased()
      if status == "failed" {
        if let error = turn["error"] as? [String: Any] {
          failure = error["message"] as? String ?? "Codex turn failed."
        } else {
          failure = turn["error"] as? String ?? "Codex turn failed."
        }
      } else if ["aborted", "cancelled", "canceled", "interrupted"].contains(status) {
        throw CancellationError()
      }
      if let failure { throw DevCodexBridgeError.invalidResponse(failure) }
    default:
      break
    }
    return ""
  }

  private static func string(_ value: Any?) -> String? {
    if let string = value as? String { return string }
    if let record = value as? [String: Any] { return record["text"] as? String }
    if let parts = value as? [[String: Any]] {
      return parts.compactMap { $0["text"] as? String }.joined()
    }
    return nil
  }
}
#endif
