// The floating pen's views, ported from the Android overlay: the bubble, the
// "drop here to close" target, and the radial tool ring.
import UIKit

// MARK: - Bubble

protocol BubbleViewListener: AnyObject {
  func bubbleTapped()
  func bubbleDragged(dx: CGFloat, dy: CGFloat)
  func bubbleDragEnded()
}

/// The floating button. Drag it anywhere (it snaps to the nearest side when
/// released); tap it to open or close the drawing tools.
final class BubbleView: UIView {
  static let size: CGFloat = 56
  weak var listener: BubbleViewListener?

  var active = false { didSet { setNeedsDisplay() } }
  var tint: UIColor = .systemRed { didSet { setNeedsDisplay() } }
  /// Remote ink is on screen: ring the bubble so a user with the tools
  /// closed still notices someone is pointing at something.
  var remoteActive = false { didSet { if oldValue != remoteActive { setNeedsDisplay() } } }

  private var down = CGPoint.zero
  private var last = CGPoint.zero
  private var dragging = false
  private let haptic = UIImpactFeedbackGenerator(style: .light)

  override init(frame: CGRect) {
    super.init(frame: CGRect(x: frame.minX, y: frame.minY, width: Self.size, height: Self.size))
    isOpaque = false
    backgroundColor = .clear
    isMultipleTouchEnabled = false
    isAccessibilityElement = true
    accessibilityLabel = "Drawing tools"
    accessibilityTraits = .button
    layer.shadowColor = UIColor.black.cgColor
    layer.shadowOpacity = 0.3
    layer.shadowRadius = 4
    layer.shadowOffset = CGSize(width: 0, height: 2)
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  override func draw(_ rect: CGRect) {
    guard let c = UIGraphicsGetCurrentContext() else { return }
    let cx = bounds.midX, cy = bounds.midY
    let r = bounds.width / 2 - 3
    let circle = CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2)
    c.setFillColor((active ? UIColor.white : PenIcons.panel).cgColor)
    c.fillEllipse(in: circle)
    let ringed = remoteActive && !active
    c.setStrokeColor((ringed ? UIColor(red: 0.04, green: 0.52, blue: 1, alpha: 1) : UIColor.white.withAlphaComponent(0.2)).cgColor)
    c.setLineWidth(ringed ? 3 : 1)
    c.strokeEllipse(in: circle)
    PenIcons.bubbleGlyph(c, cx: cx, cy: cy, color: active ? PenIcons.panel : .white, tint: tint)
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let t = touches.first else { return }
    UIView.animate(withDuration: 0.09) { self.transform = CGAffineTransform(scaleX: 0.88, y: 0.88) }
    down = t.location(in: window)
    last = down
    dragging = false
    haptic.prepare()
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let t = touches.first else { return }
    let p = t.location(in: window)
    if !dragging && hypot(p.x - down.x, p.y - down.y) > 8 { dragging = true }
    guard dragging else { return }
    if transform.a < 1.05 {
      UIView.animate(withDuration: 0.12) { self.transform = CGAffineTransform(scaleX: 1.08, y: 1.08) }
    }
    listener?.bubbleDragged(dx: p.x - last.x, dy: p.y - last.y)
    last = p
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    UIView.animate(withDuration: 0.22, delay: 0, usingSpringWithDamping: 0.45, initialSpringVelocity: 0) {
      self.transform = .identity
    }
    if dragging {
      listener?.bubbleDragEnded()
    } else {
      haptic.impactOccurred()
      listener?.bubbleTapped()
    }
    dragging = false
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    UIView.animate(withDuration: 0.15) { self.transform = .identity }
    if dragging { listener?.bubbleDragEnded() }
    dragging = false
  }
}

// MARK: - Dismiss target

/// The "drop here to close" circle shown at the bottom while the bubble is
/// dragged. Grows and turns red while the bubble is over it.
final class DismissTargetView: UIView {
  static let size: CGFloat = 96
  private let haptic = UISelectionFeedbackGenerator()

  var hot = false {
    didSet {
      guard hot != oldValue else { return }
      if hot { haptic.selectionChanged() }
      UIView.animate(withDuration: 0.12) {
        self.transform = self.hot ? CGAffineTransform(scaleX: 1.2, y: 1.2) : .identity
      }
      setNeedsDisplay()
    }
  }

  override init(frame: CGRect) {
    super.init(frame: CGRect(x: 0, y: 0, width: Self.size, height: Self.size))
    isOpaque = false
    backgroundColor = .clear
    isUserInteractionEnabled = false
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  override func draw(_ rect: CGRect) {
    guard let c = UIGraphicsGetCurrentContext() else { return }
    let cx = bounds.midX, cy = bounds.midY, r: CGFloat = 30
    c.setFillColor((hot ? UIColor(red: 1, green: 0.27, blue: 0.23, alpha: 1) : PenIcons.panel.withAlphaComponent(0.8)).cgColor)
    c.fillEllipse(in: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2))
    PenIcons.cross(c, cx: cx, cy: cy, k: 9, width: 3)
  }
}

