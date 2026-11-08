// The other side's ink, drawn over a picture of this phone's own screen in the
// picture-in-picture window. Remote-only: a PiP window takes no touches.
import UIKit

final class AwayInkView: UIView {
  static let maxStrokes = 16

  var timing = FadeTiming()
  /// How much smaller than the real screen this view is drawn, so a 6 pt
  /// stroke keeps its proportion in a small window.
  var widthScale: CGFloat = 1

  private var strokes: [String: InkStroke] = [:]
  private var order: [String] = []
  private var ticker: Timer?

  override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = false
    backgroundColor = .clear
    isUserInteractionEnabled = false
    contentMode = .redraw
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  func begin(key: String, u: CGFloat, v: CGFloat, color: String?, width: Double?, tool: String?) {
    let now = nowMs()
    let s = InkStroke(
      key: key,
      local: false,
      color: UIColor(scribbleHex: color) ?? UIColor(red: 0.04, green: 0.52, blue: 1, alpha: 1),
      width: CGFloat(width ?? 4),
      tool: tool ?? "pen",
      now: now
    )
    s.add(CGPoint(x: u, y: v), now: now)
    if strokes[key] == nil { order.append(key) }
    strokes[key] = s
    while order.count > Self.maxStrokes { strokes.removeValue(forKey: order.removeFirst()) }
    kick()
  }

  func append(key: String, points: [Double]) {
    guard let s = strokes[key] else { return }
    let now = nowMs()
    var i = 0
    while i + 1 < points.count {
      s.add(CGPoint(x: points[i], y: points[i + 1]), now: now)
      i += 2
    }
    kick()
  }

  func end(key: String, kind: String?) {
    guard let s = strokes[key], s.endedAt == nil else { return }
    s.endedAt = nowMs()
    if let kind { s.kind = kind }
    kick()
  }

  func clear() {
    strokes.removeAll()
    order.removeAll()
    kick()
  }

  /// One sender's Clear: every stroke keyed "<from> <id>".
  func clearSender(_ from: String) {
    let prefix = "\(from) "
    for key in order where key.hasPrefix(prefix) { strokes.removeValue(forKey: key) }
    order.removeAll { $0.hasPrefix(prefix) }
    kick()
  }

  // A Timer, not CADisplayLink: this view lives in the PiP window while the
  // app is in the background, where display links can stop ticking.
  private func kick() {
    setNeedsDisplay()
    if ticker != nil { return }
    let t = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in self?.tick() }
    RunLoop.main.add(t, forMode: .common)
    ticker = t
  }

  private func tick() {
    let now = nowMs()
    for key in order where (strokes[key]?.alpha(now, timing) ?? 0) <= 0 {
      strokes.removeValue(forKey: key)
    }
    order.removeAll { strokes[$0] == nil }
    setNeedsDisplay()
    if strokes.isEmpty {
      ticker?.invalidate()
      ticker = nil
    }
  }

  override func draw(_ rect: CGRect) {
    guard let ctx = UIGraphicsGetCurrentContext() else { return }
    let now = nowMs()
    for key in order {
      guard let s = strokes[key] else { continue }
      InkPainter.draw(ctx, s, alpha: s.alpha(now, timing), size: bounds.size, scale: widthScale)
    }
  }
}
