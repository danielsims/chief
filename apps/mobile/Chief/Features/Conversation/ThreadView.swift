import BrowserUI
import SwiftUI

struct ThreadView: View {
  @Environment(AppModel.self) private var model
  let workspaceID: String
  let conversationID: String
  let root: ConversationMessage

  @State private var draft = ""
  @State private var composerMentionIDs: [String] = []
  @State private var composerSkillIDs: [String] = []
  @State private var attachments: [ComposerAttachment] = []
  @State private var isSending = false
  @State private var editTarget: ConversationMessage?
  @State private var showsActivity = false
  @State private var showsMenu = false
  @State private var isJoining = false
  @State private var accessError: String?
  @State private var channelAgentIDs: [String] = []
  @State private var isNearLatest = true
  @State private var sentReplyIDs: Set<String> = []
  @State private var hasPositionedInitially = false

  private var latestAnchorID: String { "thread-latest-\(root.id)" }

  var body: some View {
    VStack(spacing: 0) {
      transcript
      if isMember {
        AgentBrowserWorkView(
          workspaceID: workspaceID,
          conversationIDs: [conversationID],
          agents: workingAgents
        )
        ConversationActivityFooter(
          agents: workingAgents,
          scheduledThreadRootID: root.id,
          errorCount: model.activityErrorCount(
            workspaceID: workspaceID,
            conversationID: conversationID
          ),
          openActivity: { showsActivity = true }
        )
      }
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
    .modifier(ScheduledRunTracking(messages: [root], conversationID: conversationID))
    .background(ChiefTheme.background)
    .navigationTitle("Thread")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        if isMember {
          Button {
            Haptics.medium()
            showsMenu = true
          } label: {
            Image(systemName: "ellipsis")
          }
          .accessibilityLabel("Thread options")
        }
      }
    }
    .sheet(isPresented: $showsMenu) {
      ConversationMenuSheet { showsActivity = true }
    }
    .navigationDestination(isPresented: $showsActivity) {
      ConversationActivityView(conversationID: conversationID)
    }
    .task {
      model.setVisibleThread(conversationID: conversationID, rootMessageID: root.id)
      async let access: Void = model.refreshCurrentChannelMemberships()
      async let members: Void = loadChannelAgents()
      await loadReplies()
      await access
      await members
      model.markThreadRead(conversationID: conversationID, rootMessageID: root.id)
    }
    .onDisappear {
      model.clearVisibleThread(conversationID: conversationID, rootMessageID: root.id)
    }
    .sheet(item: $editTarget) { message in
      EditMessageSheet(message: message) { body in
        Task {
          await model.editMessage(
            messageID: message.id,
            conversationID: conversationID,
            body: body
          )
        }
      }
    }
  }

  private var transcript: some View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          ConversationMessageRow(
            message: root,
            showsThreadSummary: false,
            allowsActions: canParticipate,
            onEdit: { editTarget = $0 }
          )
          .id("root")

          ForEach(ChatTimelineBuilder.rows(for: replies)) { row in
            switch row.payload {
            case .daySeparator(let label):
              DaySeparator(label: label).id(row.id)
            case .message(let message, let showsAuthor):
              ConversationMessageRow(
                message: message,
                showsAuthor: showsAuthor,
                allowsActions: canParticipate,
                onEdit: { editTarget = $0 }
              )
              .id(row.id)
            }
          }

          Color.clear
            .frame(height: 1)
            .id(latestAnchorID)
        }
        .padding(ChiefTheme.pagePadding)
      }
      .defaultScrollAnchor(.bottom)
      .scrollDismissesKeyboard(.interactively)
      .simultaneousGesture(TapGesture().onEnded { KeyboardDismissal.dismiss() })
      .onScrollGeometryChange(for: Bool.self) { geometry in
        ConversationScrollAnchor.isNearLatest(geometry)
      } action: { _, nearLatest in
        isNearLatest = nearLatest
      }
      .onScrollGeometryChange(for: CGFloat.self) { geometry in
        geometry.contentSize.height
      } action: { oldHeight, newHeight in
        followLatestIfNeeded(
          contentGrew: hasPositionedInitially && newHeight > oldHeight,
          using: proxy
        )
      }
      .onChange(of: ConversationScrollAnchor.followKey(for: replies)) { _, _ in
        let shouldFollowLatest =
          isNearLatest || replies.last.map { sentReplyIDs.contains($0.id) } == true
        sentReplyIDs.formIntersection(Set(replies.map(\.id)))
        if shouldFollowLatest {
          scrollToLatest(using: proxy, animated: true)
        }
      }
      .task(id: root.id) {
        await Task.yield()
        scrollToLatest(using: proxy, animated: false)
        hasPositionedInitially = true
      }
      .overlay(alignment: .bottom) {
        if hasPositionedInitially && !isNearLatest {
          ScrollToLatestButton {
            scrollToLatest(using: proxy, animated: true)
          }
          .padding(.bottom, 12)
          .transition(.opacity.combined(with: .scale(scale: 0.9)))
        }
      }
      .animation(.easeOut(duration: 0.18), value: isNearLatest)
    }
  }

  private func followLatestIfNeeded(contentGrew: Bool, using proxy: ScrollViewProxy) {
    guard contentGrew, isNearLatest else { return }
    scrollToLatest(using: proxy, animated: true)
  }

  private func scrollToLatest(using proxy: ScrollViewProxy, animated: Bool) {
    isNearLatest = true
    let scroll = {
      proxy.scrollTo(latestAnchorID, anchor: .bottom)
    }
    if animated {
      withAnimation(.easeOut(duration: 0.25), scroll)
    } else {
      scroll()
    }
  }

  private var replies: [ConversationMessage] {
    model.conversations
      .messages(workspaceID: workspaceID, conversationID: conversationID)
      .filter { $0.threadRootID == root.id }
  }

  private var workingAgents: [AgentActivityPresence] {
    model.workingAgentPresences(
      workspaceID: workspaceID,
      conversationID: conversationID
    )
  }

  private var conversation: ConversationSummary? {
    model.workspace?.conversations.first { $0.id == conversationID }
  }

  private var isMember: Bool {
    model.isConversationJoined(conversationID)
  }

  private var canParticipate: Bool {
    model.canParticipate(in: conversationID)
  }

  private func loadReplies() async {
    do {
      let remote = try await model.relay.replies(
        workspaceID: workspaceID,
        conversationID: conversationID,
        rootMessageID: root.id,
        after: nil
      )
      let cached = model.conversations.messages(
        workspaceID: workspaceID,
        conversationID: conversationID
      )
      model.conversations.replace(
        workspaceID: workspaceID,
        conversationID: conversationID,
        messages: cached + remote
      )
    } catch {
      print("[Chief] thread replies \(root.id) failed: \(error)")
    }
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

    let pendingAttachments = attachments
    let pendingMentionIDs = composerMentionIDs
    let pendingSkillIDs = composerSkillIDs
    let mentions = orderedUnique(
      composerMentionIDs + AgentMentionParser.mentions(in: draft)
    )
    let messageID = UUID().uuidString
    model.expectAgentReply(messageID: messageID, conversationID: conversationID, mentions: mentions, threadRootID: root.id)
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
          threadRootID: root.id,
          mentions: mentions,
          components: components
        )
        sentReplyIDs.insert(message.id)
        model.conversations.merge(message)
        Task { await model.wakeOnDeviceAgents() }
        // The relay queues the addressed cell once; the live mailbox owns it.
      } catch {
        if await reconcileDeliveredReply(messageID: messageID) {
          sentReplyIDs.insert(messageID)
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
        print("[Chief] thread send failed: \(error)")
      }
    }
  }

  private func reconcileDeliveredReply(messageID: String) async -> Bool {
    for attempt in 0..<4 {
      if model.conversations.messages(
        workspaceID: workspaceID,
        conversationID: conversationID
      ).contains(where: { $0.id == messageID }) {
        return true
      }
      if attempt == 1,
        let remote = try? await model.relay.replies(
          workspaceID: workspaceID,
          conversationID: conversationID,
          rootMessageID: root.id,
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

  private func loadChannelAgents() async {
    channelAgentIDs = await model.channelMembers(conversationID: conversationID)
      .filter { $0.kind == "agent" }
      .map(\.principalId)
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
