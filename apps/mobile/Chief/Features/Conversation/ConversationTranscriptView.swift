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
  @State private var isNearLatest = true
  @State private var hasPositionedInitially = false

  private var latestAnchorID: String { "conversation-latest-\(conversationID)" }

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
          Color.clear
            .frame(height: 1)
            .id(latestAnchorID)
        }
        .animation(
          hasPositionedInitially ? .easeOut(duration: 0.3) : nil,
          value: messages.map(\.id)
        )
        .padding(ChiefTheme.pagePadding)
      }
      .defaultScrollAnchor(.bottom)
      .scrollDismissesKeyboard(.interactively)
      .simultaneousGesture(TapGesture().onEnded { KeyboardDismissal.dismiss() })
      .refreshable { await reload() }
      .onScrollGeometryChange(for: Bool.self) { geometry in
        Self.isNearLatest(geometry)
      } action: { _, nearLatest in
        isNearLatest = nearLatest
      }
      .onChange(of: messages.map(\.id)) { _, messageIDs in
        handleMessageChanges(messageIDs, scrollProxy: proxy)
      }
      .task(id: conversationID) {
        hasPositionedInitially = false
        isNearLatest = true
        await positionInitially(using: proxy)
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
    let shouldFollowLatest =
      isNearLatest || messageIDs.last.map(sentMessageIDs.contains) == true
    seenMessageIDs = currentIDs
    sentMessageIDs.formIntersection(currentIDs)

    if !hasPositionedInitially {
      guard !messageIDs.isEmpty else { return }
      Task { await positionInitially(using: scrollProxy) }
      return
    }

    if shouldFollowLatest {
      scrollToLatest(using: scrollProxy, animated: true)
    }
  }

  private func positionInitially(using proxy: ScrollViewProxy) async {
    guard !hasPositionedInitially, !messages.isEmpty else { return }
    // Let the lazy stack commit both the messages and its day separator before
    // resolving the bottom anchor. Scrolling while the empty state is laid out
    // leaves the separator at the viewport edge on first entry.
    await Task.yield()
    await Task.yield()
    guard !hasPositionedInitially, !messages.isEmpty else { return }
    scrollToLatest(using: proxy, animated: false)
    hasPositionedInitially = true
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

  private static func isNearLatest(_ geometry: ScrollGeometry) -> Bool {
    geometry.contentSize.height <= geometry.containerSize.height
      || geometry.visibleRect.maxY >= geometry.contentSize.height - 80
  }
}

struct ScrollToLatestButton: View {
  let action: () -> Void

  var body: some View {
    Button {
      Haptics.selection()
      action()
    } label: {
      Image(systemName: "arrow.down")
        .font(.system(size: 15, weight: .semibold))
        .foregroundStyle(ChiefTheme.secondary)
        .frame(width: 40, height: 40)
        .background(ChiefTheme.surface, in: Circle())
        .overlay { Circle().stroke(ChiefTheme.line) }
        .shadow(color: .black.opacity(0.22), radius: 8, y: 4)
    }
    .buttonStyle(.plain)
    .accessibilityLabel("Scroll to latest")
  }
}
