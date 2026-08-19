import Foundation
import Observation
import os

let onboardingLog = Logger(subsystem: "sh.heychief.mobile", category: "onboarding")

enum AppPhase: Equatable {
  case launching
  case signedOut
  case onboarding
  case workspace
}

@MainActor
@Observable
final class AppModel {
  private(set) var phase: AppPhase = .launching
  private(set) var session: ChiefSession?
  private(set) var workspace: WorkspaceSnapshot?
  var selectedConversationID: String?
  var selectedTab: WorkspaceTab = .home
  var onboarding = OnboardingDraft()
  var inferenceCredential = ""
  private(set) var onboardingError: String?
  private(set) var workspaceSyncFailed = false
  private var debugSkipCredentialStore = false
  private var agentLoopTask: Task<Void, Never>?
  private var onboardingInProgress = false
  private var cellRuntimeBooted = false

  let sessions: SessionStore
  let workspaces: WorkspaceStore
  let inferenceCredentials: InferenceCredentialStore
  let deviceModels: OnDeviceModelStore
  let relay: any RelayServing
  let conversations: ConversationCache
  let authentication: any DeviceAuthorizationServing
  private let liveClient: RelayLiveClient

  var canCancelOnboarding: Bool {
    workspace?.onboardingComplete == true
  }

  var canAdvanceOnboarding: Bool {
    switch onboarding.step {
    case 0:
      return onboarding.runtime != nil
    case 1:
      return inferenceSelectionReady
    case 2:
      return !onboarding.companyName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    default:
      return onboarding.canContinue && inferenceSelectionReady
    }
  }

  private var inferenceSelectionReady: Bool {
    guard let provider = onboarding.inferenceProvider else { return false }
    switch provider {
    case .openCodeGo:
      return !inferenceCredential.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        || inferenceCredentials.contains(.openCodeGo)
    case .onDevice:
      guard let modelID = onboarding.deviceModelID,
        deviceModels.models.contains(where: { $0.id == modelID })
      else { return false }
      return deviceModels.isDownloaded(modelID)
    }
  }

  init(
    sessions: SessionStore,
    workspaces: WorkspaceStore = FileWorkspaceStore(),
    inferenceCredentials: InferenceCredentialStore = KeychainInferenceCredentialStore(),
    deviceModels: OnDeviceModelStore = OnDeviceModelStore(),
    relay: any RelayServing,
    conversations: ConversationCache,
    authentication: any DeviceAuthorizationServing
  ) {
    self.sessions = sessions
    self.workspaces = workspaces
    self.inferenceCredentials = inferenceCredentials
    self.deviceModels = deviceModels
    self.relay = relay
    self.conversations = conversations
    self.authentication = authentication
    self.liveClient = RelayLiveClient(configuration: AppConfiguration.current())
  }

  static func live(environment: ProcessInfo = .processInfo) -> AppModel {
    let configuration = AppConfiguration.current(environment: environment)
    let sessionStore = KeychainSessionStore()
    let transport = URLSessionRelayClient(configuration: configuration)
    return AppModel(
      sessions: sessionStore,
      workspaces: FileWorkspaceStore(),
      inferenceCredentials: KeychainInferenceCredentialStore(),
      relay: configuration.demoMode ? FixtureRelayClient() : transport,
      conversations: ConversationCache(),
      authentication: URLSessionDeviceAuthorizationClient(configuration: configuration)
    )
  }

  func start() async {
    #if DEBUG
    if ProcessInfo.processInfo.arguments.contains("--preview-onboarding") {
      session = .fixture
      if let value = ProcessInfo.processInfo.arguments.first(where: {
        $0.hasPrefix("--onboarding-step=")
      })?.split(separator: "=").last,
        let step = Int(value)
      {
        onboarding.step = min(max(step, 0), 3)
      }
      phase = .onboarding
      return
    }
    if ProcessInfo.processInfo.arguments.contains("--auto-complete-onboarding") {
      session = .fixture
      onboarding.runtime = .phone
      onboarding.inferenceProvider = .openCodeGo
      onboarding.companyName = "Chief QA"
      onboarding.inferenceModel = "deepseek-v4-flash"
      debugSkipCredentialStore = true
      phase = .onboarding
      Task { await completeOnboarding() }
      return
    }
    #endif
    if ProcessInfo.processInfo.arguments.contains("--reset-session") {
      try? sessions.clear()
    }
    if AppConfiguration.current().demoMode {
      session = .fixture
      await hydrateWorkspace()
      return
    }
    guard let stored = try? sessions.load() else {
      phase = .signedOut
      return
    }
    session = stored
    if let local = try? workspaces.load() {
      workspace = local
      selectedConversationID = local.conversations.first?.id
      phase = .workspace
    } else {
      phase = .onboarding
    }
    await hydrateWorkspace()
    startAgentLoopIfNeeded()
    await bootCellRuntimeIfNeeded()
  }

