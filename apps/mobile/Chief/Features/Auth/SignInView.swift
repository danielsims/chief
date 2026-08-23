import AuthenticationServices
import SwiftUI

struct SignInView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.webAuthenticationSession) private var webAuthenticationSession
  @StateObject private var authentication = MobileAuthenticationSession()
  @State private var relayAddress = ""
  @State private var isCheckingRelay = false
  @State private var connectionError: String?

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
        Text("Relay address")
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(ChiefTheme.secondary)
          .padding(.bottom, 8)
        TextField("https://heychief.sh", text: $relayAddress)
          .font(.system(size: 15))
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .keyboardType(.URL)
          .textContentType(.URL)
          .padding(.horizontal, 14)
          .frame(height: 50)
          .background(ChiefTheme.surface, in: RoundedRectangle(cornerRadius: 14))
          .overlay { RoundedRectangle(cornerRadius: 14).stroke(ChiefTheme.line) }
          .disabled(isWorking)
          .accessibilityIdentifier("relay-address")
        Button(action: beginSignIn) {
          HStack(spacing: 9) {
            if isWorking {
              ProgressView().tint(.black)
            }
            Text(buttonTitle)
          }
          .font(.system(size: 16, weight: .semibold))
          .frame(maxWidth: .infinity)
          .frame(height: 52)
          .background(.white, in: RoundedRectangle(cornerRadius: 14))
          .foregroundStyle(.black)
        }
        .disabled(
          isWorking || relayAddress.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        )
        .padding(.top, 12)
        .accessibilityIdentifier("sign-in-button")
        Text(
          authentication.isAuthenticating
            ? "Finish signing in from the browser window."
            : "Chief opens this relay’s secure sign-in page. Other relay sessions stay signed in."
        )
        .font(.system(size: 12))
        .foregroundStyle(ChiefTheme.secondary)
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.top, 10)
      }
      .padding(.horizontal, 24)
      .padding(.vertical, 22)

      if let errorMessage = connectionError ?? authentication.errorMessage {
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
    .onAppear {
      guard relayAddress.isEmpty else { return }
      let cloud = AppConfiguration.chiefCloud()
      relayAddress =
        RelayDirectoryStore.sameOrigin(
          model.appConfiguration.relayURL,
          cloud.relayURL
        ) ? "https://heychief.sh" : model.appConfiguration.relayURL.absoluteString
    }
  }

  private var isWorking: Bool {
    isCheckingRelay || authentication.isAuthenticating
  }

  private var buttonTitle: String {
    if isCheckingRelay { return "Checking relay" }
    if authentication.isAuthenticating { return "Opening sign in" }
    return "Continue"
  }

  private func beginSignIn() {
    guard !isWorking else { return }
    isCheckingRelay = true
    connectionError = nil
    Task {
      do {
        let cloud = AppConfiguration.chiefCloud()
        let address = relayAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedAddress = address.lowercased().trimmingCharacters(
          in: CharacterSet(charactersIn: "/")
        )
        let usesChiefCloud =
          normalizedAddress == "heychief.sh"
          || normalizedAddress == "https://heychief.sh"
          || normalizedAddress == cloud.relayURL.absoluteString.lowercased()
        let connection: RelayConnectionRecord
        if usesChiefCloud {
          connection = RelayConnectionRecord(
            relayURL: cloud.relayURL,
            accountURL: cloud.accountURL
          )
        } else {
          connection = try await RelayConnectionValidator.validate(address)
        }
        if !RelayDirectoryStore.sameOrigin(
          connection.relayURL,
          model.appConfiguration.relayURL
        ) {
          await model.activateRelay(connection, persistAsCustom: !usesChiefCloud)
        }
        isCheckingRelay = false
        guard model.phase == .signedOut else { return }
        authentication.start(
          client: model.authentication,
          authenticate: { url in
            try await webAuthenticationSession.authenticate(
              using: url,
              callback: .customScheme("chief-mobile"),
              additionalHeaderFields: [:]
            )
          },
          completion: model.completeSignIn(_:)
        )
      } catch {
        connectionError = error.localizedDescription
        isCheckingRelay = false
        Haptics.error()
      }
    }
  }
}
