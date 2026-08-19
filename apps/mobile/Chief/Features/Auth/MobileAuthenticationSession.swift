import AuthenticationServices
import UIKit

@MainActor
final class MobileAuthenticationSession: NSObject, ObservableObject {
  @Published private(set) var isAuthenticating = false
  @Published private(set) var errorMessage: String?

  private var session: ASWebAuthenticationSession?

  func start(
    client: any DeviceAuthorizationServing,
    completion: @escaping (ChiefSession) -> Void
  ) {
    errorMessage = nil
    isAuthenticating = true

    Task {
      do {
        let challenge = try await client.requestAuthorization()
        openBrowser(
          url: challenge.browserURL(returningTo: URL(string: "chief-mobile://auth")!),
          challenge: challenge,
          client: client,
          completion: completion)
      } catch {
        finish(with: error)
      }
    }
  }

  private func openBrowser(
    url: URL,
    challenge: DeviceAuthorizationChallenge,
    client: any DeviceAuthorizationServing,
    completion: @escaping (ChiefSession) -> Void
  ) {

    let session = ASWebAuthenticationSession(
      url: url,
      callback: .customScheme("chief-mobile")
    ) { [weak self] callbackURL, error in
      Task { @MainActor in
        self?.session = nil

        if let callbackURL {
          guard callbackURL.scheme == "chief-mobile",
            callbackURL.host == "auth",
            URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?
              .queryItems?.contains(where: {
                $0.name == "status" && $0.value == "approved"
              }) == true
          else {
            self?.isAuthenticating = false
            self?.errorMessage = "Chief could not verify the sign-in response."
            return
          }
          Task {
            do {
              let signedIn = try await client.exchange(challenge)
              await MainActor.run {
                self?.isAuthenticating = false
                completion(signedIn)
              }
            } catch {
              await MainActor.run { self?.finish(with: error) }
            }
          }
        } else if let error = error as? ASWebAuthenticationSessionError {
          if error.code == .canceledLogin {
            self?.isAuthenticating = false
          } else {
            self?.finish(with: error)
          }
        }
      }
    }
    session.presentationContextProvider = self
    session.prefersEphemeralWebBrowserSession = false
    self.session = session

    if !session.start() {
      isAuthenticating = false
      self.session = nil
      errorMessage = "Sign in could not be opened."
    }
  }

  private func finish(with error: Error) {
    isAuthenticating = false
    session = nil
    errorMessage =
      (error as? LocalizedError)?.errorDescription
      ?? "Sign in could not be completed."
  }
}

extension MobileAuthenticationSession: ASWebAuthenticationPresentationContextProviding {
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
  }
}
