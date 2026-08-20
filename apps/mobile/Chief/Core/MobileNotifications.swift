import Foundation
import UIKit
import UserNotifications

/// Notification presentation owned by iOS. Live sockets drive these local
/// notifications while the app process is connected; APNs remote delivery is
/// intentionally a separate server capability and must not be simulated here.
@MainActor
final class MobileNotifications: NSObject, UNUserNotificationCenterDelegate {
  static let shared = MobileNotifications()

  static let didOpenConversation = Notification.Name(
    "sh.heychief.mobile.notification.open-conversation"
  )

  private override init() {
    super.init()
    UNUserNotificationCenter.current().delegate = self
  }

  func requestAuthorizationIfNeeded() async {
    let center = UNUserNotificationCenter.current()
    let settings = await center.notificationSettings()
    guard settings.authorizationStatus == .notDetermined else { return }
    do {
      _ = try await center.requestAuthorization(options: [.alert, .badge, .sound])
    } catch {
      print("[Chief] notification permission failed: \(error)")
    }
  }

  func deliver(
    title: String,
    body: String,
    workspaceID: String,
    conversationID: String,
    threadRootID: String?
  ) async {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body.isEmpty ? "Sent an attachment" : String(body.prefix(180))
    content.sound = NotificationSoundPreferences.enabled
      ? UNNotificationSound(
        named: UNNotificationSoundName(
          rawValue: NotificationSoundPreferences.sound.fileName
        )
      )
      : nil
    content.threadIdentifier = "\(workspaceID):\(conversationID)"
    var userInfo: [String: Any] = [
      "workspaceID": workspaceID,
      "conversationID": conversationID,
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
    // Foreground arrivals use Chief's transcript animation + haptic. Showing a
    // second banner while the user is already in the app is distracting.
    []
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse
  ) async {
    let info = response.notification.request.content.userInfo
    guard
      let workspaceID = info["workspaceID"] as? String,
      let conversationID = info["conversationID"] as? String
    else { return }
    let threadRootID = info["threadRootID"] as? String
    await MainActor.run {
      var userInfo: [String: Any] = [
        "workspaceID": workspaceID,
        "conversationID": conversationID,
      ]
      if let threadRootID {
        userInfo["threadRootID"] = threadRootID
      }
      NotificationCenter.default.post(
        name: Self.didOpenConversation,
        object: nil,
        userInfo: userInfo
      )
    }
  }
}
