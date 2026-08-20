import SwiftUI

@main
struct ChiefMobileApp: App {
  @State private var model = AppModel.live()

  var body: some Scene {
    WindowGroup {
      AppRootView()
        .environment(model)
        .preferredColorScheme(.dark)
        .task { await model.start() }
    }
  }
}

struct AppRootView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    Group {
      switch model.phase {
      case .launching:
        LaunchView()
      case .signedOut:
        SignInView()
      case .onboarding:
        OnboardingView()
      case .workspace:
        WorkspaceRootView()
      }
    }
    .animation(.easeInOut(duration: 0.2), value: model.phase)
    .tint(ChiefTheme.accent)
    .onChange(of: scenePhase) { _, phase in
      model.setAppActive(phase == .active)
    }
    .onReceive(
      NotificationCenter.default.publisher(for: MobileNotifications.didOpenConversation)
    ) { notification in
      guard
        let workspaceID = notification.userInfo?["workspaceID"] as? String,
        let conversationID = notification.userInfo?["conversationID"] as? String
      else { return }
      Task {
        if workspaceID != model.workspace?.id {
          await model.switchWorkspace(workspaceID: workspaceID)
        }
        model.openConversation(conversationID)
      }
    }
  }
}

private struct LaunchView: View {
  var body: some View {
    ZStack {
      ChiefTheme.background.ignoresSafeArea()
      Image("ChiefMark")
        .resizable()
        .scaledToFit()
        .frame(width: 68, height: 68)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
  }
}
