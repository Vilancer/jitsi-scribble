// The floating pen on iOS: the same bubble, tool ring and ink layer as the
// Android overlay, in a window above this app's own UI. iOS lets no app draw
// over OTHER apps, so it is in-app only: it floats over every screen of the
// app and goes away with it.
//
// Interaction (same as Android):
//  - tap the bubble: draw mode on, the tool ring fans out around it
//  - start drawing anywhere: the ring tucks away, the bubble stays "on"
//  - tap the bubble again: ring comes back; with it open, a tap ends draw
//    mode (so does the ✓ button)
//  - left alone with draw mode off, the bubble fades and tucks half off the
//    screen edge; any touch brings it back
//  - drag it onto the ✕ at the bottom to turn the pen off
import UIKit

struct PenOptions {
  var timing = FadeTiming()
  var swatches = RadialMenuView.defaultSwatches
  var widths = RadialMenuView.defaultWidths
  var grid: [[UIColor]] = []
  var style = InkStyle()
}

/// Touches go to the app except where the pen has something to touch.
final class PenWindow: UIWindow {
  weak var controller: PenController?

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard let hit = super.hitTest(point, with: event), let c = controller else { return nil }
    if hit === rootViewController?.view { return nil }
    if hit === c.ink && !c.drawing { return nil }
    return hit
  }
}

final class PenController: NSObject, BubbleViewListener, RadialMenuListener, PenInkListener {
  static let eventStroke = "onLocalStroke"
  static let eventStyle = "onStyleChange"
  static let eventAction = "onAction"
  static let eventState = "onStateChange"

  private static let tuckAfter = 4.0
  private static let pickCloseDelay = 0.18
  private static let autoOff = 6.0
  /// How far the bubble's centre must be from the top/bottom edge for the
  /// ring (outer radius + button) to fit.
  private static let ringClearance: CGFloat = 205

  private let emit: (String, [String: Any?]) -> Void
  private var window: PenWindow?
  private(set) var ink: PenInkView?
  private var ring: RadialMenuView?
  private var bubble: BubbleView?
  private var dismiss: DismissTargetView?
  private var options = PenOptions()
  private var style = InkStyle()
  private var menuOpen = false
  private var tucked = false
  private var passThrough = false
  private var tuckWork: DispatchWorkItem?
  private var autoOffWork: DispatchWorkItem?
  private var remoteQuietWork: DispatchWorkItem?
  private var boundsObserver: NSKeyValueObservation?

  private(set) var drawing = false
  var showing: Bool { window != nil }

  init(emit: @escaping (String, [String: Any?]) -> Void) {
    self.emit = emit
  }

  // MARK: lifecycle

  func show(_ opts: PenOptions) -> Bool {
    options = opts
    style = opts.style
    if showing {
      applyOptions()
      emitState()
      return true
    }
    guard let scene = Self.activeScene() else { return false }
    let w = PenWindow(windowScene: scene)
    w.controller = self
    w.windowLevel = .alert + 1
    w.backgroundColor = .clear
    let root = UIViewController()
    root.view.backgroundColor = .clear
    w.rootViewController = root
    w.isHidden = false
    let bounds = w.bounds

    let ink = PenInkView(frame: bounds)
    ink.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    ink.listener = self
    root.view.addSubview(ink)

    let menuSize = CGSize(width: min(420, bounds.width), height: 430)
    let ring = RadialMenuView(frame: CGRect(origin: .zero, size: menuSize))
    ring.listener = self
    ring.isHidden = true
    root.view.addSubview(ring)

    let dt = DismissTargetView(frame: .zero)
    dt.center = CGPoint(x: bounds.midX, y: bounds.maxY - 72 - DismissTargetView.size / 2)
    dt.isHidden = true
    root.view.addSubview(dt)

    let bb = BubbleView(frame: CGRect(
      x: bounds.width - BubbleView.size - 8,
      y: bounds.height * 0.4,
      width: BubbleView.size,
      height: BubbleView.size
    ))
    bb.listener = self
    root.view.addSubview(bb)

    window = w
    self.ink = ink
    self.ring = ring
    dismiss = dt
    bubble = bb
    drawing = false
    menuOpen = false
    tucked = false
    applyOptions()
    // A rotation moves everything on screen, so old ink would point at the
    // wrong thing: drop it, close the ring, put the bubble back on an edge.
    boundsObserver = root.view.observe(\.bounds, options: [.old, .new]) { [weak self] _, change in
      guard let self, change.oldValue?.size != change.newValue?.size else { return }
      DispatchQueue.main.async {
        self.ink?.clear("all")
        self.setMenuOpen(false, animate: false)
        self.dismiss?.center = CGPoint(x: (self.window?.bounds.midX ?? 0), y: (self.window?.bounds.maxY ?? 0) - 72 - DismissTargetView.size / 2)
        self.snapBubble(animate: false)
      }
    }
    scheduleTuck()
    emitState()
    return true
  }

