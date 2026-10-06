import SwiftUI
import UserNotifications

struct NotificationSettingsView: View {
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.openURL) private var openURL
  @AppStorage(NotificationSoundPreferences.enabledKey) private var soundsEnabled = true
  @AppStorage(NotificationSoundPreferences.soundKey) private var selectedSound =
    ChiefNotificationSound.chime.rawValue
  @State private var status: UNAuthorizationStatus?
  @State private var testing = false
  @State private var testResult: Bool?

  var body: some View {
    SettingsPage(intro: "Choose how Chief lets you know when something needs your attention.") {
      SettingsSection(title: "Push notifications") {
        SettingsRow {
          VStack(alignment: .leading, spacing: 3) {
            Text("Push notifications")
              .font(.system(size: 15, weight: .medium))
              .foregroundStyle(ChiefTheme.accent)
            Text("Show iPhone notifications for messages and scheduled work.")
              .font(.system(size: 12))
              .foregroundStyle(ChiefTheme.secondary)
          }
          Spacer(minLength: 12)
          if let status { SettingsBadge(text: statusTitle(status), dot: statusColor(status)) }
        }
        switch status {
        case .notDetermined:
          SettingsActionRow(title: "Turn on notifications", icon: "bell.badge") {
            Task { await requestPermission() }
          }
        case .denied:
          SettingsActionRow(title: "Open iPhone Settings", icon: "gear") {
            if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
              openURL(url)
            }
          }
        default:
          EmptyView()
        }
        SettingsActionRow(
          title: testing ? "Sending…" : "Send test notification", icon: "paperplane",
          isWorking: testing
        ) {
          Task { await sendTest() }
        }
        .disabled(status == .denied)
        if status == .denied {
          SettingsNote(
            text: "iOS is blocking Chief notifications. Allow them in Settings.", tone: .failure)
        } else if let testResult {
          SettingsNote(
            text: testResult ? "Test notification sent." : "Notification delivery failed.",
            tone: testResult ? .success : .failure)
        }
      }

      SettingsSection(title: "Sounds") {
        SettingsToggle(
          title: "Notification sounds",
          detail: "Play a sound for new messages and scheduled outcomes.",
          isOn: soundsEnabled
        ) {
          soundsEnabled.toggle()
          if soundsEnabled { preview(selection) }
        }
      }

      SettingsSection(
        title: "Message sound", footer: "Choose the cue used for incoming notifications."
      ) {
        ForEach(ChiefNotificationSound.allCases) { sound in
          Button {
            selectedSound = sound.rawValue
            preview(sound)
          } label: {
            SettingsRow {
              SoundMark(sound: sound)
              VStack(alignment: .leading, spacing: 3) {
                Text(sound.title)
                  .font(.system(size: 15, weight: .medium))
                  .foregroundStyle(ChiefTheme.accent)
                Text(sound.detail)
                  .font(.system(size: 12))
                  .foregroundStyle(ChiefTheme.secondary)
              }
              Spacer()
              ChiefCheckmark(isOn: selectedSound == sound.rawValue)
            }
          }
          .buttonStyle(.plain)
          .disabled(!soundsEnabled)
          .opacity(soundsEnabled ? 1 : 0.45)
          .accessibilityAddTraits(selectedSound == sound.rawValue ? .isSelected : [])
        }
      }
    }
    .navigationTitle("Notifications")
    .task { await refreshStatus() }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { Task { await refreshStatus() } }
    }
  }

  private var selection: ChiefNotificationSound {
    ChiefNotificationSound(rawValue: selectedSound) ?? .chime
  }

  private func preview(_ sound: ChiefNotificationSound) {
    Haptics.medium()
    NotificationSoundPlayer.shared.play(sound)
  }

  private func refreshStatus() async {
    status = await MobileNotifications.shared.authorizationStatus()
  }

  private func requestPermission() async {
    await MobileNotifications.shared.requestAuthorizationIfNeeded()
    await refreshStatus()
  }

  private func sendTest() async {
    guard !testing else { return }
    testing = true
    testResult = nil
    if status == .notDetermined { await requestPermission() }
    let delivered = await MobileNotifications.shared.sendTestNotification()
    testResult = delivered
    delivered ? Haptics.success() : Haptics.error()
    testing = false
  }

  private func statusTitle(_ status: UNAuthorizationStatus) -> String {
    switch status {
    case .authorized, .provisional, .ephemeral: "Allowed"
    case .denied: "Off"
    default: "Not set"
    }
  }

  private func statusColor(_ status: UNAuthorizationStatus) -> Color {
    switch status {
    case .authorized, .provisional, .ephemeral: .green
    case .denied: .red
    default: ChiefTheme.tertiary
    }
  }
}

private struct SoundMark: View {
  let sound: ChiefNotificationSound

  var body: some View {
    HStack(alignment: .center, spacing: 2) {
      ForEach(Array(sound.bars.enumerated()), id: \.offset) { _, height in
        Capsule()
          .fill(ChiefTheme.secondary)
          .frame(width: 2, height: height)
      }
    }
    .frame(width: 36, height: 36)
    .background(ChiefTheme.elevated, in: Circle())
    .accessibilityHidden(true)
  }
}
