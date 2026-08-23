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
          availableMentionAgentIDs: model.workspace?.agents.map(\.id) ?? [],
          preferredMentionAgentIDs: channelAgentIDs,
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
        LazyVStack(alignment: .leading, spacing: 20) {
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

          AgentBrowserWorkView(
            workspaceID: workspaceID,
            conversationIDs: [conversationID],
            agents: workingAgents,
            placement: .inline
          )
        }
        .animation(.easeOut(duration: 0.3), value: replies.map(\.id))
        .padding(ChiefTheme.pagePadding)
      }
      .scrollDismissesKeyboard(.interactively)
      .simultaneousGesture(TapGesture().onEnded { KeyboardDismissal.dismiss() })
      .onChange(of: replies.map(\.id)) { _, _ in
        guard let last = replies.last else { return }
        withAnimation(.easeOut(duration: 0.25)) {
          proxy.scrollTo(last.id, anchor: .bottom)
        }
      }
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
      remote.forEach(model.conversations.merge)
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
          body: body,
          workspaceID: workspaceID,
          conversationID: conversationID,
          threadRootID: root.id,
          mentions: mentions,
          components: components
        )
        model.conversations.merge(message)
        // The relay queues the addressed cell once; the live mailbox owns it.
      } catch {
        draft = pendingText
        composerMentionIDs = pendingMentionIDs
        composerSkillIDs = pendingSkillIDs
        attachments = pendingAttachments
        Haptics.error()
        print("[Chief] thread send failed: \(error)")
      }
    }
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
