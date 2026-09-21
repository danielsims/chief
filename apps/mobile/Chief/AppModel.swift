import Foundation
import Observation
import os

let onboardingLog = Logger(subsystem: "sh.heychief.mobile", category: "onboarding")
let activityLog = Logger(subsystem: "sh.heychief.mobile", category: "activity")

enum AppPhase: Equatable {
  case launching
  case signedOut
  case workspaceSetup
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

enum WorkingAgentPresenceOrder {
  static func inserting(_ agentID: String, into agents: [String]) -> [String] {
    agents.contains(agentID) ? agents : agents + [agentID]
  }

  static func removing(_ agentID: String, from agents: [String]) -> [String] {
    agents.filter { $0 != agentID }
  }

  static func merging(_ groups: [[String]]) -> [String] {
    var seen = Set<String>()
    return groups.flatMap { $0 }.filter { seen.insert($0).inserted }
  }
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
  var mentionPeople: [MentionAgent] {
    guard let user = session?.user else { return [] }
    let agents = (workspace?.agents ?? []).flatMap { agent -> [MentionAgent] in
      let root = agent.canMessage == false ? [] : [MentionAgent(id: agent.id, name: agent.name, role: agent.role)]
      return root + agent.subagents.filter { $0.canMessage != false }.map { MentionAgent(id: $0.id, name: $0.name, role: $0.role) }
    }
    return [MentionAgent(id: user.id, name: user.name, role: "You")] + agents
  }
  private(set) var workspace: WorkspaceSnapshot?
  private(set) var workspaceSummaries: [WorkspaceSummary] = []
  private(set) var pendingWorkspaceInvite: WorkspaceInviteLink?
  private(set) var pendingOrganizationInvite: OrganizationInviteLink?
  private(set) var workspaceInvitePreview: WorkspaceInvite?
  private(set) var workspaceInviteNeedsRelayConfirmation = false
  private(set) var workspaceInviteError: String?
  private(set) var workspaceInviteInProgress = false
  /// Relay-authoritative memberships for the signed-in principal in the
  /// current workspace. `nil` means the tenant-scoped membership view is still
  /// loading; an empty set means the principal has genuinely joined no
  /// channels. Direct messages are participants-only and do not use this set.
  private(set) var joinedConversationIDs: Set<String>?
  private var membershipWorkspaceID: String?
  var homeNavigationPath: [String] = []
  var selectedConversationID: String?
  var selectedThread: SelectedThread?
  private var pendingConversationDeepLink: ConversationDeepLink?
  private var isApplyingConversationDeepLink = false
  var activityErrorAcknowledgements = ActivityErrorAcknowledgements()
  var selectedTab: WorkspaceTab = .home
  var onboarding = OnboardingDraft()
  var inferenceCredential = ""
  private(set) var onboardingError: String?
  private(set) var workspaceSyncFailed = false
  private(set) var isSwitchingWorkspace = false
  private(set) var isWorkspaceReadyForPresentation = false
  private var debugSkipCredentialStore = false
  private var agentLoopTask: Task<Void, Never>?
  private var agentLoop: WorkspaceAgentLoop?
  private var agentLoopRoster: [String] = []
  private var pendingAgentReplies: [String: (workspaceID: String, conversationID: String, agentID: String)] = [:]
  private var workspaceLiveTask: Task<Void, Never>?
  private var workspaceLiveBackgroundStopTask: Task<Void, Never>?
  private var workspaceMembershipRefreshTask: Task<Void, Never>?
  private var workspaceMembershipRefreshWorkspaceID: String?
  private var workspaceLiveClient: RelayLiveClient?
  private var workspaceLiveWorkspaceID: String?
  private var workspaceLiveConversationIDs: Set<String> = []
  private var readState = ConversationReadState()
  private var readStateWorkspaceID: String?
  private var hydratedReadConversations: Set<ConversationKey> = []
  private var notifiedMessageIDs: Set<String> = []
  private var pendingPushToken: Data?
  private let launchedAt = Date.now
  private(set) var isAppActive = true
  private(set) var visibleConversationID: String?
  private(set) var visibleThreadRootID: String?
  private(set) var onboardingInProgress = false
  private var cellRuntimeBooted = false
  /// Genuine in-flight cell work, grouped by conversation. Mission Control
  /// presents the union so the user can watch delegated specialists progress.
  /// Insertion-ordered working agent IDs, so composer matrix loaders keep a
  /// stable horizontal slot once an agent appears.
  private(set) var workingAgents: [ConversationKey: [String]] = [:]
  private(set) var agentActivityRecords: [String: AgentActivityRecord] = [:]
  private var relayActivityMessageIDs: [String: String] = [:]
  private var activeAgentActivityIDs: [String: String] = [:]
  /// Relay-authoritative run history, keyed by the isolated agent mailbox.
  /// Terminal failures remain visible and retryable across process restarts.
  private(set) var agentJobsByAgentID: [String: [AgentJobRecord]] = [:]
  /// True while the user is adding ANOTHER workspace (Add workspace). Distinguishes
  /// creating a new org from re-entering an already-completed one, which the
  /// single-workspace idempotency guard in completeOnboarding guards against.
  private var pendingNewWorkspace = false
  #if DEBUG
    /// A bridge deep link can arrive before the relay finishes hydrating the
    /// active workspace. Carry that explicit choice across startup, then bind
    /// it to the resolved workspace instead of letting recovery overwrite it.
    private var pendingDevelopmentBridgeSelection = false
  #endif

  private(set) var sessions: SessionStore
  private(set) var workspaces: WorkspaceStore
  let inferenceCredentials: InferenceCredentialStore
  let deviceModels: OnDeviceModelStore
  private(set) var relay: any RelayServing
  let conversations: ConversationCache
  private(set) var authentication: any MobileAuthenticationServing
  private let configStore = AgentConfigStore()
  private let readStateStore = ConversationReadStateStore()
  private(set) var appConfiguration: AppConfiguration
  private let relayDirectory = RelayDirectoryStore()
  private var pendingWorkspaceAfterRelaySwitch: String?

  var pendingInviteRelayURL: URL? {
    pendingWorkspaceInvite?.relayURL ?? pendingOrganizationInvite?.relayURL
  }

  var canReturnToWorkspace: Bool {
    if workspace?.onboardingComplete == true { return true }
    if let saved = try? workspaces.load(), saved.onboardingComplete { return true }
    return relayDirectory.workspaceSummaries(activeWorkspaceID: workspace?.id)
      .contains(where: \.onboardingComplete)
  }

  var canAdvanceOnboarding: Bool {
    switch onboarding.step {
    case 0:
      return !onboarding.companyName.trimmingCharacters(
        in: .whitespacesAndNewlines
      ).isEmpty
    case 1:
      return onboarding.runtime != nil
    case 2:
      return inferenceSelectionReady
    default:
      return onboarding.canContinue && inferenceSelectionReady
    }
  }

