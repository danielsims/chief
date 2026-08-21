import Foundation
import os

let liveLog = Logger(subsystem: "sh.heychief.mobile", category: "live")

/// A live event from a conversation socket. Appends add a message; reactions,
/// edits, and deletes update an existing message in place.
enum LiveEvent: Sendable {
  case appended(ConversationMessage)
  case reacted(ConversationMessage)
  case edited(ConversationMessage)
  case deleted(ConversationMessage)
}

/// Live message delivery over the relay's WebSocket (`/v1/connect`). Replaces
/// polling: the relay broadcasts `conversation.message.appended` and
/// `conversation.message.reacted` events to every connected socket, and this
/// client surfaces them to the app as they happen.
///
/// One instance per workspace. Conversation subscriptions are multiplexed over
/// the single hibernation-friendly socket so an idle app performs no polling or
/// repeated authorization work.
actor RelayLiveClient {
  private let configuration: AppConfiguration
  private let session: URLSession

  private var socket: URLSessionWebSocketTask?
  private var messageTask: Task<Void, Never>?
  private var workspaceID: String?
  private var conversationIDs: Set<String> = []
  private var workspaceCursor = 0

  init(
    configuration: AppConfiguration,
    session: URLSession = .shared
  ) {
    self.configuration = configuration
    self.session = session
  }

  /// Connect to one workspace stream and subscribe to the currently joined
  /// conversations. The durable cursor makes reconnects resumable.
  func connect(
    workspaceID: String,
    conversationIDs: Set<String>,
    onEvent: @escaping @Sendable (LiveEvent) -> Void
  ) async throws {
    disconnect()
    let ticket = try await fetchWorkspaceTicket(workspaceID: workspaceID)
    self.workspaceID = workspaceID
    self.conversationIDs = conversationIDs
    workspaceCursor = Self.savedCursor(workspaceID: workspaceID) ?? ticket.cursor
    var components = URLComponents(
      url: configuration.relayURL.appending(path: "v1/connect"),
      resolvingAgainstBaseURL: false
    )!
    components.queryItems = [
      URLQueryItem(name: "workspaceId", value: workspaceID),
      URLQueryItem(name: "ticket", value: ticket.value),
    ]
    let url = components.url!
      .absoluteString
      .replacingOccurrences(of: "https://", with: "wss://")
      .replacingOccurrences(of: "http://", with: "ws://")
    let request = URLRequest(url: URL(string: url)!)
    let socket = session.webSocketTask(with: request)
    socket.resume()
    self.socket = socket
    try await sendWorkspaceSubscription()
    messageTask = Task { [weak self] in
      await self?.receiveLoop(workspaceID: workspaceID, onEvent: onEvent)
    }
  }

  func updateSubscriptions(workspaceID: String, conversationIDs: Set<String>) async throws {
    guard self.workspaceID == workspaceID else { return }
    guard self.conversationIDs != conversationIDs else { return }
    self.conversationIDs = conversationIDs
    try await sendWorkspaceSubscription()
  }

  func disconnect() {
    messageTask?.cancel()
    messageTask = nil
    socket?.cancel(with: .goingAway, reason: nil)
    socket = nil
    workspaceID = nil
    conversationIDs = []
  }

  /// Suspends until the current conversation socket ends. Workspace-level
  /// supervision uses this to reconnect with bounded exponential backoff;
  /// reconnecting a failed socket is not message polling.
  func waitUntilDisconnected() async {
    guard let messageTask else { return }
    await messageTask.value
  }

  /// Holds an agent-authenticated mailbox connection open and invokes
  /// `onJobAvailable` whenever that agent's Durable Object enqueues work. The
  /// caller owns reconnect policy; job claiming remains a durable catch-up
  /// operation and is never timer-polled.
  func listenAgentMailbox(
    workspaceID: String,
    agentID: String,
    onConnected: @escaping @Sendable () async -> Void,
    onJobAvailable: @escaping @Sendable () async -> Void
  ) async throws {
    disconnect()
    let ticket = try await fetchAgentTicket(workspaceID: workspaceID, agentID: agentID)
    var components = URLComponents(
      url: configuration.relayURL.appending(path: "v1/connect"),
      resolvingAgainstBaseURL: false
    )!
    components.queryItems = [
      URLQueryItem(name: "workspaceId", value: workspaceID),
      URLQueryItem(name: "agentId", value: agentID),
      URLQueryItem(name: "ticket", value: ticket),
    ]
    let url = components.url!
      .absoluteString
      .replacingOccurrences(of: "https://", with: "wss://")
      .replacingOccurrences(of: "http://", with: "ws://")
    let mailboxSocket = session.webSocketTask(with: URL(string: url)!)
    mailboxSocket.resume()
    socket = mailboxSocket
    // A one-shot durable catch-up only after the authenticated socket is open
    // closes the enqueue-before-listen race without introducing a timer.
    await onConnected()
    defer {
      mailboxSocket.cancel(with: .goingAway, reason: nil)
      socket = nil
    }
    try await withTaskCancellationHandler {
      while !Task.isCancelled {
        let message = try await mailboxSocket.receive()
        guard case .string(let text) = message else { continue }
        guard Self.isJobAvailable(text, agentID: agentID) else { continue }
        await onJobAvailable()
      }
      throw CancellationError()
    } onCancel: {
      mailboxSocket.cancel(with: .goingAway, reason: nil)
    }
  }

  deinit {
    socket?.cancel(with: .goingAway, reason: nil)
  }

  // MARK: - Receive

  private func receiveLoop(
    workspaceID: String,
    onEvent: @escaping @Sendable (LiveEvent) -> Void
  ) async {
    while !Task.isCancelled, let socket {
      do {
        let message = try await socket.receive()
        switch message {
        case .string(let text):
          if let decoded = Self.decodeEvent(text) {
            if decoded.sequence <= workspaceCursor { continue }
            workspaceCursor = decoded.sequence
            Self.saveCursor(decoded.sequence, workspaceID: workspaceID)
            onEvent(decoded.event)
          }
        case .data:
          break
        @unknown default:
          break
        }
      } catch {
        liveLog.warning("socket receive failed: \(error.localizedDescription)")
        break
      }
    }
    liveLog.info("live stream ended for workspace")
  }

  /// Decode a `conversation.message.appended` / `conversation.message.reacted`
  /// event into a LiveEvent, or nil for anything else.
  private static func decodeEvent(_ text: String) -> (event: LiveEvent, sequence: Int)? {
    guard
      let data = text.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let sequence = object["sequence"] as? Int,
      let payload = object["payload"] as? [String: Any],
      let messageData = try? JSONSerialization.data(withJSONObject: payload["message"] as Any),
      let message = try? JSONDecoder().decode(ConversationMessage.self, from: messageData)
    else { return nil }
    switch object["type"] as? String {
    case "conversation.message.appended":
      return (.appended(message), sequence)
    case "conversation.message.reacted":
      return (.reacted(message), sequence)
    case "conversation.message.edited":
      return (.edited(message), sequence)
    case "conversation.message.deleted":
      return (.deleted(message), sequence)
    default:
      return nil
    }
  }

  // MARK: - Ticket

  private func fetchWorkspaceTicket(workspaceID: String) async throws -> (
    value: String,
    cursor: Int
  ) {
    let path = "/v1/workspaces/\(workspaceID)/socket-tickets"
    let url = URL(string: path, relativeTo: configuration.relayURL)!.absoluteURL
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 20
    request.setValue("application/json", forHTTPHeaderField: "accept")
    // The relay authenticates with NIP-98 now; sign the ticket request with the
    // device identity (no Bearer token).
    let header = try NIP98Authenticator.header(method: "POST", url: url)
    request.setValue(header, forHTTPHeaderField: "authorization")
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw RelayError.unavailable
    }
    struct Envelope: Decodable {
      let ticket: String
      let cursor: Int
    }
    let envelope = try JSONDecoder().decode(Envelope.self, from: data)
    return (envelope.ticket, envelope.cursor)
  }

  private func sendWorkspaceSubscription() async throws {
    guard let socket else { return }
    let payload: [String: Any] = [
      "type": "workspace.subscribe",
      "conversationIds": conversationIDs.sorted(),
      "after": workspaceCursor,
    ]
    let data = try JSONSerialization.data(withJSONObject: payload)
    guard let text = String(data: data, encoding: .utf8) else {
      throw RelayError.unavailable
    }
    try await socket.send(.string(text))
  }

  private static func savedCursor(workspaceID: String) -> Int? {
    let key = cursorKey(workspaceID: workspaceID)
    guard UserDefaults.standard.object(forKey: key) != nil else { return nil }
    return UserDefaults.standard.integer(forKey: key)
  }

  private static func saveCursor(_ cursor: Int, workspaceID: String) {
    UserDefaults.standard.set(cursor, forKey: cursorKey(workspaceID: workspaceID))
  }

  private static func cursorKey(workspaceID: String) -> String {
    "chief.relay.workspace-cursor.\(workspaceID)"
  }

  private func fetchAgentTicket(workspaceID: String, agentID: String) async throws -> String {
    let path = "/v1/workspaces/\(workspaceID)/agents/\(agentID)/socket-tickets"
    let url = URL(string: path, relativeTo: configuration.relayURL)!.absoluteURL
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 20
    request.setValue("application/json", forHTTPHeaderField: "accept")
    let identity = try AgentIdentityStore(
      workspaceID: workspaceID,
      agentID: agentID
    ).ensure()
    let header = try NIP98Authenticator.header(
      identity: identity,
      method: "POST",
      url: url
    )
    request.setValue(header, forHTTPHeaderField: "authorization")
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw RelayError.unavailable
    }
    struct Envelope: Decodable { let ticket: String }
    return try JSONDecoder().decode(Envelope.self, from: data).ticket
  }

  private static func isJobAvailable(_ text: String, agentID: String) -> Bool {
    guard
      let data = text.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      object["type"] as? String == "agent.job.available",
      let payload = object["payload"] as? [String: Any],
      payload["agentId"] as? String == agentID
    else { return false }
    return true
  }
}
