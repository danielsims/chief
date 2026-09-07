import SwiftUI

@main
struct ChiefMobileApp: App {
  @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate
  @State private var model = AppModel.live()

  var body: some Scene {
    WindowGroup {
      AppRootView()
        .environment(model)
        .preferredColorScheme(.dark)
        .task { await model.start() }
        .onOpenURL { url in
          Task { await model.handleIncomingURL(url) }
        }
        .task {
          await model.consumeNotificationDeepLink()
        }
    }
  }
}

struct AppRootView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    Group {
      if model.isSwitchingWorkspace
        || (model.phase == .workspace && !model.isWorkspaceReadyForPresentation)
      {
        LaunchView()
      } else {
        switch model.phase {
        case .launching:
          LaunchView()
        case .signedOut:
          SignInView()
        case .workspaceSetup:
          WorkspaceSetupView()
        case .onboarding:
          OnboardingView()
        case .workspace:
          WorkspaceRootView()
        }
      }
    }
    .animation(.easeInOut(duration: 0.2), value: model.isSwitchingWorkspace)
    .animation(.easeInOut(duration: 0.2), value: model.phase)
    .tint(ChiefTheme.accent)
    .onChange(of: scenePhase) { _, phase in
      model.setAppActive(phase == .active)
      if phase == .active { Task { await model.consumeNotificationDeepLink() } }
      AgentBackgroundActivityCoordinator.shared.setApplicationActive(phase == .active)
    }
    .onReceive(
      NotificationCenter.default.publisher(for: PushAppDelegate.didRegisterToken)
    ) { notification in
      guard let token = notification.userInfo?["token"] as? Data else { return }
      Task { await model.registerPushToken(token) }
    }
    .onReceive(
      NotificationCenter.default.publisher(for: MobileNotifications.didOpenConversation)
    ) { _ in
      Task { await model.consumeNotificationDeepLink() }
    }
    .onChange(of: model.isSwitchingWorkspace) { _, switching in
      if !switching { Task { await model.consumeNotificationDeepLink() } }
    }
    .onChange(of: model.isWorkspaceReadyForPresentation) { _, ready in
      guard ready else { return }
      Task { await model.consumeNotificationDeepLink() }
    }
    .sheet(
      isPresented: Binding(
        get: {
          model.workspaceInvitePreview != nil
            || model.workspaceInviteNeedsRelayConfirmation
        },
        set: { if !$0 { model.clearWorkspaceInvite() } }
      )
    ) {
      if model.workspaceInviteNeedsRelayConfirmation {
        WorkspaceInviteRelayConfirmationSheet()
      } else {
        WorkspaceInviteConfirmationSheet()
      }
    }
  }
}

private struct LaunchView: View {
  @State private var showsStatus = false
  @State private var isPulsing = false

  var body: some View {
    ZStack(alignment: .bottom) {
      ChiefTheme.background.ignoresSafeArea()

      if showsStatus {
        HStack(spacing: 8) {
          Circle()
            .fill(Color.white.opacity(isPulsing ? 0.9 : 0.32))
            .frame(width: 5, height: 5)
            .scaleEffect(isPulsing ? 1 : 0.72)
          Text("Loading")
            .font(.system(size: 12.5, weight: .medium))
            .foregroundStyle(ChiefTheme.secondary)
        }
        .padding(.horizontal, 14)
        .frame(height: 34)
        .background(ChiefTheme.surface, in: Capsule())
        .overlay { Capsule().stroke(ChiefTheme.line.opacity(0.7), lineWidth: 0.5) }
        .padding(.bottom, 18)
        .transition(.move(edge: .bottom).combined(with: .opacity))
      }
    }
    .task {
      try? await Task.sleep(for: .milliseconds(350))
      guard !Task.isCancelled else { return }
      withAnimation(.easeOut(duration: 0.22)) { showsStatus = true }
      withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
        isPulsing = true
      }
    }
  }
}
