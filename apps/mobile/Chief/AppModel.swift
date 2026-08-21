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

struct ConversationKey: Hashable {
  let workspaceID: String
  let conversationID: String
}

struct AgentActivityPresence: Identifiable, Equatable, Sendable {
  let id: String
  let name: String
}

struct AgentActivityRecord: Identifiable, Equatable, Sendable {
  let id: String
  let workspaceID: String
  let conversationID: String
  let agentID: String
  let startedAt: Date
  var updatedAt: Date
  var completedAt: Date?
  var components: [MessageComponent]

  var isWorking: Bool { completedAt == nil }
}

@MainActor
@Observable
final class AppModel {
  private(set) var phase: AppPhase = .launching
  private(set) var session: ChiefSession?
  private(set) var workspace: WorkspaceSnapshot?
  private(set) var workspaceSummaries: [WorkspaceSummary] = []
  private(set) var pendingWorkspaceInvite: WorkspaceInviteLink?
  private(set) var workspaceInvitePreview: WorkspaceInvite?
  private(set) var workspaceInviteError: String?
  private(set) var workspaceInviteInProgress = false
  /// Relay-authoritative memberships for the signed-in principal in the
  /// current workspace. `nil` means the tenant-scoped membership view is still
  /// loading; an empty set means the principal has genuinely joined no
  /// channels. Direct messages are participants-only and do not use this set.
  private(set) var joinedConversationIDs: Set<String>?
  private var membershipWorkspaceID: String?
  var selectedConversationID: String?
  var selectedTab: WorkspaceTab = .home
  var onboarding = OnboardingDraft()
  var inferenceCredential = ""
  private(set) var onboardingError: String?
  private(set) var workspaceSyncFailed = false
  private var debugSkipCredentialStore = false
  private var agentLoopTask: Task<Void, Never>?
  private var workspaceLiveTask: Task<Void, Never>?
  private var workspaceLiveBackgroundStopTask: Task<Void, Never>?
  private var workspaceLiveClient: RelayLiveClient?
  private var workspaceLiveWorkspaceID: String?
  private var workspaceLiveConversationIDs: Set<String> = []
  private var readState = ConversationReadState()
  private var readStateWorkspaceID: String?
  private var hydratedReadConversations: Set<ConversationKey> = []
  private var notifiedMessageIDs: Set<String> = []
  private let launchedAt = Date.now
  private(set) var isAppActive = true
  private(set) var visibleConversationID: String?
  private(set) var visibleThreadRootID: String?
  private(set) var onboardingInProgress = false
  private var cellRuntimeBooted = false
  /// Genuine in-flight cell work, grouped by conversation. Mission Control
  /// presents the union so the user can watch delegated specialists progress.
  private(set) var workingAgents: [ConversationKey: Set<String>] = [:]
  private(set) var agentActivityRecords: [String: AgentActivityRecord] = [:]
  private var activeAgentActivityIDs: [String: String] = [:]
  /// Relay-authoritative run history, keyed by the isolated agent mailbox.
  /// Terminal failures remain visible and retryable across process restarts.
  private(set) var agentJobsByAgentID: [String: [AgentJobRecord]] = [:]
  /// True while the user is adding ANOTHER workspace (Add workspace). Distinguishes
  /// creating a new org from re-entering an already-completed one, which the
  /// single-workspace idempotency guard in completeOnboarding guards against.
  private var pendingNewWorkspace = false

