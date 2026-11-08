// The floating pen's full-screen ink layer, ported from Android's
// InkCanvasView. Renders every stroke (remote ones pushed from JS, local ones
// drawn here) and, while draw mode is on, turns touches into strokes or
// shapes. Coordinates are normalized to the whole screen, because that is
// what a screen share captures: (0,0) top-left, (1,1) bottom-right.
import UIKit

protocol PenInkListener: AnyObject {
  func inkBegan(id: String, at: CGPoint, style: InkStyle, frame: CGSize)
  func inkAppended(id: String, points: [CGFloat])
  func inkEnded(id: String, kind: String)
  /// A finished shape, sent as one stroke.
  func inkShape(id: String, points: [CGFloat], style: InkStyle, frame: CGSize)
  /// A finger went down on the ink layer (draw mode).
  func inkTouchStarted()
}

final class PenInkView: UIView {
  private static let maxStrokes = 24
  private static let tapSlop: CGFloat = 10
  private static let tapMaxMs: Double = 300
  private static let flushMs: Double = 32

  weak var listener: PenInkListener?
  var style = InkStyle()
  var timing = FadeTiming()
  /// Set by the controller for the current gesture when the tool ring was
  /// open: a quick tap then only closes the ring instead of drawing a
  /// "look here" circle. A drag still draws.
  var dismissTapOnly = false

  private var strokes: [String: InkStroke] = [:]
  private var order: [String] = []
  private var counter = 0
  private var link: CADisplayLink?

  // The gesture in progress.
  private var activeId: String?
  private var activeShape: String?
  private var down = CGPoint.zero
  private var downAt = 0.0
  private var maxTravel: CGFloat = 0
  private var pending: [CGFloat] = []
  // "Stroke started" is held back until the touch is known to be a drag, so
  // a tap that only closes the tool ring never reaches the other side.
  private var beganRemote = false
  private var downStyle = InkStyle()
  private var flushScheduled = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = false
    backgroundColor = .clear
    isMultipleTouchEnabled = false
    contentMode = .redraw
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  private var size: CGSize { CGSize(width: max(1, bounds.width), height: max(1, bounds.height)) }

  // MARK: remote strokes (from JS)

  func remoteBegin(key: String, u: CGFloat, v: CGFloat, color: UIColor, width: CGFloat, tool: String) {
    guard strokes[key] == nil else { return }
    enforceCaps()
    let now = nowMs()
    let s = InkStroke(key: key, local: false, color: color, width: width, tool: tool, now: now)
    s.add(CGPoint(x: u, y: v), now: now)
    insert(s)
  }

  func remoteAppend(key: String, points: [Double]) {
    let now = nowMs()
    let s: InkStroke
    if let existing = strokes[key] {
      s = existing
    } else {
      enforceCaps()
      s = InkStroke(key: key, local: false, color: UIColor(red: 0.04, green: 0.52, blue: 1, alpha: 1), width: 4, tool: "pen", now: now)
      insert(s)
    }
    var i = 0
    while i + 1 < points.count {
      s.add(CGPoint(x: points[i], y: points[i + 1]), now: now)
      i += 2
    }
    kick()
  }

  func remoteEnd(key: String, kind: String) {
    guard let s = strokes[key] else { return }
    if s.endedAt == nil {
      s.endedAt = nowMs()
      s.kind = kind
    }
    kick()
  }

  /// Local scope commands only: "all", "local" or "remote".
  func clear(_ scope: String) {
    for key in order {
      guard let s = strokes[key] else { continue }
      let drop = scope == "all" || (scope == "local" && s.local) || (scope == "remote" && !s.local)
      if drop { strokes.removeValue(forKey: key) }
    }
    order.removeAll { strokes[$0] == nil }
    setNeedsDisplay()
  }

  /// One remote participant's strokes (keys are "<from> <id>").
  func clearSender(_ from: String) {
    let prefix = "\(from) "
    for key in order where key.hasPrefix(prefix) && strokes[key]?.local == false {
      strokes.removeValue(forKey: key)
    }
    order.removeAll { strokes[$0] == nil }
    setNeedsDisplay()
  }

  /// Trash: everything on screen fades out quickly instead of blinking away.
  func fadeOutAll() {
    let fadeStart = nowMs() - timing.holdMs
    for s in strokes.values where s.endedAt == nil || s.endedAt! > fadeStart { s.endedAt = fadeStart }
    kick()
  }

  private func insert(_ s: InkStroke) {
    strokes[s.key] = s
    order.append(s.key)
    kick()
  }

  private func enforceCaps() {
    while order.count >= Self.maxStrokes { strokes.removeValue(forKey: order.removeFirst()) }
  }

  // MARK: rendering

