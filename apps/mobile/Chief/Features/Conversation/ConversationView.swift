import SwiftUI

struct ConversationView: View {
    @Environment(AppModel.self) private var model
    let conversationID: String
    @State private var draft = ""
    @State private var loading = true
    @State private var sending = false
    @State private var loadFailed = false
    @State private var liveTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            if loading && messages.isEmpty {
                loadingState
            } else if loadFailed && messages.isEmpty {
                loadFailure
            } else if messages.isEmpty {
                emptyState
            } else {
                transcript
            }
            Divider().overlay(ChiefTheme.line)
            ComposeView(text: $draft, sending: sending, send: send)
        }
        .background(ChiefTheme.background)
        .navigationTitle(conversation?.name ?? "Conversation")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: conversationID) {
            await load()
            guard let workspaceID = model.workspace?.id else { return }
            liveTask = model.subscribeToConversation(
                workspaceID: workspaceID,
                conversationID: conversationID
            )
        }
        .onDisappear {
            liveTask?.cancel()
            liveTask = nil
            model.unsubscribeFromConversation()
        }
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    ForEach(messages) { message in
                        MessageView(message: message).id(message.id)
                    }
                }
                .padding(ChiefTheme.pagePadding)
            }
            .refreshable { await reload() }
            .onChange(of: messages.count) { _, _ in
                if let last = messages.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
    }

    private var loadingState: some View {
        VStack(spacing: 12) {
            ProgressView()
                .controlSize(.regular)
            Text("Loading conversation…")
                .font(.system(size: 14))
                .foregroundStyle(ChiefTheme.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var loadFailure: some View {
        VStack(spacing: 14) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 34, weight: .medium))
                .foregroundStyle(ChiefTheme.secondary)
            VStack(spacing: 5) {
                Text("We couldn't load this conversation")
                    .font(.system(size: 18, weight: .semibold, design: .rounded))
                    .foregroundStyle(ChiefTheme.accent)
                Text("Chief is having trouble reaching the workspace right now. Your messages are safe — try again in a moment.")
                    .font(.system(size: 14))
                    .foregroundStyle(ChiefTheme.secondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
            }
            .frame(maxWidth: 300)
            Button(action: retry) {
                Text("Try again")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
                    .background(.white, in: RoundedRectangle(cornerRadius: 13))
            }
            .buttonStyle(.plain)
            .frame(maxWidth: 240)
            .padding(.top, 6)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, ChiefTheme.pagePadding)
        .accessibilityElement(children: .combine)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Text("What should we work on?")
                .font(.system(size: 22, weight: .semibold, design: .rounded))
                .foregroundStyle(ChiefTheme.accent)
            Text("Share a task or let Chief get oriented in this workspace.")
                .font(.system(size: 14))
                .foregroundStyle(ChiefTheme.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, ChiefTheme.pagePadding)
    }

    private var conversation: ConversationSummary? {
        model.workspace?.conversations.first { $0.id == conversationID }
    }

    private var messages: [ConversationMessage] {
        guard let workspaceID = model.workspace?.id else { return [] }
        return model.conversations.messages(workspaceID: workspaceID, conversationID: conversationID)
    }

    private func load() async {
        loading = true
        loadFailed = false
        guard let workspaceID = model.workspace?.id else {
            loading = false
            return
        }
        do {
            let remote = try await model.relay.messages(
                workspaceID: workspaceID,
                conversationID: conversationID,
                after: nil
            )
            model.conversations.replace(workspaceID: workspaceID, conversationID: conversationID, messages: remote)
            loadFailed = false
            print("[Chief] loaded \(remote.count) messages for \(conversationID)")
        } catch {
            loadFailed = true
            print("[Chief] load messages \(conversationID) failed: \(error)")
        }
        loading = false
    }

    private func reload() async {
        await load()
    }

    private func retry() {
        Task { await load() }
    }

    private func send() {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, let workspaceID = model.workspace?.id else { return }
        let mentions = AgentMentionParser.mentions(in: draft)
        let threadRootID: String? = nil
        // Desktop parity (wake-on-mention only): a channel message wakes an
        // agent only when addressed; DMs and agent-rooted threads always wake.
        let wake = model.shouldWakeAgent(
            conversationID: conversationID,
            mentions: mentions,
            threadRootID: threadRootID
        )
        draft = ""
        sending = true
        Task {
            defer { sending = false }
            do {
                let message = try await model.relay.send(
                    body: body,
                    workspaceID: workspaceID,
                    conversationID: conversationID,
                    threadRootID: threadRootID,
                    mentions: mentions
                )
                model.conversations.merge(message)
                print("[Chief] sent message to \(conversationID) mentions=\(mentions) wake=\(wake)")
                if wake {
                    await model.runAgentTurn(
                        conversationID: conversationID,
                        threadRootID: threadRootID,
                        mentions: mentions
                    )
                }
            } catch {
                print("[Chief] send to \(conversationID) failed: \(error)")
            }
        }
    }
}

