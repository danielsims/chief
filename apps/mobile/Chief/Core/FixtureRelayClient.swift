import Foundation

actor FixtureRelayClient: RelayServing {
    private var fixtureMessages = DemoWorkspace.messages

    func loadWorkspace() async throws -> WorkspaceSnapshot { DemoWorkspace.snapshot }

    func createWorkspace(from draft: OnboardingDraft) async throws -> WorkspaceSnapshot {
        WorkspaceSnapshot(
            id: "workspace-\(UUID().uuidString.lowercased())",
            name: draft.companyName,
            onboardingComplete: true,
            conversations: DemoWorkspace.snapshot.conversations,
            agents: DemoWorkspace.snapshot.agents,
            projects: []
        )
    }

    func messages(workspaceID: String, conversationID: String, after sequence: Int?) async throws -> [ConversationMessage] {
        fixtureMessages.filter {
            $0.workspaceID == workspaceID && $0.conversationID == conversationID
        }
    }

    func send(
        body: String,
        workspaceID: String,
        conversationID: String,
        threadRootID: String?,
        mentions: [String] = []
    ) async throws -> ConversationMessage {
        let message = ConversationMessage(
            id: UUID().uuidString,
            workspaceID: workspaceID,
            conversationID: conversationID,
            threadRootID: threadRootID,
            author: .user(id: "daniel", name: "Daniel Sims"),
            body: body,
            mentions: mentions,
            components: [],
            createdAt: .now,
            sequence: (fixtureMessages.map(\.sequence).max() ?? 0) + 1
        )
        fixtureMessages.append(message)
        return message
    }

    func claimAgentJob(workspaceID: String, agentID: String) async throws -> AgentJobLease? {
        AgentJobLease(
            job: .init(id: UUID().uuidString, kind: "workspace.onboarding"),
            leaseToken: UUID().uuidString
        )
    }

    func completeAgentJob(
        workspaceID: String,
        agentID: String,
        leaseToken: String,
        completion: AgentJobCompletion
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
        signingIdentity: NostrIdentity
    ) async throws -> ConversationMessage {
        try await send(
            body: body,
            workspaceID: workspaceID,
            conversationID: conversationID,
            threadRootID: threadRootID,
            mentions: mentions
        )
    }

    func replies(
        workspaceID: String,
        conversationID: String,
        rootMessageID: String,
        after sequence: Int?
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
        query: String
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
                name: "chief",
                repository: "danielsims/chief",
                branch: "feat/projects",
                changedFiles: 12
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
