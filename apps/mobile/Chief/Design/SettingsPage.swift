import SwiftUI

struct SettingsPage<Content: View>: View {
  @ViewBuilder let content: Content

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 28) { content }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, ChiefTheme.pagePadding)
        .padding(.top, 24)
        .padding(.bottom, 32)
    }
    .background(ChiefTheme.background)
    .toolbar(.visible, for: .navigationBar)
    .navigationBarTitleDisplayMode(.inline)
  }
}

struct SettingsSection<Content: View>: View {
  let title: String
  @ViewBuilder let content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(title)
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(ChiefTheme.secondary)
        .padding(.bottom, 8)
        .accessibilityAddTraits(.isHeader)
      content
    }
  }
}

struct SettingsRow<Content: View>: View {
  @ViewBuilder let content: Content

  var body: some View {
    HStack(spacing: 12) { content }
      .font(.system(size: 15))
      .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
      .padding(.vertical, 4)
      .contentShape(Rectangle())
      .overlay(alignment: .bottom) {
        Rectangle().fill(ChiefTheme.line.opacity(0.6)).frame(height: 0.5)
      }
  }
}

struct SettingsDestination: View {
  let title: String
  let icon: String
  var detail: String? = nil

  var body: some View {
    SettingsRow {
      Image(systemName: icon)
        .font(.system(size: 17))
        .foregroundStyle(ChiefTheme.secondary)
        .frame(width: 26)
      VStack(alignment: .leading, spacing: 4) {
        Text(title).foregroundStyle(ChiefTheme.accent)
        if let detail {
          Text(detail).font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
        }
      }
      Spacer(minLength: 8)
      Image(systemName: "chevron.right")
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(ChiefTheme.tertiary)
    }
  }
}

struct SettingsTextField: View {
  let title: String
  @Binding var text: String
  var keyboard: UIKeyboardType = .default

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title).font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
      TextField(title, text: $text)
        .font(.system(size: 16))
        .keyboardType(keyboard)
        .textInputAutocapitalization(keyboard == .URL ? .never : .words)
        .autocorrectionDisabled(keyboard == .URL)
        .accessibilityLabel(title)
    }
    .padding(.vertical, 14)
    .overlay(alignment: .bottom) {
      Rectangle().fill(ChiefTheme.line.opacity(0.6)).frame(height: 0.5)
    }
  }
}

struct SettingsToggle: View {
  let title: String
  var detail: String? = nil
  let isOn: Bool
  let action: () -> Void

  var body: some View {
    SettingsRow {
      ChiefBooleanRow(title: title, detail: detail, isOn: isOn, action: action)
    }
  }
}