  private var inferenceSelectionReady: Bool {
    guard let provider = onboarding.inferenceProvider else { return false }
    switch provider {
    case .openCodeGo:
      if onboarding.runtime == .cloud {
        return workspaceForOnboardingResume != nil
          || !inferenceCredential.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      }
      return !inferenceCredential.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        || inferenceCredentials.contains(.openCodeGo)
    case .vercelAiGateway:
      if onboarding.runtime == .cloud {
        return workspaceForOnboardingResume != nil
          || !inferenceCredential.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      }
      return !inferenceCredential.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        || inferenceCredentials.contains(.vercelAiGateway)
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
    authentication: any MobileAuthenticationServing,
    appConfiguration: AppConfiguration = .current()
  ) {
    self.sessions = sessions
    self.workspaces = workspaces
    self.inferenceCredentials = inferenceCredentials
    self.deviceModels = deviceModels
    self.relay = relay
    self.conversations = conversations
    self.authentication = authentication
    self.appConfiguration = appConfiguration
  }

  static func live(environment: ProcessInfo = .processInfo) -> AppModel {
    let configuration = AppConfiguration.current(environment: environment)
    let sessionStore = KeychainSessionStore(scope: configuration.relayURL)
    let transport = URLSessionRelayClient(configuration: configuration)
    return AppModel(
      sessions: sessionStore,
      workspaces: FileWorkspaceStore(scope: configuration.relayURL),
      inferenceCredentials: KeychainInferenceCredentialStore(),
      relay: configuration.demoMode ? FixtureRelayClient() : transport,
      conversations: ConversationCache(),
      authentication: URLSessionOAuthAuthenticationClient(configuration: configuration),
      appConfiguration: configuration
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
    if appConfiguration.demoMode {
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
    await applyPendingOrganizationInvite()
    await applyPendingWorkspaceSwitch()
    await hydrateWorkspace()
    await consumeNotificationDeepLink()
  }

  func registerPushToken(_ token: Data) async {
    pendingPushToken = token
    await sendPendingPushToken()
  }

  private func sendPendingPushToken() async {
    guard let token = pendingPushToken, session != nil else { return }
    let hex = token.map { String(format: "%02x", $0) }.joined()
    #if DEBUG
      let environment = "sandbox"
    #else
      let environment = "production"
    #endif
    do {
      let configured = try await relay.registerPushDevice(
        token: hex,
        environment: environment
      )
      MobileNotifications.remotePushRegistered = configured
    } catch {
      print("[Chief] APNs token registration failed: \(error)")
    }
  }

  /// Boots the on-phone cell runtime (V8 + one isolated cell per agent) so the agent
  /// can live on the device, inference via OpenCode Go, publishing into the
  /// relay-backed channel. Wrapped so a missing device worker never blocks the
  /// workspace from opening. Retries until the engine is actually started, so a
  /// turn that arrives before first boot self-heals.
  private func bootCellRuntimeIfNeeded() async {
    #if CELL_RUNTIME
      guard phase == .workspace else { return }
      let host = ChiefAgentHost(
        relay: relay,
        credentials: inferenceCredentials,
        onActivity: { [weak self] workspaceID, conversationID, agentID, component in
          await self?.projectAgentActivity(
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
    guard
      let agentID = agentTurnTarget(
        conversationID: conversationID,
        threadRootID: threadRootID,
        mentions: mentions,
        requestedAgentID: requestedAgentID
      )
    else {
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
          components: [],
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

  func isAgentWorking(agentID: String) -> Bool {
    guard let workspaceID = workspace?.id else { return false }
    return workingAgents.contains { entry in
      entry.key.workspaceID == workspaceID && entry.value.contains(agentID)
    }
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
    var ids: [String]
    if conversationID == "mission-control" {
      ids = WorkingAgentPresenceOrder.merging(
        workingAgents
          .filter { $0.key.workspaceID == workspaceID }
          .sorted { $0.key.conversationID < $1.key.conversationID }
          .map(\.value)
      )
    } else {
      ids =
        workingAgents[
          ConversationKey(workspaceID: workspaceID, conversationID: conversationID)
        ] ?? []
    }
    // A pending reply keeps its agent visible before the stream confirms it,
    // and first-seen order must survive that insertion.
    for pending in pendingAgentReplies.values where pending.workspaceID == workspaceID {
      if conversationID == "mission-control" || pending.conversationID == conversationID {
        ids = WorkingAgentPresenceOrder.inserting(pending.agentID, into: ids)
      }
    }
    return ids.map { agentID in
      AgentActivityPresence(
        id: agentID,
        name: workspace?.agents.first(where: { $0.id == agentID })?.name
          ?? workspace?.agents.lazy.flatMap(\.subagents).first(where: { $0.id == agentID })?.name
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
      for agent in snapshot.agents.flatMap({ [$0.profile(id: $0.id)].compactMap { $0 } + $0.subagents }) {
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
    var record =
      agentActivityRecords[id]
      ?? AgentActivityRecord(
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
        await self?.refreshWorkspaceAfterAgentCompletion(
          expectedID: workspaceID,
          conversationID: conversationID
        )
      }
    }
  }

  private func projectAgentActivity(
    workspaceID: String,
    conversationID: String,
    agentID: String,
    component: MessageComponent
  ) async {
    recordAgentActivity(
      workspaceID: workspaceID,
      conversationID: conversationID,
      agentID: agentID,
      component: component
    )
    let key = "\(workspaceID):\(conversationID):\(agentID):\(component.id)"
    let messageID = relayActivityMessageIDs[key] ?? UUID().uuidString
    relayActivityMessageIDs[key] = messageID
    do {
      let identity = try AgentIdentityStore(
        workspaceID: workspaceID,
        agentID: agentID
      ).ensure()
      _ = try await relay.upsertAgentActivity(
        workspaceID: workspaceID,
        conversationID: conversationID,
        messageID: messageID,
        threadRootID: nil,
        component: component,
        signingIdentity: identity
      )
    } catch {
      onboardingLog.warning(
        "agent activity relay projection failed: \(error.localizedDescription)"
      )
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
      // The stream confirmed the reply, so drop the optimistic marker, then
      // keep the agent in first-seen position.
      pendingAgentReplies = pendingAgentReplies.filter {
        $0.value.workspaceID != workspaceID || $0.value.conversationID != conversationID || $0.value.agentID != agentID
      }
      agents = WorkingAgentPresenceOrder.inserting(agentID, into: agents)
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
      agents = WorkingAgentPresenceOrder.removing(agentID, from: agents)
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

  func saveProfileImage(_ data: Data?) async throws {
    guard let current = session else { throw RelayError.unauthorized }
    let relayURL = appConfiguration.relayURL
    let imageURL: URL?
    if let data { imageURL = try await relay.uploadIdentityImage(workspaceID: nil, data: data) }
    else { try await relay.removeProfileImage(); imageURL = nil }
    guard let latest = session, latest.user.id == current.user.id,
      appConfiguration.relayURL == relayURL else { return }
    let updated = ChiefSession(accessToken: latest.accessToken, sessionToken: latest.sessionToken,
      refreshToken: latest.refreshToken, accessTokenExpiresAt: latest.accessTokenExpiresAt,
      user: ChiefUser(id: current.user.id, name: latest.user.name, imageURL: imageURL),
      workspaceID: latest.workspaceID)
    try sessions.save(updated)
    session = updated
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
    isWorkspaceReadyForPresentation = false
    phase = .launching
    Task {
      do {
        try await bindCurrentDevice(using: signedIn)
        await applyPendingOrganizationInvite()
        await applyPendingWorkspaceSwitch()
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

  private func applyPendingWorkspaceSwitch() async {
    guard let workspaceID = pendingWorkspaceAfterRelaySwitch else { return }
    do {
      try await relay.switchWorkspace(id: workspaceID)
      pendingWorkspaceAfterRelaySwitch = nil
    } catch {
      onboardingError = error.localizedDescription
      onboardingLog.error("pending relay workspace switch failed: \(error.localizedDescription)")
    }
  }

  private func applyPendingOrganizationInvite() async {
    guard let invitation = pendingOrganizationInvite else { return }
    do {
      _ = try await relay.joinOrganizationWorkspace(
        workspaceID: invitation.workspaceID
      )
      pendingWorkspaceAfterRelaySwitch = invitation.workspaceID
      pendingOrganizationInvite = nil
    } catch {
      workspaceInviteError = error.localizedDescription
      onboardingLog.error("organization invitation join failed: \(error.localizedDescription)")
    }
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
    isWorkspaceReadyForPresentation = false
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
      await refreshCurrentChannelMemberships(for: loaded)
      guard workspace?.id == loaded.id else { return }
      isWorkspaceReadyForPresentation = true
      await refreshWorkspaces()
      await refreshAgentConfigCache(for: loaded)
      await registerAgentKeyIfNeeded(workspaceID: loaded.id)
      await refreshAgentJobs(for: loaded)
      syncWorkspaceLiveStreams(for: loaded)
      scheduleWorkspaceRefreshAfterMembershipGrant(expectedID: loaded.id)
      await MobileNotifications.shared.requestAuthorizationIfNeeded()
      await sendPendingPushToken()
      if loaded.onboardingComplete {
        startAgentLoopIfNeeded()
      } else if hasRecoverableInferenceCredential(for: loaded.id) {
        Task { [weak self] in await self?.completeOnboarding() }
      }
      if pendingWorkspaceInvite != nil { await preparePendingWorkspaceInvite() }
      await applyPendingConversationDeepLinkIfReady()
    } catch RelayError.unauthorized {
      // A relay token can be temporarily rejected while a fresh device session
      // is propagating. Keep the Better Auth session intact so the client can
      // refresh it on the next request instead of bouncing a signed-in user
      // back to the sign-in screen.
      onboardingLog.warning("relay rejected workspace hydration; preserving account session")
      isWorkspaceReadyForPresentation = workspace != nil
      phase = workspace == nil ? .workspaceSetup : .workspace
    } catch {
      // Authentication succeeded. Keep the user in onboarding while a relay is
      // unavailable or while no workspace has been created yet.
      isWorkspaceReadyForPresentation = workspace != nil
      phase = workspace == nil ? .workspaceSetup : .workspace
    }
  }

  private func registerAgentKeyIfNeeded(workspaceID: String) async {
    let roster = onDeviceAgentRoster()
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
    for agent in snapshot.agents.flatMap({ [$0.profile(id: $0.id)].compactMap { $0 } + $0.subagents }) {
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
      for agent in snapshot.agents.flatMap({ [$0.profile(id: $0.id)].compactMap { $0 } + $0.subagents }) {
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
      let current = try await relay.listWorkspaces()
      relayDirectory.remember(workspaces: current, at: appConfiguration.relayURL)
    } catch is CancellationError {
      return
    } catch {
      print("[Chief] list workspaces failed: \(error)")
    }

    // A relay owns its own authorization boundary, but the switcher should
    // aggregate every relay this phone has already signed into. Sessions never
    // leave the device and we never silently reuse a credential for a different
    // issuer; one sign-in per relay is enough for every workspace on that relay.
    let cloud = AppConfiguration.chiefCloud()
    var knownConnections = relayDirectory.connections()
    knownConnections.append(
      RelayConnectionRecord(relayURL: cloud.relayURL, accountURL: cloud.accountURL)
    )
    for connection in knownConnections {
      if RelayDirectoryStore.sameOrigin(connection.relayURL, appConfiguration.relayURL) {
        continue
      }
      let sessionStore = KeychainSessionStore(scope: connection.relayURL)
      guard let storedSession = try? sessionStore.load() else { continue }
      let configuration = AppConfiguration(
        relayURL: connection.relayURL,
        accountURL: connection.accountURL,
        demoMode: false
      )
      let client = URLSessionRelayClient(configuration: configuration)
      do {
        let remote = try await client.listWorkspaces()
        relayDirectory.remember(workspaces: remote, at: connection.relayURL)
      } catch RelayError.unauthorized {
        do {
          try await client.bindDeviceIdentity(accountToken: storedSession.accessToken)
          let remote = try await client.listWorkspaces()
          relayDirectory.remember(workspaces: remote, at: connection.relayURL)
        } catch {
          print(
            "[Chief] known relay refresh failed for \(connection.relayURL.host ?? "relay"): \(error)"
          )
        }
      } catch {
        if await shouldForgetMissingRelay(connection.relayURL) {
          await discardRelay(connection.relayURL, signingOutActive: false)
        } else {
          print(
            "[Chief] known relay refresh failed for \(connection.relayURL.host ?? "relay"): \(error)"
          )
        }
      }
    }
    workspaceSummaries = relayDirectory.workspaceSummaries(activeWorkspaceID: workspace?.id)
  }

  func relayLabel(forWorkspaceID workspaceID: String) -> String {
    guard let location = relayDirectory.location(for: workspaceID) else {
      return relayLabel(for: appConfiguration.relayURL)
    }
    return relayLabel(for: location.relayURL)
  }

  var activeRelayLabel: String { relayLabel(for: appConfiguration.relayURL) }
  var activeRelayIsChiefCloud: Bool {
    RelayDirectoryStore.sameOrigin(
      appConfiguration.relayURL,
      AppConfiguration.chiefCloud().relayURL
    )
  }

  func workspaceRelayGroups() -> [WorkspaceRelayGroup] {
    var summaries = workspaceSummaries
    if let workspace, !summaries.contains(where: { $0.id == workspace.id }) {
      summaries.append(
        WorkspaceSummary(
          id: workspace.id,
          name: workspace.name,
          website: workspace.website,
          imageURL: workspace.imageURL,
          isActive: true,
          onboardingComplete: workspace.onboardingComplete
        )
      )
    }
    let cloud = AppConfiguration.chiefCloud().relayURL
    let grouped = Dictionary(grouping: summaries) { summary in
      (relayDirectory.location(for: summary.id)?.relayURL ?? appConfiguration.relayURL)
        .absoluteString
    }
    return grouped.keys.sorted { left, right in
      let leftURL = URL(string: left)!
      let rightURL = URL(string: right)!
      let leftCloud = RelayDirectoryStore.sameOrigin(leftURL, cloud)
      let rightCloud = RelayDirectoryStore.sameOrigin(rightURL, cloud)
      if leftCloud != rightCloud { return leftCloud }
      return relayLabel(for: leftURL) < relayLabel(for: rightURL)
    }.compactMap { origin in
      guard let relayURL = URL(string: origin), let workspaces = grouped[origin] else {
        return nil
      }
      return WorkspaceRelayGroup(
        relayURL: relayURL,
        label: relayLabel(for: relayURL),
        workspaces: workspaces.sorted {
          $0.id == workspace?.id
            ? true : ($1.id == workspace?.id ? false : $0.name < $1.name)
        }
      )
    }
  }

  private func relayLabel(for relayURL: URL) -> String {
    if RelayDirectoryStore.sameOrigin(
      relayURL,
      AppConfiguration.chiefCloud().relayURL
    ) {
      return "Chief Cloud"
    }
    return relayHost(relayURL)
  }

  private func relayHost(_ url: URL) -> String {
    guard let host = url.host else { return "Relay" }
    if let port = url.port { return "\(host):\(port)" }
    return host
  }

  /// Switch the active organization, mirroring the desktop workspace rail. The
  /// conversation cache is cleared so no state leaks across tenants; the new
  /// workspace then rehydrates from the relay.
  func switchWorkspace(workspaceID: String) async -> Bool {
    guard workspaceID != workspace?.id else { return true }
    guard !isSwitchingWorkspace else { return false }
    isSwitchingWorkspace = true
    defer { isSwitchingWorkspace = false }
    print("[Chief] switching to workspace \(workspaceID)")
    if let location = relayDirectory.location(for: workspaceID),
      !RelayDirectoryStore.sameOrigin(location.relayURL, appConfiguration.relayURL)
    {
      let cloud = AppConfiguration.chiefCloud()
      let connection: RelayConnectionRecord?
      let usesChiefCloud = RelayDirectoryStore.sameOrigin(location.relayURL, cloud.relayURL)
      if usesChiefCloud {
        connection = RelayConnectionRecord(relayURL: cloud.relayURL, accountURL: cloud.accountURL)
      } else {
        connection = relayDirectory.connection(for: location.relayURL)
      }
      guard let connection else { return false }
      await activateRelay(
        connection,
        persistAsCustom: !usesChiefCloud,
        pendingWorkspaceID: workspaceID
      )
      return workspace?.id == workspaceID
    }
    stopWorkspaceLiveStreams()
    do {
      try await relay.switchWorkspace(id: workspaceID)
    } catch {
      onboardingLog.error("switch workspace failed: \(error)")
      print("[Chief] switch workspace failed: \(error)")
      return false
    }
    stopAgentLoop()
    conversations.clearAll()
    workspace = nil
    try? workspaces.clear()
    await hydrateWorkspace()
    return workspace?.id == workspaceID
  }

  func activateRelay(
    _ connection: RelayConnectionRecord,
    persistAsCustom: Bool = true,
    pendingWorkspaceID: String? = nil
  ) async {
    stopAgentLoop()
    stopWorkspaceLiveStreams()
    if persistAsCustom {
      relayDirectory.activate(connection)
    } else {
      relayDirectory.activateChiefCloud()
    }

    let configuration = AppConfiguration(
      relayURL: connection.relayURL,
      accountURL: connection.accountURL,
      demoMode: false
    )
    appConfiguration = configuration
    sessions = KeychainSessionStore(scope: connection.relayURL)
    workspaces = FileWorkspaceStore(scope: connection.relayURL)
    relay = URLSessionRelayClient(configuration: configuration)
    authentication = URLSessionOAuthAuthenticationClient(configuration: configuration)
    pendingWorkspaceAfterRelaySwitch = pendingWorkspaceID
    await DeviceAuthorizationVault.shared.clear(for: connection.relayURL)
    conversations.clearAll()
    session = nil
    workspace = nil
    homeNavigationPath = []
    selectedConversationID = nil
    selectedThread = nil
    isWorkspaceReadyForPresentation = false
    membershipWorkspaceID = nil
    joinedConversationIDs = nil
    selectedConversationID = nil
    workspaceSyncFailed = false
    onboardingError = nil
    phase = .launching

    guard let stored = try? sessions.load() else {
      phase = .signedOut
      return
    }
    session = stored
    do {
      try await bindCurrentDevice(using: stored)
      await applyPendingOrganizationInvite()
      await applyPendingWorkspaceSwitch()
      await hydrateWorkspace()
    } catch MobileAuthenticationError.invalidSession {
      try? sessions.clear()
      session = nil
      phase = .signedOut
    } catch {
      onboardingError = error.localizedDescription
      workspaceSyncFailed = true
      await hydrateWorkspace()
    }
  }

  func handleIncomingURL(_ url: URL) async {
    if let destination = ConversationDeepLink(url: url) {
      await handleConversationDeepLink(destination)
      return
    }
    if let organization = OrganizationInviteLink(url: url) {
      pendingOrganizationInvite = organization
      workspaceInviteError = nil
      if !RelayDirectoryStore.sameOrigin(
        organization.relayURL,
        appConfiguration.relayURL
      ) {
        workspaceInviteNeedsRelayConfirmation = true
        return
      }
      guard session != nil else { return }
      await applyPendingOrganizationInvite()
      await applyPendingWorkspaceSwitch()
      await hydrateWorkspace()
      return
    }
    guard let link = WorkspaceInviteLink(url: url) else {
      #if DEBUG
        await connectDevelopmentCodexBridge(url)
      #endif
      return
    }
    pendingWorkspaceInvite = link
    workspaceInviteError = nil
    if !RelayDirectoryStore.sameOrigin(link.relayURL, appConfiguration.relayURL) {
      workspaceInviteNeedsRelayConfirmation = true
      return
    }
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
    if !RelayDirectoryStore.sameOrigin(link.relayURL, appConfiguration.relayURL) {
      workspaceInviteNeedsRelayConfirmation = true
      workspaceInviteError = nil
      return
    }
    await preparePendingWorkspaceInvite()
  }

  func preparePendingWorkspaceInvite() async {
    guard let link = pendingWorkspaceInvite, !workspaceInviteInProgress else { return }
    guard RelayDirectoryStore.sameOrigin(link.relayURL, appConfiguration.relayURL) else {
      workspaceInviteNeedsRelayConfirmation = true
      return
    }
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

  func confirmPendingInviteRelay() async {
    guard let relayURL = pendingInviteRelayURL, !workspaceInviteInProgress else { return }
    workspaceInviteInProgress = true
    workspaceInviteError = nil
    do {
      let connection = try await RelayConnectionValidator.validate(
        relayURL.absoluteString
      )
      workspaceInviteNeedsRelayConfirmation = false
      workspaceInviteInProgress = false
      await activateRelay(connection)
      if session != nil {
        if pendingOrganizationInvite != nil {
          await applyPendingOrganizationInvite()
          await applyPendingWorkspaceSwitch()
          await hydrateWorkspace()
        } else {
          await preparePendingWorkspaceInvite()
        }
      }
    } catch {
      workspaceInviteInProgress = false
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
    pendingOrganizationInvite = nil
    workspaceInvitePreview = nil
    workspaceInviteError = nil
    workspaceInviteNeedsRelayConfirmation = false
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

  func inviteWorkspaceMember(email: String) async throws {
    guard let workspaceID = workspace?.id, let session else {
      throw OrganizationInvitationError.rejected
    }
    let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard address.contains("@"), !address.hasPrefix("@"), !address.hasSuffix("@") else {
      throw OrganizationInvitationError.rejected
    }
    try await authentication.inviteOrganizationMember(
      email: address,
      organizationID: workspaceID,
      session: session
    )
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

    let resumedWorkspace = workspaceForOnboardingResume
    var relayCredential: String?
    if let hostedProvider = onboarding.inferenceProvider,
      hostedProvider == .openCodeGo || hostedProvider == .vercelAiGateway,
      !debugSkipCredentialStore
    {
      let credential = inferenceCredential.trimmingCharacters(in: .whitespacesAndNewlines)
      let providerName = hostedProvider == .vercelAiGateway
        ? "Vercel AI Gateway" : "OpenCode Go"
      if onboarding.runtime == .cloud {
        if resumedWorkspace == nil {
          guard !credential.isEmpty else {
            onboardingError = "Connect \(providerName) before continuing."
            return
          }
          relayCredential = credential
        }
      } else {
        guard !credential.isEmpty || inferenceCredentials.contains(hostedProvider) else {
          onboardingError = "Connect \(providerName) before continuing."
          return
        }
      }
      if onboarding.runtime == .phone, !credential.isEmpty {
        do {
          try inferenceCredentials.save(credential, for: hostedProvider)
          inferenceCredential = ""
          onboardingLog.info("saved inference credential")
        } catch {
          onboardingError = "Chief could not save the inference credential."
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
      if let existing = resumedWorkspace {
        pending = existing
      } else {
        pending = try await relay.createWorkspace(
          from: onboarding,
          inferenceCredential: relayCredential
        )
        if relayCredential != nil { inferenceCredential = "" }
        workspace = pending
        upsertWorkspaceSummary(for: pending, isActive: true)
        // This file is only a launch cache. The relay is authoritative, so a
        // local persistence failure must not prevent the durable job from
        // being claimed and completed.
        try? workspaces.save(pending)
      }
      workspace = pending
      #if DEBUG
        DevCodexBridgeSettings.setEnabled(
          onboarding.inferenceProvider == .codexBridge,
          for: pending.id
        )
        if onboarding.inferenceProvider == .codexBridge {
          pendingDevelopmentBridgeSelection = false
        }
      #endif
      selectedTab = .home
      selectedConversationID = nil
      isWorkspaceReadyForPresentation = false
      phase = .workspace
      configureReadState(for: pending.id)
      await refreshCurrentChannelMemberships(for: pending)
      isWorkspaceReadyForPresentation = true
      syncWorkspaceLiveStreams(for: pending)
      // Enter the relay-backed workspace immediately. Key registration still
      // completes before a cell claims work, but independent agent keys are
      // enrolled concurrently instead of making the first visible arrival wait
      // on one round-trip per roster member.
      Task {
        await MobileNotifications.shared.requestAuthorizationIfNeeded()
        await self.sendPendingPushToken()
      }
      setAgentWorking(
        agentID: "chief",
        workspaceID: pending.id,
        conversationID: "mission-control",
        isWorking: true
      )
      if pending.runtime == "cloud" {
        workspaceSyncFailed = false
        onboardingError = nil
        pendingNewWorkspace = false
        onboardingLog.info("relay provisioned cloud workspace \(pending.id)")
        print("[Chief] relay provisioned cloud workspace \(pending.id)")
        phase = .workspace
        await refreshWorkspaces()
        return
      }
      await registerAgentKeyIfNeeded(workspaceID: pending.id)
      try await configureInitialAgentModels(for: pending)
      await bootCellRuntimeIfNeeded()
      let worker = PhoneWorkspaceSetupWorker(
        relay: relay,
        credentials: inferenceCredentials,
        onActivity: { [weak self] workspaceID, conversationID, agentID, component in
          await self?.projectAgentActivity(
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
    case .unavailable, .capacity:
      return true
    case .httpStatus(let status):
      return status >= 500
    case .unauthorized, .unsupportedRelay:
      return false
    }
  }

  private func recoverPendingOnboarding(for snapshot: WorkspaceSnapshot) {
    onboarding.runtime = snapshot.runtime == "cloud" ? .cloud : .phone
    onboarding.companyName = snapshot.name
    onboarding.step = 3
    #if DEBUG
      if pendingDevelopmentBridgeSelection
        || DevCodexBridgeSettings.isEnabled(for: snapshot.id),
        DevCodexBridgeSettings.isConfigured,
        inferenceCredentials.contains(.codexBridge)
      {
        DevCodexBridgeSettings.setEnabled(true, for: snapshot.id)
        pendingDevelopmentBridgeSelection = false
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

  private func hasRecoverableInferenceCredential(for workspaceID: String) -> Bool {
    if workspace?.id == workspaceID, workspace?.runtime == "cloud" { return false }
    #if DEBUG
      if DevCodexBridgeSettings.isEnabled(for: workspaceID),
        DevCodexBridgeSettings.isConfigured,
        inferenceCredentials.contains(.codexBridge)
      {
        return true
      }
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
        pendingDevelopmentBridgeSelection = true

        if let workspace, !workspace.onboardingComplete {
          DevCodexBridgeSettings.setEnabled(true, for: workspace.id)
          pendingDevelopmentBridgeSelection = false
        }

        onboardingLog.info(
          "connected development Codex bridge model=\(connection.model, privacy: .public)")
        print("[Chief] connected development Codex bridge model=\(connection.model)")
        if workspace?.onboardingComplete == false {
          await completeOnboarding()
        }
      } catch {
        onboardingError = error.localizedDescription
        onboardingLog.error(
          "development Codex bridge connection failed: \(error.localizedDescription)")
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

  func openConversation(_ id: String, threadRootID: String? = nil) {
    let id = workspace?.conversationID(for: id) ?? id
    selectedTab = .home
    selectedConversationID = id
    homeNavigationPath = [id]
    if let threadRootID, !threadRootID.isEmpty {
      selectedThread = SelectedThread(conversationID: id, rootMessageID: threadRootID)
    } else {
      selectedThread = nil
    }
  }

  func clearSelectedThread() {
    selectedThread = nil
  }

  func consumeNotificationDeepLink() async {
    await applyPendingConversationDeepLinkIfReady()
  }

  func handleConversationDeepLink(_ link: ConversationDeepLink) async {
    pendingConversationDeepLink = link
    MobileNotifications.pendingOpen = link
    await applyPendingConversationDeepLinkIfReady()
  }

  func applyPendingConversationDeepLinkIfReady() async {
    if let notification = MobileNotifications.pendingOpen {
      pendingConversationDeepLink = notification
    }
    guard !isApplyingConversationDeepLink else { return }
    guard phase == .workspace, isWorkspaceReadyForPresentation, !isSwitchingWorkspace else { return }
    isApplyingConversationDeepLink = true
    defer { isApplyingConversationDeepLink = false }
    while let link = pendingConversationDeepLink {
      if link.workspaceID != workspace?.id {
        let switched = await switchWorkspace(workspaceID: link.workspaceID)
        // A newer tap takes precedence, including while hydration awaits I/O.
        if let notification = MobileNotifications.pendingOpen {
          pendingConversationDeepLink = notification
        }
        guard pendingConversationDeepLink == link else { continue }
        guard switched, workspace?.id == link.workspaceID else { return }
      }
      guard isWorkspaceReadyForPresentation, !isSwitchingWorkspace else { return }
      pendingConversationDeepLink = nil
      openConversation(link.conversationID, threadRootID: link.threadRootID)
      // Persist the tap until the destination view confirms presentation.
      // SwiftUI can rebuild its navigation stack during launch/workspace switches.
    }
  }

  // MARK: - Read state and workspace-wide live delivery

  /// The overview needs live delivery for every conversation the principal can
  /// participate in, not every public catalogue entry. Waiting for the
  /// relay-authoritative membership snapshot prevents a freshly loaded
  /// workspace from opening sockets that can only be rejected.
  private func syncWorkspaceLiveStreams(for snapshot: WorkspaceSnapshot) {
    guard !appConfiguration.demoMode else { return }
    guard isAppActive || workspaceLiveClient != nil else { return }
    let joinedChannelIDs =
      membershipWorkspaceID == snapshot.id
      ? joinedConversationIDs
      : nil
    let desired: Set<String> = Set(
      snapshot.conversations.compactMap { conversation -> String? in
        guard
          conversation.kind == .direct
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
          self.scheduleWorkspaceRefreshAfterMembershipGrant(expectedID: workspaceID)
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
    // A disconnected stream cannot vouch for remote work still being active.
    // Keep turns owned by this phone; their local completion clears them.
    workingAgents = workingAgents.reduce(into: [:]) { result, entry in
      let local = entry.value.filter { agentID in
        activeAgentActivityIDs["\(entry.key.workspaceID):\(entry.key.conversationID):\(agentID)"] != nil
      }
      if !local.isEmpty { result[entry.key] = local }
    }
  }

  private func configureReadState(for workspaceID: String) {
    guard readStateWorkspaceID != workspaceID else { return }
    stopWorkspaceLiveStreams()
    homeNavigationPath = []
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
    let key = ConversationKey(workspaceID: workspaceID, conversationID: conversationID)
    if hydratedReadConversations.insert(key).inserted {
      let context = ConversationReadState.channelKey(conversationID)
      if readState.contexts[context] == nil,
        let latestHistorical =
          messages
          .filter({
            !$0.isAgentActivityProjection
              && !$0.isOwnMessage(session: session)
              && $0.createdAt <= launchedAt
          })
          .map(\.createdAt)
          .max()
      {
        advanceReadContext(context, to: latestHistorical)
      }
    }
    if let latest =
      messages
      .filter({ !$0.isAgentActivityProjection })
      .max(by: { $0.createdAt < $1.createdAt })
    {
      updateConversationPreview(with: latest)
    }
    // History catch-up updates unread state silently; banners belong to live delivery.
    recomputeUnreadCount(conversationID: conversationID)
  }

  private func handleLiveEvent(_ event: LiveEvent, expectedWorkspaceID: String) {
    guard workspace?.id == expectedWorkspaceID else { return }
    switch event {
    case .appended(let message):
      conversations.merge(message)
      if message.isAgentActivityProjection {
        recordRelayActivityReceipt(message, event: event)
        updateRelayActivityPresence(message)
        return
      }
      clearRelayActivityPresence(for: message)
      updateConversationPreview(with: message)
      if applyCurrentUserMembershipEvent(message) {
        scheduleWorkspaceRefreshAfterMembershipGrant(expectedID: expectedWorkspaceID)
      }
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
      if message.isAgentActivityProjection {
        recordRelayActivityReceipt(message, event: event)
        updateRelayActivityPresence(message)
        return
      }
      clearRelayActivityPresence(for: message)
      if case .edited = event, !message.isAgentActivityProjection {
        updateConversationPreview(with: message)
      }
    }
  }

  private func recordRelayActivityReceipt(_ message: ConversationMessage, event: LiveEvent) {
    guard case .agent(let agentID, _) = message.author else { return }
    let eventType: String
    switch event {
    case .appended: eventType = "appended"
    case .reacted: eventType = "reacted"
    case .edited: eventType = "edited"
    case .deleted: eventType = "deleted"
    }
    activityLog.info(
      "received event=\(eventType, privacy: .public) workspace=\(message.workspaceID, privacy: .public) conversation=\(message.conversationID, privacy: .public) agent=\(agentID, privacy: .public) message=\(message.id, privacy: .public) sequence=\(message.sequence) components=\(message.components.map(\.id).joined(separator: ","), privacy: .public)"
    )
  }

  private func updateRelayActivityPresence(_ message: ConversationMessage) {
    guard case .agent(let agentID, _) = message.author else { return }
    let failed = message.components.contains { $0.kind == "error" }
    let running = message.components.contains { component in
      component.payload["status"] == "running"
        || component.payload["status"] == "working"
    }
    if failed {
      setRelayAgentWorking(
        agentID: agentID,
        workspaceID: message.workspaceID,
        conversationID: message.conversationID,
        isWorking: false
      )
    } else {
      setRelayAgentWorking(
        agentID: agentID,
        workspaceID: message.workspaceID,
        conversationID: message.conversationID,
        isWorking: running
      )
    }
  }

  private func clearRelayActivityPresence(for message: ConversationMessage) {
    guard case .agent(let agentID, _) = message.author else { return }
    setRelayAgentWorking(
      agentID: agentID,
      workspaceID: message.workspaceID,
      conversationID: message.conversationID,
      isWorking: false
    )
  }

  private func setRelayAgentWorking(
    agentID: String,
    workspaceID: String,
    conversationID: String,
    isWorking: Bool
  ) {
    let key = ConversationKey(workspaceID: workspaceID, conversationID: conversationID)
    var agents = workingAgents[key] ?? []
    agents =
      isWorking
      ? WorkingAgentPresenceOrder.inserting(agentID, into: agents)
      : WorkingAgentPresenceOrder.removing(agentID, from: agents)
    if agents.isEmpty {
      workingAgents.removeValue(forKey: key)
    } else {
      workingAgents[key] = agents
    }
  }

  private func recordArrival(_ message: ConversationMessage) {
    guard !message.isAgentActivityProjection else { return }
    guard !message.isOwnMessage(session: session) else { return }
    guard isConversationJoined(message.conversationID) else { return }
    guard notifiedMessageIDs.insert(message.id).inserted else { return }
    if notifiedMessageIDs.count > 500, let oldest = notifiedMessageIDs.first {
      notifiedMessageIDs.remove(oldest)
    }

    let mentioned = message.mentionsCurrentUser(session: session)
    let conversation = workspace?.conversations.first { $0.id == message.conversationID }
    let channelName = conversation?.name ?? "channel"
    let title: String
    if mentioned {
      title =
        conversation?.kind == .direct
        ? "\(message.author.displayName) mentioned you"
        : "\(message.author.displayName) mentioned you in #\(channelName)"
    } else {
      title =
        conversation?.kind == .direct
        ? message.author.displayName
        : "\(message.author.displayName) in #\(channelName)"
    }

    if mentioned {
      if isAppActive { Haptics.medium() }
      if isAppActive || !MobileNotifications.remotePushRegistered {
        guard let workspace else { return }
        Task {
          await MobileNotifications.shared.deliver(
            title: title,
            body: message.body,
            workspaceID: workspace.id,
            conversationID: message.conversationID,
            threadRootID: message.threadRootID,
            mentioned: true
          )
        }
      }
      return
    }

    if isAppActive {
      Haptics.medium()
      NotificationSoundPlayer.shared.playConfigured()
      return
    }
    guard !MobileNotifications.remotePushRegistered else { return }
    guard let workspace else { return }
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
  private func applyCurrentUserMembershipEvent(_ message: ConversationMessage) -> Bool {
    guard let userID = session?.user.id else { return false }
    var grantedConversation = false
    for component in message.components where component.kind == "channel-action" {
      let userIDs = Set(
        (component.payload["userIds"] ?? "")
          .split(separator: ",")
          .map(String.init)
      )
      let targetsCurrentUser = userIDs.contains(userID)
        || (
          component.payload["targetKind"] == "user"
            && component.payload["targetId"] == userID
        )
      guard targetsCurrentUser else { continue }
      switch component.payload["type"] {
      case "member-added":
        revealGrantedChannel(conversationID: message.conversationID, lastMessage: message.body)
        grantedConversation = true
      case "member-removed":
        setConversationJoined(message.conversationID, joined: false)
      default:
        break
      }
    }
    return grantedConversation
  }

  /// Membership grants arrive before the next workspace snapshot. Insert the
  /// channel immediately so Home re-renders instead of waiting on the refresh.
  private func revealGrantedChannel(conversationID: String, lastMessage: String?) {
    if workspace?.conversations.contains(where: { $0.id == conversationID }) != true {
      upsertConversation(
        ConversationSummary(
          id: conversationID,
          name: Self.provisionalChannelName(conversationID),
          kind: .channel,
          isPrivate: false,
          unreadCount: 0,
          requiresAttention: false,
          lastMessage: lastMessage,
          archived: false
        )
      )
    }
    setConversationJoined(conversationID, joined: true)
  }

  static func provisionalChannelName(_ conversationID: String) -> String {
    let slug = conversationID.hasPrefix("channel-")
      ? String(conversationID.dropFirst("channel-".count))
      : conversationID
    if slug.count >= 16, slug.allSatisfy(\.isHexDigit) {
      return "New channel"
    }
    return conversationID
      .split(whereSeparator: { $0 == "-" || $0 == "_" })
      .map { $0.localizedCapitalized }
      .joined(separator: " ")
  }

  private func scheduleWorkspaceRefreshAfterMembershipGrant(expectedID: String) {
    if workspaceMembershipRefreshWorkspaceID == expectedID,
      workspaceMembershipRefreshTask != nil
    {
      return
    }
    workspaceMembershipRefreshTask?.cancel()
    workspaceMembershipRefreshWorkspaceID = expectedID
    workspaceMembershipRefreshTask = Task { [weak self] in
      guard let self else { return }
      defer {
        if self.workspaceMembershipRefreshWorkspaceID == expectedID {
          self.workspaceMembershipRefreshTask = nil
          self.workspaceMembershipRefreshWorkspaceID = nil
        }
      }
      await self.refreshWorkspaceContent(expectedID: expectedID)
    }
  }

  /// One coalesced catch-up on launch, foreground, and socket reconnection.
  /// HTTP history is authoritative even when socket replay has expired.
  func refreshWorkspaceContent(expectedID: String) async {
    await refreshWorkspaceSnapshot(expectedID: expectedID)
    guard !Task.isCancelled, let snapshot = workspace, snapshot.id == expectedID else { return }
    await refreshAgentConfigCache(for: snapshot)
    guard !Task.isCancelled, workspace?.id == expectedID else { return }
    await registerAgentKeyIfNeeded(workspaceID: expectedID)
    startAgentLoopIfNeeded()
    await agentLoop?.wake()
    let ids = snapshot.conversations.filter {
      $0.kind == .direct || joinedConversationIDs?.contains($0.id) == true
    }.map(\.id)
    let visible = visibleConversationID ?? selectedConversationID
    let ordered = ids.filter { $0 == visible } + ids.filter { $0 != visible }
    for id in ordered {
      guard !Task.isCancelled, workspace?.id == expectedID else { return }
      do {
        try await refreshConversation(workspaceID: expectedID, conversationID: id)
      } catch is CancellationError {
        return
      } catch {
        liveLog.warning("conversation catch-up failed: \(error.localizedDescription)")
      }
    }
    guard !Task.isCancelled, workspace?.id == expectedID else { return }
    await consumeNotificationDeepLink()
  }

  func refreshConversation(workspaceID: String, conversationID: String) async throws {
    let baseline = conversations.messages(workspaceID: workspaceID, conversationID: conversationID)
    let remote = try await relay.messages(
      workspaceID: workspaceID, conversationID: conversationID, after: nil
    )
    try Task.checkCancellation()
    guard workspace?.id == workspaceID else { return }
    // Preserve messages that arrived on the socket while history was in flight.
    conversations.reconcileHistory(
      workspaceID: workspaceID, conversationID: conversationID, messages: remote, baseline: baseline)
    hydrateReadSnapshot(remote, workspaceID: workspaceID, conversationID: conversationID)
    if isAppActive, visibleConversationID == conversationID {
      markChannelRead(conversationID: conversationID)
      if let root = visibleThreadRootID {
        markThreadRead(conversationID: conversationID, rootMessageID: root)
      }
    }
    recomputeAllConversationPresentation()
  }

  private func refreshWorkspaceSnapshot(expectedID: String) async {
    do {
      let remote = try await relay.loadWorkspace()
      guard !Task.isCancelled, workspace?.id == expectedID, remote.id == expectedID else { return }
      workspace = remote
      upsertWorkspaceSummary(for: remote, isActive: true)
      await refreshCurrentChannelMemberships(for: remote)
      recomputeAllConversationPresentation()
      syncWorkspaceLiveStreams(for: remote)
      try? workspaces.save(remote)
    } catch {
      liveLog.warning(
        "workspace membership refresh failed: \(error.localizedDescription)"
      )
    }
  }

  func setAppActive(_ active: Bool) {
    guard active != isAppActive else { return }
    isAppActive = active
    workspaceLiveBackgroundStopTask?.cancel()
    workspaceLiveBackgroundStopTask = nil
    if active {
      if let workspace {
        // A suspended socket may still look connected. Establish a fresh stream.
        stopWorkspaceLiveStreams()
        syncWorkspaceLiveStreams(for: workspace)
        scheduleWorkspaceRefreshAfterMembershipGrant(expectedID: workspace.id)
      }
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
    if let pending = MobileNotifications.pendingOpen,
      pending.workspaceID == workspace?.id,
      (workspace?.conversationID(for: pending.conversationID) ?? pending.conversationID) == conversationID
    {
      MobileNotifications.pendingOpen = nil
    }
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
    let latest =
      conversations.messages(
        workspaceID: workspaceID,
        conversationID: conversationID
      ).map(\.createdAt).max() ?? .now
    advanceReadContext(ConversationReadState.channelKey(conversationID), to: latest)
    recomputeUnreadCount(conversationID: conversationID)
  }

  func markThreadRead(conversationID: String, rootMessageID: String) {
    guard let workspaceID = workspace?.id else { return }
    let latest =
      conversations.messages(
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
    guard !message.isAgentActivityProjection else { return false }
    return readState.isUnread(
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
    guard !message.deleted, !message.isAgentActivityProjection else { return }
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
      ).filter({ !$0.isAgentActivityProjection })
        .max(by: { $0.createdAt < $1.createdAt })
      {
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
      return
        members
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
    let displayName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !displayName.isEmpty else { return nil }
    do {
      let channel = try await relay.createChannel(
        workspaceID: workspaceID,
        conversationID: UUID().uuidString.lowercased(),
        name: displayName,
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
        conversationID: conversationID,
        signingIdentity: nil
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
      agents[index] = agents[index].with(
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
    await registerAgentKeyIfNeeded(workspaceID: workspaceID)
    startAgentLoopIfNeeded()
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
  private func onDeviceAgentRoster() -> [String] {
    guard let workspace else { return [] }
    return workspace.agents.filter { $0.canRunOnDevice != false }
      .flatMap { [$0.id] + $0.subagents.map(\.id) }.filter { agentID in
        guard let config = configStore.load(workspaceID: workspace.id, agentID: agentID) else { return false }
        return config.enabled && config.deploymentTarget == "phone"
      }.sorted()
  }

  /// This is presentation only. Execution always requires a relay-issued lease.
  func expectAgentReply(messageID: String, conversationID: String, mentions: [String], threadRootID: String?) {
    guard let workspaceID = workspace?.id,
      let agentID = agentTurnTarget(conversationID: conversationID, threadRootID: threadRootID,
        mentions: mentions, requestedAgentID: nil) else { return }
    pendingAgentReplies[messageID] = (workspaceID, conversationID, agentID)
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(30))
      self?.pendingAgentReplies.removeValue(forKey: messageID)
    }
  }

  func cancelExpectedAgentReply(messageID: String) {
    pendingAgentReplies.removeValue(forKey: messageID)
  }

  func wakeOnDeviceAgents() async {
    startAgentLoopIfNeeded()
    await agentLoop?.wake()
  }

  private func startAgentLoopIfNeeded() {
    guard phase == .workspace, let workspace else { return }
    let roster = onDeviceAgentRoster()
    guard agentLoopTask == nil || agentLoopRoster != roster else { return }
    stopAgentLoop()
    guard !roster.isEmpty else { return }
    agentLoopRoster = roster
    let loop = WorkspaceAgentLoop(
      relay: relay,
      workspaceID: workspace.id,
      roster: roster,
      configuration: appConfiguration,
      onWorking: { [weak self] agentID, conversationID, isWorking in
        await self?.setAgentWorking(
          agentID: agentID,
          workspaceID: workspace.id,
          conversationID: conversationID,
          isWorking: isWorking
        )
      },
      onActivity: { [weak self] workspaceID, conversationID, agentID, component in
        await self?.projectAgentActivity(
          workspaceID: workspaceID,
          conversationID: conversationID,
          agentID: agentID,
          component: component
        )
      },
      onCompletion: { [weak self] conversationID in
        await self?.refreshWorkspaceAfterAgentCompletion(
          expectedID: workspace.id,
          conversationID: conversationID
        )
      }
    )
    agentLoopTask = Task { [weak self] in
      await self?.bootCellRuntimeIfNeeded()
      guard !Task.isCancelled else { return }
      self?.agentLoop = loop
      await loop.run()
    }
  }

  private func stopAgentLoop() {
    agentLoopTask?.cancel()
    agentLoopTask = nil
    agentLoop = nil
    agentLoopRoster = []
  }

  private func refreshWorkspaceAfterAgentCompletion(
    expectedID: String,
    conversationID: String
  ) async {
    do {
      let remote = try await relay.loadWorkspace()
      guard remote.id == expectedID else { return }
      workspace = remote
      await refreshCurrentChannelMemberships(for: remote)
      recomputeAllConversationPresentation()
      syncWorkspaceLiveStreams(for: remote)
      try? workspaces.save(remote)
      await refreshAgentJobs(for: remote)
      // Live delivery is the fast path, not the only path. A foreground socket
      // can reconnect between job completion and publication; catch up the
      // owning conversation so a completed DM or plugin card never stays
      // invisible until the user reopens it.
      let latest = try await relay.messages(
        workspaceID: expectedID,
        conversationID: conversationID,
        after: nil
      )
      latest.forEach(conversations.merge)
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
    if inferenceCredentials.contains(.openCodeGo) {
      onboarding.inferenceProvider = .openCodeGo
      onboarding.inferenceModel = OpenCodeModelCatalog.recommendedFreeModelID
    }
    inferenceCredential = ""
    onboardingError = nil
    workspaceSyncFailed = false
    phase = .onboarding
  }

  /// Opens the workspace entry screen without discarding the signed-in relay session.
  func showWorkspaceSetup() {
    stopAgentLoop()
    pendingNewWorkspace = false
    onboarding = OnboardingDraft()
    inferenceCredential = ""
    onboardingError = nil
    phase = .workspaceSetup
  }

  func returnToWorkspaceFromSetup() async {
    if workspace?.onboardingComplete == true {
      cancelWorkspaceSetup()
      return
    }

    await refreshWorkspaces()
    let savedWorkspaceID = (try? workspaces.load())?.id
    let target = workspaceSummaries.first { $0.id == savedWorkspaceID }
      ?? workspaceSummaries.first(where: \.onboardingComplete)
    guard let target else { return }
    _ = await switchWorkspace(workspaceID: target.id)
  }

  /// Returns from the workspace entry screen to the active workspace.
  func cancelWorkspaceSetup() {
    guard workspace?.onboardingComplete == true else { return }
    stopAgentLoop()
    pendingNewWorkspace = false
    onboarding = OnboardingDraft()
    inferenceCredential = ""
    onboardingError = nil
    phase = .workspace
    if let workspace { syncWorkspaceLiveStreams(for: workspace) }
    startAgentLoopIfNeeded()
  }

  func signOut() {
    let relayURL = appConfiguration.relayURL
    try? KeychainSessionStore(scope: relayURL).clear()
    try? FileWorkspaceStore(scope: relayURL).clear()
    relayDirectory.forget(relayURL)
    Task { await DeviceAuthorizationVault.shared.clear(for: relayURL) }
    applySignedOutState()
  }

  func deleteAccount() async throws {
    guard let current = session else { return }
    try await authentication.deleteAccount(session: current)
    await signOut(of: appConfiguration.relayURL)
  }

  func signOut(of relayURL: URL) async {
    let signingOutActive = RelayDirectoryStore.sameOrigin(
      relayURL,
      appConfiguration.relayURL
    )
    await discardRelay(relayURL, signingOutActive: signingOutActive)
    workspaceSummaries = relayDirectory.workspaceSummaries(
      activeWorkspaceID: signingOutActive ? nil : workspace?.id
    )
    guard signingOutActive else { return }
    if let next = nextSignedInRelay() {
      let cloud = AppConfiguration.chiefCloud()
      await activateRelay(
        next,
        persistAsCustom: !RelayDirectoryStore.sameOrigin(next.relayURL, cloud.relayURL)
      )
      return
    }
    applySignedOutState()
  }

  private func discardRelay(_ relayURL: URL, signingOutActive: Bool) async {
    try? KeychainSessionStore(scope: relayURL).clear()
    try? FileWorkspaceStore(scope: relayURL).clear()
    await DeviceAuthorizationVault.shared.clear(for: relayURL)
    relayDirectory.forget(relayURL)
    if signingOutActive {
      stopAgentLoop()
      stopWorkspaceLiveStreams()
      pendingNewWorkspace = false
      session = nil
      workspace = nil
      isWorkspaceReadyForPresentation = false
      membershipWorkspaceID = nil
      joinedConversationIDs = nil
      conversations.clearAll()
    }
  }

  private func nextSignedInRelay() -> RelayConnectionRecord? {
    let cloud = AppConfiguration.chiefCloud()
    var known = relayDirectory.connections()
    known.append(RelayConnectionRecord(relayURL: cloud.relayURL, accountURL: cloud.accountURL))
    return known.first { connection in
      (try? KeychainSessionStore(scope: connection.relayURL).load()) != nil
    }
  }

  private func shouldForgetMissingRelay(_ relayURL: URL) async -> Bool {
    if RelayDirectoryStore.sameOrigin(relayURL, AppConfiguration.chiefCloud().relayURL) {
      return false
    }
    do {
      _ = try await RelayConnectionValidator.validate(relayURL.absoluteString)
      return false
    } catch RelayConnectionValidationError.missing, RelayConnectionValidationError.unsupported {
      return true
    } catch {
      return false
    }
  }

  private func applySignedOutState() {
    stopAgentLoop()
    stopWorkspaceLiveStreams()
    pendingNewWorkspace = false
    try? sessions.clear()
    session = nil
    workspace = nil
    homeNavigationPath = []
    selectedConversationID = nil
    selectedThread = nil
    isWorkspaceReadyForPresentation = false
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

extension ConversationMessage {
  fileprivate func isOwnMessage(session: ChiefSession?) -> Bool {
    guard case .user(let id, _) = author else { return false }
    if id == session?.user.id || id == "workspace-owner" { return true }
    return id == (try? NostrKeychainStore().load())?.publicKeyHex
  }
}

enum WorkspaceTab: Hashable {
  case home
  case plugins
  case projects
  case agents
}
