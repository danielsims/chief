import SwiftUI

struct WorkspaceRootView: View {
  @Environment(AppModel.self) private var model
  @State private var homePath: [String] = []
  @State private var dmsPath: [String] = []

  var body: some View {
    @Bindable var model = model
    let inConversation = inConversationActive
    ZStack(alignment: .bottom) {
      Group {
        switch model.selectedTab {
        case .home:
          NavigationStack(path: $homePath) { HomeView(path: $homePath) }
        case .dms:
          NavigationStack(path: $dmsPath) { DMsView(path: $dmsPath) }
        case .projects:
          NavigationStack { ProjectsRootView() }
        case .agents:
          NavigationStack { AgentsView() }
        }
      }
      .safeAreaPadding(.bottom, inConversation ? 0 : 84)

      if !inConversation {
        ChiefTabBar(selection: $model.selectedTab, unreadCount: totalUnread)
      }
    }
    .background(ChiefTheme.background.ignoresSafeArea())
  }

  /// Hide the bottom tab bar in favour of the conversation composer when a
  /// channel/DM is pushed onto the active navigation stack.
  private var inConversationActive: Bool {
    switch model.selectedTab {
    case .home: return !homePath.isEmpty
    case .dms: return !dmsPath.isEmpty
    default: return false
    }
  }

  private var totalUnread: Int {
    model.workspace?.conversations.reduce(0) { $0 + $1.unreadCount } ?? 0
  }
}

struct WorkspaceHeader: View {
  @Environment(AppModel.self) private var model
  @State private var workspaceSheet = false
  @State private var profileSheet = false

  var body: some View {
    HStack(spacing: 12) {
      Button {
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
        profileSheet = true
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
    .sheet(isPresented: $profileSheet) { ProfileSheet() }
  }
}

private struct ChiefTabBar: View {
  @Binding var selection: WorkspaceTab
  let unreadCount: Int

  var body: some View {
    HStack(spacing: 4) {
      tab(.home, "Home", "house.fill", badge: unreadCount)
      tab(.dms, "DMs", "bubble.left.and.bubble.right")
      tab(.projects, "Projects", "shippingbox")
      tab(.agents, "Agents", "brain")
    }
    .padding(5)
    .frame(maxWidth: .infinity, minHeight: 60)
    .padding(.horizontal, 14)
    .chiefLiquidGlass(in: Capsule())
    .shadow(color: .black.opacity(0.28), radius: 18, y: 8)
    .padding(.bottom, 6)
  }

  private func tab(_ tab: WorkspaceTab, _ label: String, _ icon: String, badge: Int = 0)
    -> some View
  {
    Button {
      withAnimation(.easeOut(duration: 0.16)) { selection = tab }
    } label: {
      VStack(spacing: 3) {
        ZStack(alignment: .topTrailing) {
          Image(systemName: icon)
            .font(.system(size: 16, weight: selection == tab ? .semibold : .regular))
          if badge > 0 && tab == .home {
            Circle()
              .fill(Color.white)
              .frame(width: 6, height: 6)
              .offset(x: 5, y: -2)
          }
        }
        Text(label).font(.system(size: 10.5, weight: selection == tab ? .semibold : .medium))
      }
      .foregroundStyle(selection == tab ? Color.white : ChiefTheme.secondary)
      .frame(maxWidth: .infinity, minHeight: 46)
      .background(selection == tab ? Color.white.opacity(0.10) : .clear, in: Capsule())
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
  }
}

private struct WorkspaceSwitcherSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      List {
        Section {
          Button {
            dismiss()
          } label: {
            HStack(spacing: 12) {
              WorkspaceAvatar(workspace: model.workspace, size: 38)
              VStack(alignment: .leading, spacing: 3) {
                Text(model.workspace?.name ?? "Chief").font(.system(size: 15, weight: .semibold))
                Text("Connected").font(.system(size: 13)).foregroundStyle(ChiefTheme.secondary)
              }
              Spacer()
              Image(systemName: "checkmark").foregroundStyle(ChiefTheme.accent)
            }
          }
          .buttonStyle(.plain)
        }
        Section {
          Button {
            dismiss()
            model.beginWorkspaceSetup()
          } label: {
            Label("Add workspace", systemImage: "plus")
          }
        }
      }
      .scrollContentBackground(.hidden)
      .background(ChiefTheme.background)
      .navigationTitle("Workspaces")
      .navigationBarTitleDisplayMode(.inline)
    }
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
  }
}

