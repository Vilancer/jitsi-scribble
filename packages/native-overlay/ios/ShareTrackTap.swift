// Reads frames from this phone's own screen-share track: the picture under the
// ink in the PiP window, and the snapshot that ink received while the user was
// away is replayed over. The track lives in react-native-webrtc, which this
// package does not link against (it is the app's dependency, not ours), so it
// is found and fed at runtime through the Objective-C runtime:
//   RCTBridge.currentBridge → WebRTCModule.localTracks[trackId] → addRenderer:
// Every step is optional; a missing piece just means "no picture".
import AVFoundation
import CoreImage
import React
import os
import UIKit

private let logger = Logger(subsystem: "com.vilancer.scribble", category: "away")

/// Diagnostics in the device log (Console.app, idevicesyslog).
func awayLog(_ message: String) {
  logger.notice("[ScribbleAway] \(message, privacy: .public)")
}

final class ShareTrackTap: NSObject {
  /// Called on the main thread with each new frame (throttled).
  var onFrame: ((CVPixelBuffer) -> Void)?

  private let lock = NSLock()
  private var latest: CVPixelBuffer?
  private var track: NSObject?
  private var pendingMain = false
  private var loggedFrame = false
  private var loggedBadFrame = false
  private let ciContext = CIContext(options: nil)

  /// Attaches to the local track with this MediaStreamTrack id. False when
  /// react-native-webrtc or the track isn't there.
  func attach(trackId: String) -> Bool {
    detach()
    guard let bridge = RCTBridge.current() else {
      awayLog("no current bridge")
      return false
    }
    guard let module = bridge.module(forName: "WebRTCModule", lazilyLoadIfNecessary: true) as? NSObject else {
      awayLog("WebRTCModule not found")
      return false
    }
    guard module.responds(to: NSSelectorFromString("localTracks")),
          let tracks = module.value(forKey: "localTracks") as? NSDictionary else {
      awayLog("WebRTCModule has no localTracks")
      return false
    }
    guard let found = tracks[trackId] as? NSObject, found.responds(to: NSSelectorFromString("addRenderer:")) else {
      awayLog("track \(trackId) not among \(tracks.allKeys.map { "\($0)" }.joined(separator: ","))")
      return false
    }
    found.perform(NSSelectorFromString("addRenderer:"), with: self)
    track = found
    awayLog("attached to share track \(trackId)")
    return true
  }

  func detach() {
    if let track { track.perform(NSSelectorFromString("removeRenderer:"), with: self) }
    track = nil
    lock.lock()
    latest = nil
    lock.unlock()
  }

  var attached: Bool { track != nil }

  // RTCVideoRenderer, matched by selector (renderFrame:, setSize:).
  @objc(setSize:) func setSize(_ size: CGSize) {}

  @objc(renderFrame:) func renderFrame(_ frame: NSObject?) {
    guard
      let frame,
      let buffer = frame.value(forKey: "buffer") as? NSObject,
      buffer.responds(to: NSSelectorFromString("pixelBuffer")),
      let raw = buffer.perform(NSSelectorFromString("pixelBuffer"))?.takeUnretainedValue()
    else {
      if !loggedBadFrame {
        loggedBadFrame = true
        awayLog("frame without a CVPixelBuffer: \(String(describing: (frame?.value(forKey: "buffer") as? NSObject).map { type(of: $0) }))")
      }
      return
    }
    if !loggedFrame {
      loggedFrame = true
      awayLog("first share frame")
    }
    // swiftlint:disable:next force_cast
    let pixelBuffer = raw as! CVPixelBuffer
    lock.lock()
    latest = pixelBuffer
    let schedule = !pendingMain
    pendingMain = true
    lock.unlock()
    guard schedule else { return }
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.lock.lock()
      let frame = self.latest
      self.pendingMain = false
      self.lock.unlock()
      if let frame { self.onFrame?(frame) }
    }
  }

  /// The latest frame as a JPEG in the caches folder.
  func snapshot() -> [String: Any]? {
    lock.lock()
    let frame = latest
    lock.unlock()
    guard let frame else { return nil }
    let image = CIImage(cvPixelBuffer: frame)
    guard let cg = ciContext.createCGImage(image, from: image.extent),
          let data = UIImage(cgImage: cg).jpegData(compressionQuality: 0.7)
    else { return nil }
    let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("scribble-away", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let url = dir.appendingPathComponent("\(UUID().uuidString).jpg")
    do {
      try data.write(to: url)
    } catch {
      return nil
    }
    return ["uri": url.absoluteString, "width": cg.width, "height": cg.height]
  }

  /// Deletes every snapshot this module wrote.
  static func deleteSnapshots() {
    let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("scribble-away", isDirectory: true)
    try? FileManager.default.removeItem(at: dir)
  }
}

