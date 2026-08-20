import SwiftUI

/// Shared bottom-sheet treatment, adapted from the on-device durable-agent
/// menu. Sheets use iOS semantic surfaces, a generous radius, and their own
/// explicit header instead of the generic grabber-heavy default.
enum ChiefSheetPalette {
  static let background = Color(uiColor: .secondarySystemBackground)
  static let surface = Color(uiColor: .tertiarySystemBackground)
  static let primary = Color(uiColor: .label)
  static let secondary = Color(uiColor: .secondaryLabel)
  static let separator = Color(uiColor: .separator).opacity(0.42)
}

struct ChiefSheetModifier: ViewModifier {
  let detents: Set<PresentationDetent>

  func body(content: Content) -> some View {
    content
      .background(ChiefSheetPalette.background.ignoresSafeArea())
      .presentationDetents(detents)
      .presentationDragIndicator(.hidden)
      .presentationCornerRadius(32)
      .presentationBackground(ChiefSheetPalette.background)
  }
}

extension View {
  func chiefSheet(_ detents: Set<PresentationDetent>) -> some View {
    modifier(ChiefSheetModifier(detents: detents))
  }
}

struct ChiefSheetHeader: View {
  @Environment(\.dismiss) private var dismiss
  let title: String
  var doneTitle = "Done"

  var body: some View {
    HStack {
      Text(title)
        .font(.system(size: 17, weight: .semibold, design: .rounded))
      Spacer()
      Button(doneTitle) { dismiss() }
        .font(.system(size: 16, weight: .semibold, design: .rounded))
    }
    .foregroundStyle(ChiefSheetPalette.primary)
    .padding(.horizontal, 24)
    .padding(.top, 20)
    .padding(.bottom, 16)
  }
}

struct ChiefSheetMenuRow: View {
  let icon: String
  let title: String
  var detail: String? = nil
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 17) {
        Image(systemName: icon)
          .font(.system(size: 21, weight: .regular))
          .frame(width: 28)
        VStack(alignment: .leading, spacing: 2) {
          Text(title)
            .font(.system(size: 18, weight: .regular, design: .rounded))
          if let detail {
            Text(detail)
              .font(.system(size: 12, design: .rounded))
              .foregroundStyle(ChiefSheetPalette.secondary)
          }
        }
        Spacer()
        Image(systemName: "chevron.right")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(ChiefSheetPalette.secondary)
      }
      .foregroundStyle(ChiefSheetPalette.primary)
      .contentShape(Rectangle())
      .padding(.horizontal, 24)
      .frame(minHeight: 58)
    }
    .buttonStyle(.plain)
  }
}

struct ChiefCheckmark: View {
  let isOn: Bool

  var body: some View {
    ZStack {
      Circle()
        .stroke(isOn ? Color.clear : ChiefTheme.secondary.opacity(0.55), lineWidth: 1)
        .background(Circle().fill(isOn ? ChiefTheme.accent : .clear))
      if isOn {
        Image(systemName: "checkmark")
          .font(.system(size: 10, weight: .bold))
          .foregroundStyle(ChiefTheme.background)
      }
    }
    .frame(width: 20, height: 20)
  }
}

struct ChiefBooleanRow: View {
  let title: String
  var detail: String? = nil
  let isOn: Bool
  let action: () -> Void

  var body: some View {
    Button {
      Haptics.medium()
      action()
    } label: {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 3) {
          Text(title)
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(ChiefTheme.accent)
          if let detail {
            Text(detail)
              .font(.system(size: 12))
              .foregroundStyle(ChiefTheme.secondary)
          }
        }
        Spacer(minLength: 12)
        ChiefCheckmark(isOn: isOn)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }
}