private struct WorkspaceAvatar: View {
  let workspace: WorkspaceSnapshot?
  let size: CGFloat

  var body: some View {
    Group {
      if let imageURL = workspace?.imageURL {
        AsyncImage(url: imageURL) { image in
          image.resizable().scaledToFill()
        } placeholder: {
          fallback
        }
      } else {
        fallback
      }
    }
    .frame(width: size, height: size)
    .clipShape(Circle())
    .overlay { Circle().stroke(Color.white.opacity(0.12)) }
    .accessibilityLabel(workspace?.name ?? "Workspace")
  }

  private var fallback: some View {
    Image("ChiefMark")
      .resizable()
      .scaledToFill()
  }
}

extension View {
  @ViewBuilder
  fileprivate func chiefLiquidGlass<S: Shape>(in shape: S) -> some View {
    if #available(iOS 26.0, *) {
      glassEffect(.regular.interactive(), in: shape)
    } else {
      background(.ultraThinMaterial, in: shape)
        .overlay { shape.stroke(Color.white.opacity(0.10)) }
    }
  }
}

private struct ProfileSheet: View {
  @Environment(AppModel.self) private var model
  var body: some View {
    NavigationStack {
      List {
        Section {
          HStack(spacing: 14) {
            UserAvatar(user: model.session?.user, size: 46)
            VStack(alignment: .leading, spacing: 3) {
              Text(model.session?.user.name ?? "Account").font(.system(size: 16, weight: .semibold))
              Text("Available").font(.system(size: 13)).foregroundStyle(ChiefTheme.secondary)
            }
          }
        }
        Section {
          Label("Connections", systemImage: "link")
          Label("Notifications", systemImage: "bell")
        }
        Section {
          Button("Sign out", role: .destructive, action: model.signOut)
        }
      }
      .scrollContentBackground(.hidden)
      .background(ChiefTheme.background)
      .navigationTitle("Profile")
      .navigationBarTitleDisplayMode(.inline)
    }
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
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
            LocalOnlyBanner()
          }
          if attentionCount > 0 {
            HomeAttentionRow(count: attentionCount)
          }
          ChannelGroup()
        }
        .padding(.top, 16)
        .padding(.bottom, 12)
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
    let conversations = model.workspace?.conversations.filter(\.requiresAttention).count ?? 0
    let agents = model.workspace?.agents.filter { $0.status == .needsYou }.count ?? 0
    return conversations + agents
  }
}

struct DMsView: View {
  @Environment(AppModel.self) private var model
  @Binding var path: [String]

  var body: some View {
    VStack(spacing: 0) {
      WorkspaceHeader()
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 14) {
          Text("Direct messages")
            .font(.system(size: 26, weight: .regular, design: .rounded))
            .tracking(-0.6)
            .padding(.horizontal, ChiefTheme.pagePadding)
          DMsGroup()
        }
        .padding(.top, 16)
        .padding(.bottom, 12)
      }
    }
    .background(ChiefTheme.background)
    .navigationDestination(for: String.self) { id in ConversationView(conversationID: id) }
    .toolbar(.hidden, for: .navigationBar)
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

/// Shown when onboarding finished locally but the relay could not be reached,
/// so the user knows setup did not start instead of it failing silently.
private struct LocalOnlyBanner: View {
  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: "wifi.slash")
        .font(.system(size: 15, weight: .medium))
        .foregroundStyle(ChiefTheme.secondary)
        .frame(width: 34, height: 34)
        .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
      VStack(alignment: .leading, spacing: 3) {
        Text("Workspace is local-only right now")
          .font(.system(size: 15, weight: .semibold))
        Text(
          "The Chief relay wasn't reachable, so workspace setup and hosted agents haven't started. Conversations you have here stay on this device for now."
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
      ProjectsView()
    }
    .toolbar(.hidden, for: .navigationBar)
  }
}
