import XCTest

@testable import Chief

@MainActor
final class AppModelAuthenticationTests: XCTestCase {
  func testNotificationWaitsForHydrationAndNewestTapWins() async {
    MobileNotifications.pendingOpen = nil
    defer { MobileNotifications.pendingOpen = nil }
    let model = AppModel(
      sessions: TestSessionStore(), workspaces: TestWorkspaceStore(),
      inferenceCredentials: TestInferenceCredentialStore(), relay: FixtureRelayClient(),
      conversations: ConversationCache(), authentication: UnusedAuthentication())
    let first = ConversationDeepLink(workspaceID: DemoWorkspace.snapshot.id, conversationID: "general", threadRootID: "old-root")
    let newest = ConversationDeepLink(workspaceID: DemoWorkspace.snapshot.id, conversationID: "marketing", threadRootID: "scheduled-root")
    await model.handleConversationDeepLink(first)
    await model.handleConversationDeepLink(newest)
    XCTAssertNil(model.selectedConversationID)
    XCTAssertEqual(MobileNotifications.pendingOpen, newest)
    model.completeSignIn(.fixture)
    await model.hydrateWorkspace()
    XCTAssertEqual(model.selectedConversationID, "marketing")
    XCTAssertEqual(model.selectedThread?.rootMessageID, "scheduled-root")
    XCTAssertNil(MobileNotifications.pendingOpen)
    model.openConversation("general")
    XCTAssertNil(model.selectedThread)
  }

  func testSignedInUserStaysInWorkspaceSetupWhenRelayIsUnavailable() async {
    let sessions = TestSessionStore()
    let model = AppModel(
      sessions: sessions,
      workspaces: TestWorkspaceStore(),
      inferenceCredentials: TestInferenceCredentialStore(),
      relay: FailingRelay(error: RelayError.unavailable),
      conversations: ConversationCache(),
      authentication: UnusedAuthentication())

    model.completeSignIn(.fixture)
    await model.hydrateWorkspace()

    XCTAssertEqual(model.session?.accessToken, ChiefSession.fixture.accessToken)
    XCTAssertEqual(model.phase, .workspaceSetup)
    XCTAssertEqual(
      try? sessions.load()?.accessToken,
      ChiefSession.fixture.accessToken
    )
  }

  func testUnauthorizedRelayPreservesStoredAccountSession() async throws {
    let sessions = TestSessionStore(initial: .fixture)
    let model = AppModel(
      sessions: sessions,
      workspaces: TestWorkspaceStore(),
      inferenceCredentials: TestInferenceCredentialStore(),
      relay: FailingRelay(error: RelayError.unauthorized),
      conversations: ConversationCache(),
      authentication: UnusedAuthentication())

    await model.start()

    XCTAssertEqual(model.session?.accessToken, ChiefSession.fixture.accessToken)
    XCTAssertEqual(model.phase, .workspaceSetup)
    XCTAssertEqual(
      try sessions.load()?.accessToken,
      ChiefSession.fixture.accessToken
    )
  }

  func testSignInKeepsLaunchSurfaceUntilWorkspaceHydrationResolves() {
    let model = AppModel(
      sessions: TestSessionStore(),
      workspaces: TestWorkspaceStore(),
      inferenceCredentials: TestInferenceCredentialStore(),
      relay: FailingRelay(error: RelayError.unavailable),
      conversations: ConversationCache(),
      authentication: UnusedAuthentication())

    model.completeSignIn(.fixture)

    XCTAssertEqual(model.phase, .launching)
    XCTAssertFalse(model.isWorkspaceReadyForPresentation)
  }

