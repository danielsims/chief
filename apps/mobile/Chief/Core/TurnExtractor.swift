import Foundation

/// A provider-neutral failure reconstructed from the owning cell's durable
/// result envelope. Keeping the original code and safe message prevents the
/// outer app/worker layers from collapsing every distinct failure into the
/// unhelpful `inferenceFailed` case.
struct AgentCellTurnError: LocalizedError, Equatable, Sendable {
  let code: String
  let message: String

  var errorDescription: String? { message }
}

/// Pulls the final assistant reply and display components (reasoning + tool
/// activity) out of a cell worker result envelope. Shared by the app's direct
/// turns and the background agent loop so both post genuine agent work.
enum TurnExtractor {
  struct Turn {
    var reply: String
    var components: [MessageComponent]
    /// Genuine tool records retained by this cell across every attempt in the
    /// conversation. Used only for durable completion evidence; older records
    /// are never republished as fresh chat activity.
    var evidenceComponents: [MessageComponent]
    var sessionID: String?
    var streamIndex: Int?
  }

  static func extract(from workerResult: String) throws -> Turn {
    let envelope = try? JSONSerialization.jsonObject(with: Data(workerResult.utf8)) as? [String: Any]
    let bodyString = envelope?["body"] as? String
    let transcriptJSON: String
    if let bodyString {
      transcriptJSON = bodyString
    } else {
      transcriptJSON = workerResult
    }
    guard
      let data = transcriptJSON.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let messages = object["messages"] as? [[String: Any]]
    else {
      throw WorkspaceSetupError.inferenceFailed
    }
    if let error = object["error"] as? String,
      !error.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    {
      let code = object["errorCode"] as? String ?? "run_failed"
      if code == "inference_limit" {
        throw WorkspaceSetupError.providerUsageLimit
      }
      throw AgentCellTurnError(code: code, message: error)
    }

    let currentTurnStart = messages.lastIndex(where: { $0["role"] as? String == "user" }) ?? 0
    let currentTurnMessages = messages[currentTurnStart...]
    var reply: String?
    var components: [MessageComponent] = []
    let evidenceComponents = messages.compactMap(toolComponent(from:))
    for message in currentTurnMessages {
      guard let role = message["role"] as? String else { continue }
      let content = message["content"] as? String ?? ""
      switch role {
      case "assistant", "assistant-partial":
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { reply = trimmed }
      case "reasoning":
        if let data = content.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let text = obj["text"] as? String,
          !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        {
          components.append(
            MessageComponent(
              id: message["activityId"] as? String
                ?? "reasoning-\(message["checkpointId"] as? String ?? UUID().uuidString)",
              kind: "thinking",
              payload: [
                "text": text,
                "status": obj["status"] as? String ?? "completed",
              ]
            )
          )
        }
      case "tool":
        if let component = toolComponent(from: message) { components.append(component) }
      default:
        continue
      }
    }
    guard let reply, !reply.isEmpty else {
      if let error = envelope?["error"] as? String, !error.isEmpty {
        throw AgentCellTurnError(
          code: envelope?["errorCode"] as? String ?? "run_failed",
          message: error
        )
      }
      throw WorkspaceSetupError.inferenceFailed
    }
    let state = object["state"] as? [String: Any]
    return Turn(
      reply: reply,
      components: components,
      evidenceComponents: evidenceComponents,
      sessionID: state?["sessionId"] as? String,
      streamIndex: (state?["streamIndex"] as? NSNumber)?.intValue
    )
  }

  private static func toolComponent(from message: [String: Any]) -> MessageComponent? {
    guard message["role"] as? String == "tool",
      let content = message["content"] as? String,
      let data = content.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return nil }
    let name = object["name"] as? String ?? "tool"
    let status = object["status"] as? String ?? "completed"
    var payload = ["name": name, "status": status]
    if let output = object["output"] as? String { payload["output"] = output }
    if let input = object["input"] as? String { payload["input"] = input }
    if let error = object["error"] as? String { payload["error"] = error }
    return MessageComponent(
      id: message["activityId"] as? String
        ?? "tool-\(object["id"] as? String ?? UUID().uuidString)",
      kind: "tool",
      payload: payload
    )
  }
}
