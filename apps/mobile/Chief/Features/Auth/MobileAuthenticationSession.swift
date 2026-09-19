import AuthenticationServices
import OSLog

private let mobileAuthenticationLog = Logger(
  subsystem: "sh.heychief.mobile",
  category: "authentication"
)

/// Coordinates native PKCE authentication while SwiftUI owns presentation of
/// the secure browser. Keeping browser presentation in the view avoids
/// manufacturing a UIKit window anchor that can become invalid during scene
/// transitions.
@MainActor
final class MobileAuthenticationSession: ObservableObject {
  @Published private(set) var isAuthenticating = false
  @Published private(set) var errorMessage: String?

  func start(
    client: any MobileAuthenticationServing,
    authenticate: @escaping @MainActor (URL) async throws -> URL,
    completion: @escaping (ChiefSession) -> Void
  ) {
    errorMessage = nil
    isAuthenticating = true

    Task {
      do {
        let request = try await client.makeAuthorizationRequest()
        let callbackURL = try await authenticate(
          request.authorizationURL
        )
        let signedIn = try await client.exchange(
          callbackURL: callbackURL,
          request: request
        )
        isAuthenticating = false
        completion(signedIn)
      } catch let error as ASWebAuthenticationSessionError
        where error.code == .canceledLogin
      {
        isAuthenticating = false
      } catch {
        finish(with: error)
      }
    }
  }

  func startApple(
    client: any MobileAuthenticationServing,
    identityToken: String,
    nonce: String,
    fullName: PersonNameComponents?,
    email: String?,
    completion: @escaping (ChiefSession) -> Void
  ) {
    errorMessage = nil
    isAuthenticating = true

    Task {
      do {
        let signedIn = try await client.exchangeAppleIdentityToken(
          identityToken: identityToken,
          nonce: nonce,
          fullName: fullName,
          email: email
        )
        isAuthenticating = false
        completion(signedIn)
      } catch {
        finish(with: error)
      }
    }
  }

  private func finish(with error: Error) {
    let details = error as NSError
    mobileAuthenticationLog.error(
      "Native sign-in failed [\(details.domain, privacy: .public):\(details.code)]: \(details.localizedDescription, privacy: .public)"
    )
    isAuthenticating = false
    errorMessage = Self.message(for: error)
  }

  private static func message(for error: Error) -> String {
    if let error = error as? MobileAuthenticationError {
      return error.errorDescription ?? "Chief could not start sign in."
    }
    if let error = error as? ASWebAuthenticationSessionError {
      switch error.code {
      case .presentationContextInvalid, .presentationContextNotProvided:
        return "Chief could not open sign in from this window. Please try again."
      case .canceledLogin:
        return "Sign in was cancelled."
      default:
        return "Chief could not open the secure sign-in page."
      }
    }
    if (error as? ASAuthorizationError)?.code == .canceled {
      return "Sign in was cancelled."
    }
    if error is URLError {
      return "Chief could not reach sign in. Please try again."
    }
    return "Sign in could not be completed. Please try again."
  }
}