  func testOnboardingDoesNotPretendSetupSucceededWhenRelayIsUnavailable() async throws {
    let workspaces = TestWorkspaceStore()
    let credentials = TestInferenceCredentialStore()
    let model = AppModel(
      sessions: TestSessionStore(initial: .fixture),
      workspaces: workspaces,
      inferenceCredentials: credentials,
      relay: FailingRelay(error: RelayError.unavailable),
      conversations: ConversationCache(),
      authentication: UnusedAuthentication())
    model.onboarding.runtime = .phone
    model.onboarding.inferenceProvider = .openCodeGo
    model.onboarding.companyName = "Chief"
    model.inferenceCredential = "opencode-test-key"

    await model.completeOnboarding()

    XCTAssertEqual(model.phase, .launching)
    XCTAssertNil(model.workspace)
    XCTAssertNil(try workspaces.load())
    XCTAssertNotNil(model.onboardingError)
    XCTAssertTrue(credentials.contains(.openCodeGo))
  }

  func testCloudOnboardingHandsTheCredentialToTheRelayWithoutSavingItOnDevice() async {
    let credentials = TestInferenceCredentialStore()
    let relay = FixtureRelayClient()
    let model = AppModel(
      sessions: TestSessionStore(initial: .fixture),
      workspaces: TestWorkspaceStore(),
      inferenceCredentials: credentials,
      relay: relay,
      conversations: ConversationCache(),
      authentication: UnusedAuthentication())
    model.onboarding.runtime = .cloud
    model.onboarding.inferenceProvider = .openCodeGo
    model.onboarding.companyName = "Chief Cloud"
    model.inferenceCredential = "workspace-secret"

    await model.completeOnboarding()

    let provisioningCredential = await relay.latestProvisioningCredential()
    XCTAssertEqual(provisioningCredential, "workspace-secret")
    XCTAssertFalse(credentials.contains(.openCodeGo))
    XCTAssertEqual(model.inferenceCredential, "")
    XCTAssertEqual(model.phase, .workspace)
  }

  func testCancelingWorkspaceSetupReturnsToAnExistingWorkspace() async {
    let existing = DemoWorkspace.snapshot
    let workspaces = TestWorkspaceStore(initial: existing)
    let model = AppModel(
      sessions: TestSessionStore(initial: .fixture),
      workspaces: workspaces,
      inferenceCredentials: TestInferenceCredentialStore(),
      relay: FailingRelay(error: RelayError.unavailable),
      conversations: ConversationCache(),
      authentication: UnusedAuthentication())
    await model.start()
    XCTAssertEqual(model.workspace?.id, existing.id)
    XCTAssertTrue(model.isWorkspaceReadyForPresentation)

    model.beginWorkspaceSetup()
    XCTAssertEqual(model.phase, .onboarding)

    model.cancelWorkspaceSetup()
    XCTAssertEqual(model.phase, .workspace)
    XCTAssertEqual(model.workspace?.id, existing.id)
  }

  func testAddingWorkspaceNeverReusesAnIncompleteActiveWorkspace() async {
    let complete = DemoWorkspace.snapshot
    let incomplete = WorkspaceSnapshot(
      id: complete.id,
      name: complete.name,
      website: complete.website,
      selectedApps: complete.selectedApps,
      imageURL: complete.imageURL,
      onboardingComplete: false,
      conversations: complete.conversations,
      agents: complete.agents,
      projects: complete.projects
    )
    let model = AppModel(
      sessions: TestSessionStore(initial: .fixture),
      workspaces: TestWorkspaceStore(initial: incomplete),
      inferenceCredentials: TestInferenceCredentialStore(),
      relay: FailingRelay(error: RelayError.unavailable),
      conversations: ConversationCache(),
      authentication: UnusedAuthentication())

    await model.start()
    XCTAssertEqual(model.workspaceForOnboardingResume?.id, incomplete.id)

    model.beginWorkspaceSetup()

    XCTAssertNil(model.workspaceForOnboardingResume)
  }

  func testOnDeviceInferenceRequiresADownloadedModelToAdvance() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let deviceModels = OnDeviceModelStore(
      fileManager: .default,
      session: .shared,
      modelsDirectory: directory
    )
    let model = AppModel(
      sessions: TestSessionStore(initial: .fixture),
      workspaces: TestWorkspaceStore(),
      inferenceCredentials: TestInferenceCredentialStore(),
      deviceModels: deviceModels,
      relay: FailingRelay(error: RelayError.unavailable),
      conversations: ConversationCache(),
      authentication: UnusedAuthentication())
    model.onboarding.runtime = .phone
    model.onboarding.inferenceProvider = .onDevice
    model.onboarding.companyName = "Chief"
    model.onboarding.step = 2

