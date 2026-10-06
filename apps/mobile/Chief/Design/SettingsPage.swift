import SwiftUI

/// A scrolling settings page. `intro` is the page's one purposeful line,
/// shown under the inline navigation title the way desktop cards describe
/// themselves.
struct SettingsPage<Content: View>: View {
  var intro: String? = nil
  @ViewBuilder let content: Content

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 28) {
        if let intro {
          Text(intro)
            .font(.system(size: 14))
            .foregroundStyle(ChiefTheme.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.bottom, -8)
        }
        content
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, ChiefTheme.pagePadding)
      .padding(.top, 20)
      // Clears the floating tab bar, which overlays pushed settings pages.
      .padding(.bottom, 104)
    }
    .scrollDismissesKeyboard(.interactively)
    .background(ChiefTheme.background)
    .toolbar(.visible, for: .navigationBar)
    .navigationBarTitleDisplayMode(.inline)
  }
}

struct SettingsSection<Content: View>: View {
  let title: String
  var footer: String? = nil
  @ViewBuilder let content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(title)
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(ChiefTheme.secondary)
        .padding(.bottom, 8)
        .accessibilityAddTraits(.isHeader)
      content
      if let footer {
        Text(footer)
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.tertiary)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, 10)
      }
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
      .overlay(alignment: .bottom) { SettingsHairline() }
  }
}

struct SettingsHairline: View {
  var body: some View {
    Rectangle().fill(ChiefTheme.line.opacity(0.6)).frame(height: 0.5)
  }
}

struct SettingsDestination: View {
  let title: String
  let icon: String
  var detail: String? = nil

  var body: some View {
    SettingsRow {
      SettingsIcon(systemName: icon)
      VStack(alignment: .leading, spacing: 4) {
        Text(title).foregroundStyle(ChiefTheme.accent)
        if let detail {
          Text(detail).font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
            .lineLimit(1)
        }
      }
      Spacer(minLength: 8)
      SettingsChevron()
    }
  }
}

struct SettingsIcon: View {
  let systemName: String

  var body: some View {
    Image(systemName: systemName)
      .font(.system(size: 17))
      .foregroundStyle(ChiefTheme.secondary)
      .frame(width: 26)
  }
}

struct SettingsChevron: View {
  var body: some View {
    Image(systemName: "chevron.right")
      .font(.system(size: 11, weight: .medium))
      .foregroundStyle(ChiefTheme.tertiary)
  }
}

/// A read-only label and value, right-aligned like desktop's connection rows.
struct SettingsValueRow<Accessory: View>: View {
  let title: String
  let value: String
  var monospaced = false
  @ViewBuilder var accessory: Accessory

  var body: some View {
    SettingsRow {
      Text(title).foregroundStyle(ChiefTheme.secondary)
      Spacer(minLength: 12)
      Text(value)
        .font(.system(size: 15, design: monospaced ? .monospaced : .default))
        .foregroundStyle(ChiefTheme.accent)
        .lineLimit(1)
        .truncationMode(.middle)
        .textSelection(.enabled)
      accessory
    }
  }
}

extension SettingsValueRow where Accessory == EmptyView {
  init(title: String, value: String, monospaced: Bool = false) {
    self.init(title: title, value: value, monospaced: monospaced) { EmptyView() }
  }
}

/// A full-width tappable action that sits in a section like any other row.
struct SettingsActionRow: View {
  let title: String
  let icon: String
  var role: ButtonRole? = nil
  var isWorking = false
  let action: () -> Void

  var body: some View {
    Button(role: role) {
      Haptics.light()
      action()
    } label: {
      SettingsRow {
        Image(systemName: icon)
          .font(.system(size: 17))
          .frame(width: 26)
        Text(title)
        Spacer(minLength: 8)
        if isWorking { ChiefSpinner().controlSize(.small) }
      }
      .foregroundStyle(role == .destructive ? Color.red : ChiefTheme.accent)
    }
    .buttonStyle(.plain)
    .disabled(isWorking)
  }
}

