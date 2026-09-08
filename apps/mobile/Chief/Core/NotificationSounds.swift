import AVFoundation
import SwiftUI

enum ChiefNotificationSound: String, CaseIterable, Identifiable {
  case chime, sparkle, droplet, bloom, ready, success

  var id: String { rawValue }
  var fileName: String { "\(rawValue).caf" }

  var title: String { rawValue.capitalized }

  var detail: String {
    switch self {
    case .chime: "A soft two-note bell."
    case .sparkle: "A quick ascending twinkle."
    case .droplet: "A gentle falling tone."
    case .bloom: "A warm, slow swell."
    case .ready: "A focused tick and soft bloom."
    case .success: "A warm three-note rise."
    }
  }

  var bars: [CGFloat] {
    switch self {
    case .chime: [7, 13]
    case .sparkle: [5, 8, 11, 15]
    case .droplet: [15, 11, 7]
    case .bloom: [6, 10, 14, 10, 6]
    case .ready: [5, 14, 9]
    case .success: [7, 10, 14]
    }
  }
}

enum NotificationSoundPreferences {
  static let enabledKey = "chief:notification-sounds:enabled:v1"
  static let soundKey = "chief:notification-sounds:selected:v1"

  static var enabled: Bool {
    let defaults = UserDefaults.standard
    return defaults.object(forKey: enabledKey) == nil
      ? true
      : defaults.bool(forKey: enabledKey)
  }

  static var sound: ChiefNotificationSound {
    ChiefNotificationSound(
      rawValue: UserDefaults.standard.string(forKey: soundKey) ?? "chime"
    ) ?? .chime
  }
}

/// Coalesces foreground playback and system notification sounds through one
/// process-wide decision point. App lifecycle transitions can otherwise race a
/// relay arrival through both paths and play the same cue twice.
@MainActor
final class NotificationSoundGate {
  static let shared = NotificationSoundGate()

  private var lastClaimedAt = Date.distantPast

  func claim() -> Bool {
    let now = Date()
    guard now.timeIntervalSince(lastClaimedAt) >= 0.8 else { return false }
    lastClaimedAt = now
    return true
  }
}

@MainActor
final class NotificationSoundPlayer {
  static let shared = NotificationSoundPlayer()

  private var player: AVAudioPlayer?

  func playConfigured() {
    guard NotificationSoundPreferences.enabled else { return }
    guard NotificationSoundGate.shared.claim() else { return }
    play(NotificationSoundPreferences.sound)
  }

  func play(_ sound: ChiefNotificationSound) {
    guard let url = Bundle.main.url(
      forResource: sound.rawValue,
      withExtension: "caf"
    ) else {
      print("[Chief] notification sound asset missing: \(sound.fileName)")
      return
    }
    do {
      try AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default)
      let next = try AVAudioPlayer(contentsOf: url)
      next.volume = 0.78
      next.prepareToPlay()
      next.play()
      player = next
    } catch {
      print("[Chief] notification sound playback failed: \(error)")
    }
  }
}

struct NotificationSettingsView: View {
  @AppStorage(NotificationSoundPreferences.enabledKey) private var soundsEnabled = true
  @AppStorage(NotificationSoundPreferences.soundKey) private var selectedSound =
    ChiefNotificationSound.chime.rawValue

  var body: some View {
    SettingsPage {
      VStack(alignment: .leading, spacing: 0) {
        SettingsToggle(
          title: "Notification sounds",
          detail: "Play a cue for new messages and scheduled outcomes",
          isOn: soundsEnabled
        ) {
          soundsEnabled.toggle()
          if soundsEnabled { preview(selection) }
        }
      }

      SettingsSection(title: "Message sound") {
        ForEach(ChiefNotificationSound.allCases) { sound in
          Button {
            selectedSound = sound.rawValue
            preview(sound)
          } label: {
            HStack(spacing: 12) {
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
            .frame(minHeight: 60)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .disabled(!soundsEnabled)
        }
      }
    }
    .scrollContentBackground(.hidden)
    .background(ChiefTheme.background)
    .navigationTitle("Notifications")
    .navigationBarTitleDisplayMode(.inline)
  }

  private var selection: ChiefNotificationSound {
    ChiefNotificationSound(rawValue: selectedSound) ?? .chime
  }

  private func preview(_ sound: ChiefNotificationSound) {
    Haptics.medium()
    NotificationSoundPlayer.shared.play(sound)
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