    XCTAssertFalse(model.canAdvanceOnboarding)

    model.onboarding.deviceModelID = "gemma-4-e2b"
    XCTAssertFalse(model.canAdvanceOnboarding)

    let modelFile = try XCTUnwrap(OnDeviceModelStore.models.first)
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true
    )
    FileManager.default.createFile(
      atPath: deviceModels.fileURL(for: modelFile).path, contents: Data()
    )
    XCTAssertTrue(model.canAdvanceOnboarding)
  }
}

private final class TestWorkspaceStore: WorkspaceStore, @unchecked Sendable {
  private var workspace: WorkspaceSnapshot?

  init(initial: WorkspaceSnapshot? = nil) { workspace = initial }

  func load() throws -> WorkspaceSnapshot? { workspace }
  func save(_ workspace: WorkspaceSnapshot) throws { self.workspace = workspace }
  func clear() throws { workspace = nil }
}

private final class TestInferenceCredentialStore: InferenceCredentialStore, @unchecked Sendable {
  private var providers = Set<String>()

  func contains(_ provider: OnboardingDraft.InferenceProvider) -> Bool {
    providers.contains(provider.rawValue)
  }

  func load(_ provider: OnboardingDraft.InferenceProvider) throws -> String? {
    providers.contains(provider.rawValue) ? "test-credential" : nil
  }

  func save(_ credential: String, for provider: OnboardingDraft.InferenceProvider) throws {
    providers.insert(provider.rawValue)
  }

  func clear(_ provider: OnboardingDraft.InferenceProvider) throws {
    providers.remove(provider.rawValue)
  }
}

private final class TestSessionStore: SessionStore, @unchecked Sendable {
  private var session: ChiefSession?

  init(initial: ChiefSession? = nil) { session = initial }

  func load() throws -> ChiefSession? { session }
  func save(_ session: ChiefSession) throws { self.session = session }
  func clear() throws { session = nil }
}

private struct FailingRelay: RelayServing {
  let error: RelayError

