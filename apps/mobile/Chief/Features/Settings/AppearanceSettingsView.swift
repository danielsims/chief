import SwiftUI

struct AppearanceSettingsView: View {
  @AppStorage(ChiefAppearance.storageKey) private var appearance = ChiefAppearance.system

  var body: some View {
    SettingsPage(intro: "Choose how Chief looks on this iPhone.") {
      SettingsSection(title: "Theme") {
        ForEach(ChiefAppearance.allCases) { option in
          Button {
            Haptics.selection()
            appearance = option
          } label: {
            SettingsRow {
              SettingsIcon(systemName: option.icon)
              Text(option.title).foregroundStyle(ChiefTheme.accent)
              Spacer()
              ChiefCheckmark(isOn: appearance == option)
            }
          }
          .buttonStyle(.plain)
          .accessibilityAddTraits(appearance == option ? .isSelected : [])
        }
      }
    }
    .navigationTitle("Appearance")
  }
}
