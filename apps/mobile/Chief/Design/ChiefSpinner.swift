import SwiftUI

/// Chief's only loading indicator: a notched circle that spins. Drop-in for
/// an indeterminate `ProgressView`, honouring `.tint` and `.controlSize`.
struct ChiefSpinner: View {
  var label: String? = nil
  @Environment(\.controlSize) private var controlSize
  @State private var spinning = false

  var body: some View {
    HStack(spacing: 10) {
      Circle()
        .trim(from: 0, to: 0.75)
        .stroke(.tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
        .frame(width: size, height: size)
        .rotationEffect(.degrees(spinning ? 360 : 0))
        .animation(.linear(duration: 0.8).repeatForever(autoreverses: false), value: spinning)
        .onAppear { spinning = true }
      if let label { Text(label) }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label ?? "Loading")
  }

  private var size: CGFloat {
    switch controlSize {
    case .mini: 12
    case .small: 15
    case .large, .extraLarge: 26
    default: 19
    }
  }

  private var lineWidth: CGFloat { size < 16 ? 1.75 : 2.25 }
}
