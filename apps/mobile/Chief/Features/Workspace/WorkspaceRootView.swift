import SafariServices
import SwiftUI

private enum WorkspaceChrome {
  static let tabBarClearance: CGFloat = 72
}

struct WorkspaceRootView: View {
  @Environment(AppModel.self) private var model
  @State private var agentsPath: [String] = []

  var body: some View {
    @Bindable var model = model
    let inConversation = inConversationActive
    ZStack(alignment: .bottom) {
      Group {
        switch model.selectedTab {
        case .home:
          NavigationStack(path: $model.homeNavigationPath) { HomeView(path: $model.homeNavigationPath) }
        case .plugins:
          NavigationStack { PluginsView() }
        case .projects:
          NavigationStack { ProjectsRootView() }
        case .agents:
          NavigationStack(path: $agentsPath) { AgentsView() }
        }
      }
      .safeAreaPadding(.bottom, inConversation ? 0 : WorkspaceChrome.tabBarClearance)

      if !inConversation {
        ChiefTabBar(selection: $model.selectedTab, unreadCount: totalUnread)
          .padding(.horizontal, 18)
          .padding(.bottom, 5)
      }
    }
    .background(ChiefTheme.background.ignoresSafeArea())
    .task(id: model.selectedConversationID) {
      guard let conversationID = model.selectedConversationID else { return }
      model.selectedTab = .home
      model.homeNavigationPath = [conversationID]
      model.selectedConversationID = nil
    }
  }

  /// Hide the bottom tab bar in favour of the conversation composer when a
  /// channel/DM is pushed onto the active navigation stack.
  private var inConversationActive: Bool {
    switch model.selectedTab {
    case .home: return !model.homeNavigationPath.isEmpty
    case .plugins: return false
    case .agents: return !agentsPath.isEmpty
    default: return false
    }
  }

  private var totalUnread: Int {
    model.workspace?.conversations
      .filter { model.isConversationJoined($0.id) }
      .reduce(0) { $0 + $1.unreadCount } ?? 0
  }
}

struct WorkspaceHeader: View {
  @Environment(AppModel.self) private var model
  @State private var workspaceSheet = false
  @State private var profilePage = false

  var body: some View {
    HStack(spacing: 12) {
      Button {
        Haptics.medium()
        workspaceSheet = true
      } label: {
        HStack(spacing: 9) {
          WorkspaceAvatar(workspace: model.workspace, size: 32)
          Text(model.workspace?.name ?? "Chief")
            .font(.system(size: 16, weight: .semibold))
            .lineLimit(1)
          Image(systemName: "chevron.down")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(ChiefTheme.secondary)
        }
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Switch workspace")
      .accessibilityIdentifier("workspace-switcher")

      Spacer()

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
    .navigationDestination(isPresented: $profilePage) { UserProfileView() }
  }
}

private struct WorkspaceSwitcherSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var joinSheet = false
  @State private var signingOutRelay: URL?

  var body: some View {
    NavigationStack {
      List {
        ForEach(model.workspaceRelayGroups()) { group in
          Section(group.label) {
            ForEach(group.workspaces) { summary in
              Button {
                Haptics.medium()
                if summary.id != model.workspace?.id {
                  Task {
                    if await model.switchWorkspace(workspaceID: summary.id) {
                      Haptics.success()
                      dismiss()
                    } else {
                      Haptics.error()
                    }
                  }
                } else {
                  dismiss()
                }
              } label: {
                HStack(spacing: 12) {
                  WorkspaceIdentityAvatar(
                    name: summary.name,
                    website: summary.website,
                    imageURL: summary.imageURL,
                    size: 38
                  )
                  VStack(alignment: .leading, spacing: 3) {
                    Text(summary.name).font(.system(size: 15, weight: .semibold))
                    Text(group.label)
                      .font(.system(size: 13))
                      .foregroundStyle(ChiefTheme.secondary)
                  }
                  Spacer()
                  if summary.id == model.workspace?.id {
                    Image(systemName: "checkmark").foregroundStyle(ChiefTheme.accent)
                  }
                }
              }
              .buttonStyle(.plain)
            }
            Button(role: .destructive) {
              Haptics.heavy()
              signingOutRelay = group.relayURL
            } label: {
              Label("Sign out of \(group.label)", systemImage: "rectangle.portrait.and.arrow.right")
            }
            .disabled(signingOutRelay != nil)
          }
        }
        Section {
          Button {
            Haptics.heavy()
            dismiss()
            model.showWorkspaceSetup()
          } label: {
            Label("Create workspace", systemImage: "plus")
          }
          Button {
            Haptics.heavy()
            joinSheet = true
          } label: {
            Label("Join workspace", systemImage: "link")
          }
          NavigationLink {
            RelayConnectionSettingsView()
          } label: {
            Label("Manage relays", systemImage: "network")
          }
        }
      }
      .scrollContentBackground(.hidden)
      .background(ChiefSheetPalette.background)
      .navigationTitle("Workspaces")
      .navigationBarTitleDisplayMode(.inline)
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
    .chiefSheet([.height(460), .large])
    .sheet(isPresented: $joinSheet) { JoinWorkspaceSheet() }
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
      size: size
    )
  }
}

struct PersonProfileView: View {
  @Environment(AppModel.self) private var model
  let userID: String
  let name: String

