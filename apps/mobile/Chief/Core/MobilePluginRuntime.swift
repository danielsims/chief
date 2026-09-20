import Darwin
import Foundation
import MCP
import Observation
import Security

enum MobilePluginRuntimeError: LocalizedError {
  case browserDismissed
  case invalidAuthorizationRequest
  case noRemoteServer(String)
  case unavailable(String)

  var errorDescription: String? {
    switch self {
    case .browserDismissed:
      "Plugin sign in was cancelled."
    case .invalidAuthorizationRequest:
      "The plugin returned an invalid sign-in request."
    case .noRemoteServer(let name):
      "\(name) does not publish a remote MCP server Chief can connect to on this phone."
    case .unavailable(let message):
      message
    }
  }
}

/// Owns the one browser sheet used by MCP OAuth. The official MCP SDK drives
/// discovery, registration, PKCE, token exchange and refresh; this object only
/// presents the provider page and receives its standards-compliant loopback
/// callback.
@MainActor
@Observable
final class PluginAuthorizationPresenter {
  private(set) var authorizationURL: URL?
  private var activeServer: LoopbackOAuthCallbackServer?

  func present(_ url: URL) async throws -> URL {
    guard
      let redirect = URLComponents(url: url, resolvingAgainstBaseURL: false)?
        .queryItems?.first(where: { $0.name == "redirect_uri" })?.value,
      let redirectURL = URL(string: redirect)
    else { throw MobilePluginRuntimeError.invalidAuthorizationRequest }

    let server = try LoopbackOAuthCallbackServer(redirectURI: redirectURL)
    activeServer = server
    do {
      try await server.start()
      authorizationURL = url
      let callback = try await server.waitForCallback()
      authorizationURL = nil
      activeServer = nil
      server.stop()
      return callback
    } catch {
      authorizationURL = nil
      activeServer = nil
      server.stop()
      throw error
    }
  }

  func cancel() {
    authorizationURL = nil
    activeServer?.cancel()
    activeServer = nil
  }
}

private struct ChiefPluginOAuthDelegate: OAuthAuthorizationDelegate {
  let presenter: PluginAuthorizationPresenter

  func presentAuthorizationURL(_ url: URL) async throws -> URL {
    try await presenter.present(url)
  }
}

enum PluginOAuthLoopbackCallback {
  static func url(requestLine: String, redirectURI: URL) -> URL? {
    let fields = requestLine.split(whereSeparator: { $0.isWhitespace })
    guard fields.count >= 3, fields[0] == "GET",
      let callbackURL = URL(string: String(fields[1]), relativeTo: redirectURI)?.absoluteURL
    else { return nil }

    guard callbackURL.scheme?.lowercased() == redirectURI.scheme?.lowercased(),
      callbackURL.host?.lowercased() == redirectURI.host?.lowercased(),
      callbackURL.port == redirectURI.port,
      let queryItems = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems,
      queryItems.contains(where: { $0.name == "state" }),
      queryItems.contains(where: { $0.name == "code" || $0.name == "error" })
    else { return nil }
    return callbackURL
  }
}

/// A loopback redirect is the native-app callback required by the MCP OAuth
/// contract. It avoids custom URL schemes and binds only to 127.0.0.1.
final class LoopbackOAuthCallbackServer: @unchecked Sendable {
  private let redirectURI: URL
  private let descriptor: Int32
  private let queue = DispatchQueue(label: "sh.heychief.mobile.plugin-oauth")
  private let lock = NSLock()
  private var source: DispatchSourceRead?
  private var callbackContinuation: CheckedContinuation<URL, Error>?
  private var callback: URL?
  private var failure: Error?
  private var finished = false