  /// Boots the on-phone cell runtime (V8 + per-conversation cells) so the agent
  /// can live on the device, inference via OpenCode Go, publishing into the
  /// relay-backed channel. Wrapped so a missing device worker never blocks the
  /// workspace from opening.
  private func bootCellRuntimeIfNeeded() async {
    #if CELL_RUNTIME
    guard !cellRuntimeBooted, phase == .workspace else { return }
    cellRuntimeBooted = true
    let host = ChiefOpenCodeAgentHost(relay: relay, credentials: inferenceCredentials)
    do {
      print("[Chief] cell runtime: starting on device")
      try await ChiefCellRuntime.shared.start(host: host)
      print("[Chief] cell runtime booted on device")
    } catch {
      onboardingLog.error("chief cell runtime boot failed: \(error)")
      print("[Chief] cell runtime boot failed: \(error)")
    }
    #endif
  }

  /// Runs one agent turn for a conversation on the phone after the user message
  /// has already been persisted. Feeds the durable transcript through the cell
  /// and publishes the agent's reply back into the same relay channel.
  func runAgentTurn(conversationID: String, mentions: [String] = []) async {
    guard let workspaceID = workspace?.id else { return }
    #if CELL_RUNTIME
    let transcript = await MainActor.run {
      conversations.messages(workspaceID: workspaceID, conversationID: conversationID)
    }
    let userText =
      transcript.last(where: { if case .user = $0.author { return true } else { return false } })?
      .body ?? "Continue."
    print("[Chief] agent turn starting for \(conversationID) mentions=\(mentions): \(userText.prefix(40))")
    do {
      let scope = ChiefCellRuntime.scope(
        workspaceID: workspaceID,
        conversationID: conversationID
      )
      let result = try await ChiefCellRuntime.shared.runTurn(
        scope: scope,
        userText: userText
      )
      let reply = try extractReply(from: result)
      print("[Chief] agent turn reply: \(reply.prefix(60))")
      let message = try await relay.send(
        body: reply,
        workspaceID: workspaceID,
        conversationID: conversationID,
        threadRootID: nil,
        mentions: []
      )
      await MainActor.run { conversations.merge(message) }
      print("[Chief] agent reply published to \(conversationID)")
    } catch {
      onboardingLog.error("agent turn: cell failed: \(error)")
      print("[Chief] agent turn failed: \(error)")
    }
    #endif
  }

  /// The cell worker returns the durable transcript as `{"status":...,"body":"{...}"}`
  /// where `body` is `{"messages":[{role:"assistant",content:"..."},...]}`. Pull the
  /// last assistant reply out of that transcript, or throw so the turn surfaces
  /// as a real failure instead of posting a fabricated message.
  private func extractReply(from workerResult: String) throws -> String {
    let envelope = try? JSONSerialization.jsonObject(with: Data(workerResult.utf8)) as? [String: Any]
    let bodyString = envelope?["body"] as? String
    if let bodyString {
      if let reply = Self.reply(fromTranscriptBody: bodyString) { return reply }
    }
    // Some harness builds return the worker body directly (no envelope).
    if let reply = Self.reply(fromTranscriptBody: workerResult) { return reply }
    // The worker may report a real failure in its error field; prefer that.
    if let error = envelope?["error"] as? String, !error.isEmpty {
      throw WorkspaceSetupError.inferenceFailed
    }
    onboardingLog.warning("no assistant reply in worker result")
    print("[Chief] no assistant reply in worker result: \(workerResult.prefix(200))")
    throw WorkspaceSetupError.inferenceFailed
  }

  private static func reply(fromTranscriptBody body: String) -> String? {
    guard
      let data = body.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let messages = object["messages"] as? [[String: Any]]
    else { return nil }
    for message in messages.reversed() {
      guard let role = message["role"] as? String,
        role == "assistant" || role == "assistant-partial",
        let content = message["content"] as? String,
        !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      else { continue }
      return content
    }
    return nil
  }

  func completeSignIn(_ signedIn: ChiefSession) {
    do {
      try sessions.save(signedIn)
    } catch {
      onboardingError = "Chief could not securely save this sign-in. Please try again."
      onboardingLog.error("session persistence failed: \(error)")
      return
    }
    session = signedIn
    phase = .onboarding
    Task { await hydrateWorkspace() }
  }