  func hide() {
    guard showing else { return }
    boundsObserver = nil
    for work in [tuckWork, autoOffWork, remoteQuietWork] { work?.cancel() }
    window?.isHidden = true
    window?.rootViewController = nil
    window = nil
    ink = nil
    ring = nil
    bubble = nil
    dismiss = nil
    drawing = false
    menuOpen = false
    emitState()
  }

  func setDrawing(_ on: Bool) {
    guard showing else { return }
    if drawing != on {
      drawing = on
      bubble?.active = on
      emitState()
    }
    if on {
      untuck()
      openRing()
    } else {
      autoOffWork?.cancel()
      setMenuOpen(false)
      scheduleTuck()
    }
  }

  func setStyle(_ next: InkStyle) {
    style = next
    ink?.style = next
    ring?.style = next
    bubble?.tint = next.color
  }

  // MARK: remote ink, forwarded from JS

  func remoteBegin(key: String, u: CGFloat, v: CGFloat, color: UIColor, width: CGFloat, tool: String) {
    ink?.remoteBegin(key: key, u: u, v: v, color: color, width: width, tool: tool)
    remoteActivity()
  }

  func remoteAppend(key: String, points: [Double]) {
    ink?.remoteAppend(key: key, points: points)
    remoteActivity()
  }

  func remoteEnd(key: String, kind: String) { ink?.remoteEnd(key: key, kind: kind) }
  func clear(_ scope: String) { ink?.clear(scope) }
  func clearSender(_ from: String) { ink?.clearSender(from) }

