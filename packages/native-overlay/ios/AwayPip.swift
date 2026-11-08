// The picture-in-picture window a sharer sees after leaving the app: their own
// screen (from the share track) with the other side's ink on top. iOS has no
// "draw over other apps"; a video-call PiP window is the one surface an app
// keeps on screen while the user is somewhere else.
//
// It starts by itself when the app goes to the background
// (canStartPictureInPictureAutomaticallyFromInline), which needs the
// "audio" background mode and a live audio session, as any call has.
import AVKit
import UIKit

final class AwayPip: NSObject, AVPictureInPictureControllerDelegate {
  let ink = AwayInkView(frame: .zero)
  var onActiveChange: ((Bool) -> Void)?
  var onError: ((String) -> Void)?

  private let video = SampleBufferView(frame: .zero)
  private let content = AVPictureInPictureVideoCallViewController()
  private var controller: AVPictureInPictureController?
  private var foregroundObservers: [NSObjectProtocol] = []

  static var isSupported: Bool { AVPictureInPictureController.isPictureInPictureSupported() }

  var isActive: Bool { controller?.isPictureInPictureActive ?? false }

  override init() {
    super.init()
    content.view.backgroundColor = .black
    for v in [video, ink] as [UIView] {
      v.translatesAutoresizingMaskIntoConstraints = false
      content.view.addSubview(v)
      NSLayoutConstraint.activate([
        v.leadingAnchor.constraint(equalTo: content.view.leadingAnchor),
        v.trailingAnchor.constraint(equalTo: content.view.trailingAnchor),
        v.topAnchor.constraint(equalTo: content.view.topAnchor),
        v.bottomAnchor.constraint(equalTo: content.view.bottomAnchor),
      ])
    }
  }

  /// Arms the window: it opens on its own when the app goes to the background.
  func enable(sourceView: UIView) -> Bool {
    guard Self.isSupported else { return false }
    let screen = UIScreen.main.bounds.size
    content.preferredContentSize = screen
    if controller == nil {
      let source = AVPictureInPictureController.ContentSource(
        activeVideoCallSourceView: sourceView,
        contentViewController: content
      )
      let c = AVPictureInPictureController(contentSource: source)
      c.canStartPictureInPictureAutomaticallyFromInline = true
      c.delegate = self
      controller = c
    }
    if foregroundObservers.isEmpty {
      // Back in the app: the in-app UI takes over. Both notifications,
      // because returning via the app switcher or a PiP tap doesn't always
      // post willEnterForeground; stopping twice is harmless.
      for name in [UIApplication.willEnterForegroundNotification, UIApplication.didBecomeActiveNotification] {
        foregroundObservers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
          self?.stopIfActive()
        })
      }
    }
    return true
  }

  func disable() {
    controller?.stopPictureInPicture()
    controller?.delegate = nil
    controller = nil
    for o in foregroundObservers { NotificationCenter.default.removeObserver(o) }
    foregroundObservers.removeAll()
    ink.clear()
  }

  private func stopIfActive() {
    guard let c = controller, c.isPictureInPictureActive else { return }
    c.stopPictureInPicture()
  }

  func show(frame: CVPixelBuffer) {
    video.show(frame)
  }

  // MARK: AVPictureInPictureControllerDelegate

  func pictureInPictureControllerDidStartPictureInPicture(_ c: AVPictureInPictureController) {
    // The user came back while the window was still opening.
    if UIApplication.shared.applicationState == .active {
      c.stopPictureInPicture()
      return
    }
    // The window is far smaller than the screen; keep stroke widths in
    // proportion to the picture.
    ink.widthScale = max(0.35, content.view.bounds.width / max(1, UIScreen.main.bounds.width))
    onActiveChange?(true)
  }

  func pictureInPictureControllerDidStopPictureInPicture(_ c: AVPictureInPictureController) {
    onActiveChange?(false)
  }

  func pictureInPictureController(_ c: AVPictureInPictureController, failedToStartPictureInPictureWithError error: Error) {
    onError?(error.localizedDescription)
    onActiveChange?(false)
  }
}