  var body: some View {
    List {
      Section {
        HStack(spacing: 14) {
          initialsAvatar
          VStack(alignment: .leading, spacing: 3) {
            Text(displayName)
              .font(.system(size: 18, weight: .semibold))
            Text("Workspace member")
              .font(.system(size: 13))
              .foregroundStyle(ChiefTheme.secondary)
            Text("Available")
              .font(.system(size: 13))
              .foregroundStyle(ChiefTheme.tertiary)
          }
        }
        .padding(.vertical, 4)
      }
    }
    .scrollContentBackground(.hidden)
    .background(ChiefTheme.background)
    .navigationTitle("Profile")
    .navigationBarTitleDisplayMode(.inline)
    .accessibilityIdentifier("person-profile-\(userID)")
  }

  private var displayName: String {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? "Member" : trimmed
  }

  private var initialsAvatar: some View {
    Circle()
      .fill(ChiefTheme.elevated)
      .frame(width: 52, height: 52)
      .overlay {
        Text(initials)
          .font(.system(size: 18, weight: .semibold))
      }
      .overlay { Circle().stroke(ChiefTheme.line) }
  }

  private var initials: String {
    let words = displayName.split(separator: " ")
    return words.prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
  }
}

struct UserAvatar: View {
  let user: ChiefUser?
  let size: CGFloat

  var body: some View {
    AsyncImage(url: user?.imageURL) { image in
      image.resizable().scaledToFill()
    } placeholder: {
      Circle().fill(ChiefTheme.elevated).overlay {
        Text(initials)
          .font(.system(size: size * 0.34, weight: .semibold))
          .foregroundStyle(.white)
      }
    }
    .frame(width: size, height: size)
    .clipShape(Circle())
    .overlay { Circle().stroke(ChiefTheme.line) }
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
      WorkspaceHeader()
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 20) {
          greeting
          if model.workspaceSyncFailed {
            RelayUnavailableBanner()
          }
          if attentionCount > 0 {
            HomeAttentionRow(count: attentionCount)
          }
          ChannelGroup()
          DMsGroup(path: $path)
        }
        .padding(.top, 16)
        .padding(.bottom, WorkspaceChrome.tabBarClearance + 12)
      }
    }
    .background(ChiefTheme.background)
    .navigationDestination(for: String.self) { id in ConversationView(conversationID: id) }
    .toolbar(.hidden, for: .navigationBar)
  }

  private var greeting: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(greetingText)
        .font(.system(size: 26, weight: .regular, design: .rounded))
        .tracking(-0.6)
      Text("Your conversations and agents.")
        .font(.system(size: 14))
        .foregroundStyle(ChiefTheme.secondary)
    }
    .padding(.horizontal, ChiefTheme.pagePadding)
  }

  private var greetingText: String {
    let hour = Calendar.current.component(.hour, from: .now)
    let prefix = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
    let name = model.session?.user.name.split(separator: " ").first.map(String.init)
    return "\(prefix), \(name ?? "there")"
  }

  private var attentionCount: Int {
    let conversations =
      model.workspace?.conversations.filter {
        $0.requiresAttention && model.isConversationJoined($0.id)
      }.count ?? 0
    let agents = model.workspace?.agents.filter { $0.status == .needsYou }.count ?? 0
    return conversations + agents
  }
}