  private func remoteActivity() {
    // Someone is pointing at something: bring the bubble out and ring it.
    untuck()
    bubble?.remoteActive = true
    remoteQuietWork?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.bubble?.remoteActive = false }
    remoteQuietWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + (options.timing.holdMs + options.timing.fadeMs + 1000) / 1000, execute: work)
    scheduleTuck()
  }

  // MARK: ink listener

  func inkBegan(id: String, at p: CGPoint, style s: InkStyle, frame: CGSize) {
    emit(Self.eventStroke, styleBody(s).merging([
      "phase": "begin", "id": id, "points": [Double(p.x), Double(p.y)],
      "frameW": Double(frame.width), "frameH": Double(frame.height),
    ]) { $1 })
  }

  func inkAppended(id: String, points: [CGFloat]) {
    emit(Self.eventStroke, ["phase": "append", "id": id, "points": points.map(Double.init)])
  }

  func inkEnded(id: String, kind: String) {
    emit(Self.eventStroke, ["phase": "end", "id": id, "kind": kind])
    armAutoOff()
  }

  func inkShape(id: String, points: [CGFloat], style s: InkStyle, frame: CGSize) {
    armAutoOff()
    emit(Self.eventStroke, styleBody(s).merging([
      "phase": "shape", "id": id, "points": points.map(Double.init),
      "frameW": Double(frame.width), "frameH": Double(frame.height),
    ]) { $1 })
  }

  /// The user started drawing straight on the ink layer: put the ring away.
  func inkTouchStarted() {
    autoOffWork?.cancel()
    if menuOpen && !passThrough {
      ink?.dismissTapOnly = true
      setMenuOpen(false)
    }
  }

  // MARK: ring listener

  func ringPicked(_ next: InkStyle) {
    setStyle(next)
    emit(Self.eventStyle, styleBody(next).merging(["shape": next.shape as Any]) { $1 })
    // Pick and draw: fold the ring away so the very next touch draws.
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.pickCloseDelay) { [weak self] in
      if self?.menuOpen == true { self?.setMenuOpen(false) }
    }
  }

  /// Trash: everything fades out, my ink is removed on the other side too.
  func ringClear() {
    ink?.fadeOutAll()
    emit(Self.eventAction, ["action": "clear"])
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.pickCloseDelay) { [weak self] in
      if self?.menuOpen == true { self?.setMenuOpen(false) }
    }
  }

  func ringDone() { setDrawing(false) }

  /// A touch on the ring that missed every button: the user is starting to
  /// draw. Hide the ring and hand the gesture to the ink layer.
  func ringPassThrough(_ phase: UITouch.Phase, _ touch: UITouch, _ event: UIEvent?) {
    if phase == .began {
      passThrough = true
      ring?.alpha = 0
      ink?.dismissTapOnly = true
    }
    ink?.touch(phase, touch, event)
    if phase == .ended || phase == .cancelled {
      passThrough = false
      setMenuOpen(false, animate: false)
    }
  }

  // MARK: bubble listener

  /// One tap always shows the tools; with them open, a tap stops drawing.
  func bubbleTapped() {
    if tucked { untuck() }
    if !drawing { setDrawing(true) }
    else if !menuOpen { openRing() }
    else { setDrawing(false) }
  }

  func bubbleDragged(dx: CGFloat, dy: CGFloat) {
    guard let b = bubble else { return }
    untuck()
    setMenuOpen(false)
    b.center = CGPoint(x: b.center.x + dx, y: b.center.y + dy)
    dismiss?.isHidden = false
    dismiss?.hot = overDismiss()
  }

  func bubbleDragEnded() {
    let drop = overDismiss()
    dismiss?.hot = false
    dismiss?.isHidden = true
    if drop {
      // Dropped on the ✕: the pen turns off; the app's switch follows.
      hide()
      emit(Self.eventAction, ["action": "dismiss"])
      return
    }
    snapBubble(animate: true)
  }

  private func overDismiss() -> Bool {
    guard let b = bubble, let d = dismiss else { return false }
    return hypot(b.center.x - d.center.x, b.center.y - d.center.y) < 80
  }

  // MARK: ring

  private func setMenuOpen(_ open: Bool, animate: Bool = true) {
    guard let m = ring else { return }
    if open == menuOpen && (open || m.isHidden) { return }
    menuOpen = open
    if open {
      positionMenu()
      m.alpha = 1
      m.isHidden = false
      m.isUserInteractionEnabled = true
      m.animateIn()
      autoOffWork?.cancel()
    } else {
      m.isUserInteractionEnabled = false
      let hideNow = { [weak self] in if self?.menuOpen == false { m.isHidden = true } }
      if animate && m.alpha > 0 { m.animateOut(hideNow) } else { hideNow() }
      armAutoOff()
    }
  }

  /// Opens the ring, first sliding the bubble away from the top/bottom edge
  /// if the ring wouldn't fit there.
  private func openRing() {
    guard let b = bubble, let bounds = window?.bounds else { return }
    let safe = Self.ringClearance
    let target = max(safe, min(max(safe, bounds.height - safe), b.center.y))
    if abs(target - b.center.y) < 1 {
      setMenuOpen(true)
      return
    }
    animateBubble(to: CGPoint(x: b.center.x, y: target))
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.24) { [weak self] in
      if self?.drawing == true { self?.setMenuOpen(true) }
    }
  }

  /// Puts the ring beside the bubble, opening toward the middle of the screen.
  private func positionMenu() {
    guard let m = ring, let b = bubble, let bounds = window?.bounds else { return }
    let overlap: CGFloat = 30
    let onRight = b.center.x > bounds.midX
    var f = m.frame
    f.origin.x = onRight ? b.center.x + overlap - f.width : b.center.x - overlap
    f.origin.y = max(0, min(max(0, bounds.height - f.height), b.center.y - f.height / 2))
    m.frame = f
    m.direction = onRight ? -1 : 1
    m.anchor = CGPoint(x: b.center.x - f.minX, y: b.center.y - f.minY)
    m.visibleLeft = max(0, -f.minX)
    m.visibleRight = min(f.width, bounds.width - f.minX)
  }

  // MARK: bubble placement

  private func armAutoOff() {
    autoOffWork?.cancel()
    guard drawing && !menuOpen else { return }
    let work = DispatchWorkItem { [weak self] in
      guard let self, self.drawing, !self.menuOpen else { return }
      self.setDrawing(false)
    }
    autoOffWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.autoOff, execute: work)
  }

  private func scheduleTuck() {
    tuckWork?.cancel()
    guard !drawing else { return }
    let work = DispatchWorkItem { [weak self] in self?.tuck() }
    tuckWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.tuckAfter, execute: work)
  }

  /// Fade the bubble and slide it half off its edge.
  private func tuck() {
    guard !drawing, !tucked, let b = bubble, let bounds = window?.bounds else { return }
    tucked = true
    let x: CGFloat = b.center.x < bounds.midX ? 0 : bounds.width
    animateBubble(to: CGPoint(x: x, y: b.center.y))
    UIView.animate(withDuration: 0.22) { b.alpha = 0.5 }
  }

  private func untuck() {
    guard tucked, let b = bubble else { return }
    tucked = false
    UIView.animate(withDuration: 0.16) { b.alpha = 1 }
    snapBubble(animate: true)
    scheduleTuck()
  }

  private func snapBubble(animate: Bool) {
    guard let b = bubble, let w = window else { return }
    let bounds = w.bounds
    let insets = w.safeAreaInsets
    let half = BubbleView.size / 2
    let x = b.center.x < bounds.midX ? 8 + half : bounds.width - 8 - half
    let y = max(insets.top + 8 + half, min(bounds.height - insets.bottom - 96 - half, b.center.y))
    let target = CGPoint(x: x, y: y)
    if animate { animateBubble(to: target) } else { b.center = target }
  }

  private func animateBubble(to p: CGPoint) {
    guard let b = bubble else { return }
    UIView.animate(withDuration: 0.32, delay: 0, usingSpringWithDamping: 0.75, initialSpringVelocity: 0, options: [.allowUserInteraction]) {
      b.center = p
    }
  }

  // MARK: helpers

  private func applyOptions() {
    ink?.timing = options.timing
    ink?.style = style
    ring?.swatches = options.swatches
    ring?.widths = options.widths
    ring?.grid = options.grid
    ring?.style = style
    bubble?.tint = style.color
  }

  private func emitState() {
    emit(Self.eventState, ["visible": showing, "drawing": drawing])
  }

  private func styleBody(_ s: InkStyle) -> [String: Any?] {
    ["color": s.color.scribbleHex, "width": Double(s.width), "tool": s.tool]
  }

  private static func activeScene() -> UIWindowScene? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    return scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
  }
}
