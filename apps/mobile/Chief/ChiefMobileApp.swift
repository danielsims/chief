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