private struct MessageView: View {
    let message: ConversationMessage

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            avatar
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 7) {
                    Text(authorName).font(.system(size: 14, weight: .semibold))
                    Text(message.createdAt, style: .time).font(.system(size: 12)).foregroundStyle(ChiefTheme.tertiary)
                }
                MentionBody(text: message.body)
                ForEach(message.components) { component in
                    switch component.kind {
                    case "action-request":
                        ActionRequestComponent(component: component)
                    case "thinking":
                        ThinkingComponent(component: component)
                    case "tool":
                        ToolComponent(component: component)
                    default:
                        EmptyView()
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder private var avatar: some View {
        switch message.author {
        case .agent(_, let name): AgentMark(name: name, size: 34)
        case .user(_, let name):
            Circle().fill(ChiefTheme.elevated).frame(width: 34, height: 34).overlay { Text(name.prefix(1)).font(.system(size: 13, weight: .semibold)) }
        case .system: AgentMark(name: "Chief", size: 34)
        }
    }
    private var authorName: String {
        switch message.author {
        case .agent(_, let name), .user(_, let name): name.isEmpty ? "Agent" : name
        case .system: "Chief"
        }
    }
}

/// Renders a message body with `@Agent` mentions as inline rounded pills,
/// mirroring the desktop `AgentMentionText`. Runs through a flow layout so
/// mentions get real horizontal padding + rounded background without breaking
/// natural text wrapping.
private struct MentionBody: View {
    let text: String

    var body: some View {
        FlowLayout(horizontalSpacing: AgentMentionStyle.interSegment, verticalSpacing: 4) {
            ForEach(Array(AgentMentionParser.split(text).enumerated()), id: \.offset) { _, segment in
                if segment.kind == .mention, let agentID = segment.agentID,
                    let agent = WorkspaceAgentCatalog.agent(forID: agentID) {
                    Text("@\(agent.name)")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(ChiefTheme.accent)
                        .padding(.horizontal, AgentMentionStyle.pillHorizontalPadding)
                        .padding(.vertical, AgentMentionStyle.pillVerticalPadding)
                        .background(
                            ChiefTheme.accent.opacity(0.12),
                            in: RoundedRectangle(cornerRadius: 6, style: .continuous)
                        )
                } else {
                    Text(segment.value).font(.system(size: 15))
                }
            }
        }
    }
}

/// Spacing/font metrics shared by the pill renderer, matching the desktop
/// `AgentMentionText` (px-1.5, rounded-md, inline-flex).
private enum AgentMentionStyle {
    static let interSegment: CGFloat = 2
    static let pillHorizontalPadding: CGFloat = 6
    static let pillVerticalPadding: CGFloat = 1.5
}

/// A wrapping (flow) layout that lays out subviews left-to-right, breaking to a
/// new row when they overflow the available width. Used so mention pills keep
/// their padding and rounded corners while the surrounding text still wraps.
private struct FlowLayout: Layout {
    let horizontalSpacing: CGFloat
    let verticalSpacing: CGFloat

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        guard !subviews.isEmpty else { return .zero }
        var rowWidth: CGFloat = 0
        var totalHeight: CGFloat = 0
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth > 0, rowWidth + size.width > maxWidth {
                totalHeight += rowHeight + verticalSpacing
                rowWidth = 0
                rowHeight = 0
            }
            rowWidth += size.width + (rowWidth > 0 ? horizontalSpacing : 0)
            rowHeight = max(rowHeight, size.height)
        }
        totalHeight += rowHeight
        let safety = maxWidth == .infinity ? rowWidth : min(rowWidth, maxWidth)
        return CGSize(width: safety, height: totalHeight)
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + verticalSpacing
                rowHeight = 0
            }
            subview.place(
                at: CGPoint(x: x, y: y),
                anchor: .topLeading,
                proposal: .unspecified
            )
            x += size.width + horizontalSpacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// Provider reasoning rendered as a quiet secondary block, so thinking text is
