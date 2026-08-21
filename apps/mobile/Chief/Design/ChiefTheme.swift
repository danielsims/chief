import SwiftUI

enum ChiefTheme {
  static let background = Color(red: 0.035, green: 0.035, blue: 0.038)
  static let surface = Color(red: 0.075, green: 0.075, blue: 0.082)
  static let elevated = Color(red: 0.105, green: 0.105, blue: 0.115)
  static let line = Color.white.opacity(0.10)
  static let secondary = Color.white.opacity(0.58)
  static let tertiary = Color.white.opacity(0.36)
  static let accent = Color.white
  static let channelAccent = Color(red: 0.45, green: 0.71, blue: 0.96)
  static let toggleOn = Color(uiColor: .systemGreen)

  static let pagePadding: CGFloat = 18
  static let cardRadius: CGFloat = 18

  static func agentColor(_ agentID: String) -> Color {
    switch agentID {
    case "chief": Color.white
    case "brand": Color(red: 0.48, green: 0.86, blue: 0.62)
    case "prospector": Color(red: 0.49, green: 0.78, blue: 0.98)
    case "content": Color(red: 0.99, green: 0.76, blue: 0.30)
    case "analyst": Color(red: 0.38, green: 0.86, blue: 0.91)
    case "ads": Color(red: 0.98, green: 0.55, blue: 0.66)
    case "setup": Color(red: 0.38, green: 0.85, blue: 0.64)
    case "engineer": Color(red: 0.98, green: 0.61, blue: 0.34)
    default: Color.white.opacity(0.88)
    }
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

  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
        .fill(color)
      if working {
        MatrixLoader(size: size * 0.48)
          .foregroundStyle(.black)
      } else {
        Image(systemName: "viewfinder")
          .font(.system(size: size * 0.48, weight: .semibold))
          .foregroundStyle(.black)
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