/// A view backed by AVSampleBufferDisplayLayer: the one kind of video layer
/// that keeps rendering inside a PiP window while the app is in the background.
final class SampleBufferView: UIView {
  override class var layerClass: AnyClass { AVSampleBufferDisplayLayer.self }
  var displayLayer: AVSampleBufferDisplayLayer {
    // swiftlint:disable:next force_cast
    layer as! AVSampleBufferDisplayLayer
  }

  private let ciContext = CIContext(options: [.cacheIntermediates: false])
  private var pool: CVPixelBufferPool?
  private var poolSize = CGSize.zero

  override init(frame: CGRect) {
    super.init(frame: frame)
    displayLayer.videoGravity = .resizeAspect
    backgroundColor = .black
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  func show(_ source: CVPixelBuffer) {
    // The PiP window is drawn by another process, so frames must live in
    // IOSurfaces; react-native-webrtc's screen capturer makes plain
    // buffers. Copy each one (on the GPU, at half size: the window is
    // small) into an IOSurface-backed buffer from a pool.
    guard let pixelBuffer = surfaceCopy(source) else { return }
    var format: CMVideoFormatDescription?
    guard CMVideoFormatDescriptionCreateForImageBuffer(
      allocator: kCFAllocatorDefault, imageBuffer: pixelBuffer, formatDescriptionOut: &format
    ) == noErr, let format else { return }
    var timing = CMSampleTimingInfo(
      duration: .invalid,
      presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()),
      decodeTimeStamp: .invalid
    )
    var sample: CMSampleBuffer?
    guard CMSampleBufferCreateReadyWithImageBuffer(
      allocator: kCFAllocatorDefault,
      imageBuffer: pixelBuffer,
      formatDescription: format,
      sampleTiming: &timing,
      sampleBufferOut: &sample
    ) == noErr, let sample else { return }
    if let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true),
       CFArrayGetCount(attachments) > 0 {
      let dict = unsafeBitCast(CFArrayGetValueAtIndex(attachments, 0), to: CFMutableDictionary.self)
      CFDictionarySetValue(
        dict,
        Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
        Unmanaged.passUnretained(kCFBooleanTrue).toOpaque()
      )
    }
    if displayLayer.status == .failed { displayLayer.flush() }
    displayLayer.enqueue(sample)
  }

  private func surfaceCopy(_ source: CVPixelBuffer) -> CVPixelBuffer? {
    let image = CIImage(cvPixelBuffer: source)
    let scale: CGFloat = 0.5
    let size = CGSize(
      width: (image.extent.width * scale).rounded(.down),
      height: (image.extent.height * scale).rounded(.down)
    )
    guard size.width >= 2, size.height >= 2 else { return nil }
    if pool == nil || size != poolSize {
      let attrs: [String: Any] = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: Int(size.width),
        kCVPixelBufferHeightKey as String: Int(size.height),
        kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
      ]
      var created: CVPixelBufferPool?
      CVPixelBufferPoolCreate(kCFAllocatorDefault, nil, attrs as CFDictionary, &created)
      pool = created
      poolSize = size
    }
    guard let pool else { return nil }
    var out: CVPixelBuffer?
    guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &out) == kCVReturnSuccess, let out else {
      return nil
    }
    ciContext.render(image.transformed(by: CGAffineTransform(scaleX: scale, y: scale)), to: out)
    return out
  }
}
