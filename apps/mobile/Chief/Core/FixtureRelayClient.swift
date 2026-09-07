import Foundation

actor FixtureRelayClient: RelayServing {
    private var fixtureMessages = DemoWorkspace.messages + (ScheduledRunDemo.enabled ? [ScheduledRunDemo.message, ScheduledRunDemo.reply] : [])
    private var provisioningCredential: String?

    func scheduleRuns(workspaceID: String, scheduleID: String) async throws -> [WorkspaceScheduleRun] {
      ScheduledRunDemo.enabled && workspaceID == DemoWorkspace.snapshot.id && scheduleID == "demo-schedule" ? [ScheduledRunDemo.run] : []
    }
    func listWorkspaceFiles(workspaceID: String, signingIdentity: NostrIdentity?) async throws -> [WorkspaceFileRecord] {
      ScheduledRunDemo.enabled && workspaceID == DemoWorkspace.snapshot.id ? [ScheduledRunDemo.file] : []
    }

    func bindDeviceIdentity(accountToken: String) async throws {}

    func loadWorkspace() async throws -> WorkspaceSnapshot { DemoWorkspace.snapshot }

    func createWorkspace(
        from draft: OnboardingDraft,
        inferenceCredential: String?
    ) async throws -> WorkspaceSnapshot {
        provisioningCredential = inferenceCredential
        return WorkspaceSnapshot(
            id: "workspace-\(UUID().uuidString.lowercased())",
            name: draft.companyName,
            website: draft.website,
            selectedApps: draft.selectedApps.sorted(),
            runtime: draft.runtime?.rawValue,
            onboardingComplete: true,
            conversations: DemoWorkspace.snapshot.conversations,
            agents: DemoWorkspace.snapshot.agents,
            projects: []
        )
    }

    func latestProvisioningCredential() -> String? {
        provisioningCredential
    }

    func messages(
        workspaceID: String,
        conversationID: String,
        after sequence: Int?,
        signingIdentity: NostrIdentity?
    ) async throws -> [ConversationMessage] {
        fixtureMessages.filter {
            $0.workspaceID == workspaceID && $0.conversationID == conversationID
        }
    }

    func send(
        messageID: String = UUID().uuidString,
        body: String,
        workspaceID: String,
        conversationID: String,
        threadRootID: String?,
        mentions: [String] = [],
        components: [MessageComponent] = []
    ) async throws -> ConversationMessage {
        let message = ConversationMessage(
            id: messageID,
            workspaceID: workspaceID,
            conversationID: conversationID,
            threadRootID: threadRootID,
            author: .user(id: "daniel", name: "Daniel Sims"),
            body: body,
            mentions: mentions,
            components: components,
            createdAt: .now,
            sequence: (fixtureMessages.map(\.sequence).max() ?? 0) + 1
        )
        fixtureMessages.append(message)
        return message
    }

    func claimAgentJob(workspaceID: String, agentID: String) async throws -> AgentJobLease? {
        AgentJobLease(
            job: .init(
                id: UUID().uuidString,
                agentId: agentID,
                kind: "workspace.onboarding",
                attempt: 1,
                payload: .init(conversationId: "mission-control")
            ),
            leaseToken: UUID().uuidString
        )
    }

    func agentJobs(workspaceID: String, agentID: String) async throws -> [AgentJobRecord] { [] }

    func retryAgentJob(
        workspaceID: String,
        agentID: String,
        jobID: String
    ) async throws -> AgentJobRecord {
        throw RelayError.httpStatus(404)
    }

    func completeAgentJob(
        workspaceID: String,
        agentID: String,
        leaseToken: String,
        completion: AgentJobCompletion
    ) async throws {}

    func failAgentJob(
        workspaceID: String,
        agentID: String,
        leaseToken: String,
        error: String,
        retryAt: Date?
    ) async throws {}

    func recordLogs(workspaceID: String, _ entries: [RelayLogEntry]) async throws {}

    func registerAgentKey(
        workspaceID: String,
        agentID: String,
        pubkey: String
    ) async throws {}

    func sendAsAgent(
        body: String,
        workspaceID: String,
        conversationID: String,
        threadRootID: String?,
        mentions: [String],
        components: [MessageComponent],
        signingIdentity: NostrIdentity
    ) async throws -> ConversationMessage {
        var message = try await send(
            body: body,
            workspaceID: workspaceID,
            conversationID: conversationID,
            threadRootID: threadRootID,
            mentions: mentions
        )
        message = ConversationMessage(
            id: message.id,
            workspaceID: message.workspaceID,
            conversationID: message.conversationID,
            threadRootID: message.threadRootID,
            author: .agent(id: "chief", name: "Chief"),
            body: message.body,
            mentions: message.mentions,
            components: components,
            reactions: message.reactions,
            createdAt: message.createdAt,
            sequence: message.sequence
        )
        fixtureMessages = fixtureMessages.map { $0.id == message.id ? message : $0 }
        return message
    }

    func upsertAgentActivity(
        workspaceID: String,
        conversationID: String,
        messageID: String,
        threadRootID: String?,
        component: MessageComponent,
        signingIdentity: NostrIdentity
    ) async throws -> ConversationMessage {
        if let index = fixtureMessages.firstIndex(where: { $0.id == messageID }) {
            let prior = fixtureMessages[index]
            let updated = ConversationMessage(
                id: prior.id,
                workspaceID: prior.workspaceID,
                conversationID: prior.conversationID,
                threadRootID: prior.threadRootID,
                author: prior.author,
                body: "",
                components: [component],
                createdAt: prior.createdAt,
                sequence: prior.sequence
            )
            fixtureMessages[index] = updated
            return updated
        }
        let message = ConversationMessage(
            id: messageID,
            workspaceID: workspaceID,
            conversationID: conversationID,
            threadRootID: threadRootID,
            author: .agent(id: "chief", name: "Chief"),
            body: "",
            components: [component],
            createdAt: .now,
            sequence: (fixtureMessages.map(\.sequence).max() ?? 0) + 1
        )
        fixtureMessages.append(message)
        return message
    }

    func uploadAttachment(
        workspaceID: String,
        conversationID: String,
        fileName: String,
        data: Data
    ) async throws -> String {
        let ext = (fileName as NSString).pathExtension
        return "https://fixture.invalid/attachments/\(UUID().uuidString).\(ext)"
    }

    func listChannels(
        workspaceID: String,
        signingIdentity: NostrIdentity?
    ) async throws -> [ChannelRecord] {
        DemoWorkspace.snapshot.conversations
            .filter { $0.kind == .channel }
            .map { fromSummary($0, workspaceID: workspaceID) }
    }

    func createChannel(
        workspaceID: String,
        conversationID: String,
        name: String,
        isPrivate: Bool,
        signingIdentity: NostrIdentity?
    ) async throws -> ChannelRecord {
        ChannelRecord(
            id: conversationID,
            workspaceId: workspaceID,
            name: name,
            isPrivate: isPrivate,
            archived: false,
            createdAt: .now
        )
    }

    func archiveChannel(workspaceID: String, conversationID: String, archived: Bool) async throws {}

    func joinChannel(workspaceID: String, conversationID: String, signingIdentity: NostrIdentity?) async throws {}

    func leaveChannel(workspaceID: String, conversationID: String) async throws {}

    func channelMembers(workspaceID: String, conversationID: String) async throws -> [ChannelMember] {
        []
    }

    func addChannelMember(
        workspaceID: String,
        conversationID: String,
        kind: String,
        principalID: String,
        signingIdentity: NostrIdentity?
    ) async throws {}

    func editMessage(
        workspaceID: String,
        conversationID: String,
        messageID: String,
        body: String
    ) async throws -> ConversationMessage {
        guard let index = fixtureMessages.firstIndex(where: { $0.id == messageID }) else {
            throw RelayError.httpStatus(404)
        }
        var message = fixtureMessages[index]
        message.body = body
        message.edited = true
        fixtureMessages[index] = message
        return message
    }

    func deleteMessage(
        workspaceID: String,
        conversationID: String,
        messageID: String
    ) async throws -> ConversationMessage {
        guard let index = fixtureMessages.firstIndex(where: { $0.id == messageID }) else {
            throw RelayError.httpStatus(404)
        }
        var message = fixtureMessages[index]
        message = ConversationMessage(
            id: message.id,
            workspaceID: message.workspaceID,
            conversationID: message.conversationID,
            threadRootID: message.threadRootID,
            author: message.author,
            body: "",
            mentions: [],
            components: [],
            reactions: [],
            edited: false,
            deleted: true,
            createdAt: message.createdAt,
            sequence: message.sequence
        )
        fixtureMessages[index] = message
        return message
    }

    func workspaceMembers(
        workspaceID: String,
        signingIdentity: NostrIdentity?
    ) async throws -> [WorkspaceMember] {
        [
            .init(kind: "user", principalId: "daniel", role: "owner", name: "Daniel"),
            .init(kind: "agent", principalId: "chief", role: "member", name: "Chief"),
            .init(kind: "agent", principalId: "engineer", role: "member", name: "Engineer"),
        ]
    }

    func startDirectMessage(
        workspaceID: String,
        participantKind: String,
        participantID: String
    ) async throws -> ConversationSummary {
        let name = DemoWorkspace.snapshot.agents
            .first(where: { $0.id == participantID })?.name ?? participantID
        return ConversationSummary(
            id: "dm-\(participantKind)-\(participantID)",
            name: name,
            kind: .direct,
            isPrivate: true,
            unreadCount: 0,
            requiresAttention: false,
            lastMessage: nil
        )
    }

    func loadAgentConfig(workspaceID: String, agentID: String) async throws -> AgentConfig? {
        nil
    }

    func removeChannelMember(
        workspaceID: String,
        conversationID: String,
        kind: String,
        principalID: String
    ) async throws {}

    func allChannelMemberships(workspaceID: String) async throws -> [ChannelMembership] {
        var memberships: [ChannelMembership] = []
        for conversation in DemoWorkspace.snapshot.conversations where conversation.kind == .channel {
            memberships.append(
                .init(conversationId: conversation.id, kind: "user", principalId: "daniel", role: "owner", joinedAt: .now)
            )
            memberships.append(
                .init(conversationId: conversation.id, kind: "agent", principalId: "chief", role: "owner", joinedAt: .now)
            )
        }
        return memberships
    }

    func currentChannelMemberships(workspaceID: String) async throws -> [ChannelMembership] {
        try await allChannelMemberships(workspaceID: workspaceID).filter { $0.kind == "user" }
    }

    func saveAgentConfig(workspaceID: String, agentID: String, config: AgentConfig) async throws {}
    func workspaceSecretNames(workspaceID: String) async throws -> [String] { [] }
    func setWorkspaceSecret(workspaceID: String, name: String, value: String) async throws {}

    private func fromSummary(_ summary: ConversationSummary, workspaceID: String) -> ChannelRecord {
        ChannelRecord(
            id: summary.id,
            workspaceId: workspaceID,
            name: summary.name,
            isPrivate: summary.isPrivate,
            archived: summary.archived,
            createdAt: .now
        )
    }

    func replies(
        workspaceID: String,
        conversationID: String,
        rootMessageID: String,
        after sequence: Int?,
        signingIdentity: NostrIdentity?
    ) async throws -> [ConversationMessage] {
        fixtureMessages.filter {
            $0.workspaceID == workspaceID
                && $0.conversationID == conversationID
                && $0.threadRootID == rootMessageID
        }
    }

    func searchMessages(
        workspaceID: String,
        conversationID: String,
        query: String,
        signingIdentity: NostrIdentity?
    ) async throws -> [ConversationMessage] {
        fixtureMessages.filter {
            $0.workspaceID == workspaceID
                && $0.conversationID == conversationID
                && $0.body.localizedCaseInsensitiveContains(query)
        }
    }

    func react(
        workspaceID: String,
        conversationID: String,
        messageID: String,
        emoji: String,
        add: Bool,
        signingIdentity: NostrIdentity
    ) async throws -> ConversationMessage {
        fixtureMessages
            .first { $0.id == messageID }
            ?? ConversationMessage(
                id: messageID,
                workspaceID: workspaceID,
                conversationID: conversationID,
                threadRootID: nil,
                author: .agent(id: "chief", name: "Chief"),
                body: "",
                components: [],
                createdAt: .now,
                sequence: (fixtureMessages.map(\.sequence).max() ?? 0) + 1
            )
    }

    func listWorkspaces() async throws -> [WorkspaceSummary] {
        [
            .init(
                id: "chief-demo",
                name: "Chief",
                isActive: true,
                onboardingComplete: true
            )
        ]
    }

    func switchWorkspace(id: String) async throws {}

    func createWorkspaceInvite(
        workspaceID: String,
        conversationID: String?
    ) async throws -> WorkspaceInviteLink {
        WorkspaceInviteLink(
            relayURL: URL(string: "https://relay.demo.heychief.sh")!,
            workspaceID: workspaceID,
            secret: String(repeating: "a", count: 43)
        )
    }

    func previewWorkspaceInvite(_ link: WorkspaceInviteLink) async throws -> WorkspaceInvite {
        WorkspaceInvite(
            workspaceId: link.workspaceID,
            workspaceName: "Chief",
            website: "https://heychief.sh",
            conversationId: nil,
            conversationName: nil,
            expiresAt: ISO8601DateFormatter.chief().string(from: .now.addingTimeInterval(3600))
        )
    }

    func claimWorkspaceInvite(_ link: WorkspaceInviteLink) async throws -> WorkspaceInviteClaim {
        WorkspaceInviteClaim(
            workspaceId: link.workspaceID,
            workspaceName: "Chief",
            website: "https://heychief.sh",
            conversationId: nil,
            conversationName: nil,
            expiresAt: ISO8601DateFormatter.chief().string(from: .now.addingTimeInterval(3600)),
            alreadyMember: false
        )
    }
}

