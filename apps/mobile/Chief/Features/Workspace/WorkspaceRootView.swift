import SwiftUI
import UIKit

enum WorkspaceChrome {
  static let bottomClearance: CGFloat = 24
  static let headerHeight: CGFloat = 52
}

/// One navigation stack holds the whole workspace. Its root is a fixed header
/// above horizontally paged sections, so swiping only moves the page content,
/// and anything pushed (a conversation, a repository) covers the header with its
/// own back bar.
struct WorkspaceRootView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    @Bindable var model = model
    NavigationStack(path: $model.navigationPath) {
      WorkspacePages(selection: $model.selectedTab)
        .background(ChiefTheme.background.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .navigationDestination(for: String.self) { id in ConversationView(conversationID: id) }
    }
    .task(id: model.selectedConversationID) {
      guard let conversationID = model.selectedConversationID else { return }
      model.navigationPath = [conversationID]
      model.selectedConversationID = nil
    }
  }
}

/// The fixed header and the paged sections under it. The header's tab
/// highlight follows the scroll position while you drag, not only once a page
/// settles.
private struct WorkspacePages: View {
  @Environment(AppModel.self) private var model
  @Binding var selection: WorkspaceTab
  @State private var scrolledTab: WorkspaceTab?
  @State private var progress: CGFloat = 0

  var body: some View {
    VStack(spacing: 0) {
      WorkspaceHeader(selection: $selection, progress: progress)
      ScrollView(.horizontal) {
        HStack(spacing: 0) {
          ForEach(WorkspaceTab.allCases, id: \.self) { tab in
            page(tab)
              .containerRelativeFrame(.horizontal)
              .id(tab)
          }
        }
        .scrollTargetLayout()
      }
      .scrollTargetBehavior(.paging)
      .scrollIndicators(.hidden)
      .scrollPosition(id: $scrolledTab)
      .onScrollGeometryChange(for: CGFloat.self) { geometry in
        geometry.contentOffset.x / max(geometry.containerSize.width, 1)
      } action: { _, offset in
        progress = offset
      }
    }
    .onAppear { scrolledTab = selection }
    .onChange(of: scrolledTab) { _, tab in
      if let tab, tab != selection { selection = tab }
    }
    .onChange(of: selection) { _, tab in
      guard tab != scrolledTab else { return }
      withAnimation(.snappy(duration: 0.3)) { scrolledTab = tab }
    }
  }

  @ViewBuilder
  private func page(_ tab: WorkspaceTab) -> some View {
    @Bindable var model = model
    switch tab {
    case .home: HomeView(path: $model.navigationPath)
    case .inbox: InboxView()
    case .agents: AgentsView()
    case .automations: AutomationsView()
    case .boards: BoardsView()
    case .repositories: RepositoriesView()
    case .artifacts: ArtifactsView()
    case .plugins: PluginsView()
    }
  }
}

struct WorkspaceHeader: View {
  @Environment(AppModel.self) private var model
  @State private var workspaceSheet = false
  @State private var profilePage = false
  @Binding var selection: WorkspaceTab
  /// The pager's scroll position in pages, so labels track a drag.
  var progress: CGFloat

  private var totalUnread: Int {
    model.workspace?.conversations
      .filter { model.isConversationJoined($0.id) }
      .reduce(0) { $0 + $1.unreadCount } ?? 0
  }

