import SwiftUI

struct ConversationView: View {
  @Environment(AppModel.self) private var model

  let conversationID: String

  @State private var draft = ""
  @State private var composerMentionIDs: [String] = []
  @State private var composerSkillIDs: [String] = []
  @State private var attachments: [ComposerAttachment] = []
  @State private var isLoading = true
  @State private var isSending = false
  @State private var loadFailed = false
  @State private var seenMessageIDs: Set<String> = []
  @State private var sentMessageIDs: Set<String> = []
  @State private var showsActivity = false
  @State private var showsMenu = false
  @State private var showsCanvas = false
  @State private var isJoining = false
  @State private var accessError: String?
  @State private var channelAgentIDs: [String] = []

  var body: some View {
    VStack(spacing: 0) {
      content
      if isMember, let workspaceID = model.workspace?.id {
        AgentBrowserWorkView(
          workspaceID: workspaceID,
          conversationIDs: browserConversationIDs,
          agents: workingAgents
        )
      }
      if isMember {
        ConversationActivityFooter(
          agents: workingAgents,
          errorCount: model.activityErrorCount(
            workspaceID: model.workspace?.id,
            conversationID: conversationID
          ),
          openActivity: { showsActivity = true }
        )
      }
      participationFooter
    }
    .modifier(ScheduledRunTracking(messages: messages, conversationID: conversationID))
    .background(ChiefTheme.background)
    .navigationTitle(conversation?.name ?? "Conversation")
    .navigationBarTitleDisplayMode(.inline)
    .navigationDestination(isPresented: $showsCanvas) { ChannelCanvasView(conversationID: conversationID) }
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        if isMember, conversation?.kind == .channel {
          Button { showsCanvas = true } label: { Image(systemName: "doc.on.doc") }
            .accessibilityLabel("Open channel Canvas")
        }
      }
      ToolbarItem(placement: .topBarTrailing) {
        if isMember {
          Button {
            Haptics.medium()
            showsMenu = true
          } label: {
            Image(systemName: "ellipsis")
          }
          .accessibilityLabel("Conversation options")
        }
      }
    }
    .sheet(isPresented: $showsMenu) {
      ConversationMenuSheet { showsActivity = true }
    }
    .navigationDestination(isPresented: $showsActivity) {
      ConversationActivityView(conversationID: conversationID)
    }
    .task(id: conversationID) {
      model.setVisibleConversation(conversationID)
      async let access: Void = model.refreshCurrentChannelMemberships()
      async let members: Void = loadChannelAgents()
      await load()
      await access
      await members
      model.markChannelRead(conversationID: conversationID)
    }
    .refreshable { await load() }
    .onDisappear {
      model.clearVisibleConversation(conversationID)
    }
  }

  @ViewBuilder
  private var content: some View {
    if isLoading && messages.isEmpty {
      ConversationLoadingView()
    } else if loadFailed && messages.isEmpty {
      ConversationLoadFailureView(onRetry: retryLoad)
    } else if messages.isEmpty {
      ConversationEmptyView()
    } else {
      ConversationTranscriptView(
        conversationID: conversationID,
        messages: messages,
        seenMessageIDs: $seenMessageIDs,
        sentMessageIDs: $sentMessageIDs,
        allowsActions: canParticipate
      )
    }
  }

  private var conversation: ConversationSummary? {
    model.workspace?.conversations.first { $0.id == conversationID }
  }

  private var messages: [ConversationMessage] {
    guard let workspaceID = model.workspace?.id else { return [] }
    return model.conversations.messages(
      workspaceID: workspaceID,
      conversationID: conversationID
    ).filter { $0.threadRootID == nil }
  }

  private var workingAgents: [AgentActivityPresence] {
    model.workingAgentPresences(
      workspaceID: model.workspace?.id,
      conversationID: conversationID
    )
  }

  private var browserConversationIDs: [String] {
    [conversationID]
  }

  private var isMember: Bool {
    model.isConversationJoined(conversationID)
  }

  private var canParticipate: Bool {
    model.canParticipate(in: conversationID)
  }

  @ViewBuilder
  private var participationFooter: some View {
    if canParticipate {
      MessageComposer(
        text: $draft,
        mentionIDs: $composerMentionIDs,
        skillIDs: $composerSkillIDs,
        isSending: isSending,
        attachments: attachments,
        availableMentionAgentIDs: model.mentionPeople.filter { $0.role != "You" }.map(\.id),
        preferredMentionAgentIDs: channelAgentIDs,
        people: model.mentionPeople,
        onSend: send,
        onAddAttachments: addAttachments,
        onRemoveAttachment: removeAttachment
      )
    } else if model.channelMembershipsLoaded, let conversation {
      ChannelAccessBar(
        channelName: conversation.name,
        isMember: isMember,
        isPrivate: conversation.isPrivate,
        isArchived: conversation.archived,
        isJoining: isJoining,
        error: accessError,
        onJoin: joinChannel
      )
    } else {
      ChannelAccessLoadingBar()
    }
  }

  private func load() async {
    isLoading = true
    loadFailed = false

    guard let workspaceID = model.workspace?.id else {
      isLoading = false
      return
    }

    do {
      try await model.refreshConversation(workspaceID: workspaceID, conversationID: conversationID)
      let remote = model.conversations.messages(workspaceID: workspaceID, conversationID: conversationID)
      seenMessageIDs = Set(remote.map(\.id))
      sentMessageIDs = []
      print("[Chief] loaded \(remote.count) messages for \(conversationID)")
    } catch {
      loadFailed = true
      print("[Chief] load messages \(conversationID) failed: \(error)")
    }

    isLoading = false
  }

  private func retryLoad() {
    Task { await load() }
  }

  private func loadChannelAgents() async {
    channelAgentIDs = await model.channelMembers(conversationID: conversationID)
      .filter { $0.kind == "agent" }
      .map(\.principalId)
  }

  private func send() {
    guard canParticipate else { return }
    let pendingText = draft
    let body = MessageReferenceSerializer.body(
      text: draft,
      mentionIDs: composerMentionIDs,
      skillIDs: composerSkillIDs
    )
    guard !body.isEmpty || !attachments.isEmpty else { return }
    guard let workspaceID = model.workspace?.id else { return }

    let pendingAttachments = attachments
    let pendingMentionIDs = composerMentionIDs
    let pendingSkillIDs = composerSkillIDs
    let mentions = orderedUnique(
      composerMentionIDs + AgentMentionParser.mentions(in: draft)
    )
    let shouldWakeAgent = model.shouldWakeAgent(
      conversationID: conversationID,
      mentions: mentions,
      threadRootID: nil
    )
    let messageID = UUID().uuidString
    model.expectAgentReply(messageID: messageID, conversationID: conversationID, mentions: mentions, threadRootID: nil)

    draft = ""
    composerMentionIDs = []
    composerSkillIDs = []
    attachments = []
    isSending = true

    Task {
      defer { isSending = false }
      do {
        let components = try await MessageAttachmentUploader.components(
          for: pendingAttachments,
          workspaceID: workspaceID,
          conversationID: conversationID,
          relay: model.relay
        )
        let message = try await model.relay.send(
          messageID: messageID,
          body: body,
          workspaceID: workspaceID,
          conversationID: conversationID,
          threadRootID: nil,
          mentions: mentions,
          components: components
        )
        sentMessageIDs.insert(message.id)
        model.conversations.merge(message)
        Task { await model.wakeOnDeviceAgents() }
        print(
          "[Chief] sent message to \(conversationID) mentions=\(mentions) "
            + "wake=\(shouldWakeAgent) attachments=\(pendingAttachments.count)"
        )
        // The relay queues exactly one idempotent job for the addressed cell.
        // The on-device mailbox loop claims it over the live socket.
      } catch {
        if await reconcileDeliveredMessage(
          messageID: messageID,
          workspaceID: workspaceID
        ) {
          sentMessageIDs.insert(messageID)
          Task { await model.wakeOnDeviceAgents() }
          return
        }
        model.cancelExpectedAgentReply(messageID: messageID)
        draft = MessageSendRecovery.restoredDraft(
          pending: pendingText,
          current: draft
        )
        composerMentionIDs = pendingMentionIDs
        composerSkillIDs = pendingSkillIDs
        attachments = pendingAttachments
        Haptics.error()
        print("[Chief] send to \(conversationID) failed: \(error)")
      }
    }
  }

  private func reconcileDeliveredMessage(
    messageID: String,
    workspaceID: String
  ) async -> Bool {
    for attempt in 0..<4 {
      if model.conversations.messages(
        workspaceID: workspaceID,
        conversationID: conversationID
      ).contains(where: { $0.id == messageID }) {
        return true
      }
      if attempt == 1,
        let remote = try? await model.relay.messages(
          workspaceID: workspaceID,
          conversationID: conversationID,
          after: nil
        ),
        let delivered = remote.first(where: { $0.id == messageID })
      {
        model.conversations.merge(delivered)
        return true
      }
      try? await Task.sleep(for: .milliseconds(150))
    }
    return false
  }

  private func joinChannel() {
    guard !isJoining else { return }
    isJoining = true
    accessError = nil
    Task {
      let joined = await model.joinConversation(conversationID)
      isJoining = false
      if joined {
        Haptics.heavy()
      } else {
        Haptics.error()
        accessError = "Chief couldn't join this channel. Try again."
      }
    }
  }

  private func addAttachments(_ newAttachments: [ComposerAttachment]) {
    attachments.append(contentsOf: newAttachments.prefix(4 - attachments.count))
  }

  private func removeAttachment(_ attachment: ComposerAttachment) {
    attachments.removeAll { $0.id == attachment.id }
  }

  private func orderedUnique(_ values: [String]) -> [String] {
    var seen = Set<String>()
    return values.filter { seen.insert($0).inserted }
  }
}
