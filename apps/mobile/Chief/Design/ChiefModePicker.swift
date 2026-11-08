import SwiftUI

/// A compact icon switch that sits beside a page title, such as List and
/// Calendar on Automations.
struct ChiefModePicker<Value: Hashable>: View {
  struct Option {
    let value: Value
    let symbol: String
    let label: String
  }

  @Binding var selection: Value
  let options: [Option]

  var body: some View {
    HStack(spacing: 2) {
      ForEach(options, id: \.value) { option($0) }
    }
    .padding(2)
    .background(ChiefTheme.elevated, in: Capsule())
    .padding(.top, 2)
  }

  private func option(_ option: Option) -> some View {
    let selected = selection == option.value
    return Button {
      guard !selected else { return }
      Haptics.selection()
      withAnimation(.snappy(duration: 0.2)) { selection = option.value }
    } label: {
      Image(systemName: option.symbol)
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(selected ? ChiefTheme.accent : ChiefTheme.secondary)
        .frame(width: 38, height: 30)
        .background {
          if selected {
            Capsule().fill(ChiefTheme.background).shadow(color: .black.opacity(0.08), radius: 1, y: 1)
          }
        }
        .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(option.label)
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}