  var body: some View {
    HStack(spacing: 14) {
      Button {
        Haptics.medium()
        workspaceSheet = true
      } label: {
        WorkspaceAvatar(workspace: model.workspace, size: 32)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Switch workspace")
      .accessibilityIdentifier("workspace-switcher")

      ChiefTabBar(selection: $selection, progress: progress, unreadCount: totalUnread)
        .frame(maxWidth: .infinity)

      Button {
        Haptics.medium()
        profilePage = true
      } label: {
        UserAvatar(user: model.session?.user, size: 32)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Open profile")
    }
    .padding(.horizontal, ChiefTheme.pagePadding)
    .frame(maxWidth: .infinity, minHeight: 52, maxHeight: 52)
    .background(ChiefTheme.background)
    .sheet(isPresented: $workspaceSheet) { WorkspaceSwitcherSheet() }
    .sheet(isPresented: $profilePage) { NavigationStack { SettingsView() } }
  }
}

private struct WorkspaceSwitcherSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var joinSheet = false
  @State private var signingOutRelay: URL?

  var body: some View {
    NavigationStack {
      SettingsPage {
        ForEach(model.workspaceRelayGroups()) { group in
          SettingsSection(title: group.label) {
            ForEach(group.workspaces) { summary in
              Button {
                select(summary.id)
              } label: {
                SettingsRow {
                  WorkspaceIdentityAvatar(
                    name: summary.name,
                    website: summary.website,
                    imageURL: summary.imageURL,
                    size: 26
                  )
                  Text(summary.name).foregroundStyle(ChiefTheme.accent).lineLimit(1)
                  Spacer(minLength: 8)
                  if summary.id == model.workspace?.id {
                    Image(systemName: "checkmark")
                      .font(.system(size: 13, weight: .semibold))
                      .foregroundStyle(ChiefTheme.accent)
                  }
                }
              }
              .buttonStyle(.plain)
            }
            SettingsActionRow(
              title: "Sign out", icon: "rectangle.portrait.and.arrow.right", role: .destructive,
              isWorking: signingOutRelay == group.relayURL
            ) {
              signingOutRelay = group.relayURL
            }
            .disabled(signingOutRelay != nil)
          }
        }
        SettingsSection(title: "More") {
          SettingsActionRow(title: "Create workspace", icon: "plus") {
            dismiss()
            model.showWorkspaceSetup()
          }
          SettingsActionRow(title: "Join workspace", icon: "link") { joinSheet = true }
          NavigationLink {
            ConnectionSettingsView()
          } label: {
            SettingsDestination(title: "Manage relays", icon: "network")
          }
          .buttonStyle(.plain)
        }
      }
      .navigationTitle("Workspaces")
      .task { await model.refreshWorkspaces() }
      .alert(
        "Sign out of this relay?",
        isPresented: Binding(
          get: { signingOutRelay != nil },
          set: { if !$0 { signingOutRelay = nil } }
        )
      ) {
        Button("Cancel", role: .cancel) { signingOutRelay = nil }
        Button("Sign out", role: .destructive) {
          guard let relayURL = signingOutRelay else { return }
          Task {
            await model.signOut(of: relayURL)
            Haptics.success()
            if model.phase != .workspace { dismiss() }
            signingOutRelay = nil
          }
        }
      } message: {
        Text("Workspaces on this relay will leave this iPhone. Other relays stay signed in.")
      }
    }
    .sheet(isPresented: $joinSheet) { JoinWorkspaceSheet() }
  }

  private func select(_ id: String) {
    Haptics.medium()
    guard id != model.workspace?.id else { return dismiss() }
    Task {
      if await model.switchWorkspace(workspaceID: id) {
        Haptics.success()
        dismiss()
      } else {
        Haptics.error()
      }
    }
  }
}

private struct WorkspaceAvatar: View {
  let workspace: WorkspaceSnapshot?
  let size: CGFloat

  var body: some View {
    WorkspaceIdentityAvatar(
      name: workspace?.name ?? "Chief",
      website: workspace?.website,
      imageURL: workspace?.imageURL,
      size: size,
      plain: true
    )
  }
}

/// The header for pushed screens (channels, DMs, repository detail). It sits at the
/// same height and border as the main page header so navigation doesn't shift.
struct PageDetailBar<Trailing: View>: View {
  @Environment(\.dismiss) private var dismiss
  let title: String
  /// Shown before the title, such as a DM's avatar.
  let titleLeading: AnyView?
  let trailing: Trailing

  init(title: String, titleLeading: AnyView? = nil, @ViewBuilder trailing: () -> Trailing) {
    self.title = title
    self.titleLeading = titleLeading
    self.trailing = trailing()
  }

  var body: some View {
    ZStack {
      HStack(spacing: 8) {
        if let titleLeading { titleLeading }
        Text(title)
          .font(.system(size: 16, weight: .semibold))
          .lineLimit(1)
      }
      .padding(.horizontal, 56)
      HStack {
        Button {
          Haptics.light()
          dismiss()
        } label: {
          PageBarIcon(systemName: "chevron.left")
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Back")
        Spacer()
        trailing
      }
    }
    .padding(.horizontal, ChiefTheme.pagePadding)
    .frame(maxWidth: .infinity, minHeight: WorkspaceChrome.headerHeight, maxHeight: WorkspaceChrome.headerHeight)
    .background(ChiefTheme.background)
    .overlay(alignment: .bottom) {
      Rectangle().fill(ChiefTheme.line).frame(height: 0.5)
    }
  }
}

extension PageDetailBar where Trailing == EmptyView {
  init(title: String) {
    self.init(title: title) { EmptyView() }
  }
}

struct PageBarIcon: View {
  let systemName: String