// MARK: - Radial tool ring

protocol RadialMenuListener: AnyObject {
  func ringPicked(_ style: InkStyle)
  func ringClear()
  func ringDone()
  /// A touch that hit no button: the user is starting to draw.
  func ringPassThrough(_ phase: UITouch.Phase, _ touch: UITouch, _ event: UIEvent?)
}

/// The drawing tools as a ring of round buttons fanned out around the bubble:
///   inner ring: tool · shape · colour · size · clear · done
///   outer ring: the options of whichever inner button is open
final class RadialMenuView: UIView {
  static let tools = ["pen", "marker", "pencil", "crayon"]
  static let shapes = ["line", "arrow", "rect", "ellipse"]
  static let defaultSwatches: [UIColor] = ["#FFFFFF", "#000000", "#0A84FF", "#30D158", "#FFD60A", "#FF453A"]
    .compactMap { UIColor(scribbleHex: $0) }
  static let defaultWidths: [CGFloat] = [2, 3, 4, 6, 9, 12, 18]

  weak var listener: RadialMenuListener?
  var style = InkStyle() { didSet { setNeedsDisplay() } }
  var swatches = RadialMenuView.defaultSwatches
  var widths = RadialMenuView.defaultWidths
  var grid: [[UIColor]] = []

  /// The bubble's centre in this view's coordinates, the way the ring opens
  /// (+1 right, -1 left), and the part of the view that is on screen.
  var anchor = CGPoint.zero
  var direction: CGFloat = -1 { didSet { setNeedsDisplay() } }
  var visibleLeft: CGFloat = 0
  var visibleRight: CGFloat = .greatestFiniteMagnitude

  private let btnR: CGFloat = 21
  private let innerR: CGFloat = 112
  private let outerR: CGFloat = 178

  private enum Section { case tool, shape, colour, size }
  private var open: Section?
  private var gridOpen = false

  private struct Hit { let center: CGPoint; let radius: CGFloat; let action: () -> Void }
  private var hits: [Hit] = []
  private var forwarding = false
  private var pressedIndex = -1

  private var progress: CGFloat = 1
  private var subProgress: CGFloat = 1
  private let tween = Tween()
  private let subTween = Tween()
  private let haptic = UIImpactFeedbackGenerator(style: .light)

