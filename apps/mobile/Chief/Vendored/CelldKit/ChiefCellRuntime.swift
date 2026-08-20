import Foundation
import os

/// Boots and owns the vendored celld-compatible cell runtime (V8 + per-cell
/// SQLite), mirroring `CelldKit.CelldRuntime` from the durable-agent app.
///
/// Each agent is exactly one cell, named `workspace:agent`. Conversations are
/// durable records inside that agent's isolated SQLite database; they are not
/// separate runtimes. Inference and tools are bridged from Swift.
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
      let storage = try Self.prepareStorageDirectory()
      guard CelldC.setDataDirectory(storage.path) else {
        throw ChiefCellError.storageUnavailable
      }
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
  func runTurn(
    scope: String,
    conversationID: String,
    userText: String
  ) async throws -> String {
    guard started else { throw ChiefCellError.notStarted }
    guard let bundle = agentBundle else { throw ChiefCellError.missingWorker }
    let bindings = #"[{"name":"AGENT_CELL","className":"AgentCell"}]"#
    let body = try JSONSerialization.data(
      withJSONObject: ["conversationId": conversationID, "text": userText]
    )
    let bodyString = String(decoding: body, as: UTF8.self)
    let url = "https://agent/?name=\(scope.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? scope)"
    // The C FFI blocks the calling thread (isolate + model inference), so run
    // it on a detached task to keep the Swift concurrency pool free — the AI
    // trampoline schedules back onto that pool, and blocking an actor-isolated
    // pool thread here would deadlock.
    let first = try await Self.evaluate(
      bundle: bundle,
      url: url,
      body: bodyString,
      bindings: bindings
    )
    guard Self.responseStatus(first) == 409 else { return first }

    // A prior inference or process failure leaves the exact user turn pending
    // in the cell. Resume that durable checkpoint rather than appending the
    // same instruction again or fabricating a replacement response.
    let resumeBody = try JSONSerialization.data(
      withJSONObject: ["conversationId": conversationID, "resume": true]
    )
    return try await Self.evaluate(
      bundle: bundle,
      url: url,
      body: String(decoding: resumeBody, as: UTF8.self),
      bindings: bindings
    )
  }

  private static func evaluate(
    bundle: String,
    url: String,
    body: String,
    bindings: String
  ) async throws -> String {
    try await Task.detached(priority: .userInitiated) {
      guard let reply = CelldC.evaluateWorker(
        source: bundle,
        url: url,
        method: "POST",
        body: body,
        bindingsJSON: bindings
      ) else {
        throw ChiefCellError.noResult
      }
      return reply
    }.value
  }

  private static func responseStatus(_ response: String) -> Int? {
    guard let data = response.data(using: .utf8),
      let envelope = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return nil }
    return envelope["status"] as? Int
  }

  /// Allocate exactly one cell scope per agent in a workspace.
  static func scope(
    workspaceID: String,
    agentID: String = "chief"
  ) throws -> String {
    guard isSafeIdentifier(workspaceID), isSafeIdentifier(agentID) else {
      throw ChiefCellError.invalidScope
    }
    return "\(workspaceID):\(agentID)"
  }

  private static func isSafeIdentifier(_ value: String) -> Bool {
    value.range(
      of: #"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"#,
      options: .regularExpression
    ) != nil
  }

  private static func prepareStorageDirectory() throws -> URL {
    let manager = FileManager.default
    guard let applicationSupport = manager.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    ).first else {
      throw ChiefCellError.storageUnavailable
    }
    var directory = applicationSupport.appending(
      path: "ChiefAgentCells",
      directoryHint: .isDirectory
    )
    try manager.createDirectory(
      at: directory,
      withIntermediateDirectories: true,
      attributes: [
        .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication
      ]
    )
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try directory.setResourceValues(values)
    return directory
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
  case invalidScope
  case storageUnavailable

  var errorDescription: String? {
    switch self {
    case .notStarted: return "The chief cell runtime is not started."
    case .missingWorker: return "The chief agent worker bundle is missing."
    case .noResult: return "The chief cell returned no result."
    case .invalidScope: return "The agent cell identity is invalid."
    case .storageUnavailable: return "Secure agent cell storage is unavailable."
    }
  }
}

private final class ResultBox<Value: Sendable>: @unchecked Sendable {
  var value: Result<Value, Error>?
}
