import SwiftUI

struct ConversationTranscriptView: View {
  @Environment(AppModel.self) private var model

  let conversationID: String
  let messages: [ConversationMessage]
  @Binding var seenMessageIDs: Set<String>
  @Binding var sentMessageIDs: Set<String>
  let allowsActions: Bool

  @State private var threadRoot: ConversationMessage?
  @State private var pendingThreadError = false
  @State private var threadLoadAttempt = 0
  @State private var editTarget: ConversationMessage?
  @State private var isNearLatest = true
  @State private var hasPositionedInitially = false

  private var latestAnchorID: String { "conversation-latest-\(conversationID)" }

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          ForEach(ChatTimelineBuilder.rows(for: messages)) { row in
            transcriptRow(row)
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
        ConversationScrollAnchor.isNearLatest(geometry)
      } action: { _, nearLatest in
        isNearLatest = nearLatest
      }
      .onScrollGeometryChange(for: CGFloat.self) { geometry in
        geometry.contentSize.height
      } action: { oldHeight, newHeight in
        guard hasPositionedInitially, isNearLatest, newHeight > oldHeight else { return }
        scrollToLatest(using: proxy, animated: true)
      }
      .onChange(of: ConversationScrollAnchor.followKey(for: messages)) { _, _ in
        handleMessageChanges(scrollProxy: proxy)
      }
      .task(id: conversationID) {
        hasPositionedInitially = false
        isNearLatest = true
        await positionInitially(using: proxy)
      }
      .task(id: threadRoot?.id ?? "channel") {
        guard threadRoot == nil, hasPositionedInitially else { return }
        await Task.yield()
        scrollToLatest(using: proxy, animated: false)
      }
      .onChange(of: model.selectedThread?.rootMessageID) { _, _ in
        openPendingThreadIfNeeded()
      }
      .onChange(of: messages.map(\.id)) { _, _ in
        openPendingThreadIfNeeded()
      }
      .onAppear { openPendingThreadIfNeeded() }
      .task(id: "\(model.selectedThread?.rootMessageID ?? ""):\(threadLoadAttempt)") {
        await loadPendingThreadIfNeeded()
      }
      .alert("Couldn’t open this thread", isPresented: $pendingThreadError) {
        Button("Try again") { threadLoadAttempt += 1 }
        Button("Cancel", role: .cancel) { model.clearSelectedThread() }
      } message: { Text("Check your connection and try again.") }
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

  private func openPendingThreadIfNeeded() {
    guard let pending = model.selectedThread,
      pending.conversationID == conversationID
    else { return }
    if let root = messages.first(where: { $0.id == pending.rootMessageID }) {
      threadRoot = root
      model.clearSelectedThread()
    }
  }

  private func loadPendingThreadIfNeeded() async {
    guard let pending = model.selectedThread, pending.conversationID == conversationID,
      let workspaceID = model.workspace?.id else { return }
    openPendingThreadIfNeeded()
    guard model.selectedThread == pending else { return }
    do {
      let root = try await model.relay.message(workspaceID: workspaceID, conversationID: conversationID, messageID: pending.rootMessageID)
      guard !Task.isCancelled, model.selectedThread == pending, model.workspace?.id == workspaceID else { return }
      threadRoot = root
      model.clearSelectedThread()
    } catch {
      guard !Task.isCancelled, model.selectedThread == pending else { return }
      pendingThreadError = true
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

  private func handleMessageChanges(scrollProxy: ScrollViewProxy) {
    let currentIDs = Set(messages.map(\.id))
    let shouldFollowLatest =
      isNearLatest || messages.last.map { sentMessageIDs.contains($0.id) } == true
    seenMessageIDs = currentIDs
    sentMessageIDs.formIntersection(currentIDs)

    if !hasPositionedInitially {
      guard !messages.isEmpty else { return }
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
