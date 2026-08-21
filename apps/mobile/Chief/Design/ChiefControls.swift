import SwiftUI

struct ChiefTextFieldStyle: TextFieldStyle {
  func _body(configuration: TextField<_Label>) -> some View {
    configuration
      .padding(15)
      .background(ChiefTheme.surface, in: RoundedRectangle(cornerRadius: 13))
      .overlay { RoundedRectangle(cornerRadius: 13).stroke(ChiefTheme.line) }
  }
}

struct PrimaryButtonStyle: ButtonStyle {
  @Environment(\.isEnabled) private var isEnabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 15, weight: .semibold))
      .frame(maxWidth: .infinity)
      .frame(height: 50)
      .background(
        .white.opacity(isEnabled ? (configuration.isPressed ? 0.78 : 1) : 0.28),
        in: RoundedRectangle(cornerRadius: 13)
      )
      .foregroundStyle(.black.opacity(isEnabled ? 1 : 0.54))
  }
}