/// visible but never dominates the transcript (ported lite from the durable
/// agent app).
private struct ThinkingComponent: View {
    let component: MessageComponent
    @State private var expanded = true

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "brain")
                    .font(.system(size: 11))
                    .foregroundStyle(ChiefTheme.secondary)
                Text("Thought")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(ChiefTheme.secondary)
                Spacer()
                Button {
                    withAnimation { expanded.toggle() }
                } label: {
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(ChiefTheme.tertiary)
                }
                .buttonStyle(.plain)
            }
            if expanded,
               let text = component.payload["text"] ?? component.payload["content"]
            {
                Text(text)
                    .font(.system(size: 13))
                    .foregroundStyle(ChiefTheme.secondary)
                    .lineSpacing(3)
                    .textSelection(.enabled)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/// A tool invocation rendered as a quiet disclosure row with status, using the
/// agent's own output when present (ported lite from the durable agent app).
private struct ToolComponent: View {
    let component: MessageComponent
    @State private var expanded = false

    private var name: String { component.payload["name"] ?? "tool" }
    private var status: String { component.payload["status"] ?? "running" }
    private var output: String? {
        component.payload["output"] ?? component.payload["result"]
    }
    private var error: String? { component.payload["error"] }

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 8) {
                if let output {
                    block(title: "Output", text: output, mono: true)
                }
                if let error {
                    block(title: "Error", text: error, mono: true)
                }
            }
            .padding(.top, 6)
        } label: {
            HStack(spacing: 8) {
                Text("$").font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundStyle(ChiefTheme.secondary)
                Text(name).font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(ChiefTheme.secondary)
                Spacer(minLength: 8)
                statusLabel
            }
            .contentShape(Rectangle())
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .tint(ChiefTheme.secondary)
    }

    @ViewBuilder private var statusLabel: some View {
        switch status {
        case "running", "working":
            Label("Running", systemImage: "ellipsis")
                .font(.system(size: 11))
                .foregroundStyle(ChiefTheme.secondary)
        case "failed", "error":
            Label("Error", systemImage: "xmark.circle")
                .font(.system(size: 11))
                .foregroundStyle(Color.red)
        default:
            Label("Done", systemImage: "checkmark.circle")
                .font(.system(size: 11))
                .foregroundStyle(ChiefTheme.secondary)
        }
    }

    private func block(title: String, text: String, mono: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(ChiefTheme.tertiary)
            Text(text)
                .font(.system(size: 12, design: mono ? .monospaced : .default))
                .foregroundStyle(ChiefTheme.secondary)
                .textSelection(.enabled)
                .lineLimit(6)
        }
    }
}

private struct ActionRequestComponent: View {
    let component: MessageComponent
    @State private var selected: String?

