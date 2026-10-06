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
