import Foundation
import os

let liveLog = Logger(subsystem: "sh.heychief.mobile", category: "live")

/// Live message delivery over the relay's WebSocket (`/v1/connect`). Replaces
/// polling: the relay broadcasts `conversation.message.appended` events to every
/// connected socket, and this client surfaces them to the app as they happen.
///
/// One instance per open conversation. When a new message arrives it is decoded
/// and handed to the `onMessage` callback (the UI merges it into its cache).
actor RelayLiveClient {
  private let configuration: AppConfiguration
  private let sessionStore: SessionStore
  private let session: URLSession

  private var socket: URLSessionWebSocketTask?
  private var messageTask: Task<Void, Never>?

  init(
    configuration: AppConfiguration,
    sessionStore: SessionStore = KeychainSessionStore(),
    session: URLSession = .shared
  ) {
    self.configuration = configuration
    self.sessionStore = sessionStore
    self.session = session
  }

  /// Connect to a conversation's live event stream. `onMessage` is called on
  /// the calling actor for each decoded appended message.
  func connect(
    workspaceID: String,
    conversationID: String,
    onMessage: @escaping @Sendable (ConversationMessage) -> Void
  ) async throws {
    disconnect()
    let ticket = try await fetchTicket(workspaceID: workspaceID, conversationID: conversationID)
    var components = URLComponents(
      url: configuration.relayURL.appending(path: "v1/connect"),
      resolvingAgainstBaseURL: false
    )!
    components.queryItems = [
      URLQueryItem(name: "workspaceId", value: workspaceID),
      URLQueryItem(name: "conversationId", value: conversationID),
      URLQueryItem(name: "ticket", value: ticket),
    ]
    let url = components.url!
      .absoluteString
      .replacingOccurrences(of: "https://", with: "wss://")
      .replacingOccurrences(of: "http://", with: "ws://")
    let request = URLRequest(url: URL(string: url)!)
    let socket = session.webSocketTask(with: request)
    socket.resume()
    self.socket = socket
    messageTask = Task { [weak self] in
      await self?.receiveLoop(onMessage: onMessage)
    }
  }

  func disconnect() {
    messageTask?.cancel()
    messageTask = nil
    socket?.cancel(with: .goingAway, reason: nil)
    socket = nil
  }

  deinit {
    socket?.cancel(with: .goingAway, reason: nil)
  }

  // MARK: - Receive

  private func receiveLoop(
    onMessage: @escaping @Sendable (ConversationMessage) -> Void
  ) async {
    while !Task.isCancelled, let socket {
      do {
        let message = try await socket.receive()
        switch message {
        case .string(let text):
          if let decoded = Self.decodeMessage(text) {
            onMessage(decoded)
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
    // Socket dropped — the caller can reconnect by calling connect again.
    liveLog.info("live stream ended for conversation")
  }

  /// The relay broadcasts `{...event, type:"conversation.message.appended",
  /// payload:{message}}`. Pull the message out of the event envelope.
  private static func decodeMessage(_ text: String) -> ConversationMessage? {
    guard
      let data = text.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      (object["type"] as? String) == "conversation.message.appended",
      let payload = object["payload"] as? [String: Any],
      let messageData = try? JSONSerialization.data(withJSONObject: payload["message"] as Any)
    else { return nil }
    return try? JSONDecoder().decode(ConversationMessage.self, from: messageData)
  }

  // MARK: - Ticket

  private func fetchTicket(workspaceID: String, conversationID: String) async throws -> String {
    let path =
      "/v1/workspaces/\(workspaceID)/conversations/\(conversationID)/socket-tickets"
    let url = URL(string: path, relativeTo: configuration.relayURL)!.absoluteURL
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 20
    request.setValue("application/json", forHTTPHeaderField: "accept")
    if let token = try? sessionStore.load()?.accessToken {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
    }
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw RelayError.unavailable
    }
    struct Envelope: Decodable { let ticket: String }
    return try JSONDecoder().decode(Envelope.self, from: data).ticket
  }
}