  let sessions: SessionStore
  let workspaces: WorkspaceStore
  let inferenceCredentials: InferenceCredentialStore
  let deviceModels: OnDeviceModelStore
  let relay: any RelayServing
  let conversations: ConversationCache
  let authentication: any MobileAuthenticationServing
  private let configStore = AgentConfigStore()
  private let readStateStore = ConversationReadStateStore()
  private let appConfiguration: AppConfiguration

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
    #if DEBUG
      case .codexBridge:
        return DevCodexBridgeSettings.isConfigured
          && inferenceCredentials.contains(.codexBridge)
    #endif
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
    authentication: any MobileAuthenticationServing
  ) {
    self.sessions = sessions
    self.workspaces = workspaces
    self.inferenceCredentials = inferenceCredentials
    self.deviceModels = deviceModels
    self.relay = relay
    self.conversations = conversations
    self.authentication = authentication
    self.appConfiguration = AppConfiguration.current()
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
      authentication: URLSessionOAuthAuthenticationClient(configuration: configuration)
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
        onboarding.inferenceModel = OpenCodeModelCatalog.recommendedFreeModelID
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
      phase = .workspace
    }
    do {
      try await bindCurrentDevice(using: stored)
    } catch MobileAuthenticationError.invalidSession {
      onboardingLog.notice("stored account session is no longer valid")
      try? sessions.clear()
      session = nil
      phase = .signedOut
      return
    } catch {
      onboardingError = error.localizedDescription
      workspaceSyncFailed = true
      onboardingLog.error("device account binding failed: \(error.localizedDescription)")
      await hydrateWorkspace()
      return
    }
    await hydrateWorkspace()
  }

  /// Boots the on-phone cell runtime (V8 + one isolated cell per agent) so the agent
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
      let host = ChiefOpenCodeAgentHost(
        relay: relay,
        credentials: inferenceCredentials,
        onActivity: { [weak self] workspaceID, conversationID, agentID, component in
          await self?.recordAgentActivity(
            workspaceID: workspaceID,
            conversationID: conversationID,
            agentID: agentID,
            component: component
          )
        }
      )
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
    mentions: [String] = [],
    agentID requestedAgentID: String? = nil
  ) async {
    guard let workspaceID = workspace?.id else { return }
    guard let agentID = agentTurnTarget(
      conversationID: conversationID,
      threadRootID: threadRootID,
      mentions: mentions,
      requestedAgentID: requestedAgentID
    ) else {
      onboardingLog.warning(
        "ignored agent turn without an addressed cell in \(conversationID, privacy: .public)"
      )
      return
    }
    setAgentWorking(
      agentID: agentID,
      workspaceID: workspaceID,
      conversationID: conversationID,
      isWorking: true
    )
    defer {
      setAgentWorking(
        agentID: agentID,
        workspaceID: workspaceID,
        conversationID: conversationID,
        isWorking: false
      )
    }
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
        transcript.last(where: {
          guard $0.threadRootID == threadRootID else { return false }
          if case .user = $0.author { return true }
          return false
        })?
        .body ?? "Continue."
      let agentName = WorkspaceAgentCatalog.agent(forID: agentID)?.name ?? "Chief"
      print(
        "[Chief] agent turn starting for \(conversationID) agent=\(agentName) mentions=\(mentions.count)"
      )
      do {
        let scope = try ChiefCellRuntime.scope(
          workspaceID: workspaceID,
          agentID: agentID
        )
        let result = try await ChiefCellRuntime.shared.runTurn(
          scope: scope,
          conversationID: conversationID,
          userText: userText
        )
        let turn = try TurnExtractor.extract(from: result)
        print("[Chief] agent turn produced \(turn.reply.count) characters")
        // Post as THAT agent (self-auth) so the relay attributes the reply to the
        // agent, not the workspace owner. Components carry the turn's reasoning +
        // tool activity so the transcript shows the work, not just the final line.
        let agentIdentity = try AgentIdentityStore(
          workspaceID: workspaceID,
          agentID: agentID
        ).ensure()
        let message = try await relay.sendAsAgent(
          body: turn.reply,
          workspaceID: workspaceID,
          conversationID: conversationID,
          threadRootID: threadRootID,
          mentions: mentions,
          components: turn.components,
          signingIdentity: agentIdentity
        )
        await MainActor.run { conversations.merge(message) }
        print("[Chief] agent reply published to \(conversationID)")
      } catch {
        recordAgentActivity(
          workspaceID: workspaceID,
          conversationID: conversationID,
          agentID: agentID,
          component: AgentRunFailure(error).component()
        )
        onboardingLog.error("agent turn: cell failed: \(error)")
        print("[Chief] agent turn failed: \(error)")
      }
    #endif
  }

  /// Resolve the exact keyed cell that owns a user turn. Explicit mentions are
  /// authoritative; a channel message must never silently fall back to Chief.
  private func agentTurnTarget(
    conversationID: String,
    threadRootID: String?,
    mentions: [String],
    requestedAgentID: String?
  ) -> String? {
    if let requestedAgentID,
      let requested = WorkspaceAgentCatalog.agent(forID: requestedAgentID)
    {
      return requested.id
    }
    if let mentioned = mentions.compactMap({ WorkspaceAgentCatalog.agent(forID: $0) }).first {
      return mentioned.id
    }
    if let direct = workspace?.conversations.first(where: { $0.id == conversationID }),
      direct.kind == .direct
    {
      return WorkspaceAgentCatalog.agent(forID: conversationID)?.id ?? "chief"
    }
    if let threadRootID,
      let root = conversations.messages(
        workspaceID: workspace?.id ?? "",
        conversationID: conversationID
      ).first(where: { $0.id == threadRootID })
    {
      if case .agent(let rootAgentID, _) = root.author {
        return WorkspaceAgentCatalog.agent(forID: rootAgentID)?.id
      }
    }
    return nil
  }

  /// Whether an agent turn is currently generating in a conversation. Drives the
  /// typing/working indicator in the transcript.
  func isAgentWorking(workspaceID: String?, conversationID: String) -> Bool {
    !workingAgentNames(workspaceID: workspaceID, conversationID: conversationID).isEmpty
  }

  func workingAgentNames(workspaceID: String?, conversationID: String) -> [String] {
    workingAgentPresences(
      workspaceID: workspaceID,
      conversationID: conversationID
    ).map(\.name)
  }

  func workingAgentPresences(
    workspaceID: String?,
    conversationID: String
  ) -> [AgentActivityPresence] {
    guard let workspaceID else { return [] }
    let ids: Set<String>
    if conversationID == "mission-control" {
      ids = workingAgents.reduce(into: Set<String>()) { result, entry in
        guard entry.key.workspaceID == workspaceID else { return }
        result.formUnion(entry.value)
      }
    } else {
      ids =
        workingAgents[
          ConversationKey(workspaceID: workspaceID, conversationID: conversationID)
        ] ?? []
    }
    let roster = workspace?.agents.map(\.id) ?? []
    return ids.sorted {
      (roster.firstIndex(of: $0) ?? .max) < (roster.firstIndex(of: $1) ?? .max)
    }.map { agentID in
      AgentActivityPresence(
        id: agentID,
        name: workspace?.agents.first(where: { $0.id == agentID })?.name
          ?? WorkspaceAgentCatalog.agent(forID: agentID)?.name
          ?? agentID.capitalized
      )
    }
  }

  func activityRecords(
    workspaceID: String?,
    conversationID: String,
    agentID: String? = nil
  ) -> [AgentActivityRecord] {
    guard let workspaceID else { return [] }
    return agentActivityRecords.values.filter { record in
      record.workspaceID == workspaceID
        && (conversationID == "mission-control" || record.conversationID == conversationID)
        && (agentID == nil || record.agentID == agentID)
    }.sorted { $0.updatedAt > $1.updatedAt }
  }

  func activityErrorCount(workspaceID: String?, conversationID: String) -> Int {
    let latestByAgent = Dictionary(
      grouping: activityRecords(workspaceID: workspaceID, conversationID: conversationID),
      by: \.agentID
    ).compactMap { $0.value.first }
    var agentIDs = Set(
      latestByAgent.compactMap { record in
        record.components.contains { $0.kind == "error" } ? record.agentID : nil
      }
    )
    agentIDs.formUnion(
      failedAgentJobs(
        workspaceID: workspaceID,
        conversationID: conversationID
      ).map(\.agentId)
    )
    return agentIDs.count
  }

  func failedAgentJobs(
    workspaceID: String?,
    conversationID: String,
    agentID: String? = nil
  ) -> [AgentJobRecord] {
    guard let workspaceID, workspace?.id == workspaceID else { return [] }
    return agentJobsByAgentID.values.flatMap { $0 }.filter { job in
      job.workspaceId == workspaceID
        && job.status == "failed"
        && (conversationID == "mission-control"
          || job.payload.conversationId == conversationID)
        && (agentID == nil || job.agentId == agentID)
    }.sorted { $0.updatedDate > $1.updatedDate }
  }

  func refreshAgentJobs() async {
    guard let workspace else { return }
    await refreshAgentJobs(for: workspace)
  }

  func retryAgentJob(_ job: AgentJobRecord) async {
    guard workspace?.id == job.workspaceId, job.status == "failed" else { return }
    do {
      _ = try await relay.retryAgentJob(
        workspaceID: job.workspaceId,
        agentID: job.agentId,
        jobID: job.id
      )
      await refreshAgentJobs()
    } catch {
      onboardingLog.error(
        "agent job retry failed for \(job.agentId, privacy: .public): \(error.localizedDescription)"
      )
    }
  }

  private func refreshAgentJobs(for snapshot: WorkspaceSnapshot) async {
    let relay = relay
    let fetched = await withTaskGroup(
      of: (String, [AgentJobRecord])?.self,
      returning: [String: [AgentJobRecord]].self
    ) { group in
      for agent in snapshot.agents {
        group.addTask {
          do {
            return (
              agent.id,
              try await relay.agentJobs(
                workspaceID: snapshot.id,
                agentID: agent.id
              )
            )
          } catch {
            return nil
          }
        }
      }
      var jobs: [String: [AgentJobRecord]] = [:]
      for await result in group {
        if let result { jobs[result.0] = result.1 }
      }
      return jobs
    }
    guard workspace?.id == snapshot.id else { return }
    agentJobsByAgentID = fetched
  }

  private func recordAgentActivity(
    workspaceID: String,
    conversationID: String,
    agentID: String,
    component: MessageComponent
  ) {
    let activityKey = "\(workspaceID):\(conversationID):\(agentID)"
    let id = activeAgentActivityIDs[activityKey] ?? UUID().uuidString
    activeAgentActivityIDs[activityKey] = id
    var record = agentActivityRecords[id] ?? AgentActivityRecord(
      id: id,
      workspaceID: workspaceID,
      conversationID: conversationID,
      agentID: agentID,
      startedAt: .now,
      updatedAt: .now,
      completedAt: nil,
      components: []
    )
    if let index = record.components.firstIndex(where: { $0.id == component.id }) {
      record.components[index] = component
    } else {
      record.components.append(component)
    }
    record.updatedAt = .now
    record.completedAt = nil
    agentActivityRecords[id] = record
    if component.kind == "tool",
      component.payload["status"] == "completed",
      [RelayChannelCreateTool.name, RelayChannelMembersAddTool.name]
        .contains(component.payload["name"] ?? "")
    {
      // Channel topology changes arrive through a genuine completed tool call.
      // Refresh from that event so a newly created specialist channel appears
      // while the agent is still working, without introducing polling.
      Task { [weak self] in
        await self?.refreshWorkspaceAfterAgentCompletion(expectedID: workspaceID)
      }
    }
  }

  private func setAgentWorking(
    agentID: String,
    workspaceID: String,
    conversationID: String,
    isWorking: Bool
  ) {
    let key = ConversationKey(workspaceID: workspaceID, conversationID: conversationID)
    var agents = workingAgents[key] ?? []
    let activityKey = "\(workspaceID):\(conversationID):\(agentID)"
    if isWorking {
      agents.insert(agentID)
      if activeAgentActivityIDs[activityKey] == nil {
        let activityID = UUID().uuidString
        activeAgentActivityIDs[activityKey] = activityID
        agentActivityRecords[activityID] = AgentActivityRecord(
          id: activityID,
          workspaceID: workspaceID,
          conversationID: conversationID,
          agentID: agentID,
          startedAt: .now,
          updatedAt: .now,
          completedAt: nil,
          components: []
        )
      }
    } else {
      agents.remove(agentID)
      if let activityID = activeAgentActivityIDs.removeValue(forKey: activityKey),
        var record = agentActivityRecords[activityID]
      {
        record.updatedAt = .now
        record.completedAt = .now
        agentActivityRecords[activityID] = record
      }
    }
    if agents.isEmpty {
      workingAgents.removeValue(forKey: key)
    } else {
      workingAgents[key] = agents
    }
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
    phase = .launching
    Task {
      do {
        try await bindCurrentDevice(using: signedIn)
        await hydrateWorkspace()
      } catch MobileAuthenticationError.invalidSession {
        onboardingLog.notice("new account session was rejected during device binding")
        try? sessions.clear()
        session = nil
        phase = .signedOut
      } catch {
        onboardingError = error.localizedDescription
        workspaceSyncFailed = true
        onboardingLog.error("device account binding failed: \(error.localizedDescription)")
        await hydrateWorkspace()
      }
    }
  }

  /// Binds only the local device's public signing key to the signed-in Chief
  /// account. Each installation keeps a distinct Keychain private key, so a
  /// phone or desktop can be enrolled first and either can later be revoked
  /// without rotating every other device.
  private func bindCurrentDevice(using current: ChiefSession) async throws {
    let refreshed = try await authentication.refreshAccountSession(current)
    try await relay.bindDeviceIdentity(accountToken: refreshed.accessToken)
    try sessions.save(refreshed)
    session = refreshed
    onboardingLog.info("bound this device to Chief account \(current.user.id, privacy: .private)")
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
  }

  func hydrateWorkspace() async {
    do {
      let loaded = try await relay.loadWorkspace()
      workspace = loaded
      configureReadState(for: loaded.id)
      try? workspaces.save(loaded)
      phase = .workspace
      if !loaded.onboardingComplete {
        recoverPendingOnboarding(for: loaded)
        // An incomplete durable job is work in progress, not a failure. Resume
        // it automatically when this device still has its inference credential.
        onboardingError = nil
      } else {
        onboardingError = nil
        workspaceSyncFailed = false
      }
      onboardingLog.info(
        "hydrated workspace \(loaded.id, privacy: .public) complete=\(loaded.onboardingComplete)"
      )
      print("[Chief] hydrated workspace \(loaded.id) complete=\(loaded.onboardingComplete)")
      await refreshWorkspaces()
      await registerAgentKeyIfNeeded(workspaceID: loaded.id)
      await refreshAgentConfigCache(for: loaded)
      await refreshAgentJobs(for: loaded)
      await refreshCurrentChannelMemberships(for: loaded)
      syncWorkspaceLiveStreams(for: loaded)
      await MobileNotifications.shared.requestAuthorizationIfNeeded()
      if loaded.onboardingComplete { startAgentLoopIfNeeded() }
      else if hasRecoverableInferenceCredential {
        Task { [weak self] in await self?.completeOnboarding() }
      }
      if pendingWorkspaceInvite != nil { await preparePendingWorkspaceInvite() }
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

  /// Register every roster agent's own pubkey with the workspace so each agent can
  /// self-authenticate and post as itself (no impersonation). Idempotent: the
  /// relay ignores re-registration of an existing key.
  private func registerAgentKeyIfNeeded(workspaceID: String) async {
    let roster = workspace?.agents.map(\.id) ?? ["chief"]
    await withTaskGroup(of: Void.self) { group in
      for agentID in roster {
        group.addTask { [weak self] in
          await self?.registerAgentKey(
            workspaceID: workspaceID,
            agentID: agentID
          )
        }
      }
    }
  }

  private func registerAgentKey(workspaceID: String, agentID: String) async {
    guard
      let identity = try? AgentIdentityStore(
        workspaceID: workspaceID,
        agentID: agentID
      ).ensure()
    else { return }
    do {
      try await relay.registerAgentKey(
        workspaceID: workspaceID,
        agentID: agentID,
        pubkey: identity.publicKeyHex
      )
      print("[Chief] registered \(agentID) agent key with workspace")
    } catch {
      onboardingLog.warning(
        "could not register \(agentID) agent key: \(error.localizedDescription)"
      )
      print("[Chief] could not register \(agentID) agent key: \(error)")
    }
  }

  private func refreshAgentConfigCache(for snapshot: WorkspaceSnapshot) async {
    for agent in snapshot.agents {
      do {
        let config =
          try await relay.loadAgentConfig(
            workspaceID: snapshot.id,
            agentID: agent.id
          ) ?? AgentConfig.defaults(for: agent.id)
        configStore.save(
          workspaceID: snapshot.id,
          agentID: agent.id,
          config: config
        )
      } catch {
        onboardingLog.warning(
          "could not refresh config for \(agent.id): \(error.localizedDescription)"
        )
      }
    }
  }

  /// Persist onboarding's model choice before any cell claims work. The relay
  /// remains authoritative and every agent receives its own policy record;
  /// selecting a model is never merely cosmetic UI state.
  private func configureInitialAgentModels(for snapshot: WorkspaceSnapshot) async throws {
    #if DEBUG
      // The paired Mac is an ephemeral development transport, not an agent
      // configuration. Leave every relay-authoritative cell record untouched.
      if onboarding.inferenceProvider == .codexBridge { return }
    #endif
    let selectedModel = onboarding.inferenceModel
    let relay = relay
    let workspaceID = snapshot.id
    let configured = try await withThrowingTaskGroup(
      of: (String, AgentConfig).self,
      returning: [(String, AgentConfig)].self
    ) { group in
      for agent in snapshot.agents {
        group.addTask {
          var config =
            try await relay.loadAgentConfig(
              workspaceID: workspaceID,
              agentID: agent.id
            ) ?? AgentConfig.defaults(for: agent.id)
          config.model = selectedModel
          try await relay.saveAgentConfig(
            workspaceID: workspaceID,
            agentID: agent.id,
            config: config
          )
          return (agent.id, config)
        }
      }
      var values: [(String, AgentConfig)] = []
      for try await value in group { values.append(value) }
      return values
    }
    for (agentID, config) in configured {
      configStore.save(
        workspaceID: workspaceID,
        agentID: agentID,
        config: config
      )
    }
  }

  /// Refresh the list of workspaces the identity belongs to (used by the
  /// switcher). Best-effort; never blocks hydration.
  func refreshWorkspaces() async {
    do {
      workspaceSummaries = try await relay.listWorkspaces()
    } catch is CancellationError {
      return
    } catch {
      print("[Chief] list workspaces failed: \(error)")
    }
  }

  /// Switch the active organization, mirroring the desktop workspace rail. The
  /// conversation cache is cleared so no state leaks across tenants; the new
  /// workspace then rehydrates from the relay.
  func switchWorkspace(workspaceID: String) async -> Bool {
    print("[Chief] switching to workspace \(workspaceID)")
    stopWorkspaceLiveStreams()
    do {
      try await relay.switchWorkspace(id: workspaceID)
    } catch {
      onboardingLog.error("switch workspace failed: \(error)")
      print("[Chief] switch workspace failed: \(error)")
      return false
    }
    conversations.clearAll()
    workspace = nil
    try? workspaces.clear()
    await hydrateWorkspace()
    return workspace?.id == workspaceID
  }

  func handleIncomingURL(_ url: URL) async {
    guard let link = WorkspaceInviteLink(url: url) else {
      #if DEBUG
        await connectDevelopmentCodexBridge(url)
      #endif
      return
    }
    pendingWorkspaceInvite = link
    workspaceInviteError = nil
    guard session != nil else { return }
    await preparePendingWorkspaceInvite()
  }

  func prepareWorkspaceInvite(from value: String) async {
    guard let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
      let link = WorkspaceInviteLink(url: url)
    else {
      workspaceInviteError = "Paste a valid Chief workspace invitation."
      return
    }
    pendingWorkspaceInvite = link
    await preparePendingWorkspaceInvite()
  }

  func preparePendingWorkspaceInvite() async {
    guard let link = pendingWorkspaceInvite, !workspaceInviteInProgress else { return }
    workspaceInviteInProgress = true
    workspaceInviteError = nil
    defer { workspaceInviteInProgress = false }
    do {
      let preview = try await relay.previewWorkspaceInvite(link)
      await refreshWorkspaces()
      if workspaceSummaries.contains(where: { $0.id == preview.workspaceId }) {
        if preview.conversationId != nil {
          _ = try await relay.claimWorkspaceInvite(link)
        }
        if await switchWorkspace(workspaceID: preview.workspaceId) {
          if let conversationID = preview.conversationId {
            selectedConversationID = conversationID
          }
          clearWorkspaceInvite()
        }
        return
      }
      workspaceInvitePreview = preview
    } catch {
      workspaceInviteError = error.localizedDescription
    }
  }

  func claimPendingWorkspaceInvite() async -> Bool {
    guard let link = pendingWorkspaceInvite, !workspaceInviteInProgress else { return false }
    workspaceInviteInProgress = true
    workspaceInviteError = nil
    defer { workspaceInviteInProgress = false }
    do {
      let claim = try await relay.claimWorkspaceInvite(link)
      await refreshWorkspaces()
      guard await switchWorkspace(workspaceID: claim.workspaceId) else { return false }
      if let conversationID = claim.conversationId {
        selectedConversationID = conversationID
      }
      clearWorkspaceInvite()
      return true
    } catch {
      workspaceInviteError = error.localizedDescription
      return false
    }
  }

  func clearWorkspaceInvite() {
    pendingWorkspaceInvite = nil
    workspaceInvitePreview = nil
    workspaceInviteError = nil
  }

  func createWorkspaceInvite(conversationID: String? = nil) async -> WorkspaceInviteLink? {
    guard let workspaceID = workspace?.id else { return nil }
    do {
      return try await relay.createWorkspaceInvite(
        workspaceID: workspaceID,
        conversationID: conversationID
      )
    } catch {
      workspaceInviteError = error.localizedDescription
      return nil
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

    if !onboarding.canContinue, let existing = workspace, !existing.onboardingComplete {
      recoverPendingOnboarding(for: existing)
    }
    guard onboarding.canContinue else {
      onboardingError = "Choose an inference provider before retrying setup."
      phase = .onboarding
      return
    }
    onboardingError = nil
    guard onboarding.runtime == .phone else {
      onboardingError = "Chief Cloud setup is not available in this build yet."
      return
    }
    let selection =
      "runtime=\(onboarding.runtime?.rawValue ?? "nil") provider=\(onboarding.inferenceProvider?.rawValue ?? "nil") model=\(onboarding.inferenceModel)"
    onboardingLog.info("completing \(selection)")
    print("[Chief] completing \(selection)")

    // Idempotency: a single-workspace re-entry of an already on-boarded
    // workspace just opens it. Creating a NEW workspace (Add workspace) skips
    // this guard so it genuinely creates another org instead of bouncing back.
    if !pendingNewWorkspace, let existing = workspace, existing.onboardingComplete {
      phase = .workspace
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
    #if DEBUG
      if onboarding.inferenceProvider == .codexBridge {
        guard DevCodexBridgeSettings.isConfigured,
          inferenceCredentials.contains(.codexBridge)
        else {
          onboardingError = "Connect this debug build to Codex on your Mac before continuing."
          return
        }
      }
    #endif

    do {
      let pending: WorkspaceSnapshot
      if let existing = workspaceForOnboardingResume {
        pending = existing
      } else {
        pending = try await relay.createWorkspace(from: onboarding)
        workspace = pending
        upsertWorkspaceSummary(for: pending, isActive: true)
        // This file is only a launch cache. The relay is authoritative, so a
        // local persistence failure must not prevent the durable job from
        // being claimed and completed.
        try? workspaces.save(pending)
      }
      workspace = pending
      selectedTab = .home
      selectedConversationID = nil
      phase = .workspace
      configureReadState(for: pending.id)
      await refreshCurrentChannelMemberships(for: pending)
      syncWorkspaceLiveStreams(for: pending)
      // Enter the relay-backed workspace immediately. Key registration still
      // completes before a cell claims work, but independent agent keys are
      // enrolled concurrently instead of making the first visible arrival wait
      // on one round-trip per roster member.
      Task { await MobileNotifications.shared.requestAuthorizationIfNeeded() }
      setAgentWorking(
        agentID: "chief",
        workspaceID: pending.id,
        conversationID: "mission-control",
        isWorking: true
      )
      await registerAgentKeyIfNeeded(workspaceID: pending.id)
      try await configureInitialAgentModels(for: pending)
      await bootCellRuntimeIfNeeded()
      let worker = PhoneWorkspaceSetupWorker(
        relay: relay,
        credentials: inferenceCredentials,
        onActivity: { [weak self] workspaceID, conversationID, agentID, component in
          await self?.recordAgentActivity(
            workspaceID: workspaceID,
            conversationID: conversationID,
            agentID: agentID,
            component: component
          )
        }
      )
      onboardingLog.info("starting phone worker for \(pending.id, privacy: .public)")
      try await worker.run(draft: onboarding, workspaceID: pending.id)
      let remote = try await relay.loadWorkspace()
      guard remote.onboardingComplete else {
        throw WorkspaceSetupError.missingJob
      }
      workspace = remote
      await refreshCurrentChannelMemberships(for: remote)
      upsertWorkspaceSummary(for: remote, isActive: true)
      recomputeAllConversationPresentation()
      syncWorkspaceLiveStreams(for: remote)
      try? workspaces.save(remote)
      workspaceSyncFailed = false
      onboardingError = nil
      pendingNewWorkspace = false
      onboardingLog.info("relay created workspace \(remote.id)")
      print("[Chief] relay created workspace \(remote.id)")
      setAgentWorking(
        agentID: "chief",
        workspaceID: remote.id,
        conversationID: "mission-control",
        isWorking: false
      )
    } catch {
      // A missing job when onboarding already completed (e.g. a duplicate
      // trigger that lost the claim race) is not a relay outage — do not raise
      // the misleading "local only" banner.
      if isRelayConnectivity(error) {
        workspaceSyncFailed = true
      }
      onboardingError =
        (error as? LocalizedError)?.errorDescription
        ?? "Chief could not finish setting up this workspace. Try again."
      onboardingLog.error("relay createWorkspace failed: \(error)")
      print("[Chief] relay createWorkspace failed: \(error)")
      if let workspaceID = workspace?.id {
        setAgentWorking(
          agentID: "chief",
          workspaceID: workspaceID,
          conversationID: "mission-control",
          isWorking: false
        )
      }
      if workspace?.onboardingComplete == true {
        phase = .workspace
        startAgentLoopIfNeeded()
      }
      return
    }
    phase = .workspace
    await refreshWorkspaces()
    startAgentLoopIfNeeded()
  }

  private func isRelayConnectivity(_ error: Error) -> Bool {
    if error is URLError { return true }
    guard let relayError = error as? RelayError else { return false }
    switch relayError {
    case .unavailable:
      return true
    case .httpStatus(let status):
      return status >= 500
    case .unauthorized, .unsupportedRelay:
      return false
    }
  }

  private func recoverPendingOnboarding(for snapshot: WorkspaceSnapshot) {
    onboarding.runtime = .phone
    onboarding.companyName = snapshot.name
    onboarding.step = 3
    #if DEBUG
      if DevCodexBridgeSettings.isConfigured,
        inferenceCredentials.contains(.codexBridge)
      {
        onboarding.inferenceProvider = .codexBridge
        onboarding.inferenceModel = DevCodexBridgeSettings.model
        return
      }
    #endif
    if inferenceCredentials.contains(.openCodeGo) {
      onboarding.inferenceProvider = .openCodeGo
      onboarding.inferenceModel = OpenCodeModelCatalog.recommendedFreeModelID
    }
  }

  private var hasRecoverableInferenceCredential: Bool {
    #if DEBUG
      if DevCodexBridgeSettings.isConfigured,
        inferenceCredentials.contains(.codexBridge)
      { return true }
    #endif
    return inferenceCredentials.contains(.openCodeGo)
  }

  #if DEBUG
    /// Accepts only the development bridge's tightly validated custom URL.
    /// The capability token is device-only Keychain material and is never
    /// persisted in the workspace, relay, transcript, or app logs.
    func connectDevelopmentCodexBridge(_ url: URL) async {
      do {
        let connection = try DevCodexBridgeConnection(url: url)
        try inferenceCredentials.save(connection.capabilityToken, for: .codexBridge)
        DevCodexBridgeSettings.save(connection)
        onboarding.runtime = .phone
        onboarding.inferenceProvider = .codexBridge
        onboarding.inferenceModel = connection.model
        onboardingError = nil

        onboardingLog.info("connected development Codex bridge model=\(connection.model, privacy: .public)")
        print("[Chief] connected development Codex bridge model=\(connection.model)")
        if workspace?.onboardingComplete == false {
          await completeOnboarding()
        }
      } catch {
        onboardingError = error.localizedDescription
        onboardingLog.error("development Codex bridge connection failed: \(error.localizedDescription)")
      }
    }
  #endif

  /// Resume an incomplete workspace only when setup was entered as recovery.
  /// An explicit Add workspace flow must always create the newly named tenant,
  /// even when the previously active workspace is itself incomplete.
  var workspaceForOnboardingResume: WorkspaceSnapshot? {
    guard !pendingNewWorkspace, let workspace, !workspace.onboardingComplete else {
      return nil
    }
    return workspace
  }

  private func upsertWorkspaceSummary(for snapshot: WorkspaceSnapshot, isActive: Bool) {
    if isActive {
      workspaceSummaries = workspaceSummaries.map { summary in
        WorkspaceSummary(
          id: summary.id,
          name: summary.name,
          website: summary.website,
          imageURL: summary.imageURL,
          isActive: false,
          onboardingComplete: summary.onboardingComplete
        )
      }
    }
    let summary = WorkspaceSummary(
      id: snapshot.id,
      name: snapshot.name,
      website: snapshot.website,
      imageURL: snapshot.imageURL,
      isActive: isActive,
      onboardingComplete: snapshot.onboardingComplete
    )
    if let index = workspaceSummaries.firstIndex(where: { $0.id == snapshot.id }) {
      workspaceSummaries[index] = summary
    } else {
      workspaceSummaries.append(summary)
    }
  }

  func openConversation(_ id: String) {
    selectedConversationID = id
    selectedTab = .home
  }

  // MARK: - Read state and workspace-wide live delivery

  /// The overview needs live delivery for every conversation the principal can
  /// participate in, not every public catalogue entry. Waiting for the
  /// relay-authoritative membership snapshot prevents a freshly loaded
  /// workspace from opening sockets that can only be rejected.
  private func syncWorkspaceLiveStreams(for snapshot: WorkspaceSnapshot) {
    guard !appConfiguration.demoMode else { return }
    guard isAppActive || workspaceLiveClient != nil else { return }
    let joinedChannelIDs = membershipWorkspaceID == snapshot.id
      ? joinedConversationIDs
      : nil
    let desired: Set<String> = Set(
      snapshot.conversations.compactMap { conversation -> String? in
        guard conversation.kind == .direct
          || joinedChannelIDs?.contains(conversation.id) == true
        else { return nil }
        return conversation.id
      }
    )
    if workspaceLiveWorkspaceID != snapshot.id {
      stopWorkspaceLiveStreams()
    }
    workspaceLiveWorkspaceID = snapshot.id
    workspaceLiveConversationIDs = desired
    if let client = workspaceLiveClient {
      Task {
        try? await client.updateSubscriptions(
          workspaceID: snapshot.id,
          conversationIDs: desired
        )
      }
      return
    }
    startWorkspaceLiveStream(workspaceID: snapshot.id)
  }

  private func startWorkspaceLiveStream(workspaceID: String) {
    guard workspaceLiveTask == nil else { return }
    let client = RelayLiveClient(configuration: appConfiguration)
    workspaceLiveClient = client
    workspaceLiveTask = Task { [weak self, client] in
      var failureCount = 0
      while !Task.isCancelled {
        var connectedAt: Date?
        do {
          guard let self, self.workspaceLiveWorkspaceID == workspaceID else { break }
          try await client.connect(
            workspaceID: workspaceID,
            conversationIDs: self.workspaceLiveConversationIDs
          ) { [weak self] event in
            Task { @MainActor [weak self] in
              self?.handleLiveEvent(event, expectedWorkspaceID: workspaceID)
            }
          }
          connectedAt = .now
          await client.waitUntilDisconnected()
          if Task.isCancelled { break }
        } catch is CancellationError {
          break
        } catch {
          liveLog.warning(
            "workspace live stream failed: \(error.localizedDescription)"
          )
        }
        if let connectedAt, Date.now.timeIntervalSince(connectedAt) >= 60 {
          failureCount = 0
        }
        failureCount += 1
        let baseSeconds = min(pow(2.0, Double(min(failureCount - 1, 5))), 30)
        let jitter = Double.random(in: 0...0.5)
        do {
          try await Task.sleep(for: .seconds(baseSeconds + jitter))
        } catch {
          break
        }
      }
      await client.disconnect()
    }
  }

  private func stopWorkspaceLiveStreams() {
    workspaceLiveBackgroundStopTask?.cancel()
    workspaceLiveBackgroundStopTask = nil
    workspaceLiveTask?.cancel()
    workspaceLiveTask = nil
    workspaceLiveWorkspaceID = nil
    workspaceLiveConversationIDs = []
    if let client = workspaceLiveClient { Task { await client.disconnect() } }
    workspaceLiveClient = nil
  }

  private func configureReadState(for workspaceID: String) {
    guard readStateWorkspaceID != workspaceID else { return }
    stopWorkspaceLiveStreams()
    membershipWorkspaceID = nil
    joinedConversationIDs = nil
    readStateWorkspaceID = workspaceID
    readState = readStateStore.load(workspaceID: workspaceID, readerID: readStateReaderID)
    hydratedReadConversations.removeAll()
    notifiedMessageIDs.removeAll()
  }

  private var readStateReaderID: String {
    session?.user.id
      ?? (try? NostrKeychainStore().load())?.publicKeyHex
      ?? "device-owner"
  }

  private func hydrateReadSnapshot(
    _ messages: [ConversationMessage],
    workspaceID: String,
    conversationID: String
  ) {
    guard workspace?.id == workspaceID else { return }
    messages.forEach(conversations.merge)
    let key = ConversationKey(workspaceID: workspaceID, conversationID: conversationID)
    if hydratedReadConversations.insert(key).inserted {
      let context = ConversationReadState.channelKey(conversationID)
      if readState.contexts[context] == nil,
        let latestHistorical = messages
          .filter({ !$0.isOwnMessage(session: session) && $0.createdAt <= launchedAt })
          .map(\.createdAt)
          .max()
      {
        advanceReadContext(context, to: latestHistorical)
      }
    }
    if let latest = messages.max(by: { $0.createdAt < $1.createdAt }) {
      updateConversationPreview(with: latest)
    }
    for message in messages where message.createdAt > launchedAt {
      recordArrival(message)
    }
    recomputeUnreadCount(conversationID: conversationID)
  }

  private func handleLiveEvent(_ event: LiveEvent, expectedWorkspaceID: String) {
    guard workspace?.id == expectedWorkspaceID else { return }
    switch event {
    case .appended(let message):
      conversations.merge(message)
      updateConversationPreview(with: message)
      applyCurrentUserMembershipEvent(message)
      guard isConversationJoined(message.conversationID) else { return }
      if message.createdAt <= launchedAt {
        let context = ConversationReadState.channelKey(message.conversationID)
        if readState.contexts[context] == nil {
          advanceReadContext(context, to: message.createdAt)
        }
        recomputeUnreadCount(conversationID: message.conversationID)
        return
      }
      recordArrival(message)
      if isAppActive, visibleConversationID == message.conversationID {
        markChannelRead(conversationID: message.conversationID)
      } else {
        recomputeUnreadCount(conversationID: message.conversationID)
      }
    case .reacted(let message), .edited(let message), .deleted(let message):
      conversations.update(message)
      if case .edited = event { updateConversationPreview(with: message) }
    }
  }

  private func recordArrival(_ message: ConversationMessage) {
    guard !message.isOwnMessage(session: session) else { return }
    guard isConversationJoined(message.conversationID) else { return }
    guard notifiedMessageIDs.insert(message.id).inserted else { return }
    if notifiedMessageIDs.count > 500, let oldest = notifiedMessageIDs.first {
      notifiedMessageIDs.remove(oldest)
    }

    if isAppActive {
      Haptics.medium()
      NotificationSoundPlayer.shared.playConfigured()
      return
    }
    guard let workspace else { return }
    let conversation = workspace.conversations.first { $0.id == message.conversationID }
    let title = conversation?.kind == .direct
      ? message.author.displayName
      : "\(message.author.displayName) in #\(conversation?.name ?? "channel")"
    Task {
      await MobileNotifications.shared.deliver(
        title: title,
        body: message.body,
        workspaceID: workspace.id,
        conversationID: message.conversationID,
        threadRootID: message.threadRootID
      )
    }
  }

  /// Channel membership messages are relay-authored, signed live events. Apply
  /// only events explicitly targeting the current user so another member's
  /// invite can never change this device's joined-channel state.
  private func applyCurrentUserMembershipEvent(_ message: ConversationMessage) {
    guard let userID = session?.user.id else { return }
    for component in message.components where component.kind == "channel-action" {
      guard component.payload["targetKind"] == "user",
        component.payload["targetId"] == userID
      else { continue }
      switch component.payload["type"] {
      case "member-added":
        setConversationJoined(message.conversationID, joined: true)
      case "member-removed":
        setConversationJoined(message.conversationID, joined: false)
      default:
        break
      }
    }
  }

  func setAppActive(_ active: Bool) {
    isAppActive = active
    workspaceLiveBackgroundStopTask?.cancel()
    workspaceLiveBackgroundStopTask = nil
    if active {
      if let workspace { syncWorkspaceLiveStreams(for: workspace) }
    } else {
      workspaceLiveBackgroundStopTask = Task { [weak self] in
        try? await Task.sleep(for: .seconds(5))
        guard !Task.isCancelled, let self, !self.isAppActive else { return }
        self.stopWorkspaceLiveStreams()
      }
    }
    guard active, let visibleConversationID else { return }
    if let visibleThreadRootID {
      markThreadRead(
        conversationID: visibleConversationID,
        rootMessageID: visibleThreadRootID
      )
    }
    markChannelRead(conversationID: visibleConversationID)
  }

  func setVisibleConversation(_ conversationID: String) {
    visibleConversationID = conversationID
    visibleThreadRootID = nil
    markChannelRead(conversationID: conversationID)
  }

  func clearVisibleConversation(_ conversationID: String) {
    guard visibleConversationID == conversationID, visibleThreadRootID == nil else { return }
    visibleConversationID = nil
  }

  func setVisibleThread(conversationID: String, rootMessageID: String) {
    visibleConversationID = conversationID
    visibleThreadRootID = rootMessageID
    markThreadRead(conversationID: conversationID, rootMessageID: rootMessageID)
  }

  func clearVisibleThread(conversationID: String, rootMessageID: String) {
    guard
      visibleConversationID == conversationID,
      visibleThreadRootID == rootMessageID
    else { return }
    visibleThreadRootID = nil
    markChannelRead(conversationID: conversationID)
  }

  func markChannelRead(conversationID: String) {
    guard let workspaceID = workspace?.id else { return }
    let latest = conversations.messages(
      workspaceID: workspaceID,
      conversationID: conversationID
    ).map(\.createdAt).max() ?? .now
    advanceReadContext(ConversationReadState.channelKey(conversationID), to: latest)
    recomputeUnreadCount(conversationID: conversationID)
  }

  func markThreadRead(conversationID: String, rootMessageID: String) {
    guard let workspaceID = workspace?.id else { return }
    let latest = conversations.messages(
      workspaceID: workspaceID,
      conversationID: conversationID
    ).filter { $0.threadRootID == rootMessageID }.map(\.createdAt).max() ?? .now
    advanceReadContext(
      ConversationReadState.threadKey(conversationID, rootMessageID: rootMessageID),
      to: max(latest, .now)
    )
    recomputeUnreadCount(conversationID: conversationID)
  }

  func unreadThreadCount(conversationID: String, rootMessageID: String) -> Int {
    guard let workspaceID = workspace?.id else { return 0 }
    return conversations.messages(
      workspaceID: workspaceID,
      conversationID: conversationID
    ).filter {
      $0.threadRootID == rootMessageID
        && !$0.isOwnMessage(session: session)
        && isUnread($0)
    }.count
  }

  private func advanceReadContext(_ context: String, to date: Date) {
    guard readState.advance(context, to: date) else { return }
    guard let workspaceID = readStateWorkspaceID else { return }
    readStateStore.save(readState, workspaceID: workspaceID, readerID: readStateReaderID)
  }

  private func isUnread(_ message: ConversationMessage) -> Bool {
    readState.isUnread(
      createdAt: message.createdAt,
      conversationID: message.conversationID,
      threadRootID: message.threadRootID
    )
  }

  private func recomputeUnreadCount(conversationID: String) {
    guard let workspaceID = workspace?.id else { return }
    let count = conversations.messages(
      workspaceID: workspaceID,
      conversationID: conversationID
    ).filter {
      !$0.isOwnMessage(session: session) && isUnread($0)
    }.count
    mutateConversation(conversationID) { $0.unreadCount = count }
    let total = workspace?.conversations.reduce(0) { $0 + $1.unreadCount } ?? 0
    Task { await MobileNotifications.shared.setBadgeCount(total) }
  }

  private func updateConversationPreview(with message: ConversationMessage) {
    guard !message.deleted else { return }
    let preview = message.body.trimmingCharacters(in: .whitespacesAndNewlines)
    mutateConversation(message.conversationID) {
      $0.lastMessage = preview.isEmpty ? "Sent an attachment" : String(preview.prefix(140))
    }
  }

  private func recomputeAllConversationPresentation() {
    guard let workspaceID = workspace?.id else { return }
    for conversationID in workspace?.conversations.map(\.id) ?? [] {
      if let latest = conversations.messages(
        workspaceID: workspaceID,
        conversationID: conversationID
      ).max(by: { $0.createdAt < $1.createdAt }) {
        updateConversationPreview(with: latest)
      }
      recomputeUnreadCount(conversationID: conversationID)
    }
  }

  /// Toggle a reaction on a message, signed by the device user. The relay
  /// echoes the updated message, which the cache updates in place.
  func react(to messageID: String, conversationID: String, emoji: String, add: Bool) async {
    guard let workspaceID = workspace?.id else { return }
    guard let identity = try? NostrKeychainStore().load() else { return }
    do {
      let message = try await relay.react(
        workspaceID: workspaceID,
        conversationID: conversationID,
        messageID: messageID,
        emoji: emoji,
        add: add,
        signingIdentity: identity
      )
      conversations.update(message)
    } catch {
      print("[Chief] react \(emoji) on \(messageID) failed: \(error)")
    }
  }

  /// Edit a message body (author-only or workspace owner). The socket echoes the
  /// updated message so everyone in the conversation sees the change in place.
  func editMessage(messageID: String, conversationID: String, body: String) async {
    guard let workspaceID = workspace?.id else { return }
    do {
      let message = try await relay.editMessage(
        workspaceID: workspaceID,
        conversationID: conversationID,
        messageID: messageID,
        body: body
      )
      conversations.update(message)
    } catch {
      print("[Chief] edit \(messageID) failed: \(error)")
    }
  }

  /// Delete a message (author-only or workspace owner). Tombstoned on the
  /// relay; the socket echo removes it from view in place.
  func deleteMessage(messageID: String, conversationID: String) async {
    guard let workspaceID = workspace?.id else { return }
    do {
      let message = try await relay.deleteMessage(
        workspaceID: workspaceID,
        conversationID: conversationID,
        messageID: messageID
      )
      await MainActor.run { conversations.update(message) }
    } catch {
      print("[Chief] delete \(messageID) failed: \(error)")
    }
  }

  // MARK: - Channels (Phase 4)

  func directMessageRecipients() async -> [DirectMessageRecipient] {
    guard let workspace else { return [] }
    do {
      let members = try await relay.workspaceMembers(workspaceID: workspace.id)
      let currentUserID = (try? NostrKeychainStore().load())?.publicKeyHex
      let agentNames = Dictionary(
        uniqueKeysWithValues: workspace.agents.map { ($0.id, $0.name) }
      )
      return members
        .filter { !($0.kind == "user" && $0.principalId == currentUserID) }
        .map { member in
          DirectMessageRecipient(
            kind: member.kind,
            principalID: member.principalId,
            name: member.kind == "agent"
              ? (agentNames[member.principalId] ?? member.principalId)
              : member.principalId,
            role: member.role
          )
        }
        .sorted {
          if $0.isAgent != $1.isAgent { return $0.isAgent }
          return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
    } catch {
      onboardingLog.error("DM recipient load failed: \(error.localizedDescription)")
      return []
    }
  }

  @discardableResult
  func startDirectMessage(with recipient: DirectMessageRecipient) async -> String? {
    guard let workspaceID = workspace?.id else { return nil }
    do {
      let conversation = try await relay.startDirectMessage(
        workspaceID: workspaceID,
        participantKind: recipient.kind,
        participantID: recipient.principalID
      )
      upsertConversation(conversation)
      if let workspace { syncWorkspaceLiveStreams(for: workspace) }
      return conversation.id
    } catch {
      onboardingLog.error("DM start failed: \(error.localizedDescription)")
      return nil
    }
  }

  /// Create a channel and surface it in the workspace snapshot immediately.
  @discardableResult
  func createChannel(name: String, isPrivate: Bool) async -> ChannelRecord? {
    guard let workspaceID = workspace?.id else { return nil }
    let slug = Self.slugify(name)
    do {
      let channel = try await relay.createChannel(
        workspaceID: workspaceID,
        conversationID: slug,
        name: slug,
        isPrivate: isPrivate
      )
      upsertConversation(
        ConversationSummary(
          id: channel.id,
          name: channel.name,
          kind: .channel,
          isPrivate: channel.isPrivate,
          unreadCount: 0,
          requiresAttention: false,
          lastMessage: nil,
          archived: false
        )
      )
      setConversationJoined(channel.id, joined: true)
      return channel
    } catch {
      print("[Chief] create channel \(name) failed: \(error)")
      return nil
    }
  }

  /// Archive/unarchive a channel from its context menu.
  func archiveConversation(_ conversationID: String, archived: Bool) async {
    guard let workspaceID = workspace?.id else { return }
    do {
      try await relay.archiveChannel(
        workspaceID: workspaceID,
        conversationID: conversationID,
        archived: archived
      )
      mutateConversation(conversationID) { $0.archived = archived }
    } catch {
      print("[Chief] archive \(conversationID) failed: \(error)")
    }
  }

  /// Join a public channel as the signed-in user. The relay remains
  /// authoritative; local visibility changes only after it accepts the join.
  @discardableResult
  func joinConversation(_ conversationID: String) async -> Bool {
    guard let workspaceID = workspace?.id else { return false }
    do {
      try await relay.joinChannel(
        workspaceID: workspaceID,
        conversationID: conversationID
      )
      setConversationJoined(conversationID, joined: true)
      return true
    } catch {
      print("[Chief] join \(conversationID) failed: \(error)")
      return false
    }
  }

  /// Leave a channel without deleting its public catalogue entry. It disappears
  /// from the joined sidebar, but a later `#channel` link can still open the
  /// relay-authorized read-only preview.
  func leaveConversation(_ conversationID: String) async {
    guard let workspaceID = workspace?.id else { return }
    do {
      try await relay.leaveChannel(
        workspaceID: workspaceID,
        conversationID: conversationID
      )
      setConversationJoined(conversationID, joined: false)
      conversations.clear(workspaceID: workspaceID, conversationID: conversationID)
      if selectedConversationID == conversationID { selectedConversationID = nil }
    } catch {
      print("[Chief] leave \(conversationID) failed: \(error)")
    }
  }

  /// List current channel members (used by the channel detail sheet).
  func channelMembers(conversationID: String) async -> [ChannelMember] {
    guard let workspaceID = workspace?.id else { return [] }
    return
      (try? await relay.channelMembers(
        workspaceID: workspaceID,
        conversationID: conversationID
      )) ?? []
  }

  /// All channel memberships in the workspace (membership switches on the Agents
  /// tab, without one request per channel).
  func allChannelMemberships() async -> [ChannelMembership] {
    guard let workspaceID = workspace?.id else { return [] }
    return (try? await relay.allChannelMemberships(workspaceID: workspaceID)) ?? []
  }

  func isConversationJoined(_ conversationID: String) -> Bool {
    guard let conversation = workspace?.conversations.first(where: { $0.id == conversationID })
    else { return false }
    if conversation.kind == .direct { return true }
    guard membershipWorkspaceID == workspace?.id else { return false }
    return joinedConversationIDs?.contains(conversationID) == true
  }

  var channelMembershipsLoaded: Bool {
    membershipWorkspaceID == workspace?.id && joinedConversationIDs != nil
  }

  func canParticipate(in conversationID: String) -> Bool {
    guard let conversation = workspace?.conversations.first(where: { $0.id == conversationID })
    else { return false }
    return !conversation.archived && isConversationJoined(conversationID)
  }

  func refreshCurrentChannelMemberships() async {
    guard let workspace else { return }
    await refreshCurrentChannelMemberships(for: workspace)
  }

  /// Add or remove an agent as a member of a channel (Agents > Channels tab).
  @discardableResult
  func setAgentMembership(
    conversationID: String,
    agentID: String,
    isMember: Bool
  ) async -> Bool {
    guard let workspaceID = workspace?.id else { return false }
    do {
      if isMember {
        try await relay.addChannelMember(
          workspaceID: workspaceID,
          conversationID: conversationID,
          kind: "agent",
          principalID: agentID
        )
      } else {
        try await relay.removeChannelMember(
          workspaceID: workspaceID,
          conversationID: conversationID,
          kind: "agent",
          principalID: agentID
        )
      }
      return true
    } catch {
      print("[Chief] set membership \(agentID) in \(conversationID) failed: \(error)")
      return false
    }
  }

  /// Persist to the relay first. The local copy is a cache, never an authority:
  /// a failed policy write must not silently grant the on-device runtime access.
  @discardableResult
  func saveAgentConfig(agentID: String, config: AgentConfig) async -> Bool {
    guard let workspaceID = workspace?.id else { return false }
    do {
      try await relay.saveAgentConfig(
        workspaceID: workspaceID,
        agentID: agentID,
        config: config
      )
      configStore.save(workspaceID: workspaceID, agentID: agentID, config: config)
    } catch {
      onboardingLog.error("agent config save failed for \(agentID): \(error)")
      return false
    }
    // Reflect the Active/Paused state in the roster immediately.
    if let current = workspace,
      let index = current.agents.firstIndex(where: { $0.id == agentID })
    {
      var agents = current.agents
      agents[index] = AgentSummary(
        id: agents[index].id,
        name: agents[index].name,
        role: agents[index].role,
        status: config.enabled ? agents[index].status : .offline
      )
      workspace = WorkspaceSnapshot(
        id: current.id,
        name: current.name,
        website: current.website,
        selectedApps: current.selectedApps,
        imageURL: current.imageURL,
        onboardingComplete: current.onboardingComplete,
        conversations: current.conversations,
        agents: agents,
        projects: current.projects
      )
    }
    return true
  }

  func refreshAgentConfig(agentID: String) async -> AgentConfig {
    guard let workspaceID = workspace?.id else { return AgentConfig.defaults(for: agentID) }
    do {
      let remote =
        try await relay.loadAgentConfig(
          workspaceID: workspaceID,
          agentID: agentID
        ) ?? AgentConfig.defaults(for: agentID)
      configStore.save(workspaceID: workspaceID, agentID: agentID, config: remote)
      return remote
    } catch {
      onboardingLog.warning("agent config load failed for \(agentID): \(error)")
    }
    return configStore.load(workspaceID: workspaceID, agentID: agentID)
      ?? AgentConfig.defaults(for: agentID)
  }

  func agentConfig(agentID: String) -> AgentConfig {
    guard let workspaceID = workspace?.id else { return AgentConfig.defaults(for: agentID) }
    return configStore.load(workspaceID: workspaceID, agentID: agentID)
      ?? AgentConfig.defaults(for: agentID)
  }

  private func upsertConversation(_ conversation: ConversationSummary) {
    guard let current = workspace else { return }
    var conversations = current.conversations
    if let index = conversations.firstIndex(where: { $0.id == conversation.id }) {
      conversations[index] = conversation
    } else {
      conversations.append(conversation)
    }
    renameConversations(conversations, in: current)
  }

  private func mutateConversation(
    _ conversationID: String, _ mutate: (inout ConversationSummary) -> Void
  ) {
    guard let current = workspace else { return }
    var conversations = current.conversations
    guard let index = conversations.firstIndex(where: { $0.id == conversationID }) else { return }
    mutate(&conversations[index])
    renameConversations(conversations, in: current)
  }

  private func removeConversation(_ conversationID: String) {
    guard let current = workspace else { return }
    renameConversations(
      current.conversations.filter { $0.id != conversationID },
      in: current
    )
  }

  private func renameConversations(
    _ conversations: [ConversationSummary], in current: WorkspaceSnapshot
  ) {
    workspace = WorkspaceSnapshot(
      id: current.id,
      name: current.name,
      website: current.website,
      selectedApps: current.selectedApps,
      imageURL: current.imageURL,
      onboardingComplete: current.onboardingComplete,
      conversations: conversations,
      agents: current.agents,
      projects: current.projects
    )
  }

  /// Lowercase slug for a new channel name ("My Channel" -> "my-channel").
  static func slugify(_ name: String) -> String {
    let allowed = name.lowercased()
      .replacingOccurrences(of: " ", with: "-")
      .replacingOccurrences(of: "_", with: "-")
    let filtered = allowed.filter { $0.isLetter || $0.isNumber || $0 == "-" }
    return filtered.split(separator: "-").filter { !$0.isEmpty }.joined(separator: "-")
  }
  private func startAgentLoopIfNeeded() {
    guard phase == .workspace, let workspace else { return }
    guard agentLoopTask == nil else { return }
    let roster = workspace.agents.map(\.id)
    let loop = WorkspaceAgentLoop(
      relay: relay,
      workspaceID: workspace.id,
      roster: roster,
      onWorking: { [weak self] agentID, conversationID, isWorking in
        await self?.setAgentWorking(
          agentID: agentID,
          workspaceID: workspace.id,
          conversationID: conversationID,
          isWorking: isWorking
        )
      },
      onActivity: { [weak self] workspaceID, conversationID, agentID, component in
        await self?.recordAgentActivity(
          workspaceID: workspaceID,
          conversationID: conversationID,
          agentID: agentID,
          component: component
        )
      },
      onCompletion: { [weak self] in
        await self?.refreshWorkspaceAfterAgentCompletion(expectedID: workspace.id)
      }
    )
    agentLoopTask = Task { [weak self] in
      await self?.bootCellRuntimeIfNeeded()
      await loop.run()
    }
  }

  private func stopAgentLoop() {
    agentLoopTask?.cancel()
    agentLoopTask = nil
  }

  private func refreshWorkspaceAfterAgentCompletion(expectedID: String) async {
    do {
      let remote = try await relay.loadWorkspace()
      guard remote.id == expectedID else { return }
      workspace = remote
      await refreshCurrentChannelMemberships(for: remote)
      recomputeAllConversationPresentation()
      syncWorkspaceLiveStreams(for: remote)
      try? workspaces.save(remote)
      await refreshAgentJobs(for: remote)
    } catch {
      onboardingLog.warning("post-job workspace refresh failed: \(error.localizedDescription)")
    }
  }

  func beginWorkspaceSetup() {
    stopAgentLoop()
    stopWorkspaceLiveStreams()
    // Adding a new workspace. Keep the existing workspace, its summaries and
    // local cache intact so the user has genuinely multiple workspaces to
    // switch between. The flag tells completeOnboarding this is a NEW workspace
    // (skip the single-workspace idempotency guard), not a re-run of setup.
    pendingNewWorkspace = true
    onboarding = OnboardingDraft()
    #if DEBUG
      if DevCodexBridgeSettings.isConfigured,
        inferenceCredentials.contains(.codexBridge)
      {
        onboarding.inferenceProvider = .codexBridge
        onboarding.inferenceModel = DevCodexBridgeSettings.model
      }
    #endif
    inferenceCredential = ""
    onboardingError = nil
    workspaceSyncFailed = false
    phase = .onboarding
  }

  /// Exits an accidental workspace setup and returns to the existing
  /// workspace when one is already saved locally.
  func cancelWorkspaceSetup() {
    stopAgentLoop()
    pendingNewWorkspace = false
    onboarding = OnboardingDraft()
    inferenceCredential = ""
    onboardingError = nil
    phase = workspace != nil ? .workspace : .signedOut
    if let workspace { syncWorkspaceLiveStreams(for: workspace) }
    startAgentLoopIfNeeded()
  }

  func signOut() {
    stopAgentLoop()
    stopWorkspaceLiveStreams()
    pendingNewWorkspace = false
    try? sessions.clear()
    session = nil
    workspace = nil
    membershipWorkspaceID = nil
    joinedConversationIDs = nil
    try? workspaces.clear()
    conversations.clearAll()
    phase = .signedOut
  }

  private func setConversationJoined(_ conversationID: String, joined: Bool) {
    guard let workspaceID = workspace?.id else { return }
    var ids = membershipWorkspaceID == workspaceID ? (joinedConversationIDs ?? []) : []
    if joined { ids.insert(conversationID) } else { ids.remove(conversationID) }
    membershipWorkspaceID = workspaceID
    joinedConversationIDs = ids
    if let workspace { syncWorkspaceLiveStreams(for: workspace) }
  }

  private func refreshCurrentChannelMemberships(for snapshot: WorkspaceSnapshot) async {
    do {
      let memberships = try await relay.currentChannelMemberships(workspaceID: snapshot.id)
      guard workspace?.id == snapshot.id else { return }
      membershipWorkspaceID = snapshot.id
      joinedConversationIDs = Set(memberships.map(\.conversationId))
      syncWorkspaceLiveStreams(for: snapshot)
      return
    } catch {
      onboardingLog.warning(
        "current channel membership load failed; trying visible-channel fallback: \(error.localizedDescription)"
      )
    }

    guard let userID = session?.user.id else { return }
    let channels = snapshot.conversations.filter { $0.kind == .channel }
    let results = await withTaskGroup(of: (String, Bool?).self) { group in
      for channel in channels {
        group.addTask { [relay] in
          do {
            let members = try await relay.channelMembers(
              workspaceID: snapshot.id,
              conversationID: channel.id
            )
            return (
              channel.id,
              members.contains { $0.kind == "user" && $0.principalId == userID }
            )
          } catch {
            return (channel.id, nil)
          }
        }
      }
      var values: [(String, Bool?)] = []
      for await value in group { values.append(value) }
      return values
    }
    guard workspace?.id == snapshot.id, results.contains(where: { $0.1 != nil }) else { return }
    membershipWorkspaceID = snapshot.id
    joinedConversationIDs = Set(results.compactMap { id, joined in joined == true ? id : nil })
    syncWorkspaceLiveStreams(for: snapshot)
  }
}

private extension ConversationMessage {
  func isOwnMessage(session: ChiefSession?) -> Bool {
    guard case .user(let id, _) = author else { return false }
    if id == session?.user.id || id == "workspace-owner" { return true }
    return id == (try? NostrKeychainStore().load())?.publicKeyHex
  }
}

enum WorkspaceTab: Hashable {
  case home
  case dms
  case projects
  case agents
}
