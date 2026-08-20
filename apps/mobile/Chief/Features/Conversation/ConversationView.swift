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

  var body: some View {
    VStack(spacing: 0) {
      content
      if let workspaceID = model.workspace?.id {
        AgentBrowserWorkView(
          workspaceID: workspaceID,
          conversationIDs: browserConversationIDs,
          agents: workingAgents
        )
      }
      ConversationActivityFooter(
        agents: workingAgents,
        errorCount: model.activityErrorCount(
          workspaceID: model.workspace?.id,
          conversationID: conversationID
        ),
        openActivity: { showsActivity = true }
      )
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
    .navigationTitle(conversation?.name ?? "Conversation")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          Haptics.medium()
          showsMenu = true
        } label: {
          Image(systemName: "ellipsis")
        }
        .accessibilityLabel("Conversation options")
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
      await load()
      model.markChannelRead(conversationID: conversationID)
    }
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
        sentMessageIDs: $sentMessageIDs
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

  private func load() async {
    isLoading = true
    loadFailed = false

    guard let workspaceID = model.workspace?.id else {
      isLoading = false
      return
    }

    do {
      let remote = try await model.relay.messages(
        workspaceID: workspaceID,
        conversationID: conversationID,
        after: nil
      )
      model.conversations.replace(
        workspaceID: workspaceID,
        conversationID: conversationID,
        messages: remote
      )
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

  private func send() {
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
          threadRootID: nil,
          mentions: mentions,
          components: components
        )
        model.conversations.merge(message)
        sentMessageIDs.insert(message.id)
        print(
          "[Chief] sent message to \(conversationID) mentions=\(mentions) "
            + "wake=\(shouldWakeAgent) attachments=\(pendingAttachments.count)"
        )
        if shouldWakeAgent {
          await model.runAgentTurn(
            conversationID: conversationID,
            threadRootID: nil,
            mentions: mentions
          )
        }
      } catch {
        draft = pendingText
        composerMentionIDs = pendingMentionIDs
        composerSkillIDs = pendingSkillIDs
        attachments = pendingAttachments
        Haptics.error()
        print("[Chief] send to \(conversationID) failed: \(error)")
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
