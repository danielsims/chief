import Foundation
import os

/// Adapter that powers one agent turn in a cell: inference via OpenCode Go and
/// a small phone-local toolset that posts to the workspace relay (the mobile
/// analog of the durable agent's channel tools).
protocol ChiefAgentHosting: Sendable {
  /// Respond to a full turn. `messagesJSON` is the durable transcript array.
  /// Returns a JSON envelope `{"reply": "...", "tools": [...]}` that the worker
  /// persists, mirroring `env.AI.respond`.
  func respond(scope: String, messagesJSON: String) async -> String
}

/// Concrete host that runs inference through the OpenCode Go API and exposes a
/// `channel_post` tool that publishes agent messages to a relay conversation.
actor ChiefOpenCodeAgentHost: ChiefAgentHosting {
  private let relay: any RelayServing
  private let credentials: InferenceCredentialStore
  private let logger = Logger(subsystem: "sh.heychief.mobile", category: "AgentHost")

  init(relay: any RelayServing, credentials: InferenceCredentialStore) {
    self.relay = relay
    self.credentials = credentials
  }

  func respond(scope: String, messagesJSON: String) async -> String {
    do {
      let reply = try await runInference(scope: scope, messagesJSON: messagesJSON)
      return Self.envelope(reply: reply, tools: [])
    } catch {
      logger.error("turn failed: \(error.localizedDescription)")
      // Report the failure to the worker as an error envelope (no reply), so it
      // keeps the turn pending and the UI can offer a retry — never fabricate.
      return Self.errorEnvelope(error)
    }
  }

  /// Build the `env.AI.respond` envelope with correct JSON escaping.
  private static func envelope(reply: String, tools: [[String: Any]]) -> String {
    let payload: [String: Any] = ["reply": reply, "tools": tools]
    let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data()
    return String(data: data, encoding: .utf8) ?? #"{"reply":"","tools":[]}"#
  }

  private static func errorEnvelope(_ error: Error) -> String {
    let message = (error as? LocalizedError)?.errorDescription ?? "\(error)"
    let payload: [String: Any] = ["error": message]
    let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data()
    return String(data: data, encoding: .utf8) ?? #"{"error":"inference failed"}"#
  }

  private struct Message: Encodable {
    let role: String
    let content: String
  }

  private func runInference(scope: String, messagesJSON: String) async throws -> String {
    guard let key = try credentials.load(.openCodeGo), !key.isEmpty else {
      throw WorkspaceSetupError.missingCredential
    }
    let endpoint = URL(string: "https://opencode.ai/zen/go/v1/chat/completions")!
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.timeoutInterval = 90
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.setValue("Bearer \(key)", forHTTPHeaderField: "authorization")

    let system = """
    You are Chief, a proactive chief of staff agent that lives on the owner's iPhone and represents them in a workspace. Be concise, warm, and natural. Never use em dashes. Do not claim work has happened unless the supplied setup proves it. Keep replies to 1-3 short sentences unless the work genuinely needs more.
    """
    let context = try loadConvoy(messagesJSON)
    var convoy = [OpenCodeRequest.Message(role: "system", content: system)]
    convoy.append(contentsOf: context)
    let body = try JSONEncoder().encode(
      OpenCodeRequest(
        model: "deepseek-v4-flash",
        messages: convoy,
        maxTokens: 400
      )
    )
    request.httpBody = body
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw WorkspaceSetupError.inferenceFailed
    }
    let output = try JSONDecoder().decode(OpenCodeResponse.self, from: data)
    guard let message = output.choices.first?.message.content
      .trimmingCharacters(in: .whitespacesAndNewlines), !message.isEmpty
    else { throw WorkspaceSetupError.inferenceFailed }
    return message
  }

  /// Convert the cell's durable transcript (JSON array of {role, content, at})
  /// into {role, content} pairs for the chat API, dropping reasoning/tool spam.
  private func loadConvoy(_ messagesJSON: String) throws -> [OpenCodeRequest.Message] {
    guard let data = messagesJSON.data(using: .utf8),
      let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else { return [] }
    var result: [OpenCodeRequest.Message] = []
    for item in array.prefix(40) {
      guard let role = item["role"] as? String,
        let content = item["content"] as? String
      else { continue }
      switch role {
      case "user", "assistant", "system":
        result.append(OpenCodeRequest.Message(role: role, content: content))
      default:
        continue  // skip reasoning/tool noise
      }
    }
    return result
  }
}
