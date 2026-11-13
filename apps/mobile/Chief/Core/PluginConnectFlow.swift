import Foundation
import Observation
import SafariServices
import UIKit

/// Where one plugin's connect stands, shown inline wherever it's connected.
enum PluginConnectState: Equatable {
  case idle
  case connecting
  case connected
  case failed(String)
}

/// Asks for a plugin's key, to add it or replace the one it has.
struct PluginKeyRequest: Identifiable {
  let id = UUID()
  let pluginName: String
  let pluginKey: String
  /// The connection the key is for, once the relay keeps it.
  let connectionID: String
  let header: PluginKeyHeader
  /// Swapping the key of a plugin that's already connected.
  var replacing = false
  /// Pre-ticked when choosing which agents get the plugin.
  var preferredAgentID: String?
  let submit: @MainActor (String) async throws -> Void
}

/// Asks for an OAuth app the person registers with the provider by hand.
struct PluginClientRequest: Identifiable {
  let id = UUID()
  let pluginName: String
  let pluginKey: String
  let domain: String?
  let callbackURL: URL?
  let submit: @MainActor (_ clientID: String, _ clientSecret: String?) async throws -> Void
}

/// Adding, signing in to and removing workspace plugins. The relay holds every
/// connection and its credentials; this phone only starts sign-ins and shows
/// where they stand. Each screen that connects plugins owns one, along with
/// the key and OAuth app sheets it asks for (`pluginConnectSheets`).
/// Desktop's `usePluginConnectFlow` over `relay-runtime-plugins`.
@MainActor
@Observable
final class PluginConnectFlow {
  let workspaceID: String
  @ObservationIgnored let relay: any RelayServing

  private(set) var connections: [WorkspacePluginConnection] = []
  private(set) var states: [String: PluginConnectState] = [:]
  var keyRequest: PluginKeyRequest?
  var clientRequest: PluginClientRequest?
  var accessRequest: WorkspacePluginConnection?
  @ObservationIgnored private var afterKeyAccess: WorkspacePluginConnection?
  /// The latest failure, for screens that show one alert rather than inline state.
  var failure: String?

  @ObservationIgnored private let browser = PluginSignInBrowser()
  /// The sign-in that follows an OAuth app sheet, started once the sheet is gone.
  @ObservationIgnored private var afterClientSheet: (@MainActor () async -> Void)?
  @ObservationIgnored private var shownKeyRequest: PluginKeyRequest?
  @ObservationIgnored private var shownClientRequest: PluginClientRequest?

  init(workspaceID: String, relay: any RelayServing) {
    self.workspaceID = workspaceID
    self.relay = relay
  }

  func connection(for pluginKey: String) -> WorkspacePluginConnection? {
    connections.first { $0.pluginKey == pluginKey }
  }

  func state(for pluginKey: String) -> PluginConnectState {
    if let state = states[pluginKey], state != .idle { return state }
    switch connection(for: pluginKey)?.status {
    case "connected": return .connected
    case "error": return .failed(connection(for: pluginKey)?.error ?? "Chief couldn’t reach it.")
    default: return .idle
    }
  }

  func load() async throws {
    connections = try await relay.pluginConnections(workspaceID: workspaceID)
  }

  /// Adds a catalog plugin, or finishes connecting the one already added.
  /// `agentID` is pre-ticked if the plugin asks for a key.
  func connect(_ plugin: PluginOption, agentID: String? = nil) {
    guard states[plugin.id] != .connecting else { return }
    run(plugin.id, name: plugin.name) { [self] in
      try await load()
      if let existing = connection(for: plugin.id) {
        try await resume(existing, agentID: agentID)
        return
      }
      let surface = try await PluginCatalogClient.shared.surface(for: plugin)
      switch surface.auth {
      case .key(let requirement):
        askForKey(
          name: plugin.name, key: plugin.id,
          connectionID: PluginCatalogClient.connectionID(plugin.id),
          header: requirement.header, agentID: agentID
        ) { [self] key in
          try await PluginCatalogClient.shared.connect(
            requirement, key: key, workspaceID: workspaceID, relay: relay)
        }
      case .none, .oauth:
        let kind: String
        switch surface.auth {
        case .none: kind = "none"
        default: kind = "oauth"
        }
        let created = try await PluginCatalogClient.shared.create(
          plugin,
          endpoint: surface.endpoint,
          auth: .object(["kind": .string(kind)]),
          workspaceID: workspaceID,
          relay: relay
        )
        upsert(created)
        try await authorize(created)
      }
    }
  }

