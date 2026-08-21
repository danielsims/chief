import UIKit

/// Tactile feedback helpers. The chat surface uses these liberally (message
/// long-press, reactions, replies) for a physical, app-like feel.
@MainActor
enum Haptics {
  private static let selectionGenerator = UISelectionFeedbackGenerator()
  private static let lightGenerator = UIImpactFeedbackGenerator(style: .light)
  private static let mediumGenerator = UIImpactFeedbackGenerator(style: .medium)
  private static let heavyGenerator = UIImpactFeedbackGenerator(style: .heavy)

  /// A crisp tick for changing tabs, pickers, and lightweight selections.
  static func selection() {
    selectionGenerator.selectionChanged()
    selectionGenerator.prepare()
  }

  /// A small acknowledgement for disclosure controls and secondary actions.
  static func light() {
    lightGenerator.impactOccurred(intensity: 0.82)
    lightGenerator.prepare()
  }

  /// A strong, immediate impact.
  static func heavy() {
    heavyGenerator.impactOccurred(intensity: 1)
    heavyGenerator.prepare()
  }

  static func medium() {
    mediumGenerator.impactOccurred(intensity: 0.92)
    mediumGenerator.prepare()
  }

  static func success() {
    UINotificationFeedbackGenerator().notificationOccurred(.success)
  }

  static func error() {
    UINotificationFeedbackGenerator().notificationOccurred(.error)
  }
}