  func hydrateWorkspace() async {
    do {
      let loaded = try await relay.loadWorkspace()
      workspace = loaded
      try? workspaces.save(loaded)
      selectedConversationID = loaded.conversations.first?.id
      phase = loaded.onboardingComplete ? .workspace : .onboarding
      onboardingLog.info(
        "hydrated workspace \(loaded.id, privacy: .public) complete=\(loaded.onboardingComplete)"
      )
      print("[Chief] hydrated workspace \(loaded.id) complete=\(loaded.onboardingComplete)")
      startAgentLoopIfNeeded()
    } catch RelayError.unauthorized {
      // A relay token can be temporarily rejected while a fresh device session
      // is propagating. Keep the Better Auth session intact so the client can
      // refresh it on the next request instead of bouncing a signed-in user
      // back to the sign-in screen.
      onboardingLog.warning("relay rejected workspace hydration; preserving account session")
      phase = workspace == nil ? .onboarding : .workspace
    } catch {
      // Authentication succeeded. Keep the user in onboarding while a relay is
      // unavailable or while no workspace has been created yet.
      phase = workspace == nil ? .onboarding : .workspace
    }
  }

  func completeOnboarding() async {
    // Re-entrancy guard: a double-tap or a re-render of the "Enter workspace"
    // button can fire this multiple times concurrently. Only the first run may
    // claim the durable onboarding job; later runs must not tear down a
    // successfully completed workspace.
    guard !onboardingInProgress else {
      onboardingLog.info("onboarding already in progress; ignoring duplicate trigger")
      return
    }
    onboardingInProgress = true
    defer { onboardingInProgress = false }

    guard onboarding.canContinue else { return }
    onboardingError = nil
    guard onboarding.runtime == .phone else {
      onboardingError = "Chief Cloud setup is not available in this build yet."
      return
    }
    let selection =
      "runtime=\(onboarding.runtime?.rawValue ?? "nil") provider=\(onboarding.inferenceProvider?.rawValue ?? "nil") model=\(onboarding.inferenceModel)"
    onboardingLog.info("completing \(selection)")
    print("[Chief] completing \(selection)")

    // Idempotency: if we already have a fully on-boarded workspace there is
    // nothing left to set up — just enter it.
    if let existing = workspace, existing.onboardingComplete {
      phase = .workspace
      selectedConversationID = existing.conversations.first?.id
      workspaceSyncFailed = false
      startAgentLoopIfNeeded()
      return
    }

    if onboarding.inferenceProvider == .openCodeGo && !debugSkipCredentialStore {
      let credential = inferenceCredential.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !credential.isEmpty || inferenceCredentials.contains(.openCodeGo) else {
        onboardingError = "Connect OpenCode Go before continuing."
        return
      }
      if !credential.isEmpty {
        do {
          try inferenceCredentials.save(credential, for: .openCodeGo)
          inferenceCredential = ""
          onboardingLog.info("saved OpenCode Go credential")
        } catch {
          onboardingError = "Chief could not save the OpenCode credential."
          return
        }
      }
    }

    do {
      let pending: WorkspaceSnapshot
      if let existing = workspace, !existing.onboardingComplete {
        pending = existing
      } else {
        pending = try await relay.createWorkspace(from: onboarding)
        workspace = pending
        // This file is only a launch cache. The relay is authoritative, so a
        // local persistence failure must not prevent the durable job from
        // being claimed and completed.
        try? workspaces.save(pending)
      }
      let worker = PhoneWorkspaceSetupWorker(
        relay: relay,
        credentials: inferenceCredentials
      )
      onboardingLog.info("starting phone worker for \(pending.id, privacy: .public)")
      try await worker.run(draft: onboarding, workspaceID: pending.id)
      let remote = try await relay.loadWorkspace()
      guard remote.onboardingComplete else {
        throw WorkspaceSetupError.missingJob
      }
      workspace = remote
      selectedConversationID = remote.conversations.first?.id
      try? workspaces.save(remote)
      workspaceSyncFailed = false
      onboardingLog.info("relay created workspace \(remote.id)")
      print("[Chief] relay created workspace \(remote.id)")
    } catch {
      // A missing job when onboarding already completed (e.g. a duplicate
      // trigger that lost the claim race) is not a relay outage — do not raise
      // the misleading "local only" banner.
      let error = error as? LocalizedError
      if isRelayConnectivity(error) {
        workspaceSyncFailed = true
      }
      onboardingError =
        error?.errorDescription
        ?? "Chief could not finish setting up this workspace. Try again."
      onboardingLog.error("relay createWorkspace failed: \(error)")
      print("[Chief] relay createWorkspace failed: \(error)")
      if workspace?.onboardingComplete == true {
        phase = .workspace
        startAgentLoopIfNeeded()
      }
      return
    }
    phase = .workspace
    startAgentLoopIfNeeded()
  }

