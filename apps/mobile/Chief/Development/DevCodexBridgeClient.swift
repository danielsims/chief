#if DEBUG
import Foundation

struct DevCodexBridgeCompletion: Sendable {
  let content: String
  let toolCalls: [OpenCodeResponse.Choice.Message.ToolCall]
}

enum DevCodexBridgeClient {
  static func complete(
    transcriptJSON: String,
    toolDefinitionsJSON: String,
    allowedTools: Set<String>,
    model: String,
    capabilityToken: String,
    onReasoning: @escaping @Sendable (String) async -> Void
  ) async throws -> DevCodexBridgeCompletion {
    guard let endpoint = DevCodexBridgeSettings.endpoint else {
      throw DevCodexBridgeError.notConnected
    }
    guard capabilityToken.range(
      of: #"^[0-9a-fA-F]{64}$"#,
      options: .regularExpression
    ) != nil else { throw DevCodexBridgeError.notConnected }

    var request = URLRequest(url: endpoint)
    request.timeoutInterval = 180
    request.setValue("Bearer \(capabilityToken)", forHTTPHeaderField: "Authorization")
    let socket = DevCodexSocket(task: URLSession.shared.webSocketTask(with: request))
    socket.start()
    defer { socket.close() }
    let rpc = DevCodexRPC(socket: socket)

    try await rpc.send([
      "id": 1,
      "method": "initialize",
      "params": [
        "clientInfo": [
          "name": "chief-ios-development",
          "title": "Chief for iPhone (Development)",
          "version": "0.1.0",
        ],
        "capabilities": ["experimentalApi": true],
      ],
    ])
    _ = try await rpc.awaitResult(id: 1)
    try await rpc.send(["method": "initialized", "params": [:]])

    let instructions = inferenceInstructions(
      transcriptJSON: transcriptJSON,
      toolDefinitionsJSON: toolDefinitionsJSON
    )
    try await rpc.send([
      "id": 2,
      "method": "thread/start",
      "params": [
        "model": model,
        "baseInstructions": instructions,
        "developerInstructions": developerInstructions,
        "approvalPolicy": "never",
        "sandbox": "read-only",
        "ephemeral": true,
        "environments": [],
        "dynamicTools": [],
        "config": inferenceOnlyConfig,
      ],
    ])
    let threadResult = try await rpc.awaitResult(id: 2)
    guard let thread = threadResult["thread"] as? [String: Any],
      let threadID = thread["id"] as? String ?? threadResult["threadId"] as? String
    else {
      throw DevCodexBridgeError.invalidResponse("Codex returned no thread id.")
    }

    try await rpc.send([
      "id": 3,
      "method": "turn/start",
      "params": [
        "threadId": threadID,
        "input": [[
          "type": "text",
          "text": "Produce the agent's next response now. Use one advertised phone tool only when it is genuinely needed. Otherwise reply to the user in plain text. Never wait or poll for changes.",
        ]],
        "environments": [],
        "effort": "medium",
      ],
    ])

    var accumulator = DevCodexTurnAccumulator()
    var accepted = false
    while true {
      let object = try await rpc.receive()
      if try await rpc.declineHostRequest(object) { continue }
      if (object["id"] as? Int) == 3 {
        if let error = DevCodexRPC.errorMessage(in: object) {
          throw DevCodexBridgeError.invalidResponse(error)
        }
        accepted = true
        continue
      }
      guard let method = object["method"] as? String,
        let params = object["params"] as? [String: Any]
      else { continue }
      let reasoning = try accumulator.consume(method: method, params: params)
      if !reasoning.isEmpty { await onReasoning(reasoning) }
      if method == "turn/completed" {
        guard accepted else {
          throw DevCodexBridgeError.invalidResponse(
            "Codex completed a turn before accepting it."
          )
        }
        return try parse(accumulator.output, allowedTools: allowedTools)
      }
    }
  }

