import SwiftUI

struct SignInView: View {
  @Environment(AppModel.self) private var model
  @StateObject private var authentication = MobileAuthenticationSession()

  var body: some View {
    ZStack {
      ChiefTheme.background.ignoresSafeArea()
      VStack(alignment: .leading, spacing: 0) {
        Spacer()
        Image("ChiefMark")
          .resizable()
          .scaledToFit()
          .frame(width: 58, height: 58)
          .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        Text("Your team of agents,\nalready at work.")
          .font(.system(size: 38, weight: .regular, design: .rounded))
          .tracking(-1.2)
          .padding(.top, 28)
        Text("Bring your agents, projects, and decisions into one workspace.")
          .font(.system(size: 16))
          .foregroundStyle(ChiefTheme.secondary)
          .lineSpacing(4)
          .padding(.top, 16)
        Spacer()
        Button(action: beginSignIn) {
          HStack(spacing: 9) {
            if authentication.isAuthenticating {
              ProgressView().tint(.black)
            }
            Text(authentication.isAuthenticating ? "Opening sign in" : "Continue")
          }
          .font(.system(size: 16, weight: .semibold))
          .frame(maxWidth: .infinity)
          .frame(height: 52)
          .background(.white, in: RoundedRectangle(cornerRadius: 14))
          .foregroundStyle(.black)
        }
        .disabled(authentication.isAuthenticating)
        .accessibilityIdentifier("sign-in-button")
      }
      .padding(.horizontal, 24)
      .padding(.vertical, 22)

      if let errorMessage = authentication.errorMessage {
        Text(errorMessage)
          .font(.system(size: 13, weight: .medium))
          .multilineTextAlignment(.center)
          .foregroundStyle(.white.opacity(0.88))
          .padding(.horizontal, 14)
          .padding(.vertical, 10)
          .background(.ultraThinMaterial, in: Capsule())
          .overlay { Capsule().stroke(ChiefTheme.line) }
          .padding(.horizontal, 24)
          .padding(.bottom, 88)
          .frame(maxHeight: .infinity, alignment: .bottom)
          .transition(.opacity)
          .accessibilityIdentifier("sign-in-error")
      }
    }
  }

  private func beginSignIn() {
    authentication.start(
      client: model.authentication,
      completion: model.completeSignIn(_:))
  }
}
