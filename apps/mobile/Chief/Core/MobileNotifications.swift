import Foundation
import UIKit
import UserNotifications

/// Notification presentation owned by iOS. Live sockets drive these local
/// notifications while the app process is connected; APNs remote delivery is
/// intentionally a separate server capability and must not be simulated here.
@MainActor
final class MobileNotifications: NSObject, UNUserNotificationCenterDelegate {
  static let shared = MobileNotifications()
  static var remotePushRegistered = false
  /// Survives the race between a lock-screen tap and SwiftUI becoming ready.
  static var pendingOpen: ConversationDeepLink? {
    get {
      guard let value = UserDefaults.standard.string(forKey: "chief.notification.pending-url"),
        let url = URL(string: value) else { return nil }
      return ConversationDeepLink(url: url)
    }
    set {
      UserDefaults.standard.set(newValue?.url.absoluteString, forKey: "chief.notification.pending-url")
    }
  }

  static let didOpenConversation = Notification.Name(
    "sh.heychief.mobile.notification.open-conversation"
  )

  private override init() {
    super.init()
    UNUserNotificationCenter.current().delegate = self
  }

  static var configuredSound: UNNotificationSound? {
    guard NotificationSoundPreferences.enabled else { return nil }
    return UNNotificationSound(
      named: UNNotificationSoundName(
        rawValue: NotificationSoundPreferences.sound.fileName
      )
    )
  }

  func requestAuthorizationIfNeeded() async {
    let center = UNUserNotificationCenter.current()
    var settings = await center.notificationSettings()
    if settings.authorizationStatus == .notDetermined {
      do {
        _ = try await center.requestAuthorization(options: [.alert, .badge, .sound])
      } catch {
        print("[Chief] notification permission failed: \(error)")
        return
      }
      settings = await center.notificationSettings()
    }
    guard settings.authorizationStatus == .authorized
      || settings.authorizationStatus == .provisional
    else { return }
    await MainActor.run { UIApplication.shared.registerForRemoteNotifications() }
  }

  func deliver(
    title: String,
    body: String,
    workspaceID: String,
    conversationID: String,
    threadRootID: String?,
    mentioned: Bool = false
  ) async {
    let link = ConversationDeepLink(
      workspaceID: workspaceID,
      conversationID: conversationID,
      threadRootID: threadRootID
    )
    let content = UNMutableNotificationContent()
    content.title = title
    let preview = MarkdownMessageParser.plainText(body)
    content.body = preview.isEmpty ? "Sent an attachment" : String(preview.prefix(180))
    content.sound = NotificationSoundGate.shared.claim()
      ? Self.configuredSound
      : nil
    content.threadIdentifier = "\(workspaceID):\(conversationID)"
    content.targetContentIdentifier = conversationID
    var userInfo: [String: Any] = [
      "workspaceID": workspaceID,
      "conversationID": conversationID,
      "url": link.url.absoluteString,
      "mentioned": mentioned,
    ]
    if let threadRootID { userInfo["threadRootID"] = threadRootID }
    content.userInfo = userInfo
    let request = UNNotificationRequest(
      identifier: "message:\(workspaceID):\(conversationID):\(UUID().uuidString)",
      content: content,
      trigger: nil
    )
    do {
      try await UNUserNotificationCenter.current().add(request)
    } catch {
      print("[Chief] local notification delivery failed: \(error)")
    }
  }

  func setBadgeCount(_ count: Int) async {
    do {
      try await UNUserNotificationCenter.current().setBadgeCount(count)
    } catch {
      print("[Chief] notification badge update failed: \(error)")
    }
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    let info = notification.request.content.userInfo
    let mentioned = info["mentioned"] as? Bool == true
    // Ordinary foreground arrivals use the transcript + haptic. An explicit
    // @mention still deserves a banner while the app is open.
    if mentioned { return [.banner, .sound, .list] }
    return []
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse
  ) async {
    guard response.actionIdentifier != UNNotificationDismissActionIdentifier,
      let link = ConversationDeepLink(userInfo: response.notification.request.content.userInfo)
    else { return }
    await MainActor.run {
      Self.pendingOpen = link
      NotificationCenter.default.post(
        name: Self.didOpenConversation,
        object: nil
      )
    }
  }
}
