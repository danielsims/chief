import SwiftUI

enum ChiefTheme {
  static let background = Color(red: 0.035, green: 0.035, blue: 0.038)
  static let surface = Color(red: 0.075, green: 0.075, blue: 0.082)
  static let elevated = Color(red: 0.105, green: 0.105, blue: 0.115)
  static let line = Color.white.opacity(0.10)
  static let secondary = Color.white.opacity(0.58)
  static let tertiary = Color.white.opacity(0.36)
  static let accent = Color.white

  static let pagePadding: CGFloat = 18
  static let cardRadius: CGFloat = 18
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

  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
        .fill(Color.white)
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

  var body: some View {
    TimelineView(.animation(minimumInterval: 1 / 15)) { context in
      let elapsed = context.date.timeIntervalSinceReferenceDate
      Grid(horizontalSpacing: size * 2 / 15, verticalSpacing: size * 2 / 15) {
        ForEach(0..<3, id: \.self) { row in
          GridRow {
            ForEach(0..<3, id: \.self) { column in
              RoundedRectangle(cornerRadius: size * 0.025)
                .opacity(opacity(at: row * 3 + column, elapsed: elapsed))
            }
          }
        }
      }
    }
    .frame(width: size, height: size)
    .accessibilityLabel("Working")
  }

  private func opacity(at index: Int, elapsed: TimeInterval) -> Double {
    let delays = [0.0, -0.78, -0.56, -0.78, -0.56, -0.33, -0.56, -0.33, -0.11]
    let progress = (elapsed / 1.28 + delays[index]).truncatingRemainder(dividingBy: 1)
    return 0.14 + (0.64 * max(0, sin(progress * .pi)))
  }
}
