import SwiftUI
import UIKit

/// Chief's palette, mirroring the desktop tokens in `packages/ui/src/globals.css`
/// (warm neutrals in light mode, cool near-black in dark mode).
enum ChiefTheme {
  /// `--background`
  static let background = Color(light: .hsl(0, 0, 100), dark: .hsl(0, 0, 5))
  /// `--card`
  static let surface = Color(light: .hsl(42, 16, 96), dark: .hsl(0, 0, 9))
  /// `--muted`
  static let elevated = Color(light: .hsl(40, 10, 90), dark: .hsl(0, 0, 13))
  /// `--border`
  static let line = Color(light: .hsl(42, 6, 85), dark: .hsl(0, 0, 15))
  /// `--muted-foreground`
  static let secondary = Color(light: .hsl(0, 0, 40), dark: .hsl(0, 0, 60))
  /// `--sidebar-muted`, dimmed: hints and timestamps.
  static let tertiary = Color(light: .hsl(0, 0, 58), dark: .hsl(0, 0, 38))
  /// `--foreground`
  static let accent = Color(light: .hsl(0, 0, 7), dark: .hsl(0, 0, 98))
  /// `--primary`: filled buttons and selected pills.
  static let primary = Color(light: .hsl(240, 6, 10), dark: .hsl(0, 0, 98))
  /// `--primary-foreground`
  static let onPrimary = Color(light: .hsl(0, 0, 98), dark: .hsl(240, 6, 10))
  static let channelAccent = Color(red: 0.45, green: 0.71, blue: 0.96)
  static let toggleOn = Color(uiColor: .systemGreen)

  static let pagePadding: CGFloat = 18
  static let cardRadius: CGFloat = 18

  static func agentColor(_ agentID: String) -> Color {
    switch agentID {
    case "chief": primary
    case "brand": Color(red: 0.48, green: 0.86, blue: 0.62)
    case "prospector": Color(red: 0.49, green: 0.78, blue: 0.98)
    case "content": Color(red: 0.99, green: 0.76, blue: 0.30)
    case "analyst": Color(red: 0.38, green: 0.86, blue: 0.91)
    case "ads": Color(red: 0.98, green: 0.55, blue: 0.66)
    case "setup": Color(red: 0.38, green: 0.85, blue: 0.64)
    case "engineer": Color(red: 0.98, green: 0.61, blue: 0.34)
    default: primary.opacity(0.88)
    }
  }

  /// The glyph colour drawn on top of `agentColor`.
  static func agentMarkColor(_ agentID: String) -> Color {
    switch agentID {
    case "brand", "prospector", "content", "analyst", "ads", "setup", "engineer": .black
    default: onPrimary
    }
  }
}

/// The user's colour scheme choice, mirroring desktop's System / Light / Dark.
enum ChiefAppearance: String, CaseIterable, Identifiable {
  case system, light, dark

  static let storageKey = "chief.appearance"

  var id: String { rawValue }

  var title: String {
    switch self {
    case .system: "System"
    case .light: "Light"
    case .dark: "Dark"
    }
  }

  var icon: String {
    switch self {
    case .system: "circle.lefthalf.filled"
    case .light: "sun.max"
    case .dark: "moon"
    }
  }

  var colorScheme: ColorScheme? {
    switch self {
    case .system: nil
    case .light: .light
    case .dark: .dark
    }
  }
}

extension Color {
  init(light: UIColor, dark: UIColor) {
    self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
  }
}

extension UIColor {
  /// CSS-style `hsl(h s% l%)`.
  static func hsl(_ hue: CGFloat, _ saturation: CGFloat, _ lightness: CGFloat) -> UIColor {
    let s = saturation / 100
    let l = lightness / 100
    let c = (1 - abs(2 * l - 1)) * s
    let h = hue / 60
    let x = c * (1 - abs(h.truncatingRemainder(dividingBy: 2) - 1))
    let (r, g, b): (CGFloat, CGFloat, CGFloat) =
      switch h {
      case ..<1: (c, x, 0)
      case ..<2: (x, c, 0)
      case ..<3: (0, c, x)
      case ..<4: (0, x, c)
      case ..<5: (x, 0, c)
      default: (c, 0, x)
      }
    let m = l - c / 2
    return UIColor(red: r + m, green: g + m, blue: b + m, alpha: 1)
  }
}

struct ChiefCard<Content: View>: View {
  @ViewBuilder let content: Content

  var body: some View {
    content
      .padding(16)
      .background(ChiefTheme.surface, in: RoundedRectangle(cornerRadius: ChiefTheme.cardRadius))
      .overlay {
        RoundedRectangle(cornerRadius: ChiefTheme.cardRadius)
          .stroke(ChiefTheme.line, lineWidth: 1)
      }
  }
}

struct AgentMark: View {
  let name: String
  var size: CGFloat = 32
  var working = false

  private var color: Color {
    let agentID = WorkspaceAgentCatalog.agent(forID: name)?.id ?? name.lowercased()
    return ChiefTheme.agentColor(agentID)
  }

  private var markColor: Color {
    let agentID = WorkspaceAgentCatalog.agent(forID: name)?.id ?? name.lowercased()
    return ChiefTheme.agentMarkColor(agentID)
  }

  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
        .fill(color)
      if working {
        MatrixLoader(size: size * 0.48)
          .foregroundStyle(markColor)
      } else {
        Image(systemName: "viewfinder")
          .font(.system(size: size * 0.48, weight: .semibold))
          .foregroundStyle(markColor)
      }
    }
    .frame(width: size, height: size)
    .accessibilityLabel(name)
  }
}

struct MatrixLoader: View {
  let size: CGFloat
  var fps: Double = 7
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    TimelineView(.animation(minimumInterval: 1 / fps)) { context in
      let elapsed = context.date.timeIntervalSinceReferenceDate
      Grid(horizontalSpacing: size * 2 / 15, verticalSpacing: size * 2 / 15) {
        ForEach(0..<3, id: \.self) { row in
          GridRow {
            ForEach(0..<3, id: \.self) { column in
              RoundedRectangle(cornerRadius: size * 0.025)
                .opacity(
                  reduceMotion
                    ? 0.45
                    : opacity(at: row * 3 + column, elapsed: elapsed)
                )
            }
          }
        }
      }
    }
    .frame(width: size, height: size)
    .accessibilityLabel("Working")
  }

  private func opacity(at index: Int, elapsed: TimeInterval) -> Double {
    let delays = [0.0, 0.7778, 0.5556, 0.7778, 0.5556, 0.3333, 0.5556, 0.3333, 0.1111]
    let duration = 9 / fps
    var progress = (elapsed / duration + delays[index]).truncatingRemainder(dividingBy: 1)
    if progress < 0 { progress += 1 }
    if progress <= 0.4 {
      return interpolate(from: 0.14, to: 0.78, progress: progress / 0.4)
    }
    return interpolate(from: 0.78, to: 0.14, progress: (progress - 0.4) / 0.6)
  }

  private func interpolate(from: Double, to: Double, progress: Double) -> Double {
    let eased = 0.5 - 0.5 * cos(.pi * progress)
    return from + ((to - from) * eased)
  }
}