  override init(frame: CGRect) {
    super.init(frame: frame)
    isOpaque = false
    backgroundColor = .clear
    isMultipleTouchEnabled = false
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  /// Close any sub-ring and fan the buttons out.
  func animateIn() {
    open = nil
    gridOpen = false
    tween.run(from: 0, to: 1, ms: 320) { [weak self] v in
      self?.progress = v
      self?.setNeedsDisplay()
    }
  }

  /// Fold the buttons back into the bubble, then call `done`.
  func animateOut(_ done: @escaping () -> Void) {
    tween.run(from: progress, to: 0, ms: 160, update: { [weak self] v in
      self?.progress = v
      self?.setNeedsDisplay()
    }, done: done)
  }

  private func animateSub() {
    subTween.run(from: 0, to: 1, ms: 260) { [weak self] v in
      self?.subProgress = v
      self?.setNeedsDisplay()
    }
  }

  /// Per-button progress, staggered by index, with a little overshoot.
  private func staggered(_ p: CGFloat, _ i: Int, _ n: Int) -> CGFloat {
    let span: CGFloat = 0.45
    let start = n <= 1 ? 0 : (1 - span) * CGFloat(i) / CGFloat(n - 1)
    return Ease.overshoot(max(0, min(1, (p - start) / span)))
  }

  private func angle(_ i: Int, _ n: Int, spread: CGFloat, centre: CGFloat) -> CGFloat {
    let start = centre - spread / 2
    let step = n <= 1 ? 0 : spread / CGFloat(n - 1)
    return (start + step * CGFloat(i)) * .pi / 180
  }

  /// Point on a ring. Angle 0 = straight out from the bubble's edge.
  private func at(_ radius: CGFloat, _ a: CGFloat, _ k: CGFloat = 1) -> CGPoint {
    CGPoint(x: anchor.x + direction * radius * k * cos(a), y: anchor.y + radius * k * sin(a))
  }

  private func scaled(_ c: CGContext, _ p: CGPoint, _ k: CGFloat, _ block: () -> Void) {
    guard k > 0.01 else { return }
    c.saveGState()
    c.setAlpha(max(0, min(1, k)))
    c.beginTransparencyLayer(auxiliaryInfo: nil)
    c.translateBy(x: p.x, y: p.y)
    c.scaleBy(x: k, y: k)
    c.translateBy(x: -p.x, y: -p.y)
    block()
    c.endTransparencyLayer()
    c.restoreGState()
  }

  override func draw(_ rect: CGRect) {
    guard let c = UIGraphicsGetCurrentContext() else { return }
    hits.removeAll()
    let inner: [Section?] = [.tool, .shape, .colour, .size, nil, nil]
    let n = inner.count
    var openAngle: CGFloat = 0
    for i in 0..<n {
      let a = angle(i, n, spread: 125, centre: 0)
      let k = staggered(progress, i, n)
      let p = at(innerR, a, k)
      let section = inner[i]
      let selected = section != nil && section == open
      scaled(c, p, k) {
        button(c, p, selected)
        switch i {
        case 0: toolGlyph(c, p, style.tool)
        case 1:
          if let s = style.shape { PenIcons.shape(c, s, cx: p.x, cy: p.y, size: 16, color: .white) }
          else { PenIcons.squiggle(c, cx: p.x, cy: p.y) }
        case 2: PenIcons.swatch(c, cx: p.x, cy: p.y, r: 13, color: style.color, selected: false)
        case 3: sizeDot(c, p, style.width)
        case 4: PenIcons.trash(c, cx: p.x, cy: p.y, scale: 0.9, color: .white)
        default: PenIcons.check(c, cx: p.x, cy: p.y)
        }
      }
      if selected { openAngle = a }
      hits.append(Hit(center: p, radius: btnR + 4) { [weak self] in
        guard let self else { return }
        switch i {
        case 4: self.listener?.ringClear()
        case 5: self.listener?.ringDone()
        default:
          self.open = self.open == section ? nil : section
          self.gridOpen = false
          if self.open != nil { self.animateSub() }
        }
      })
    }

    if gridOpen {
      drawGrid(c)
      return
    }
    guard progress >= 1, let section = open else { return }
    let options: Int
    switch section {
    case .tool: options = Self.tools.count
    case .shape: options = Self.shapes.count + 1
    case .colour: options = swatches.count + 1
    case .size: options = widths.count
    }
    let spread = min(24 * CGFloat(options - 1), 150)
    let centreDeg = max(-78 + spread / 2, min(78 - spread / 2, openAngle * 180 / .pi))
    for k in 0..<options {
      let a = angle(k, options, spread: spread, centre: centreDeg)
      let sp = staggered(subProgress, k, options)
      if sp < 0.05 { continue }
      let p = at(innerR + (outerR - innerR) * sp, a)
      switch section {
      case .tool:
        let t = Self.tools[k]
        button(c, p, style.shape == nil && style.tool == t)
        toolGlyph(c, p, t)
        hits.append(Hit(center: p, radius: btnR + 2) { [weak self] in
          guard let self else { return }
          var s = self.style; s.tool = t; s.shape = nil; self.pick(s)
        })
      case .shape:
        let s = k == 0 ? nil : Self.shapes[k - 1]
        button(c, p, style.shape == s)
        if let s { PenIcons.shape(c, s, cx: p.x, cy: p.y, size: 16, color: .white) }
        else { PenIcons.squiggle(c, cx: p.x, cy: p.y) }
        hits.append(Hit(center: p, radius: btnR + 2) { [weak self] in
          guard let self else { return }
          var next = self.style; next.shape = s; self.pick(next)
        })
      case .colour:
        if k < swatches.count {
          let col = swatches[k]
          PenIcons.swatch(c, cx: p.x, cy: p.y, r: 16, color: col, selected: col.scribbleHex == style.color.scribbleHex)
          hits.append(Hit(center: p, radius: btnR) { [weak self] in
            guard let self else { return }
            var next = self.style; next.color = col; self.pick(next)
          })
        } else {
          PenIcons.spectrum(c, cx: p.x, cy: p.y, r: 16, selected: gridOpen)
          hits.append(Hit(center: p, radius: btnR) { [weak self] in self?.gridOpen = true })
        }
      case .size:
        let w = widths[k]
        button(c, p, style.width == w)
        let r = min(1.5 + w * 0.75, btnR - 4)
        c.setFillColor(style.color.cgColor)
        c.fillEllipse(in: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2))
        hits.append(Hit(center: p, radius: btnR + 2) { [weak self] in
          guard let self else { return }
          var next = self.style; next.width = w; self.pick(next)
        })
      }
    }
  }

  private func pick(_ next: InkStyle) {
    style = next
    open = nil
    listener?.ringPicked(next)
  }

