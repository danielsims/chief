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

/// Concrete host that runs inference through the OpenCode Go API and executes
/// the package-level relay tools natively (running them in an OpenAI-style
/// tool loop). Tool invocations are returned in the envelope's `tools` so the
/// worker persists them into the durable transcript, grounding the reply in
/// real workspace state.
actor ChiefOpenCodeAgentHost: ChiefAgentHosting {
  private let relay: any RelayServing
  private let credentials: InferenceCredentialStore
  private let logger = Logger(subsystem: "sh.heychief.mobile", category: "AgentHost")

  private static let maxToolRounds = 6

  init(relay: any RelayServing, credentials: InferenceCredentialStore) {
    self.relay = relay
    self.credentials = credentials
  }

  func respond(scope: String, messagesJSON: String) async -> String {
    do {
      let (reply, tools) = try await runTurn(scope: scope, messagesJSON: messagesJSON)
      return Self.envelope(reply: reply, tools: tools)
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

  /// Runs inference + tool calls in a loop until the model produces a final
  /// text reply. Returns the reply and the executed tool records.
  private func runTurn(
    scope: String,
    messagesJSON: String
  ) async throws -> (String, [[String: Any]]) {
    let (workspaceID, conversationID) = Self.scopeParts(scope)
    let identity = try AgentIdentityStore().ensure()
    let workspace = try await relay.loadWorkspace()
    let context = ToolContext(
      relay: relay,
      identity: identity,
      workspaceID: workspaceID,
      conversationID: conversationID,
      channels: workspace.conversations
    )

    var convoy = [OpenCodeRequest.Message]()
    convoy.append(
      OpenCodeRequest.Message(
        role: "system",
        content: """
        You are Chief, a proactive chief of staff agent that lives on the owner's iPhone and represents them in a workspace. Be concise, warm, and natural. Never use em dashes. When you need workspace information or want to act in a conversation, call the provided relay tools; do not claim work has happened unless a tool result proves it. Keep replies to 1-3 short sentences unless the work genuinely needs more.
        """
      )
    )
    convoy.append(contentsOf: try loadConvoy(messagesJSON))

    let definitions = RelayToolRegistry.openAIDefinitions()
    var toolRecords: [[String: Any]] = []
    var timeout = 90

    for _ in 0..<Self.maxToolRounds {
      let (data, response) = try await complete(
        convoy: convoy,
        tools: definitions,
        timeout: timeout
      )
      guard let http = response as? HTTPURLResponse,
        (200..<300).contains(http.statusCode)
      else {
        throw WorkspaceSetupError.inferenceFailed
      }
      let output = try JSONDecoder().decode(OpenCodeResponse.self, from: data)
      guard let message = output.choices.first?.message else {
        throw WorkspaceSetupError.inferenceFailed
      }

      if let toolCalls = message.toolCalls, !toolCalls.isEmpty {
        timeout = 120
        for call in toolCalls {
          let record = try await Self.executeTool(
            call,
            convoy: &convoy,
            context: context
          )
          toolRecords.append(record)
        }
        continue
      }

      guard let content = message.content?.trimmingCharacters(in: .whitespacesAndNewlines),
        !content.isEmpty
      else {
        throw WorkspaceSetupError.inferenceFailed
      }
      return (content, toolRecords)
    }
    throw WorkspaceSetupError.inferenceFailed
  }

  /// Executes one tool call natively, echoes it into the conversation, and
  /// returns its record for the transcript.
  private static func executeTool(
    _ call: OpenCodeResponse.Choice.Message.ToolCall,
    convoy: inout [OpenCodeRequest.Message],
    context: ToolContext
  ) async throws -> [String: Any] {
    convoy.append(
      OpenCodeRequest.Message(
        role: "assistant",
        content: nil,
        toolCalls: [
          .init(
            id: call.id,
            type: "function",
            function: .init(name: call.function.name, arguments: call.function.arguments)
          )
        ]
      )
    )
    let (result, status, errorMessage): (String, String, String?)
    do {
      let output = try await RelayToolRegistry.execute(
        name: call.function.name,
        arguments: call.function.arguments,
        context: context
      )
      result = output
      status = "completed"
      errorMessage = nil
    } catch {
      let message = (error as? LocalizedError)?.errorDescription ?? "\(error)"
      result = toolResultJSON(["error": message])
      status = "failed"
      errorMessage = message
    }
    convoy.append(
      OpenCodeRequest.Message(role: "tool", content: result, toolCallID: call.id)
    )
    var record: [String: Any] = [
      "name": call.function.name,
      "status": status,
      "output": result,
    ]
    if let errorMessage { record["error"] = errorMessage }
    return record
  }

  private func complete(
    convoy: [OpenCodeRequest.Message],
    tools: [OpenCodeRequest.ToolDefinition],
    timeout: Int
  ) async throws -> (Data, URLResponse) {
    guard let key = try credentials.load(.openCodeGo), !key.isEmpty else {
      throw WorkspaceSetupError.missingCredential
    }
    let endpoint = URL(string: "https://opencode.ai/zen/go/v1/chat/completions")!
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.timeoutInterval = TimeInterval(timeout)
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.setValue("Bearer \(key)", forHTTPHeaderField: "authorization")
    request.httpBody = try JSONEncoder().encode(
      OpenCodeRequest(
        model: "deepseek-v4-flash",
        messages: convoy,
        maxTokens: 400,
        tools: tools.isEmpty ? nil : tools
      )
    )
    return try await URLSession.shared.data(for: request)
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

  /// Split a cell scope of the form `workspaceId:conversationId`.
  private static func scopeParts(_ scope: String) -> (String, String) {
    let parts = scope.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
    let workspaceID = String(parts[0])
    let conversationID = parts.count > 1 ? String(parts[1]) : scope
    return (workspaceID, conversationID)
  }
}