    var body: some View {
        ChiefCard {
            VStack(alignment: .leading, spacing: 12) {
                Label("Requires attention", systemImage: "exclamationmark.circle")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(ChiefTheme.accent)
                Text(component.payload["title"] ?? "Choose an option")
                    .font(.system(size: 16, weight: .semibold))
                ForEach(options, id: \.self) { option in
                    Button { selected = option } label: {
                        HStack {
                            AgentMark(name: "Chief", size: 24)
                            Text(option)
                            Spacer()
                            if selected == option { Image(systemName: "checkmark") }
                        }
                        .font(.system(size: 13, weight: .medium))
                        .padding(.horizontal, 10)
                        .frame(height: 42)
                        .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 10))
                        .overlay {
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(selected == option ? ChiefTheme.accent : ChiefTheme.line)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }.padding(.top, 4)
    }
    private var options: [String] { component.payload["options"]?.split(separator: "|").map(String.init) ?? [] }
}

private struct ComposeView: View {
    @Binding var text: String
    let sending: Bool
    let send: () -> Void
    @FocusState private var fieldFocused: Bool
    @State private var mentionQuery = ""
    @State private var showMentions = false

    var body: some View {
        VStack(spacing: 0) {
            if showMentions {
                mentionPicker
            }
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Ask anything…", text: $text, axis: .vertical)
                    .lineLimit(1...6)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 11)
                    .background(ChiefTheme.surface, in: RoundedRectangle(cornerRadius: 16))
                    .overlay { RoundedRectangle(cornerRadius: 16).stroke(ChiefTheme.line) }
                    .focused($fieldFocused)
                    .onChange(of: text) { _, newValue in
                        updateMentionState(newValue)
                    }
                Button(action: send) {
                    Group { if sending { ProgressView() } else { Image(systemName: "arrow.up") } }
                        .font(.system(size: 15, weight: .bold))
                        .frame(width: 42, height: 42)
                        .background(.white, in: Circle())
                        .foregroundStyle(.black)
                }
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(ChiefTheme.background)
        }
        .background(ChiefTheme.background)
    }

    /// Mirrors the desktop composer: typing `@` surfaces the agent roster as a
    /// mention picker; choosing one inserts `@Name` into the draft.
    private var mentionPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(candidates) { agent in
                    Button {
                        insertMention(agent)
                    } label: {
                        HStack(spacing: 7) {
                            AgentMark(name: agent.name, size: 24)
                            Text(agent.name).font(.system(size: 14, weight: .medium))
                        }
                        .padding(.horizontal, 12)
                        .frame(height: 38)
                        .background(ChiefTheme.surface, in: Capsule())
                        .overlay { Capsule().stroke(ChiefTheme.line) }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(ChiefTheme.background)
    }

    private var candidates: [MentionAgent] {
        WorkspaceAgentCatalog.matching(prefix: mentionQuery)
    }

    private func updateMentionState(_ newValue: String) {
        let text = newValue as NSString
        let length = text.length
        guard length > 0 else {
            showMentions = false
            return
        }
        // Find the last `@` token after the previous whitespace.
        var atIndex = NSNotFound
        var index = length - 1
        while index >= 0 {
            let char = String(text.character(at: index))
            if char == "@" {
                atIndex = index
                break
            }
            if char.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                break
            }
            index -= 1
        }
        guard atIndex != NSNotFound else {
            showMentions = false
            return
        }
        let query = text.substring(from: atIndex + 1)
        mentionQuery = query
        showMentions = true
    }

    private func insertMention(_ agent: MentionAgent) {
        let current = text as NSString
        let length = current.length
        var atIndex = NSNotFound
        var index = length - 1
        while index >= 0 {
            let char = String(current.character(at: index))
            if char == "@" {
                atIndex = index
                break
            }
            if char.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                break
            }
            index -= 1
        }
        let prefix = atIndex != NSNotFound ? current.substring(to: atIndex) : (current as String)
        text = prefix + "@" + agent.name + " "
        mentionQuery = ""
        showMentions = false
    }
}