  override func draw(_ rect: CGRect) {
    guard let ctx = UIGraphicsGetCurrentContext() else { return }
    let now = nowMs()
    let active = activeId.map { "local \($0)" }
    for key in order {
      guard let s = strokes[key] else { continue }
      let a = s.alpha(now, timing)
      if a <= 0 && key != active {
        strokes.removeValue(forKey: key)
        continue
      }
      InkPainter.draw(ctx, s, alpha: a, size: size)
    }
    order.removeAll { strokes[$0] == nil }
  }

  private func kick() {
    setNeedsDisplay()
    guard link == nil else { return }
    let l = CADisplayLink(target: self, selector: #selector(frameTick))
    l.add(to: .main, forMode: .common)
    link = l
  }

  @objc private func frameTick() {
    setNeedsDisplay()
    if strokes.isEmpty {
      link?.invalidate()
      link = nil
    }
  }

  // MARK: local drawing (also fed by the ring when a touch misses its buttons)

  func touch(_ phase: UITouch.Phase, _ touch: UITouch, _ event: UIEvent?) {
    let now = nowMs()
    let p = touch.location(in: self)
    switch phase {
    case .began:
      listener?.inkTouchStarted()
      counter += 1
      let id = "ooa-\(String(Int(now), radix: 36))-\(counter)"
      activeId = id
      activeShape = style.shape
      down = p
      downAt = now
      maxTravel = 0
      enforceCaps()
      let s = InkStroke(key: "local \(id)", local: true, color: style.color, width: style.width, tool: style.tool, now: now)
      s.add(norm(p), now: now)
      insert(s)
      beganRemote = false
      pending.removeAll()
      downStyle = style
    case .moved:
      guard let id = activeId, let s = strokes["local \(id)"] else { return }
      maxTravel = max(maxTravel, hypot(p.x - down.x, p.y - down.y))
      if let shape = activeShape {
        s.replace(Shapes.points(shape, down, p).map(norm), now: now)
      } else {
        for c in event?.coalescedTouches(for: touch) ?? [touch] {
          addLocalPoint(s, c.location(in: self), now: now)
        }
        if !beganRemote && (maxTravel >= Self.tapSlop || now - downAt >= Self.tapMaxMs) { beginRemote(id) }
        if beganRemote { scheduleFlush() }
      }
      setNeedsDisplay()
    case .ended, .cancelled:
      guard let id = activeId else { return }
      let s = strokes["local \(id)"]
      let tap = maxTravel < Self.tapSlop && now - downAt < Self.tapMaxMs
      let dismissOnly = dismissTapOnly
      dismissTapOnly = false
      if activeShape == nil && tap && dismissOnly {
        // Just closing the tool ring: draw nothing, send nothing.
        activeId = nil
        pending.removeAll()
        if let s { strokes.removeValue(forKey: s.key) }
        order.removeAll { strokes[$0] == nil }
        setNeedsDisplay()
        return
      }
      if activeShape == nil {
        if !beganRemote { beginRemote(id) }
        flushPending()
      }
      activeId = nil
      guard let s else { return }
      if activeShape != nil {
        if maxTravel < 12 || phase == .cancelled {
          strokes.removeValue(forKey: s.key)
          order.removeAll { strokes[$0] == nil }
        } else {
          s.endedAt = now
          listener?.inkShape(id: id, points: s.points.flatMap { [$0.x, $0.y] }, style: style, frame: size)
        }
      } else {
        s.kind = tap ? "tap" : "stroke"
        s.endedAt = now
        listener?.inkEnded(id: id, kind: s.kind)
      }
      kick()
    default:
      break
    }
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    if let t = touches.first { touch(.began, t, event) }
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    if let t = touches.first { touch(.moved, t, event) }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    if let t = touches.first { touch(.ended, t, event) }
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    if let t = touches.first { touch(.cancelled, t, event) }
  }

  private func norm(_ p: CGPoint) -> CGPoint { CGPoint(x: p.x / size.width, y: p.y / size.height) }

  private func addLocalPoint(_ s: InkStroke, _ p: CGPoint, now: Double) {
    if let last = s.points.last, hypot(p.x - last.x * size.width, p.y - last.y * size.height) < 1.5 { return }
    let n = norm(p)
    s.add(n, now: now)
    pending.append(n.x)
    pending.append(n.y)
  }

  private func beginRemote(_ id: String) {
    beganRemote = true
    listener?.inkBegan(id: id, at: norm(down), style: downStyle, frame: size)
  }

  private func scheduleFlush() {
    guard !flushScheduled else { return }
    flushScheduled = true
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.flushMs / 1000) { [weak self] in self?.flushPending() }
  }

  private func flushPending() {
    flushScheduled = false
    guard beganRemote else { return } // keep buffering until the stroke is announced
    guard let id = activeId, !pending.isEmpty else {
      pending.removeAll()
      return
    }
    listener?.inkAppended(id: id, points: pending)
    pending.removeAll()
  }
}
