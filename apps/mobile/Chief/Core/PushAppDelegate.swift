import UIKit
import UserNotifications

@MainActor
final class PushAppDelegate: NSObject, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // The notification center must have a delegate before launch finishes or
    // a lock-screen tap that cold-starts the app is dropped.
    _ = MobileNotifications.shared
    if let payload = launchOptions?[.remoteNotification] as? [AnyHashable: Any],
      let link = ConversationDeepLink(userInfo: payload)
    {
      MobileNotifications.pendingOpen = link
    }
    application.registerForRemoteNotifications()
    return true
  }

  func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    NotificationCenter.default.post(
      name: PushAppDelegate.didRegisterToken,
      object: nil,
      userInfo: ["token": deviceToken]
    )
  }

  func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    print("[Chief] APNs registration failed: \(error)")
  }

  static let didRegisterToken = Notification.Name("sh.heychief.mobile.push.token")
}