  private func isRelayConnectivity(_ error: LocalizedError?) -> Bool {
    guard let error else { return false }
    return error is RelayError
  }

  func openConversation(_ id: String) {
    selectedConversationID = id
    selectedTab = .home
  }

  /// Subscribes to a conversation's live event stream. Incoming messages are
  /// merged into the conversation cache as they arrive — no polling. Returns a
  /// task the view owns so it can cancel when the conversation closes.
  func subscribeToConversation(workspaceID: String, conversationID: String) -> Task<Void, Never> {
    Task { [liveClient, conversations] in
      do {
        try await liveClient.connect(
          workspaceID: workspaceID,
          conversationID: conversationID
        ) { message in
          Task { @MainActor in
            conversations.merge(message)
          }
        }
      } catch {
        liveLog.warning("live subscribe failed for \(conversationID): \(error.localizedDescription)")
      }
    }
  }

  func unsubscribeFromConversation() {
    Task { await liveClient.disconnect() }
  }

  /// Starts the continuous agent loop so the workspace keeps doing useful work
  /// after onboarding completes (the relay queues follow-up jobs).
  private func startAgentLoopIfNeeded() {
    guard phase == .workspace, let workspace else { return }
    guard agentLoopTask == nil else { return }
    let roster = workspace.agents.map(\.id)
    let generation = WorkspaceAgentLoop.Inference(
      loadKey: { [inferenceCredentials] in
        try? inferenceCredentials.load(.openCodeGo)
      },
      generate: { [relay, inferenceCredentials] instruction in
        try await Self.generateFollowup(
          relay: relay,
          credentials: inferenceCredentials,
          instruction: instruction
        )
      }
    )
    let loop = WorkspaceAgentLoop(
      relay: relay,
      inference: generation,
      workspaceID: workspace.id,
      roster: roster
    )
    agentLoopTask = Task { await loop.run() }
  }

  private func stopAgentLoop() {
    agentLoopTask?.cancel()
    agentLoopTask = nil
  }

  private static func generateFollowup(
    relay: any RelayServing,
    credentials: InferenceCredentialStore,
    instruction: String
  ) async throws -> String {
    try await Task.detached { () async throws -> String in
      guard let key = try credentials.load(.openCodeGo), !key.isEmpty else {
        throw WorkspaceSetupError.missingCredential
      }
      let endpoint = URL(string: "https://opencode.ai/zen/go/v1/chat/completions")!
      var request = URLRequest(url: endpoint)
      request.httpMethod = "POST"
      request.timeoutInterval = 60
      request.setValue("application/json", forHTTPHeaderField: "content-type")
      request.setValue("Bearer \(key)", forHTTPHeaderField: "authorization")
      request.httpBody = try JSONEncoder().encode(
        OpenCodeRequest(
          model: "deepseek-v4-flash",
          messages: [
            .init(
              role: "system",
              content:
                "You are Chief, a concise and proactive chief of staff. Never use em dashes. Keep responses to 1-3 short sentences. Return only the message."
            ),
            .init(role: "user", content: instruction),
          ],
          maxTokens: 180
        )
      )
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode)
      else { throw WorkspaceSetupError.inferenceFailed }
      let output = try JSONDecoder().decode(OpenCodeResponse.self, from: data)
      guard let message = output.choices.first?.message.content
        .trimmingCharacters(in: .whitespacesAndNewlines), !message.isEmpty
      else { throw WorkspaceSetupError.inferenceFailed }
      return message
    }.value
  }

  func beginWorkspaceSetup() {
    stopAgentLoop()
    onboarding = OnboardingDraft()
    inferenceCredential = ""
    onboardingError = nil
    workspaceSyncFailed = false
    phase = .onboarding
  }

  /// Exits an accidental workspace setup and returns to the existing
  /// workspace when one is already saved locally.
  func cancelWorkspaceSetup() {
    stopAgentLoop()
    onboarding = OnboardingDraft()
    inferenceCredential = ""
    onboardingError = nil
    phase = workspace != nil ? .workspace : .signedOut
    startAgentLoopIfNeeded()
  }

  func signOut() {
    stopAgentLoop()
    try? sessions.clear()
    session = nil
    workspace = nil
    try? workspaces.clear()
    conversations.clearAll()
    phase = .signedOut
  }
}

enum WorkspaceTab: Hashable {
  case home
  case dms
  case projects
  case agents
}