enum DemoWorkspace {
    static let snapshot = WorkspaceSnapshot(
        id: "chief-demo",
        name: "Chief",
        onboardingComplete: true,
        conversations: [
            .init(
                id: "mission-control",
                name: "mission-control",
                kind: .channel,
                isPrivate: false,
                unreadCount: 2,
                requiresAttention: true,
                lastMessage: "I have one decision ready for you."
            ),
            .init(
                id: "engineering",
                name: "engineering",
                kind: .channel,
                isPrivate: false,
                unreadCount: 0,
                requiresAttention: false,
                lastMessage: "The relay checks are green."
            ),
            .init(
                id: "general",
                name: "general",
                kind: .channel,
                isPrivate: false,
                unreadCount: 0,
                requiresAttention: false,
                lastMessage: "Daniel joined the workspace."
            ),
            .init(
                id: "chief-dm",
                name: "Chief",
                kind: .direct,
                isPrivate: true,
                unreadCount: 1,
                requiresAttention: false,
                lastMessage: "Morning. I pulled together your priorities."
            )
        ],
        agents: [
            .init(id: "chief", name: "Chief", role: "Chief of staff", status: .working),
            .init(id: "engineer", name: "Engineer", role: "Product engineering", status: .idle),
            .init(id: "marketer", name: "Marketer", role: "Marketing", status: .needsYou)
        ],
        projects: [
            .init(
                id: "chief-project",
                organizationID: "chief-demo",
                name: "chief",
                description: "The Chief application repository.",
                repositoryKind: "cloned",
                providerID: "github",
                canonicalRemoteURL: "https://github.com/danielsims/chief.git",
                repositoryWebURL: "https://github.com/danielsims/chief",
                repositoryFiles: [
                    .init(
                        path: "README.md",
                        content: "# Chief\n\nA workspace where people and agents get work done together."
                    ),
                    .init(
                        path: "apps/mobile/ChiefApp.swift",
                        content: "import SwiftUI\n\n@main\nstruct ChiefApp: App {\n  var body: some Scene { WindowGroup { RootView() } }\n}"
                    ),
                    .init(
                        path: "packages/relay-client/package.json",
                        content: "{\n  \"name\": \"@chief/relay-client\"\n}"
                    )
                ],
                defaultBranch: "main",
                createdAt: "2026-08-22T00:00:00.000Z",
                updatedAt: "2026-08-22T00:00:00.000Z"
            )
        ]
    )

    static let messages: [ConversationMessage] = [
        .init(
            id: "message-1",
            workspaceID: snapshot.id,
            conversationID: "mission-control",
            threadRootID: nil,
            author: .agent(id: "chief", name: "Chief"),
            body: "Morning Daniel. The team is moving. Engineering has the relay vertical slice ready for review.",
            components: [],
            createdAt: .now.addingTimeInterval(-1_800),
            sequence: 1
        ),
        .init(
            id: "message-2",
            workspaceID: snapshot.id,
            conversationID: "mission-control",
            threadRootID: nil,
            author: .agent(id: "chief", name: "Chief"),
            body: "Which move should I greenlight next?",
            components: [
                .init(
                    id: "attention-1",
                    kind: "action-request",
                    payload: [
                        "title": "Choose the next move",
                        "options": "Review the relay|Connect GitHub|Start mobile QA"
                    ]
                )
            ],
            createdAt: .now.addingTimeInterval(-1_200),
            sequence: 2
        )
    ]
}