struct PluginsView: View {
  @Environment(AppModel.self) private var model
  @State private var plugins = PluginCatalogClient.shared.cached ?? PluginOption.preferred
  @State private var search = ""
  @State private var loading = false
  @State private var installedPluginIDs: Set<String> = []
  @State private var busyPluginID: String?
  @State private var authorization = PluginAuthorizationPresenter()
  @State private var connectionError: String?

  var body: some View {
    VStack(spacing: 0) {
      WorkspaceHeader()
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 14) {
          VStack(alignment: .leading, spacing: 4) {
            Text("Plugins")
              .font(.system(size: 26, weight: .regular, design: .rounded))
              .tracking(-0.6)
            Text("Give your agents access to the tools you already use.")
              .font(.system(size: 14))
              .foregroundStyle(ChiefTheme.secondary)
          }
          .padding(.horizontal, ChiefTheme.pagePadding)

          HStack(spacing: 9) {
            Image(systemName: "magnifyingglass")
              .foregroundStyle(ChiefTheme.tertiary)
            TextField("Search plugins", text: $search)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
          }
          .padding(.horizontal, 13)
          .frame(height: 44)
          .background(ChiefTheme.surface, in: RoundedRectangle(cornerRadius: 13))
          .overlay { RoundedRectangle(cornerRadius: 13).stroke(ChiefTheme.line) }
          .padding(.horizontal, ChiefTheme.pagePadding)

          if loading && plugins.isEmpty {
            ProgressView()
              .tint(.white)
              .frame(maxWidth: .infinity)
              .padding(.top, 36)
          } else if filteredPlugins.isEmpty {
            ContentUnavailableView.search(text: search)
              .foregroundStyle(ChiefTheme.secondary)
          } else {
            LazyVStack(spacing: 0) {
              ForEach(filteredPlugins) { plugin in
                PluginCatalogRow(
                  plugin: plugin,
                  installed: installedPluginIDs.contains(plugin.id),
                  busy: busyPluginID == plugin.id,
                  onSelect: { install(plugin) }
                )
                if plugin.id != filteredPlugins.last?.id {
                  Divider().overlay(ChiefTheme.line).padding(.leading, 58)
                }
              }
            }
            .padding(.horizontal, 13)
            .background(ChiefTheme.surface, in: RoundedRectangle(cornerRadius: 15))
            .overlay { RoundedRectangle(cornerRadius: 15).stroke(ChiefTheme.line) }
            .padding(.horizontal, ChiefTheme.pagePadding)
          }
        }
        .padding(.top, 16)
        .padding(.bottom, WorkspaceChrome.tabBarClearance + 18)
      }
    }
    .background(ChiefTheme.background)
    .toolbar(.hidden, for: .navigationBar)
    .task {
      loading = true
      async let catalog = PluginCatalogClient.shared.preferredPlugins()
      async let installed = PluginCatalogClient.shared.installedPluginIDs(
        workspaceID: model.workspace?.id ?? ""
      )
      plugins = await catalog
      installedPluginIDs = await installed
      loading = false
    }
    .sheet(
      isPresented: Binding(
        get: { authorization.authorizationURL != nil },
        set: { if !$0 { authorization.cancel() } }
      )
    ) {
      if let url = authorization.authorizationURL {
        PluginBrowserView(url: url)
          .ignoresSafeArea()
      }
    }
    .alert(
      "Couldn’t connect plugin",
      isPresented: Binding(
        get: { connectionError != nil },
        set: { if !$0 { connectionError = nil } }
      )
    ) {
      Button("OK", role: .cancel) { connectionError = nil }
    } message: {
      Text(connectionError ?? "Try again.")
    }
  }

  private var filteredPlugins: [PluginOption] {
    let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else { return plugins }
    return plugins.filter {
      $0.name.localizedCaseInsensitiveContains(query)
        || $0.domain.localizedCaseInsensitiveContains(query)
    }
  }

  private func install(_ plugin: PluginOption) {
    guard let workspaceID = model.workspace?.id, busyPluginID == nil else { return }
    Haptics.medium()
    busyPluginID = plugin.id
    Task {
      do {
        try await PluginCatalogClient.shared.install(
          plugin,
          workspaceID: workspaceID,
          presenter: authorization
        )
        installedPluginIDs.insert(plugin.id)
        busyPluginID = nil
        Haptics.success()
      } catch MobilePluginRuntimeError.browserDismissed {
        busyPluginID = nil
      } catch {
        busyPluginID = nil
        connectionError = error.localizedDescription
        Haptics.error()
      }
    }
  }
}

