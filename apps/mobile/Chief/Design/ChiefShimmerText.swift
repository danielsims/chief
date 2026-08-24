import SwiftUI

/// Narrow muted-to-white sweep used for genuinely in-progress model activity.
/// Mirrors the durable-agent treatment and becomes static for Reduce Motion.
struct ChiefShimmerText: View {
  private let text: String
  private let font: Font
  private let duration: TimeInterval
  private let spread: CGFloat

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var phase: CGFloat = -1

  init(
    _ text: String,
    font: Font = .system(size: 12, weight: .medium),
    duration: TimeInterval = 2,
    spread: CGFloat = 0.45
  ) {
    self.text = text
    self.font = font
    self.duration = duration
    self.spread = spread
  }

  var body: some View {
    Text(text)
      .font(font)
      .foregroundStyle(ChiefTheme.tertiary)
      .overlay {
        if !reduceMotion {
          GeometryReader { proxy in
            let width = max(28, proxy.size.width * spread)
            LinearGradient(
              colors: [.clear, ChiefTheme.accent.opacity(0.9), .clear],
              startPoint: .leading,
              endPoint: .trailing
            )
            .frame(width: width)
            .offset(x: -width + ((phase + 1) / 2) * (proxy.size.width + width))
          }
          .mask { Text(text).font(font) }
        }
      }
      .fixedSize(horizontal: true, vertical: false)
      .onAppear {
        guard !reduceMotion else { return }
        phase = 1
      }
      .animation(
        reduceMotion ? nil : .linear(duration: duration).repeatForever(autoreverses: false),
        value: phase
      )
      .accessibilityLabel(text)
  }
}