  init(redirectURI: URL) throws {
    guard redirectURI.scheme?.lowercased() == "http",
      redirectURI.host?.lowercased() == "127.0.0.1",
      let rawPort = redirectURI.port,
      rawPort > 0,
      rawPort <= Int(UInt16.max)
    else { throw MobilePluginRuntimeError.invalidAuthorizationRequest }
    self.redirectURI = redirectURI
    descriptor = Darwin.socket(AF_INET, SOCK_STREAM, 0)
    guard descriptor >= 0 else {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .ENOTSUP)
    }
    var noPipe: Int32 = 1
    _ = setsockopt(
      descriptor,
      SOL_SOCKET,
      SO_NOSIGPIPE,
      &noPipe,
      socklen_t(MemoryLayout<Int32>.size)
    )
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = in_port_t(UInt16(rawPort).bigEndian)
    address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
    let bound = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    guard bound == 0, Darwin.listen(descriptor, 4) == 0 else {
      let code = POSIXErrorCode(rawValue: errno) ?? .ENOTSUP
      Darwin.close(descriptor)
      throw POSIXError(code)
    }
    _ = fcntl(descriptor, F_SETFL, O_NONBLOCK)
  }

  func start() async throws {
    let source = DispatchSource.makeReadSource(fileDescriptor: descriptor, queue: queue)
    source.setEventHandler { [weak self] in self?.acceptPendingConnections() }
    source.setCancelHandler { [descriptor] in Darwin.close(descriptor) }
    self.source = source
    source.resume()
  }

  func waitForCallback() async throws -> URL {
    try await withCheckedThrowingContinuation { continuation in
      lock.lock()
      if let callback {
        lock.unlock()
        continuation.resume(returning: callback)
      } else if let failure {
        lock.unlock()
        continuation.resume(throwing: failure)
      } else {
        callbackContinuation = continuation
        lock.unlock()
      }
    }
  }

  func cancel() {
    finish(.failure(MobilePluginRuntimeError.browserDismissed))
  }

  func stop() {
    source?.cancel()
    source = nil
  }

  private func acceptPendingConnections() {
    while true {
      let connection = Darwin.accept(descriptor, nil, nil)
      if connection < 0 {
        if errno == EAGAIN || errno == EWOULDBLOCK { return }
        finish(.failure(POSIXError(POSIXErrorCode(rawValue: errno) ?? .ECONNABORTED)))
        return
      }
      configureAcceptedConnection(connection)
      guard
        let requestLine = readRequestLine(connection),
        let callbackURL = PluginOAuthLoopbackCallback.url(
          requestLine: requestLine,
          redirectURI: redirectURI
        )
      else {
        respond(connection, status: "400 Bad Request", message: "Invalid authorization response.")
        continue
      }
      respond(connection, status: "200 OK", message: "Connected. Return to Chief.")
      finish(.success(callbackURL))
      return
    }
  }

  private func configureAcceptedConnection(_ connection: Int32) {
    let flags = fcntl(connection, F_GETFL, 0)
    if flags >= 0 {
      _ = fcntl(connection, F_SETFL, flags & ~O_NONBLOCK)
    }
    var timeout = timeval(tv_sec: 5, tv_usec: 0)
    _ = setsockopt(
      connection,
      SOL_SOCKET,
      SO_RCVTIMEO,
      &timeout,
      socklen_t(MemoryLayout<timeval>.size)
    )
  }

  private func readRequestLine(_ connection: Int32) -> String? {
    var bytes: [UInt8] = []
    bytes.reserveCapacity(1_024)
    var chunk = [UInt8](repeating: 0, count: 1_024)
    while bytes.count < 16_384 {
      let count = Darwin.recv(connection, &chunk, chunk.count, 0)
      if count > 0 {
        bytes.append(contentsOf: chunk.prefix(Int(count)))
        if let newline = bytes.firstIndex(of: 0x0A) {
          return String(bytes: bytes[..<newline], encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        continue
      }
      if count < 0 && errno == EINTR { continue }
      return nil
    }
    return nil
  }

  private func respond(_ connection: Int32, status: String, message: String) {
    let html =
      "<html><body style=\"font:16px -apple-system;padding:40px;background:#0b0b0b;color:white\">\(message)</body></html>"
    let response =
      "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: \(html.utf8.count)\r\nConnection: close\r\n\r\n\(html)"
    response.withCString { pointer in
      _ = Darwin.send(connection, pointer, strlen(pointer), 0)
    }
    Darwin.close(connection)
  }

  private func finish(_ result: Result<URL, Error>) {
    lock.lock()
    guard !finished else {
      lock.unlock()
      return
    }
    finished = true
    let continuation = callbackContinuation
    callbackContinuation = nil
    switch result {
    case .success(let url): callback = url
    case .failure(let error): failure = error
    }
    lock.unlock()
    continuation?.resume(with: result)
    stop()
  }
}

private final class PluginKeychainTokenStorage: TokenStorage, @unchecked Sendable {
  private let service = "sh.heychief.mobile.plugins"
  private let account: String
  private let lock = NSLock()

  init(workspaceID: String, pluginID: String, serverName: String) {
    account = "\(workspaceID):\(pluginID):\(serverName)"
  }

  func save(_ token: OAuthAccessToken) {
    guard let data = try? JSONEncoder().encode(token) else { return }
    lock.withLock {
      SecItemDelete(query as CFDictionary)
      var attributes = query
      attributes[kSecValueData as String] = data
      attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      SecItemAdd(attributes as CFDictionary, nil)
    }
  }

  func load() -> OAuthAccessToken? {
    lock.withLock {
      var result: CFTypeRef?
      var lookup = query
      lookup[kSecReturnData as String] = true
      lookup[kSecMatchLimit as String] = kSecMatchLimitOne
      guard SecItemCopyMatching(lookup as CFDictionary, &result) == errSecSuccess,
        let data = result as? Data
      else { return nil }
      return try? JSONDecoder().decode(OAuthAccessToken.self, from: data)
    }
  }

  func clear() {
    _ = lock.withLock { SecItemDelete(query as CFDictionary) }
  }

  private var query: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }
}

