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

  var body: some View {
    VStack(spacing: 0) {
      transcript
      AgentBrowserWorkView(
        workspaceID: workspaceID,
        conversationIDs: [conversationID],
        agents: workingAgents
      )
      if !workingAgents.isEmpty {
        AgentTypingRow(
          agents: workingAgents,
          openActivity: { showsActivity = true }
        )
          .transition(.opacity)
      }
      MessageComposer(
        text: $draft,
        mentionIDs: $composerMentionIDs,
        skillIDs: $composerSkillIDs,
        isSending: isSending,
        attachments: attachments,
        onSend: send,
        onAddAttachments: addAttachments,
        onRemoveAttachment: removeAttachment
      )
    }
    .background(ChiefTheme.background)
    .navigationTitle("Thread")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          Haptics.medium()
          showsMenu = true
        } label: {
          Image(systemName: "ellipsis")
        }
        .accessibilityLabel("Thread options")
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
      await loadReplies()
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
            onEdit: { editTarget = $0 }
          )
          .id("root")

          Divider().overlay(ChiefTheme.line)

          ForEach(ChatTimelineBuilder.rows(for: replies)) { row in
            switch row.payload {
            case .daySeparator(let label):
              DaySeparator(label: label).id(row.id)
            case .message(let message, let showsAuthor):
              ConversationMessageRow(
                message: message,
                showsAuthor: showsAuthor,
                onEdit: { editTarget = $0 }
              )
              .id(row.id)
            }
          }
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
    let all = model.workingAgentPresences(
      workspaceID: workspaceID,
      conversationID: conversationID
    )
    guard let expected = AgentMentionParser.mentions(in: root.body).first else { return all }
    return all.filter { $0.id == expected }
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
        if case .agent = root.author {
          await model.runAgentTurn(
            conversationID: conversationID,
            threadRootID: root.id,
            mentions: mentions
          )
        }
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