  private func drawGrid(_ c: CGContext) {
    guard let first = grid.first, !first.isEmpty else { return }
    let cell: CGFloat = 22
    let w = cell * CGFloat(first.count)
    let h = cell * CGFloat(grid.count)
    // Beside the ring when it fits, otherwise slid back on screen.
    let wanted = direction < 0 ? anchor.x - innerR - btnR - 12 - w : anchor.x + innerR + btnR + 12
    let minLeft = visibleLeft + 8
    let maxLeft = visibleRight - w - 8
    let left = maxLeft >= minLeft ? max(minLeft, min(maxLeft, wanted)) : minLeft
    let top = max(4, min(bounds.height - h - 4, anchor.y - h / 2))
    c.setFillColor(PenIcons.panel.cgColor)
    c.addPath(CGPath(roundedRect: CGRect(x: left - 6, y: top - 6, width: w + 12, height: h + 12), cornerWidth: 14, cornerHeight: 14, transform: nil))
    c.fillPath()
    for (ri, row) in grid.enumerated() {
      for (ci, col) in row.enumerated() {
        let x = left + CGFloat(ci) * cell
        let y = top + CGFloat(ri) * cell
        let r = CGRect(x: x + 1, y: y + 1, width: cell - 2, height: cell - 2)
        c.addPath(CGPath(roundedRect: r, cornerWidth: 3, cornerHeight: 3, transform: nil))
        c.setFillColor(col.cgColor)
        c.fillPath()
        if col.scribbleHex == style.color.scribbleHex {
          c.addPath(CGPath(roundedRect: r, cornerWidth: 3, cornerHeight: 3, transform: nil))
          c.setStrokeColor(UIColor.white.cgColor)
          c.setLineWidth(2)
          c.strokePath()
        }
        hits.append(Hit(center: CGPoint(x: x + cell / 2, y: y + cell / 2), radius: cell / 2) { [weak self] in
          guard let self else { return }
          var next = self.style; next.color = col
          self.pick(next)
          self.gridOpen = false
        })
      }
    }
  }

  private func button(_ c: CGContext, _ p: CGPoint, _ selected: Bool) {
    c.setFillColor(UIColor.black.withAlphaComponent(0.25).cgColor)
    c.fillEllipse(in: CGRect(x: p.x - btnR - 0.5, y: p.y - btnR + 1, width: (btnR + 0.5) * 2, height: (btnR + 0.5) * 2))
    let r = CGRect(x: p.x - btnR, y: p.y - btnR, width: btnR * 2, height: btnR * 2)
    c.setFillColor(PenIcons.panel.cgColor)
    c.fillEllipse(in: r)
    c.setStrokeColor((selected ? UIColor.white : UIColor.white.withAlphaComponent(0.2)).cgColor)
    c.setLineWidth(selected ? 2 : 1)
    c.strokeEllipse(in: r)
  }

  private func toolGlyph(_ c: CGContext, _ p: CGPoint, _ tool: String) {
    c.saveGState()
    c.addEllipse(in: CGRect(x: p.x - btnR + 2, y: p.y - btnR + 2, width: (btnR - 2) * 2, height: (btnR - 2) * 2))
    c.clip()
    c.translateBy(x: p.x, y: p.y)
    c.scaleBy(x: 0.62, y: 0.62)
    c.translateBy(x: -p.x, y: -p.y)
    PenIcons.tool(c, tool, cx: p.x, bottom: p.y + 30, tint: style.color)
    c.restoreGState()
  }

  private func sizeDot(_ c: CGContext, _ p: CGPoint, _ w: CGFloat) {
    let r = min(0.6 + w * 0.55, btnR - 5)
    c.setFillColor(UIColor.white.cgColor)
    c.fillEllipse(in: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2))
  }

  private func hitIndex(_ p: CGPoint) -> Int {
    hits.lastIndex { hypot(p.x - $0.center.x, p.y - $0.center.y) <= $0.radius } ?? -1
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let t = touches.first else { return }
    pressedIndex = hitIndex(t.location(in: self))
    forwarding = pressedIndex < 0
    if forwarding { listener?.ringPassThrough(.began, t, event) } else { haptic.prepare() }
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let t = touches.first, forwarding else { return }
    listener?.ringPassThrough(.moved, t, event)
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let t = touches.first else { return }
    if forwarding {
      forwarding = false
      listener?.ringPassThrough(.ended, t, event)
      return
    }
    let idx = hitIndex(t.location(in: self))
    if idx >= 0 && idx == pressedIndex {
      haptic.impactOccurred()
      hits[idx].action()
      setNeedsDisplay()
    }
    pressedIndex = -1
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let t = touches.first else { return }
    if forwarding {
      forwarding = false
      listener?.ringPassThrough(.cancelled, t, event)
    }
    pressedIndex = -1
  }
}