private struct PluginCatalogRow: View {
  let plugin: PluginOption
  let installed: Bool
  let busy: Bool
  let onSelect: () -> Void

  var body: some View {
    Button(action: onSelect) {
      HStack(spacing: 12) {
        BrandLogoView(domain: plugin.domain, iconURL: plugin.iconURL, size: 40)

        VStack(alignment: .leading, spacing: 3) {
          Text(plugin.name)
            .font(.system(size: 15, weight: .medium))
            .lineLimit(1)
          Text(plugin.description)
            .font(.system(size: 12))
            .foregroundStyle(ChiefTheme.secondary)
            .lineLimit(1)
        }
        Spacer(minLength: 8)
        ZStack {
          Text(installed ? "Added" : "Add")
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(installed ? ChiefTheme.secondary : .primary)
            .opacity(busy ? 0 : 1)
          if busy {
            ProgressView()
              .controlSize(.small)
              .tint(.white)
          }
        }
        .padding(.horizontal, 12)
        .frame(minWidth: 58, minHeight: 29, maxHeight: 29)
        .background(ChiefTheme.elevated, in: Capsule())
      }
      .frame(minHeight: 62)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(busy)
    .accessibilityLabel("\(installed ? "Open" : "Add") \(plugin.name)")
  }
}

struct PluginBrowserView: UIViewControllerRepresentable {
  let url: URL

  func makeUIViewController(context: Context) -> SFSafariViewController {
    let controller = SFSafariViewController(url: url)
    controller.dismissButtonStyle = .done
    return controller
  }

  func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

struct DMsView: View {
  @Environment(AppModel.self) private var model
  @Binding var path: [String]
  @State private var quickCreateVisible = false
  @State private var newMessageVisible = false
  @State private var newChannelVisible = false
  @State private var inviteVisible = false

