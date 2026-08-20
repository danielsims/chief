import UIKit

/// Tactile feedback helpers. The chat surface uses these liberally (message
/// long-press, reactions, replies) for a physical, app-like feel.
@MainActor
enum Haptics {
  /// A strong, immediate impact.
  static func heavy() {
    UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
  }

  static func medium() {
    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
  }

  static func success() {
    UINotificationFeedbackGenerator().notificationOccurred(.success)
  }

  static func error() {
    UINotificationFeedbackGenerator().notificationOccurred(.error)
  }
}
