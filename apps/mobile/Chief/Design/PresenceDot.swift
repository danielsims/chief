import SwiftUI

extension View {
  /// A presence dot on an avatar's corner; nothing when `presence` is nil.
  func presenceDot(_ presence: AgentPresence?, avatarSize: CGFloat) -> some View {
    overlay(alignment: .bottomTrailing) {
      if let presence {
        let size = max(7, avatarSize * 0.3)
        Circle()
          .fill(presence.tint)
          .frame(width: size, height: size)
          .overlay(Circle().stroke(ChiefTheme.background, lineWidth: max(1.5, size * 0.25)))
          .offset(x: size * 0.2, y: size * 0.2)
          .accessibilityLabel(presence.label)
      }
    }
  }
}

extension AgentPresence {
  var tint: Color {
    switch self {
    case .working: Color(red: 0.98, green: 0.75, blue: 0.14)
    case .error: Color(red: 0.94, green: 0.27, blue: 0.27)
    case .online: Color(red: 0.06, green: 0.73, blue: 0.51)
    case .offline: Color(light: .hsl(0, 0, 64), dark: .hsl(0, 0, 45))
    }
  }

  var label: String {
    switch self {
    case .working: "Working"
    case .error: "Last run failed"
    case .online: "Online"
    case .offline: "Offline"
    }
  }
}
