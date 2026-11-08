// Shows this package's "someone is drawing" notifications as banners even
// while iOS counts the app as in the foreground, which it does while the
// picture-in-picture window is up. Without a delegate saying so, a
// foreground app's notifications are dropped: no banner, no sound, nothing
// in Notification Center.
//
// The app may have its own delegate (expo-notifications, a push SDK):
// everything that isn't ours is forwarded to it unchanged.
import UserNotifications

final class AwayNotifications: NSObject, UNUserNotificationCenterDelegate {
  static let shared = AwayNotifications()
  static let idPrefix = "scribble-away-"

  private weak var previous: UNUserNotificationCenterDelegate?

  /// Puts this delegate in front of the app's own one, once (and again if
  /// something replaced it since).
  func install() {
    let center = UNUserNotificationCenter.current()
    guard center.delegate !== self else { return }
    previous = center.delegate
    center.delegate = self
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    if notification.request.identifier.hasPrefix(Self.idPrefix) {
      completionHandler([.banner, .list, .sound])
    } else if let previous, previous.responds(to: #selector(userNotificationCenter(_:willPresent:withCompletionHandler:))) {
      previous.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: completionHandler)
    } else {
      completionHandler([])
    }
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    if let previous, previous.responds(to: #selector(userNotificationCenter(_:didReceive:withCompletionHandler:))) {
      previous.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completionHandler)
    } else {
      completionHandler()
    }
  }
}