  var body: some View {
    Image(systemName: systemName)
      .font(.system(size: 14, weight: .semibold))
      .foregroundStyle(.primary)
      .frame(width: 34, height: 34)
      .background(ChiefTheme.elevated, in: Circle())
      .overlay { Circle().stroke(ChiefTheme.line) }
      .contentShape(Circle())
  }
}

/// Keeps the system edge-swipe back gesture live while the navigation bar is hidden.
struct InteractivePopEnabler: UIViewControllerRepresentable {
  func makeUIViewController(context: Context) -> Controller { Controller() }
  func updateUIViewController(_ controller: Controller, context: Context) {}

  final class Controller: UIViewController {
    override func viewDidAppear(_ animated: Bool) {
      super.viewDidAppear(animated)
      navigationController?.interactivePopGestureRecognizer?.isEnabled = true
      navigationController?.interactivePopGestureRecognizer?.delegate = nil
    }
  }
}

struct UserAvatar: View {
  let user: ChiefUser?
  let size: CGFloat
  /// Matches `AgentMark`'s rounded square instead of a circle.
  var rounded = false

  private var shape: RoundedRectangle {
    RoundedRectangle(cornerRadius: rounded ? size * 0.28 : size / 2, style: .continuous)
  }

  var body: some View {
    AsyncImage(url: user?.imageURL) { image in
      image.resizable().scaledToFill()
    } placeholder: {
      shape.fill(ChiefTheme.elevated).overlay {
        Text(initials)
          .font(.system(size: size * 0.34, weight: .semibold))
          .foregroundStyle(ChiefTheme.accent)
      }
    }
    .frame(width: size, height: size)
    .clipShape(shape)
    .overlay { shape.stroke(ChiefTheme.line) }
  }

  private var initials: String {
    let words = (user?.name ?? "User").split(separator: " ")
    return words.prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
  }
}

struct HomeView: View {
  @Environment(AppModel.self) private var model
  @Binding var path: [String]

  var body: some View {
    VStack(spacing: 0) {
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 20) {
          greeting
          if model.workspaceSyncFailed {
            RelayUnavailableBanner()
          }
          ChannelGroup()
          DMsGroup(path: $path)
        }
        .padding(.top, 16)
        .padding(.bottom, WorkspaceChrome.bottomClearance)
      }
    }
    .background(ChiefTheme.background)
  }

  private var greeting: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(greetingText)
        .font(.system(size: 26, weight: .regular, design: .rounded))
        .tracking(-0.6)
    }
    .padding(.horizontal, ChiefTheme.pagePadding)
  }

  private var greetingText: String {
    let hour = Calendar.current.component(.hour, from: .now)
    let prefix = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
    let name = model.session?.user.name.split(separator: " ").first.map(String.init)
    return "\(prefix), \(name ?? "there")"
  }


}

/// The search field at the top of the Plugins and Repositories pages.
struct ChiefSearchField: View {
  let prompt: String
  @Binding var text: String

  var body: some View {
    HStack(spacing: 9) {
      Image(systemName: "magnifyingglass")
        .foregroundStyle(ChiefTheme.tertiary)
      TextField(prompt, text: $text)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
    }
    .padding(.horizontal, 13)
    .frame(height: 44)
    .background(ChiefTheme.surface, in: RoundedRectangle(cornerRadius: 13))
    .overlay { RoundedRectangle(cornerRadius: 13).stroke(ChiefTheme.line) }
    .padding(.horizontal, ChiefTheme.pagePadding)
  }
}

private struct RelayUnavailableBanner: View {
  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: "wifi.slash")
        .font(.system(size: 15, weight: .medium))
        .foregroundStyle(ChiefTheme.secondary)
        .frame(width: 34, height: 34)
        .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
      VStack(alignment: .leading, spacing: 3) {
        Text("Relay connection interrupted")
          .font(.system(size: 15, weight: .semibold))
        Text(
          "Chief is showing the last workspace saved on this iPhone. Messages and agent work will resume after the relay reconnects."
        )
        .font(.system(size: 13))
        .foregroundStyle(ChiefTheme.secondary)
        .lineSpacing(1)
        .fixedSize(horizontal: false, vertical: true)
      }
      Spacer(minLength: 0)
    }
    .padding(13)
    .padding(.horizontal, ChiefTheme.pagePadding)
    .background(
      ChiefTheme.surface,
      in: RoundedRectangle(cornerRadius: 15, style: .continuous)
    )
    .overlay { RoundedRectangle(cornerRadius: 15, style: .continuous).stroke(ChiefTheme.line) }
    .padding(.horizontal, ChiefTheme.pagePadding)
  }
}