struct MobilePluginToolDefinition: Sendable {
  let name: String
  let description: String
  let schemaJSON: String

  func openCodeDefinition() -> OpenCodeRequest.ToolDefinition {
    let schema =
      (try? JSONSerialization.jsonObject(with: Data(schemaJSON.utf8))) as? [String: Any]
      ?? ["type": "object", "properties": [:]]
    return OpenCodeRequest.ToolDefinition(
      type: "function",
      function: .init(
        name: name,
        description: description,
        parameters: schema.mapValues { AnyEncodable(value: $0) }
      )
    )
  }
}

actor MobilePluginRuntime {
  static let shared = MobilePluginRuntime()

  private struct Connection {
    let client: Client
    let endpoint: URL
    let tools: [MCP.Tool]
  }

  private struct RoutedTool {
    let connectionKey: String
    let remoteName: String
    let tool: MCP.Tool
  }

  private var connections: [String: Connection] = [:]
  private var routedTools: [String: RoutedTool] = [:]

  func connect(
    plugin: PluginOption,
    workspaceID: String,
    presenter: PluginAuthorizationPresenter
  ) async throws -> [String: URL] {
    let servers = try await PluginCatalogClient.shared.remoteMCPServers(for: plugin)
    var connected: [String: URL] = [:]
    do {
      for server in servers {
        let key = connectionKey(
          workspaceID: workspaceID,
          pluginID: plugin.id,
          serverName: server.name
        )
        let storage = PluginKeychainTokenStorage(
          workspaceID: workspaceID,
          pluginID: plugin.id,
          serverName: server.name
        )
        let existingClientID = storage.load()?.clientID ?? ""
        let oauth = OAuthConfiguration(
          grantType: .authorizationCode,
          authentication: .none(clientID: existingClientID),
          clientName: "Chief",
          authorizationDelegate: ChiefPluginOAuthDelegate(presenter: presenter)
        )
        let authorizer = OAuthAuthorizer(configuration: oauth, tokenStorage: storage)
        let transport = HTTPClientTransport(
          endpoint: server.endpoint,
          streaming: false,
          authorizer: authorizer
        )
        let client = Client(
          name: "Chief",
          version: "0.1.0",
          websiteUrl: "https://heychief.sh"
        )
        _ = try await client.connect(transport: transport)
        let tools = try await client.listTools().tools
        register(
          Connection(client: client, endpoint: server.endpoint, tools: tools),
          key: key,
          plugin: plugin,
          serverName: server.name
        )
        connected[server.name] = server.endpoint
      }
    } catch {
      let prefix = connectionPrefix(workspaceID: workspaceID, pluginID: plugin.id)
      for key in connections.keys.filter({ $0.hasPrefix(prefix) }) {
        guard let connection = connections.removeValue(forKey: key) else { continue }
        await connection.client.disconnect()
      }
      routedTools = routedTools.filter { !$0.value.connectionKey.hasPrefix(prefix) }
      for server in servers {
        PluginKeychainTokenStorage(
          workspaceID: workspaceID,
          pluginID: plugin.id,
          serverName: server.name
        ).clear()
      }
      throw error
    }
    return connected
  }

  func disconnect(workspaceID: String, pluginID: String) async {
    let prefix = connectionPrefix(workspaceID: workspaceID, pluginID: pluginID)
    let keys = connections.keys.filter { $0.hasPrefix(prefix) }
    for key in keys {
      guard let connection = connections.removeValue(forKey: key) else { continue }
      await connection.client.disconnect()
    }
    routedTools = routedTools.filter { !$0.value.connectionKey.hasPrefix(prefix) }
    let installation = await MobilePluginStore.shared.installation(
      workspaceID: workspaceID,
      pluginID: pluginID
    )
    let serverNames = installation?.serverEndpoints.map { Array($0.keys) } ?? ["default"]
    for serverName in serverNames {
      PluginKeychainTokenStorage(
        workspaceID: workspaceID,
        pluginID: pluginID,
        serverName: serverName
      ).clear()
    }
  }

  func toolDefinitions(workspaceID: String) async -> [MobilePluginToolDefinition] {
    await attachStoredConnections(workspaceID: workspaceID)
    return routedTools.compactMap { name, route in
      guard route.connectionKey.hasPrefix("\(workspaceID)\u{0}") else { return nil }
      let schema =
        foundationValue(route.tool.inputSchema) as? [String: Any]
        ?? ["type": "object", "properties": [:]]
      let schemaData = try? JSONSerialization.data(withJSONObject: schema, options: [.sortedKeys])
      return MobilePluginToolDefinition(
        name: name,
        description: route.tool.description
          ?? "Use \(route.tool.name) through this connected plugin.",
        schemaJSON: schemaData.flatMap { String(data: $0, encoding: .utf8) }
          ?? #"{"type":"object","properties":{}}"#
      )
    }.sorted { $0.name < $1.name }
  }

  func execute(name: String, argumentsJSON: String, workspaceID: String) async throws -> String? {
    guard let route = routedTools[name],
      route.connectionKey.hasPrefix("\(workspaceID)\u{0}"),
      let connection = connections[route.connectionKey]
    else { return nil }
    let arguments = try JSONDecoder().decode(
      [String: MCP.Value].self, from: Data(argumentsJSON.utf8))
    let result = try await connection.client.callTool(name: route.remoteName, arguments: arguments)
    let payload: [String: Any] = [
      "content": try JSONSerialization.jsonObject(with: JSONEncoder().encode(result.content)),
      "isError": result.isError ?? false,
    ]
    return toolResultJSON(payload)
  }

  private func attachStoredConnections(workspaceID: String) async {
    let installations = await MobilePluginStore.shared.installations(workspaceID: workspaceID)
    let catalog = await PluginCatalogClient.shared.catalog()
    for (pluginID, installation) in installations where installation.connectedAt != nil {
      guard let plugin = catalog.first(where: { $0.id == pluginID }) else { continue }
      let endpoints =
        installation.serverEndpoints
        ?? installation.endpointURL.map { ["default": $0] }
        ?? [:]
      for (serverName, endpoint) in endpoints {
        let key = connectionKey(
          workspaceID: workspaceID,
          pluginID: pluginID,
          serverName: serverName
        )
        guard connections[key] == nil else { continue }
        let storage = PluginKeychainTokenStorage(
          workspaceID: workspaceID,
          pluginID: pluginID,
          serverName: serverName
        )
        guard let token = storage.load(), !token.isExpired() else { continue }
        do {
          let oauth = OAuthConfiguration(
            grantType: .authorizationCode,
            authentication: .none(clientID: token.clientID ?? ""),
            clientName: "Chief"
          )
          let transport = HTTPClientTransport(
            endpoint: endpoint,
            streaming: false,
            authorizer: OAuthAuthorizer(configuration: oauth, tokenStorage: storage)
          )
          let client = Client(name: "Chief", version: "0.1.0", websiteUrl: "https://heychief.sh")
          _ = try await client.connect(transport: transport)
          let tools = try await client.listTools().tools
          register(
            Connection(client: client, endpoint: endpoint, tools: tools),
            key: key,
            plugin: plugin,
            serverName: serverName
          )
        } catch {
          continue
        }
      }
    }
  }

  private func register(
    _ connection: Connection,
    key: String,
    plugin: PluginOption,
    serverName: String
  ) {
    connections[key] = connection
    routedTools = routedTools.filter { $0.value.connectionKey != key }
    for tool in connection.tools {
      let exported = exportedToolName(
        pluginID: plugin.id,
        serverName: serverName,
        remoteName: tool.name
      )
      routedTools[exported] = RoutedTool(connectionKey: key, remoteName: tool.name, tool: tool)
    }
  }

  private func connectionPrefix(workspaceID: String, pluginID: String) -> String {
    "\(workspaceID)\u{0}\(pluginID)\u{0}"
  }

  private func connectionKey(workspaceID: String, pluginID: String, serverName: String) -> String {
    "\(connectionPrefix(workspaceID: workspaceID, pluginID: pluginID))\(serverName)"
  }

  private func exportedToolName(pluginID: String, serverName: String, remoteName: String) -> String
  {
    let raw = "plugin_\(pluginID)_\(serverName)_\(remoteName)"
      .replacingOccurrences(of: "[^A-Za-z0-9_-]", with: "_", options: .regularExpression)
    return String(raw.prefix(64))
  }
}

private func foundationValue(_ value: MCP.Value) -> Any {
  switch value {
  case .null: NSNull()
  case .bool(let value): value
  case .int(let value): value
  case .double(let value): value
  case .string(let value): value
  case .data(let mimeType, let data):
    "data:\(mimeType ?? "application/octet-stream");base64,\(data.base64EncodedString())"
  case .array(let values): values.map(foundationValue)
  case .object(let values): values.mapValues(foundationValue)
  }
}
