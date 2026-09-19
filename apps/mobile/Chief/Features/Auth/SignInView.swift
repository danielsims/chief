import AuthenticationServices
import SwiftUI

struct SignInView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.webAuthenticationSession) private var webAuthenticationSession
  @StateObject private var authentication = MobileAuthenticationSession()
  @State private var relayAddress = ""
  @State private var showsRelay = false
  @State private var isCheckingRelay = false
  @State private var appleNonce = ""
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
        SignInWithAppleButton(.signIn) { request in
          prepareAppleRequest(request)
        } onCompletion: { result in
          handleApple(result)
        }
        .signInWithAppleButtonStyle(.white)
        .frame(height: 52)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .disabled(isWorking)
        .overlay {
          if isWorking {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
              .fill(.white.opacity(0.82))
            ProgressView().tint(.black)
          }
        }
        .accessibilityIdentifier("sign-in-button")
        Button(action: beginGoogleSignIn) {
          HStack(spacing: 9) {
            if isWorking {
              ProgressView().tint(.white)
            }
            Text("Sign in with Google")
          }
          .font(.system(size: 16, weight: .semibold))
          .frame(maxWidth: .infinity)
          .frame(minHeight: 52)
          .background(ChiefTheme.surface, in: RoundedRectangle(cornerRadius: 14))
          .overlay { RoundedRectangle(cornerRadius: 14).stroke(ChiefTheme.line) }
          .foregroundStyle(.white)
        }
        .disabled(isWorking)
        .padding(.top, 12)
        .accessibilityIdentifier("google-sign-in-button")
        DisclosureGroup(isExpanded: $showsRelay) {
          TextField("https://relay.example.com", text: $relayAddress)
            .font(.system(size: 16))
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .keyboardType(.URL)
            .textContentType(.URL)
            .padding(.horizontal, 14)
            .frame(height: 50)
            .background(ChiefTheme.surface, in: RoundedRectangle(cornerRadius: 14))
            .overlay { RoundedRectangle(cornerRadius: 14).stroke(ChiefTheme.line) }
            .disabled(isWorking)
            .padding(.top, 12)
            .accessibilityIdentifier("relay-address")
          Button(action: beginRelaySignIn) {
            HStack(spacing: 9) {
              if isWorking {
                ProgressView().tint(.black)
              }
              Text(relayButtonTitle)
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
          .accessibilityIdentifier("relay-sign-in-button")
        } label: {
          Text("Use a different relay")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(ChiefTheme.secondary)
        }
        .tint(ChiefTheme.secondary)
        .padding(.top, 18)
        .accessibilityIdentifier("use-different-relay")
        HStack(spacing: 6) {
          Link("Privacy", destination: ChiefAccountLinks.privacy)
          Text("·")
          Link("Terms", destination: ChiefAccountLinks.terms)
        }
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(ChiefTheme.secondary)
        .frame(maxWidth: .infinity)
        .padding(.top, 18)
        .accessibilityElement(children: .contain)
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
      let cloud = AppConfiguration.chiefCloud()
      let usesCloud = RelayDirectoryStore.sameOrigin(
        model.appConfiguration.relayURL,
        cloud.relayURL
      )
      if relayAddress.isEmpty {
        relayAddress =
          usesCloud ? "https://heychief.sh" : model.appConfiguration.relayURL.absoluteString
      }
      if !usesCloud {
        showsRelay = true
      }
    }
  }

  private var isWorking: Bool {
    isCheckingRelay || authentication.isAuthenticating
  }

  private var relayButtonTitle: String {
    if isCheckingRelay { return "Checking relay" }
    if authentication.isAuthenticating { return "Opening sign in" }
    return "Continue"
  }

  private func prepareAppleRequest(_ request: ASAuthorizationAppleIDRequest) {
    connectionError = nil
    do {
      let nonce = try URLSessionOAuthAuthenticationClient.appleRequestNonce()
      appleNonce = nonce.raw
      request.requestedScopes = [.email, .fullName]
      request.nonce = nonce.raw
    } catch {
      connectionError = error.localizedDescription
      Haptics.error()
    }
  }

  private func handleApple(_ result: Result<ASAuthorization, Error>) {
    switch result {
    case .success(let authorization):
      guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
        let tokenData = credential.identityToken,
        let identityToken = String(data: tokenData, encoding: .utf8),
        !appleNonce.isEmpty
      else {
        connectionError = MobileAuthenticationError.invalidResponse.errorDescription
        Haptics.error()
        return
      }
      Task { await beginApple(identityToken: identityToken, credential: credential) }
    case .failure(let error as ASAuthorizationError) where error.code == .canceled:
      break
    case .failure(let error):
      connectionError = error.localizedDescription
      Haptics.error()
    }
  }

  private func beginApple(
    identityToken: String,
    credential: ASAuthorizationAppleIDCredential
  ) async {
    guard !isWorking else { return }
    connectionError = nil
    do {
      try await activateChiefCloud()
      guard model.phase == .signedOut else { return }
      authentication.startApple(
        client: model.authentication,
        identityToken: identityToken,
        nonce: appleNonce,
        fullName: credential.fullName,
        email: credential.email,
        completion: model.completeSignIn(_:)
      )
    } catch {
      connectionError = error.localizedDescription
      Haptics.error()
    }
  }

  private func beginGoogleSignIn() {
    let cloud = AppConfiguration.chiefCloud()
    Task {
      await beginBrowserSignIn(
        using: RelayConnectionRecord(
          relayURL: cloud.relayURL,
          accountURL: cloud.accountURL
        ),
        persistAsCustom: false
      )
    }
  }

  private func beginRelaySignIn() {
    guard !isWorking else { return }
    isCheckingRelay = true
    connectionError = nil
    Task {
      do {
        let connection = try await relayConnection(
          from: relayAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        let cloud = AppConfiguration.chiefCloud()
        let persistAsCustom = !RelayDirectoryStore.sameOrigin(connection.relayURL, cloud.relayURL)
        isCheckingRelay = false
        await beginBrowserSignIn(using: connection, persistAsCustom: persistAsCustom)
      } catch {
        connectionError = error.localizedDescription
        isCheckingRelay = false
        Haptics.error()
      }
    }
  }

  private func beginBrowserSignIn(
    using connection: RelayConnectionRecord,
    persistAsCustom: Bool
  ) async {
    guard !isWorking else { return }
    connectionError = nil
    do {
      if !RelayDirectoryStore.sameOrigin(
        connection.relayURL,
        model.appConfiguration.relayURL
      ) {
        await model.activateRelay(connection, persistAsCustom: persistAsCustom)
      }
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
      Haptics.error()
    }
  }

  private func activateChiefCloud() async throws {
    let cloud = AppConfiguration.chiefCloud()
    let connection = RelayConnectionRecord(
      relayURL: cloud.relayURL,
      accountURL: cloud.accountURL
    )
    if !RelayDirectoryStore.sameOrigin(connection.relayURL, model.appConfiguration.relayURL) {
      await model.activateRelay(connection, persistAsCustom: false)
    }
  }

  private func relayConnection(from address: String) async throws -> RelayConnectionRecord {
    let cloud = AppConfiguration.chiefCloud()
    if ChiefCloudAddress.matches(address, cloud: cloud) {
      return RelayConnectionRecord(relayURL: cloud.relayURL, accountURL: cloud.accountURL)
    }
    return try await RelayConnectionValidator.validate(address)
  }
}