  private static func inferenceInstructions(
    transcriptJSON: String,
    toolDefinitionsJSON: String
  ) -> String {
    return """
      You are the inference engine for a phone-owned durable agent. The iPhone,
      not this Mac, owns the agent identity, history, tools, permissions, and
      side effects. Follow the conversation and system instructions below.

      Conversation JSON:
      \(transcriptJSON)

      Phone tool definitions JSON:
      \(toolDefinitionsJSON)

      If a phone tool is required, output exactly one JSON object and nothing
      else: {"type":"tool_call","id":"a fresh stable id","name":"one exact
      advertised tool name","arguments":{}}. The iPhone validates and executes
      it, then a later inference step supplies the genuine result. Never invoke
      a Mac-host tool and never invent a result. If no tool is needed, reply in
      plain conversational text. Do not wrap an ordinary reply in JSON. Never
      poll a phone tool or repeat an identical read while waiting for changes.
      """
  }

  private static func parse(
    _ rawOutput: String,
    allowedTools: Set<String>
  ) throws -> DevCodexBridgeCompletion {
    let output = stripCodeFence(rawOutput)
    guard !output.isEmpty else {
      throw DevCodexBridgeError.invalidResponse("Codex completed without output.")
    }
    guard let object = jsonObject(in: output) else {
      if output.first == "{" {
        throw DevCodexBridgeError.invalidResponse("Codex emitted malformed action JSON.")
      }
      return DevCodexBridgeCompletion(content: output, toolCalls: [])
    }
    if object["type"] as? String == "final", let content = object["content"] as? String {
      return DevCodexBridgeCompletion(content: content, toolCalls: [])
    }
    // Accept the previous development-bridge envelope during durable retries,
    // but never reinterpret an object containing action-shaped fields as text.
    if object["type"] == nil,
      let content = object["content"] as? String,
      object["name"] == nil,
      object["arguments"] == nil,
      object["tool_call"] == nil
    {
      return DevCodexBridgeCompletion(content: content, toolCalls: [])
    }
    let call = (object["tool_call"] as? [String: Any]) ?? object
    guard (call["type"] as? String == "tool_call" || object["tool_call"] != nil),
      let name = call["name"] as? String,
      allowedTools.contains(name)
    else {
      throw DevCodexBridgeError.invalidResponse(
        "Codex requested an unadvertised or malformed phone action."
      )
    }
    let arguments: String
    if let value = call["arguments"] as? String {
      arguments = value
    } else {
      let value = call["arguments"] as? [String: Any] ?? [:]
      arguments = String(
        decoding: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
        as: UTF8.self
      )
    }
    let id = (call["id"] as? String).flatMap { $0.isEmpty ? nil : $0 }
      ?? UUID().uuidString
    return DevCodexBridgeCompletion(
      content: "",
      toolCalls: [
        .init(id: id, function: .init(name: name, arguments: arguments))
      ]
    )
  }

  private static func stripCodeFence(_ value: String) -> String {
    var result = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if result.hasPrefix("```") {
      result = result.replacingOccurrences(
        of: #"^```(?:json)?\s*|\s*```$"#,
        with: "",
        options: .regularExpression
      )
    }
    return result.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private static func jsonObject(in value: String) -> [String: Any]? {
    guard let start = value.firstIndex(of: "{"), let end = value.lastIndex(of: "}") else {
      return nil
    }
    let candidate = String(value[start...end])
    guard let data = candidate.data(using: .utf8) else { return nil }
    return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
  }

  private static let developerInstructions = """
    This is an inference-only development connection for an iPhone agent.
    Never use shell, files, browser, search, MCP, apps, plugins, skills,
    subagents, or user-input requests on the Mac. Phone tool-call JSON is plain
    text and must follow the base-instruction schema exactly. Ordinary replies
    are plain text; JSON is reserved for phone tool calls.
    """

  private static var inferenceOnlyConfig: [String: Any] {
    [
      "model_reasoning_summary": "detailed",
      "web_search": "disabled",
      "mcp_servers": [:],
      "apps": ["_default": ["enabled": false]],
      "agents": ["enabled": false],
      "tools": [
        "experimental_request_user_input": ["enabled": false],
        "update_plan": ["enabled": false],
      ],
      "features": [
        "apps": false, "browser_use": false, "computer_use": false,
        "hooks": false, "image_generation": false, "in_app_browser": false,
        "multi_agent": false, "plugins": false, "remote_plugin": false,
        "shell_tool": false, "skill_search": false, "unified_exec": false,
        "workspace_dependencies": false,
      ],
    ]
  }
}
#endif
