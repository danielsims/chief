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
    // Ensure this device has its signing identities before any request can be
    // made. Provisioning used to run only on sign-in, so a session resumed on a
    // later launch (or after an reinstall that kept the old session) had no key
    // and every relay request failed unsigned against the NIP-98 relay.
    provisionIdentityIfNeeded()
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
  /// workspace from opening. Retries until the engine is actually started, so a
  /// turn that arrives before first boot self-heals.
  private func bootCellRuntimeIfNeeded() async {
    #if CELL_RUNTIME
    guard phase == .workspace else { return }
    if ChiefCellRuntime.shared.isStarted {
      cellRuntimeBooted = true
      return
    }
    let host = ChiefOpenCodeAgentHost(relay: relay, credentials: inferenceCredentials)
    do {
      print("[Chief] cell runtime: starting on device")
      try await ChiefCellRuntime.shared.start(host: host)
      cellRuntimeBooted = true
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
  func runAgentTurn(
    conversationID: String,
    threadRootID: String? = nil,
    mentions: [String] = []
  ) async {
    guard let workspaceID = workspace?.id else { return }
    #if CELL_RUNTIME
    // The cell runtime is booted when entering the workspace, but a first-run
    // conversation can reach a turn before that boot attempt (which is gated on
    // `phase == .workspace`). Boot it lazily here so a reply is always possible.
    if !ChiefCellRuntime.shared.isStarted {
      await bootCellRuntimeIfNeeded()
    }
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
      // Post as the on-device agent (self-auth) so the relay attributes the
      // reply to the agent, not the workspace owner.
      let agentIdentity = try AgentIdentityStore().ensure()
      let message = try await relay.sendAsAgent(
        body: reply,
        workspaceID: workspaceID,
        conversationID: conversationID,
        threadRootID: threadRootID,
        mentions: [],
        signingIdentity: agentIdentity
      )
      await MainActor.run { conversations.merge(message) }
      print("[Chief] agent reply published to \(conversationID)")
    } catch {
      onboardingLog.error("agent turn: cell failed: \(error)")
      print("[Chief] agent turn failed: \(error)")
    }
    #endif
  }

  /// Mirror desktop wake-on-mention: only wake an agent for (a) a direct
  /// conversation with a single agent, (b) an explicit @-mention, or (c) a
  /// thread rooted to an agent. An untagged channel message gets no reply.
  func shouldWakeAgent(
    conversationID: String,
    mentions: [String],
    threadRootID: String? = nil
  ) -> Bool {
    guard let workspace else { return false }
    guard
      let conversation = workspace.conversations.first(where: { $0.id == conversationID })
    else { return false }
    // (b) Explicit @-mention always wakes the mentioned agent.
    if mentions.contains(where: { WorkspaceAgentCatalog.agent(forID: $0) != nil }) {
      return true
    }
    // (a) A direct conversation models a single agent; its id is the agent id in
    // a 1:1 (e.g. the "chief" DM), otherwise the workspace lead.
    if conversation.kind == .direct {
      return WorkspaceAgentCatalog.agent(forID: conversationID) != nil
        || WorkspaceAgentCatalog.agent(forID: "chief") != nil
    }
    // (c) A thread rooted to an agent wakes that root's author.
    if let threadRootID {
      let root = conversations.messages(
        workspaceID: workspace.id,
        conversationID: conversationID
      ).first(where: { $0.id == threadRootID })
      if case .agent = root?.author { return true }
    }
    return false
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
    provisionIdentityIfNeeded()
    session = signedIn
    phase = .onboarding
    Task { await hydrateWorkspace() }
  }

  /// Ensure identity keypairs exist on this device so relay requests can be
  /// signed (NIP-98). Generates the user identity and the on-device agent's
  /// identity once, persisting both in the Keychain.
  private func provisionIdentityIfNeeded() {
    let userStore = NostrKeychainStore()
    if (try? userStore.load()) == nil {
      do {
        let identity = try NostrIdentity.generate()
        try userStore.save(identity)
        onboardingLog.info(
          "provisioned device identity \(identity.publicKeyHex.prefix(8), privacy: .public)"
        )
        print("[Chief] provisioned device identity \(identity.publicKeyHex.prefix(8))")
      } catch {
        onboardingError = "Chief could not create this device's signing key. Please try again."
        onboardingLog.error("identity provisioning failed: \(error)")
        print("[Chief] identity provisioning failed: \(error)")
      }
    }
    do {
      let agentIdentity = try AgentIdentityStore().ensure()
      onboardingLog.info(
        "provisioned agent identity \(agentIdentity.publicKeyHex.prefix(8), privacy: .public)"
      )
      print("[Chief] provisioned agent identity \(agentIdentity.publicKeyHex.prefix(8))")
    } catch {
      onboardingError = "Chief could not create this device's agent key. Please try again."
      onboardingLog.error("agent identity provisioning failed: \(error)")
      print("[Chief] agent identity provisioning failed: \(error)")
    }
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
      await registerAgentKeyIfNeeded(workspaceID: loaded.id)
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

  /// Register the on-device agent's pubkey with a workspace so the agent can
  /// self-authenticate and post as itself. Idempotent: re-registering an
  /// existing key is a no-op on the relay.
  private func registerAgentKeyIfNeeded(workspaceID: String) async {
    guard let agentIdentity = try? AgentIdentityStore().ensure() else { return }
    do {
      try await relay.registerAgentKey(
        workspaceID: workspaceID,
        agentID: "chief",
        pubkey: agentIdentity.publicKeyHex
      )
      onboardingLog.info("registered chief agent key with workspace")
    } catch {
      onboardingLog.warning(
        "could not register chief agent key: \(error.localizedDescription)"
      )
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
      guard
        let content = output.choices.first?.message.content,
        !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      else { throw WorkspaceSetupError.inferenceFailed }
      return content
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