  /// Signs an added plugin in again.
  func reconnect(_ connection: WorkspacePluginConnection) {
    guard states[connection.pluginKey] != .connecting else { return }
    run(connection.pluginKey, name: connection.name) { [self] in
      try await authorize(connection)
    }
  }

  /// Asks for a new key. The relay keeps the old one if the server rejects it.
  func replaceKey(_ connection: WorkspacePluginConnection) {
    guard states[connection.pluginKey] != .connecting else { return }
    run(connection.pluginKey, name: connection.name) { [self] in
      guard let header = await PluginCatalogClient.shared.keyHeader(for: connection) else {
        throw PluginConnectError("Chief doesn’t know where \(connection.name)’s key goes.")
      }
      askForKey(
        name: connection.name, key: connection.pluginKey, connectionID: connection.id,
        header: header, replacing: true
      ) { [self] key in
        upsert(
          try await relay.replacePluginHeaders(
            workspaceID: workspaceID, connectionID: connection.id,
            headers: [header.header(key: key)]))
      }
    }
  }

  func remove(_ connection: WorkspacePluginConnection) async throws {
    try await relay.deletePluginConnection(workspaceID: workspaceID, connectionID: connection.id)
    connections.removeAll { $0.id == connection.id }
    states[connection.pluginKey] = nil
  }

  /// Called when the key sheet closes, whether or not a key was given.
  func keySheetDismissed() {
    guard let key = shownKeyRequest?.pluginKey else { return }
    shownKeyRequest = nil
    if let connection = afterKeyAccess { afterKeyAccess = nil; accessRequest = connection }
    if states[key] == .connecting { states[key] = .idle }
  }

  /// Called when the OAuth app sheet closes: signs in with the new app, or
  /// leaves the plugin as it was if the sheet was cancelled.
  func clientSheetDismissed() {
    guard let key = shownClientRequest?.pluginKey else { return }
    shownClientRequest = nil
    guard let next = afterClientSheet else {
      if states[key] == .connecting { states[key] = .idle }
      return
    }
    afterClientSheet = nil
    Task { await next() }
  }

  /// Runs one connect step for a plugin, recording how it ended.
  private func run(
    _ key: String, name: String, _ work: @escaping @MainActor () async throws -> Void
  ) {
    states[key] = .connecting
    failure = nil
    Task {
      do {
        try await work()
        // A sheet asked for more; its own completion records the outcome.
        if keyRequest?.pluginKey == key || clientRequest?.pluginKey == key { return }
        settle(key)
      } catch {
        fail(key, PluginFailure.message(error, name: name))
      }
    }
  }

  private func settle(_ key: String) {
    guard states[key] == .connecting else { return }
    states[key] = connection(for: key)?.isConnected == true ? .connected : .idle
    if let connection = connection(for: key), connection.isConnected { accessRequest = connection }
  }

  private func fail(_ key: String, _ message: String) {
    states[key] = .failed(message)
    failure = message
  }

  private func resume(_ connection: WorkspacePluginConnection, agentID: String?) async throws {
    if connection.isConnected { return }
    if connection.auth?.kind == "headers" {
      guard let header = await PluginCatalogClient.shared.keyHeader(for: connection) else {
        throw PluginConnectError("Chief doesn’t know where \(connection.name)’s key goes.")
      }
      askForKey(
        name: connection.name, key: connection.pluginKey, connectionID: connection.id,
        header: header, agentID: agentID
      ) { [self] key in
        upsert(
          try await relay.replacePluginHeaders(
            workspaceID: workspaceID, connectionID: connection.id,
            headers: [header.header(key: key)]))
      }
      return
    }
    try await authorize(connection)
  }

  private func askForKey(
    name: String,
    key: String,
    connectionID: String,
    header: PluginKeyHeader,
    replacing: Bool = false,
    agentID: String? = nil,
    submit: @escaping @MainActor (String) async throws -> Void
  ) {
    let request = PluginKeyRequest(
      pluginName: name, pluginKey: key, connectionID: connectionID, header: header,
      replacing: replacing, preferredAgentID: agentID
    ) { [self] value in
      try await submit(value)
      try? await load()
      states[key] = .connected
      if !replacing { afterKeyAccess = connection(for: key) }
    }
    shownKeyRequest = request
    keyRequest = request
  }

  private func authorize(_ connection: WorkspacePluginConnection) async throws {
    let result = try await relay.authorizePluginConnection(
      workspaceID: workspaceID, connectionID: connection.id)
    try await follow(result, connection: connection)
  }

