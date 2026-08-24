import Foundation

struct OpenCodeStreamResult {
  let response: HTTPURLResponse
  let content: String
  let toolCalls: [OpenCodeResponse.Choice.Message.ToolCall]
  let errorBody: Data
}

/// Incrementally reconstructs one OpenAI-compatible chat completion while
/// exposing provider reasoning as it arrives. Tool call fragments are kept in
/// their provider indexes so parallel calls retain their original order.
struct OpenCodeStreamAccumulator {
  private struct Chunk: Decodable {
    struct Choice: Decodable {
      struct Delta: Decodable {
        struct ToolCall: Decodable {
          struct Function: Decodable {
            let name: String?
            let arguments: String?
          }

          let index: Int
          let id: String?
          let function: Function?
        }

        let content: String?
        let reasoningContent: String?
        let reasoning: String?
        let toolCalls: [ToolCall]?

        enum CodingKeys: String, CodingKey {
          case content, reasoning
          case reasoningContent = "reasoning_content"
          case toolCalls = "tool_calls"
        }
      }

      let delta: Delta
    }

    let choices: [Choice]
  }

  private struct PartialToolCall {
    var id = ""
    var name = ""
    var arguments = ""
  }

  private(set) var content = ""
  private var partialTools: [Int: PartialToolCall] = [:]

  /// Returns reasoning deltas from this event. The caller emits them before
  /// processing any later tool call, preserving think → act chronology.
  mutating func consume(event data: Data) throws -> [String] {
    let chunk = try JSONDecoder().decode(Chunk.self, from: data)
    var reasoningDeltas: [String] = []
    for choice in chunk.choices {
      let delta = choice.delta
      if let text = delta.reasoningContent ?? delta.reasoning, !text.isEmpty {
        reasoningDeltas.append(text)
      }
      if let text = delta.content { content += text }
      for fragment in delta.toolCalls ?? [] {
        var partial = partialTools[fragment.index] ?? PartialToolCall()
        if let id = fragment.id { partial.id += id }
        if let name = fragment.function?.name { partial.name += name }
        if let arguments = fragment.function?.arguments {
          partial.arguments += arguments
        }
        partialTools[fragment.index] = partial
      }
    }
    return reasoningDeltas
  }

  var toolCalls: [OpenCodeResponse.Choice.Message.ToolCall] {
    partialTools.keys.sorted().compactMap { index in
      guard let partial = partialTools[index], !partial.id.isEmpty, !partial.name.isEmpty else {
        return nil
      }
      return OpenCodeResponse.Choice.Message.ToolCall(
        id: partial.id,
        function: .init(name: partial.name, arguments: partial.arguments)
      )
    }
  }
}

enum OpenCodeStreamingClient {
  static func complete(
    request: URLRequest,
    onReasoning: @Sendable (String) async -> Void
  ) async throws -> OpenCodeStreamResult {
    let (bytes, response) = try await URLSession.shared.bytes(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw WorkspaceSetupError.inferenceFailed
    }

    guard (200..<300).contains(http.statusCode) else {
      var body = Data()
      for try await byte in bytes { body.append(byte) }
      return OpenCodeStreamResult(
        response: http,
        content: "",
        toolCalls: [],
        errorBody: body
      )
    }

    var accumulator = OpenCodeStreamAccumulator()
    for try await rawLine in bytes.lines {
      guard rawLine.hasPrefix("data:") else { continue }
      let payload = rawLine.dropFirst(5).trimmingCharacters(in: .whitespaces)
      guard !payload.isEmpty, payload != "[DONE]", let data = payload.data(using: .utf8) else {
        continue
      }
      for delta in try accumulator.consume(event: data) {
        await onReasoning(delta)
      }
    }
    return OpenCodeStreamResult(
      response: http,
      content: accumulator.content,
      toolCalls: accumulator.toolCalls,
      errorBody: Data()
    )
  }
}