  func bindDeviceIdentity(accountToken: String) async throws {}
  func loadWorkspace() async throws -> WorkspaceSnapshot { throw error }
  func createWorkspace(
    from draft: OnboardingDraft,
    inferenceCredential: String?
  ) async throws -> WorkspaceSnapshot {
    throw error
  }
  func messages(
    workspaceID: String,
    conversationID: String,
    after sequence: Int?,
    signingIdentity: NostrIdentity?
  ) async throws
    -> [ConversationMessage]
  { throw error }
  func send(
    messageID: String,
    body: String,
    workspaceID: String,
    conversationID: String,
    threadRootID: String?,
    mentions: [String] = [],
    components: [MessageComponent] = []
  ) async throws -> ConversationMessage { throw error }
  func sendAsAgent(
    body: String,
    workspaceID: String,
    conversationID: String,
    threadRootID: String?,
    mentions: [String],
    components: [MessageComponent],
    signingIdentity: NostrIdentity
  ) async throws -> ConversationMessage { throw error }
  func upsertAgentActivity(
    workspaceID: String,
    conversationID: String,
    messageID: String,
    threadRootID: String?,
    component: MessageComponent,
    signingIdentity: NostrIdentity
  ) async throws -> ConversationMessage { throw error }
  func uploadAttachment(
    workspaceID: String,
    conversationID: String,
    fileName: String,
    data: Data
  ) async throws -> String { throw error }
  func listChannels(
    workspaceID: String,
    signingIdentity: NostrIdentity?
  ) async throws -> [ChannelRecord] { throw error }
  func createChannel(
    workspaceID: String,
    conversationID: String,
    name: String,
    isPrivate: Bool,
    signingIdentity: NostrIdentity?
  ) async throws -> ChannelRecord { throw error }
  func archiveChannel(workspaceID: String, conversationID: String, archived: Bool) async throws {
    throw error
  }
  func joinChannel(workspaceID: String, conversationID: String, signingIdentity: NostrIdentity?) async throws { throw error }
  func leaveChannel(workspaceID: String, conversationID: String) async throws { throw error }
  func channelMembers(workspaceID: String, conversationID: String) async throws -> [ChannelMember] {
    throw error
  }
  func addChannelMember(
    workspaceID: String,
    conversationID: String,
    kind: String,
    principalID: String,
    signingIdentity: NostrIdentity?
  ) async throws { throw error }
  func removeChannelMember(
    workspaceID: String,
    conversationID: String,
    kind: String,
    principalID: String
  ) async throws { throw error }
  func allChannelMemberships(workspaceID: String) async throws -> [ChannelMembership] {
    throw error
  }
  func currentChannelMemberships(workspaceID: String) async throws -> [ChannelMembership] {
    throw error
  }
  func editMessage(
    workspaceID: String,
    conversationID: String,
    messageID: String,
    body: String
  ) async throws -> ConversationMessage { throw error }
  func deleteMessage(
    workspaceID: String,
    conversationID: String,
    messageID: String
  ) async throws -> ConversationMessage { throw error }
  func workspaceMembers(
    workspaceID: String,
    signingIdentity: NostrIdentity?
  ) async throws -> [WorkspaceMember] { throw error }
  func startDirectMessage(
    workspaceID: String,
    participantKind: String,
    participantID: String
  ) async throws -> ConversationSummary { throw error }
  func loadAgentConfig(workspaceID: String, agentID: String) async throws -> AgentConfig? {
    throw error
  }
  func saveAgentConfig(workspaceID: String, agentID: String, config: AgentConfig) async throws {
    throw error
  }
  func replies(
    workspaceID: String,
    conversationID: String,
    rootMessageID: String,
    after sequence: Int?,
    signingIdentity: NostrIdentity?
  ) async throws -> [ConversationMessage] { throw error }
  func searchMessages(
    workspaceID: String,
    conversationID: String,
    query: String,
    signingIdentity: NostrIdentity?
  ) async throws -> [ConversationMessage] { throw error }
  func react(
    workspaceID: String,
    conversationID: String,
    messageID: String,
    emoji: String,
    add: Bool,
    signingIdentity: NostrIdentity
  ) async throws -> ConversationMessage { throw error }
  func listWorkspaces() async throws -> [WorkspaceSummary] { throw error }
  func switchWorkspace(id: String) async throws { throw error }
  func completeAgentJob(
    workspaceID: String,
    agentID: String,
    leaseToken: String,
    completion: AgentJobCompletion
  ) async throws { throw error }
  func failAgentJob(
    workspaceID: String,
    agentID: String,
    leaseToken: String,
    error message: String,
    retryAt: Date?
  ) async throws { throw error }
  func registerAgentKey(
    workspaceID: String,
    agentID: String,
    pubkey: String
  ) async throws { throw error }
  func recordLogs(workspaceID: String, _ entries: [RelayLogEntry]) async throws { throw error }
  func claimAgentJob(workspaceID: String, agentID: String) async throws -> AgentJobLease? {
    throw error
  }
  func agentJobs(workspaceID: String, agentID: String) async throws -> [AgentJobRecord] {
    throw error
  }
  func retryAgentJob(
    workspaceID: String,
    agentID: String,
    jobID: String
  ) async throws -> AgentJobRecord { throw error }
}

private struct UnusedAuthentication: MobileAuthenticationServing {
  func makeAuthorizationRequest() async throws -> MobileAuthorizationRequest {
    throw MobileAuthenticationError.network
  }

  func exchange(
    callbackURL: URL,
    request: MobileAuthorizationRequest
  ) async throws -> ChiefSession {
    throw MobileAuthenticationError.network
  }

  func refreshAccountSession(_ session: ChiefSession) async throws -> ChiefSession {
    session
  }

  func inviteOrganizationMember(
    email: String,
    organizationID: String,
    session: ChiefSession
  ) async throws {
    throw MobileAuthenticationError.network
  }
}
