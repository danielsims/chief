import AuthenticationServices
import SwiftUI

struct SignInView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.webAuthenticationSession) private var webAuthenticationSession
  @StateObject private var authentication = MobileAuthenticationSession()
  @State private var relayAddress = "https://heychief.sh"
  @State private var showsRelaySheet = false
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
        Button("Change relay") { showsRelaySheet = true }
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.secondary)
          .frame(maxWidth: .infinity, minHeight: 44)
          .padding(.top, 2)
          .disabled(isWorking)
          .accessibilityIdentifier("change-relay")
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
    .sheet(isPresented: $showsRelaySheet) {
      SignInRelaySheet(address: relayAddress) { address in
        relayAddress = address
        connectionError = nil
      }
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

private struct SignInRelaySheet: View {
  @Environment(\.dismiss) private var dismiss
  @State private var address: String
  @FocusState private var isFocused: Bool
  let onSave: (String) -> Void

  init(address: String, onSave: @escaping (String) -> Void) {
    _address = State(initialValue: address)
    self.onSave = onSave
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ChiefSheetHeader(title: "Change relay", doneTitle: "Cancel")
      VStack(alignment: .leading, spacing: 16) {
        TextField("https://heychief.sh", text: $address)
          .font(.system(size: 15))
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .keyboardType(.URL)
          .textContentType(.URL)
          .submitLabel(.done)
          .focused($isFocused)
          .padding(.horizontal, 14)
          .frame(height: 50)
          .background(ChiefSheetPalette.surface, in: RoundedRectangle(cornerRadius: 14))
          .overlay { RoundedRectangle(cornerRadius: 14).stroke(ChiefSheetPalette.separator) }
          .accessibilityLabel("Relay address")
          .accessibilityIdentifier("relay-address")
          .onSubmit(save)
        Button("Save", action: save)
          .font(.system(size: 16, weight: .semibold))
          .frame(maxWidth: .infinity, minHeight: 50)
          .background(Color(uiColor: .label), in: RoundedRectangle(cornerRadius: 14))
          .foregroundStyle(Color(uiColor: .systemBackground))
          .disabled(trimmedAddress.isEmpty)
          .accessibilityIdentifier("save-relay")
        Button("Use default") {
          address = "https://heychief.sh"
          save()
        }
        .font(.system(size: 13))
        .foregroundStyle(ChiefTheme.secondary)
        .frame(maxWidth: .infinity, minHeight: 44)
      }
      .padding(.horizontal, 24)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .chiefSheet([.height(300)])
    .onAppear { isFocused = true }
  }

  private var trimmedAddress: String {
    address.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func save() {
    guard !trimmedAddress.isEmpty else { return }
    onSave(trimmedAddress)
    dismiss()
  }
}
