// iOS side of @vilancer/scribble-overlay: what a sharer gets after leaving the
// app (useAwayInk in JS). iOS lets no app draw over other apps, so instead:
//   - a picture-in-picture window with their screen and the other side's ink,
//   - a local notification (sound / vibration) when someone starts drawing,
//   - snapshots of their screen, so ink received while away can be replayed
//     over what they were looking at when they come back.
import AudioToolbox
import AVFoundation
import ExpoModulesCore
import UIKit
import UserNotifications

public final class ScribbleAwayModule: Module {
  private lazy var pip = AwayPip()
  private let tap = ShareTrackTap()

  public func definition() -> ModuleDefinition {
    Name("ScribbleAway")
    Events("onPipChange")

    Function("isPipSupported") { AwayPip.isSupported }

    AsyncFunction("notificationPermission") { (promise: Promise) in
      UNUserNotificationCenter.current().getNotificationSettings { settings in
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: promise.resolve("granted")
        case .denied: promise.resolve("denied")
        default: promise.resolve("undetermined")
        }
      }
    }

    AsyncFunction("requestNotificationPermission") { (promise: Promise) in
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
        promise.resolve(granted)
      }
    }

    Function("notify") { (title: String, body: String) in
      // iOS shows no banner while the screen is being shared ("Posting not
      // permitted during screen sharing"), which is exactly when this runs.
      // The notification still lands in Notification Center; the vibration
      // is what the user actually feels. The app is running (a call keeps
      // it alive), and a recording audio session mutes system haptics
      // unless it allows them.
      try? AVAudioSession.sharedInstance().setAllowHapticsAndSystemSoundsDuringRecording(true)
      AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
      awayLog("vibrated for a new burst of ink")
      AwayNotifications.shared.install()
      let content = UNMutableNotificationContent()
      content.title = title
      content.body = body
      content.sound = .default
      // One thread so they stack, but a new id each time: re-adding an id
      // that is still in Notification Center only updates it, silently.
      content.threadIdentifier = "scribble-away"
      if #available(iOS 15.0, *) { content.interruptionLevel = .active }
      let request = UNNotificationRequest(identifier: "\(AwayNotifications.idPrefix)\(UUID().uuidString)", content: content, trigger: nil)
      UNUserNotificationCenter.current().add(request)
    }

    AsyncFunction("pipEnable") { (options: [String: Any]) -> Bool in
      guard let source = Self.sourceView() else { return false }
      var timing = FadeTiming()
      if let v = options["holdMs"] as? Double { timing.holdMs = v }
      if let v = options["fadeMs"] as? Double { timing.fadeMs = v }
      if let v = options["staleMs"] as? Double { timing.staleMs = v }
      self.pip.ink.timing = timing
      self.pip.onActiveChange = { [weak self] active in
        self?.sendEvent("onPipChange", ["active": active])
      }
      self.pip.onError = { [weak self] message in
        self?.sendEvent("onPipChange", ["active": false, "error": message])
      }
      return self.pip.enable(sourceView: source)
    }.runOnQueue(.main)

    AsyncFunction("pipDisable") {
      self.pip.disable()
    }.runOnQueue(.main)

    Function("isPipActive") { () -> Bool in
      Thread.isMainThread ? self.pip.isActive : DispatchQueue.main.sync { self.pip.isActive }
    }

    AsyncFunction("attachShareTrack") { (trackId: String?) -> Bool in
      guard let trackId, !trackId.isEmpty else {
        self.tap.detach()
        return false
      }
      self.tap.onFrame = { [weak self] frame in self?.pip.show(frame: frame) }
      return self.tap.attach(trackId: trackId)
    }.runOnQueue(.main)

    AsyncFunction("snapshot") { () -> [String: Any]? in
      self.tap.snapshot()
    }

    Function("deleteSnapshots") {
      ShareTrackTap.deleteSnapshots()
    }

    Function("remoteBegin") { (key: String, u: Double, v: Double, color: String?, width: Double?, tool: String?) in
      DispatchQueue.main.async {
        self.pip.ink.begin(key: key, u: CGFloat(u), v: CGFloat(v), color: color, width: width, tool: tool)
      }
    }

    Function("remoteAppend") { (key: String, points: [Double]) in
      DispatchQueue.main.async { self.pip.ink.append(key: key, points: points) }
    }

    Function("remoteEnd") { (key: String, kind: String?) in
      DispatchQueue.main.async { self.pip.ink.end(key: key, kind: kind) }
    }

    Function("clear") { (_: String) in
      DispatchQueue.main.async { self.pip.ink.clear() }
    }

    Function("clearSender") { (from: String) in
      DispatchQueue.main.async { self.pip.ink.clearSender(from) }
    }

    OnDestroy {
      DispatchQueue.main.async {
        self.tap.detach()
        self.pip.disable()
      }
    }
  }

  /// The view PiP animates from and back into: the app's root view.
  private static func sourceView() -> UIView? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first?.windows.first
    return window?.rootViewController?.view
  }
}