  /// Desktop's `authorizationAction`: done, sign in, or register an OAuth app.
  private func follow(
    _ result: PluginAuthorization, connection: WorkspacePluginConnection
  ) async throws {
    switch result {
    case .connected(let checked):
      upsert(checked)
      if !checked.isConnected {
        throw PluginConnectError(checked.error ?? "\(checked.name) couldn’t list its tools.")
      }
    case .signIn(let url):
      try await signIn(url, connection: connection)
    case .clientRequired:
      let request = PluginClientRequest(
        pluginName: connection.name,
        pluginKey: connection.pluginKey,
        domain: connection.domain,
        callbackURL: await relay.pluginOAuthCallbackURL()
      ) { [self] clientID, clientSecret in
        let next = try await relay.configurePluginClient(
          workspaceID: workspaceID, connectionID: connection.id,
          clientID: clientID, clientSecret: clientSecret)
        let key = connection.pluginKey
        afterClientSheet = { [self] in
          do {
            try await follow(next, connection: connection)
            settle(key)
          } catch {
            fail(key, PluginFailure.message(error, name: connection.name))
          }
        }
      }
      shownClientRequest = request
      clientRequest = request
    }
  }

  /// Opens the relay's sign-in page in an in-app browser. While it's open the
  /// connection is checked every two seconds so the browser closes itself once
  /// the relay's callback finishes; closing it early cancels quietly.
  private func signIn(_ url: URL, connection: WorkspacePluginConnection) async throws {
    guard browser.open(url) else {
      throw PluginConnectError("Chief couldn’t open the sign-in page.")
    }
    let deadline = Date.now.addingTimeInterval(600)
    var ticks = 0
    while browser.isOpen, Date.now < deadline {
      try? await Task.sleep(for: .milliseconds(500))
      ticks += 1
      guard ticks % 4 == 0, browser.isOpen,
        let current = try? await refresh(connection.id), current.status != "needs_auth"
      else { continue }
      break
    }
    await browser.close()
    let current = try await refresh(connection.id)
    if current?.status == "error" {
      throw PluginConnectError(current?.error ?? "\(connection.name) couldn’t finish signing in.")
    }
  }

  private func refresh(_ connectionID: String) async throws -> WorkspacePluginConnection? {
    try await load()
    return connections.first { $0.id == connectionID }
  }

  private func upsert(_ connection: WorkspacePluginConnection) {
    if let index = connections.firstIndex(where: { $0.id == connection.id }) {
      connections[index] = connection
    } else {
      connections.append(connection)
    }
  }
}

enum PluginFailure {
  /// Copy for a failed plugin request. The relay's own plugin messages (a
  /// rejected key, an unassigned plugin) pass through as written.
  static func message(_ error: Error, name: String) -> String {
    switch error {
    case RelayError.httpStatus(403):
      "Only workspace owners and admins can change plugins."
    case RelayError.plugin, RelayError.unavailable, RelayError.unauthorized, RelayError.capacity,
      RelayError.httpStatus(404):
      error.localizedDescription
    case let error as PluginConnectError:
      error.message
    default:
      "Chief couldn’t connect \(name)."
    }
  }
}

/// The in-app browser for a relay sign-in page. It is presented over whatever
/// is on screen, so a sign-in can start from a page, a sheet or a chat card.
/// Safari's view keeps the relay's sign-in cookie between its confirm page
/// and the provider's callback.
@MainActor
private final class PluginSignInBrowser: NSObject, SFSafariViewControllerDelegate {
  private var controller: SFSafariViewController?

  var isOpen: Bool { controller != nil }

  func open(_ url: URL) -> Bool {
    guard controller == nil, let presenter = Self.topViewController() else { return false }
    let controller = SFSafariViewController(url: url)
    controller.dismissButtonStyle = .close
    controller.delegate = self
    self.controller = controller
    presenter.present(controller, animated: true)
    return true
  }

  func close() async {
    guard let controller else { return }
    self.controller = nil
    if controller.presentingViewController != nil {
      await withCheckedContinuation { continuation in
        controller.dismiss(animated: true) { continuation.resume() }
      }
    }
  }

  nonisolated func safariViewControllerDidFinish(_ controller: SFSafariViewController) {
    MainActor.assumeIsolated {
      if controller === self.controller { self.controller = nil }
    }
  }

  private static func topViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
    var top = scene?.keyWindow?.rootViewController
    while let presented = top?.presentedViewController, !presented.isBeingDismissed {
      top = presented
    }
    return top
  }
}
