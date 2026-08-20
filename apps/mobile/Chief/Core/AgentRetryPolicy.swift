import Foundation

/// Matches the desktop agent runtime's bounded progressive retry schedule.
/// Jobs release their relay lease before waiting so retries survive suspension,
/// termination, and device restarts without holding an iOS process open.
enum AgentRetryPolicy {
  static let delays: [TimeInterval] = [1, 2, 4, 8]

  static func retryDate(
    attempt: Int,
    error: Error,
    now: Date = .now,
    jitter: TimeInterval = Double.random(in: 0...0.5)
  ) -> Date? {
    if let setupError = error as? WorkspaceSetupError {
      switch setupError {
      case .missingCredential, .providerUsageLimit, .unsupportedInference:
        return nil
      case .inferenceFailed, .missingJob, .missingRequiredToolCalls:
        break
      }
    }
    guard attempt > 0, attempt <= delays.count else { return nil }
    let boundedJitter = min(max(jitter, 0), 0.5)
    return now.addingTimeInterval(delays[attempt - 1] + boundedJitter)
  }
}