struct SettingsTextField: View {
  let title: String
  @Binding var text: String
  var placeholder: String? = nil
  var keyboard: UIKeyboardType = .default
  var secure = false
  var monospaced = false
  var capitalization: TextInputAutocapitalization? = nil

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title).font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
      Group {
        if secure {
          SecureField(placeholder ?? title, text: $text)
            .textContentType(.password)
            .privacySensitive()
        } else {
          TextField(placeholder ?? title, text: $text)
            .keyboardType(keyboard)
        }
      }
      .font(.system(size: 16, design: monospaced ? .monospaced : .default))
      .textInputAutocapitalization(resolvedCapitalization)
      .autocorrectionDisabled(disablesCorrection)
      .accessibilityLabel(title)
    }
    .padding(.vertical, 14)
    .overlay(alignment: .bottom) { SettingsHairline() }
  }

  /// Addresses, keys and secrets are typed verbatim.
  private var isVerbatim: Bool { secure || [.URL, .emailAddress].contains(keyboard) }

  private var disablesCorrection: Bool { isVerbatim || monospaced }

  private var resolvedCapitalization: TextInputAutocapitalization {
    capitalization ?? (isVerbatim ? .never : .words)
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

/// Inline status under a control: failures in red, confirmations in green.
struct SettingsNote: View {
  enum Tone { case secondary, success, failure }

  let text: String
  var tone: Tone = .secondary

  var body: some View {
    Label {
      Text(text).fixedSize(horizontal: false, vertical: true)
    } icon: {
      if let icon { Image(systemName: icon) }
    }
    .labelStyle(SettingsNoteLabelStyle())
    .font(.system(size: 13))
    .foregroundStyle(color)
    .padding(.top, 10)
  }

  private var icon: String? {
    switch tone {
    case .secondary: nil
    case .success: "checkmark.circle.fill"
    case .failure: "exclamationmark.circle.fill"
    }
  }

  private var color: Color {
    switch tone {
    case .secondary: ChiefTheme.secondary
    case .success: .green
    case .failure: .red.opacity(0.9)
    }
  }
}

private struct SettingsNoteLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      configuration.icon.font(.system(size: 12))
      configuration.title
    }
  }
}

/// The quiet placeholder for an empty or unavailable list.
struct SettingsEmptyState: View {
  let icon: String
  let title: String
  var detail: String? = nil

  var body: some View {
    VStack(spacing: 8) {
      Image(systemName: icon)
        .font(.system(size: 20, weight: .light))
        .foregroundStyle(ChiefTheme.secondary)
        .padding(.bottom, 4)
      Text(title)
        .font(.system(size: 15, weight: .medium))
        .foregroundStyle(ChiefTheme.accent)
      if let detail {
        Text(detail)
          .font(.system(size: 13))
          .foregroundStyle(ChiefTheme.secondary)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .frame(maxWidth: .infinity, minHeight: 150)
    .padding(.horizontal, 24)
    .background(ChiefTheme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(ChiefTheme.line)
    }
  }
}

/// A small capsule used for roles and statuses.
struct SettingsBadge: View {
  let text: String
  var dot: Color? = nil
  var showsMenuIndicator = false

  var body: some View {
    HStack(spacing: 5) {
      if let dot { Circle().fill(dot).frame(width: 6, height: 6) }
      Text(text)
      if showsMenuIndicator {
        Image(systemName: "chevron.up.chevron.down").font(.system(size: 8, weight: .semibold))
      }
    }
    .font(.system(size: 12, weight: .medium))
    .foregroundStyle(ChiefTheme.secondary)
    .padding(.horizontal, 9)
    .frame(height: 24)
    .background(ChiefTheme.elevated, in: Capsule())
  }
}

/// Shows a spinner until the first load finishes, then the content.
struct SettingsLoading: View {
  var body: some View {
    ChiefSpinner()
      .tint(ChiefTheme.secondary)
      .frame(maxWidth: .infinity, minHeight: 120)
  }
}
