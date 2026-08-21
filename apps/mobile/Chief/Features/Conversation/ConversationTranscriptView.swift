import BrowserUI
import SwiftUI

struct ConversationTranscriptView: View {
  @Environment(AppModel.self) private var model

  let conversationID: String
  let messages: [ConversationMessage]
  let browserWorkspaceID: String?
  let browserAgents: [AgentActivityPresence]
  @Binding var seenMessageIDs: Set<String>
  @Binding var sentMessageIDs: Set<String>
  let allowsActions: Bool

  @State private var threadRoot: ConversationMessage?
  @State private var editTarget: ConversationMessage?

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 20) {
          ForEach(ChatTimelineBuilder.rows(for: messages)) { row in
            transcriptRow(row)
          }
          if let browserWorkspaceID {
            AgentBrowserWorkView(
              workspaceID: browserWorkspaceID,
              conversationIDs: [conversationID],
              agents: browserAgents,
              placement: .inline
            )
          }
        }
        .animation(.easeOut(duration: 0.3), value: messages.map(\.id))
        .padding(ChiefTheme.pagePadding)
      }
      .scrollDismissesKeyboard(.interactively)
      .simultaneousGesture(TapGesture().onEnded { KeyboardDismissal.dismiss() })
      .refreshable { await reload() }
      .onChange(of: messages.map(\.id)) { _, messageIDs in
        handleMessageChanges(messageIDs, scrollProxy: proxy)
      }
    }
    .navigationDestination(
      isPresented: Binding(
        get: { threadRoot != nil },
        set: { if !$0 { threadRoot = nil } }
      )
    ) {
      if let workspaceID = model.workspace?.id, let root = threadRoot {
        ThreadView(
          workspaceID: workspaceID,
          conversationID: conversationID,
          root: root
        )
        .environment(model)
      }
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

  @ViewBuilder
  private func transcriptRow(_ row: TranscriptRow) -> some View {
    switch row.payload {
    case .daySeparator(let label):
      DaySeparator(label: label)
        .id(row.id)
    case .message(let message, let showsAuthor):
      ConversationMessageRow(
        message: message,
        showsAuthor: showsAuthor,
        allowsActions: allowsActions,
        onReply: { threadRoot = $0 },
        onEdit: { editTarget = $0 }
      )
      .id(row.id)
    }
  }

  private func reload() async {
    guard let workspaceID = model.workspace?.id else { return }
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
    } catch {
      Haptics.error()
      print("[Chief] refresh messages \(conversationID) failed: \(error)")
    }
  }

  private func handleMessageChanges(
    _ messageIDs: [String],
    scrollProxy: ScrollViewProxy
  ) {
    let currentIDs = Set(messageIDs)
    seenMessageIDs = currentIDs
    sentMessageIDs.formIntersection(currentIDs)

    if let last = messages.last {
      withAnimation(.easeOut(duration: 0.25)) {
        scrollProxy.scrollTo(last.id, anchor: .bottom)
      }
    }
  }
}
