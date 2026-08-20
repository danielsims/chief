import Foundation

/// Pulls the final assistant reply and display components (reasoning + tool
/// activity) out of a cell worker result envelope. Shared by the app's direct
/// turns and the background agent loop so both post genuine agent work.
enum TurnExtractor {
  struct Turn {
    var reply: String
    var components: [MessageComponent]
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
      if object["errorCode"] as? String == "inference_limit" {
        throw WorkspaceSetupError.providerUsageLimit
      }
      throw WorkspaceSetupError.inferenceFailed
    }

    var reply: String?
    var components: [MessageComponent] = []
    for message in messages {
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
              id: "reasoning-\(UUID().uuidString)",
              kind: "thinking",
              payload: ["text": text]
            )
          )
        }
      case "tool":
        if let data = content.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        {
          let name = obj["name"] as? String ?? "tool"
          let status = obj["status"] as? String ?? "completed"
          var payload = ["name": name, "status": status]
          if let output = obj["output"] as? String { payload["output"] = output }
          if let input = obj["input"] as? String { payload["input"] = input }
          if let error = obj["error"] as? String { payload["error"] = error }
          components.append(
            MessageComponent(
              id: "tool-\(UUID().uuidString)",
              kind: "tool",
              payload: payload
            )
          )
        }
      default:
        continue
      }
    }
    guard let reply, !reply.isEmpty else {
      if let error = envelope?["error"] as? String, !error.isEmpty {
        throw WorkspaceSetupError.inferenceFailed
      }
      throw WorkspaceSetupError.inferenceFailed
    }
    return Turn(reply: reply, components: components)
  }
}