  var body: some View {
    ZStack(alignment: .bottomTrailing) {
      VStack(spacing: 0) {
        WorkspaceHeader()
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 14) {
            Text("DMs")
              .font(.system(size: 26, weight: .regular, design: .rounded))
              .tracking(-0.6)
              .padding(.horizontal, ChiefTheme.pagePadding)
            DMsGroup(path: $path)
          }
          .padding(.top, 16)
          .padding(.bottom, 84)
        }
      }
      if quickCreateVisible {
        Color.black.opacity(0.001)
          .ignoresSafeArea()
          .onTapGesture {
            Haptics.light()
            withAnimation(.easeOut(duration: 0.15)) { quickCreateVisible = false }
          }
        WorkspaceQuickCreateMenu(
          onInvite: {
            quickCreateVisible = false
            inviteVisible = true
          },
          onChannel: {
            quickCreateVisible = false
            newChannelVisible = true
          },
          onMessage: {
            quickCreateVisible = false
            newMessageVisible = true
          }
        )
        .padding(.trailing, ChiefTheme.pagePadding)
        .padding(.bottom, 74)
        .transition(.scale(scale: 0.94, anchor: .bottomTrailing).combined(with: .opacity))
      }
      Button {
        Haptics.heavy()
        withAnimation(.easeOut(duration: 0.16)) { quickCreateVisible.toggle() }
      } label: {
        Image(systemName: quickCreateVisible ? "xmark" : "plus")
          .font(.system(size: 19, weight: .semibold))
          .foregroundStyle(.white)
          .frame(width: 54, height: 54)
          .background(.ultraThinMaterial, in: Circle())
          .overlay { Circle().stroke(Color.white.opacity(0.12), lineWidth: 0.5) }
          .shadow(color: .black.opacity(0.24), radius: 12, y: 5)
      }
      .buttonStyle(.plain)
      .padding(.trailing, ChiefTheme.pagePadding)
      .padding(.bottom, 8)
      .accessibilityLabel(quickCreateVisible ? "Close create menu" : "Create")
    }
    .background(ChiefTheme.background)
    .navigationDestination(for: String.self) { id in ConversationView(conversationID: id) }
    .toolbar(.hidden, for: .navigationBar)
    .fullScreenCover(isPresented: $newMessageVisible) {
      NewMessageView { conversationID in path.append(conversationID) }
    }
    .sheet(isPresented: $newChannelVisible) {
      NewChannelSheet { name, isPrivate in
        Task { await model.createChannel(name: name, isPrivate: isPrivate) }
      }
    }
    .sheet(isPresented: $inviteVisible) { InvitePeopleSheet() }
  }
}

struct AgentsView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    VStack(spacing: 0) {
      WorkspaceHeader()
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 14) {
          Text("Agents")
            .font(.system(size: 26, weight: .regular, design: .rounded))
            .tracking(-0.6)
            .padding(.horizontal, ChiefTheme.pagePadding)
          AgentsGroup()
        }
        .padding(.top, 16)
        .padding(.bottom, 12)
      }
    }
    .background(ChiefTheme.background)
    .toolbar(.hidden, for: .navigationBar)
    .navigationDestination(for: String.self) { agentID in
      let card = model.workspace?.agentCard(for: agentID) ?? .chiefFallback(for: agentID)
      AgentDetailView(agent: card.agent, highlightedSubagentID: card.subagentID)
    }
  }
}

private struct HomeAttentionRow: View {
  let count: Int

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: "exclamationmark.circle")
        .font(.system(size: 16, weight: .medium))
        .foregroundStyle(ChiefTheme.accent)
        .frame(width: 34, height: 34)
        .background(ChiefTheme.accent.opacity(0.08), in: Circle())
      VStack(alignment: .leading, spacing: 3) {
        Text("\(count) \(count == 1 ? "item requires" : "items require") attention")
          .font(.system(size: 15, weight: .semibold))
        Text("Review and respond")
          .font(.system(size: 13))
          .foregroundStyle(ChiefTheme.secondary)
      }
      Spacer()
      Image(systemName: "chevron.right")
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(ChiefTheme.tertiary)
    }
    .padding(.horizontal, 13)
    .frame(height: 62)
    .padding(.horizontal, ChiefTheme.pagePadding)
    .background(
      ChiefTheme.surface,
      in: RoundedRectangle(cornerRadius: 15, style: .continuous)
    )
    .overlay { RoundedRectangle(cornerRadius: 15, style: .continuous).stroke(ChiefTheme.line) }
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

private struct ProjectsRootView: View {
  var body: some View {
    VStack(spacing: 0) {
      WorkspaceHeader()
      Text("Projects")
        .font(.system(size: 26, weight: .regular, design: .rounded))
        .tracking(-0.6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, ChiefTheme.pagePadding)
        .padding(.top, 16)
        .padding(.bottom, 14)
      ProjectsView()
    }
    .toolbar(.hidden, for: .navigationBar)
  }
}
