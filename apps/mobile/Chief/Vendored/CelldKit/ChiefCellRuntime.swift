import Foundation
import os

/// Boots and owns the vendored celld-compatible cell runtime (V8 + per-cell
/// SQLite), mirroring `CelldKit.CelldRuntime` from the durable-agent app.
///
/// Each conversation is its own cell, named `workspace:conversation`. The
/// embedded `agent.js` worker is a Durable Object: it keeps the durable
/// transcript in the cell and calls `env.AI.respond(scope, messages)` to run
/// one turn. Inference and tools are bridged from Swift.
actor ChiefCellRuntime {
  static let shared = ChiefCellRuntime()

  private let logger = Logger(
    subsystem: "sh.heychief.mobile",
    category: "CellRuntime"
  )

  nonisolated(unsafe) private var started = false
  private var agentBundle: String?
  private var host: (any ChiefAgentHosting)?

  /// Whether the cell engine has booted successfully (idempotent; `start` may be
  /// re-invoked by the app until this becomes true).
  nonisolated var isStarted: Bool { started }

  private init() {}

  /// Start V8, point cell storage at the app sandbox, and install the AI +
  /// tool bridges. Safe to call more than once; only the first starts the engine.
  func start(host: any ChiefAgentHosting) async throws {
    if !started {
      CelldC.start()
      let documents = FileManager.default.urls(
        for: .documentDirectory,
        in: .userDomainMask
      ).first?.path ?? NSTemporaryDirectory()
      CelldC.setDataDirectory(documents)
      CelldC.setAICallback(Self.makeAITrampoline())
      started = true
      logger.info("cell runtime started (version \(CelldC.version))")
    }
    self.host = host
    if agentBundle == nil {
      agentBundle = Self.loadAgentBundle()
    }
    guard let bundle = agentBundle else {
      throw ChiefCellError.missingWorker
    }
    _ = bundle
  }

  /// Run one user-authored turn in a cell. `messagesJSON` is the durable
  /// transcript already persisted in the cell; returns the updated transcript.
  func runTurn(scope: String, userText: String) async throws -> String {
    guard started else { throw ChiefCellError.notStarted }
    guard let bundle = agentBundle else { throw ChiefCellError.missingWorker }
    let bindings = #"[{"name":"CONVERSATION_AGENT","className":"ConversationAgent"}]"#
    let body = try JSONSerialization.data(withJSONObject: ["text": userText])
    let bodyString = String(decoding: body, as: UTF8.self)
    let url = "https://agent/?name=\(scope.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? scope)"
    // The C FFI blocks the calling thread (isolate + model inference), so run
    // it on a detached task to keep the Swift concurrency pool free — the AI
    // trampoline schedules back onto that pool, and blocking an actor-isolated
    // pool thread here would deadlock.
    return try await Task.detached(priority: .userInitiated) {
      guard
        let reply = CelldC.evaluateWorker(
          source: bundle,
          url: url,
          method: "POST",
          body: bodyString,
          bindingsJSON: bindings
        )
      else {
        throw ChiefCellError.noResult
      }
      return reply
    }.value
  }

  /// Allocate one cell scope per workspace + conversation.
  static func scope(workspaceID: String, conversationID: String) -> String {
    "\(workspaceID):\(conversationID)"
  }

  // MARK: - C trampolines

  private nonisolated static func makeAITrampoline() -> dw_ai_callback? {
    { scope, messagesJSON in
      guard let scope, let messagesJSON else { return nil }
      let sc = String(cString: scope)
      let messages = String(cString: messagesJSON)
      guard let reply = ChiefCellRuntime.runHostedTurn(scope: sc, messages: messages) else {
        return nil
      }
      return UnsafePointer(strdup(reply))
    }
  }

  private nonisolated static func runHostedTurn(scope: String, messages: String) -> String? {
    let semaphore = DispatchSemaphore(value: 0)
    let box = ResultBox<String>()
    Task {
      do {
        let result = try await withCheckedThrowingContinuation { continuation in
          Task {
            let host = await shared.host
            if let host {
              let output = await host.respond(scope: scope, messagesJSON: messages)
              continuation.resume(returning: output)
            } else {
              continuation.resume(throwing: ChiefCellError.notStarted)
            }
          }
        }
        box.value = .success(result)
      } catch {
        box.value = .failure(error)
      }
      semaphore.signal()
    }
    semaphore.wait()
    switch box.value {
    case .success(let result): return result
    case .failure(let error):
      // Surface the failure to the worker as an error (no reply), matching the
      // durable agent contract: agent.js persists the pending turn and returns
      // a 502 the UI turns into a retry state — never a fabricated message.
      let message = (error as? LocalizedError)?.errorDescription ?? "\(error)"
      let escaped = message.replacingOccurrences(of: "\"", with: "\\\"")
      return #"{"error":"\#(escaped)"}"#
    case .none: return nil
    }
  }

  private static func loadAgentBundle() -> String? {
    if let url = Bundle.main.url(forResource: "agent", withExtension: "js"),
      let source = try? String(contentsOf: url, encoding: .utf8)
    {
      return source
    }
    return nil
  }
}

enum ChiefCellError: LocalizedError {
  case notStarted
  case missingWorker
  case noResult

  var errorDescription: String? {
    switch self {
    case .notStarted: return "The chief cell runtime is not started."
    case .missingWorker: return "The chief agent worker bundle is missing."
    case .noResult: return "The chief cell returned no result."
    }
  }
}

private final class ResultBox<Value: Sendable>: @unchecked Sendable {
  var value: Result<Value, Error>?
}
