// Hand-drawn vector glyphs for the floating pen's bubble and tool ring, so
// the overlay needs no images or fonts. A port of the Android Icons.kt; sizes
// are in points.
import UIKit

enum PenIcons {
  static let body = UIColor(red: 0xF2 / 255, green: 0xF2 / 255, blue: 0xF7 / 255, alpha: 1)
  static let bodyShade = UIColor(red: 0xC7 / 255, green: 0xC7 / 255, blue: 0xCC / 255, alpha: 1)
  static let wood = UIColor(red: 0xE9 / 255, green: 0xC7 / 255, blue: 0x9A / 255, alpha: 1)
  static let panel = UIColor(red: 0x1C / 255, green: 0x1C / 255, blue: 0x1E / 255, alpha: 0.95)

  private static func fill(_ c: CGContext, _ path: CGPath, _ color: UIColor) {
    c.addPath(path)
    c.setFillColor(color.cgColor)
    c.fillPath()
  }

  private static func line(_ c: CGContext, _ path: CGPath, _ color: UIColor, _ width: CGFloat) {
    c.addPath(path)
    c.setStrokeColor(color.cgColor)
    c.setLineWidth(width)
    c.setLineCap(.round)
    c.setLineJoin(.round)
    c.strokePath()
  }

  private static func poly(_ pts: [CGPoint]) -> CGPath {
    let p = CGMutablePath()
    p.addLines(between: pts)
    p.closeSubpath()
    return p
  }

  /// A drawing tool standing upright, tip at the top, like the iOS Markup
  /// tool tray. (cx, bottom) is the base centre; the tip is tinted.
  static func tool(_ c: CGContext, _ tool: String, cx: CGFloat, bottom: CGFloat, tint: UIColor) {
    let w: CGFloat = 22
    let top = bottom - 46
    switch tool {
    case "pen":
      toolBody(c, cx, top, bottom, w * 0.78)
      fill(c, poly([CGPoint(x: cx - w * 0.39, y: top), CGPoint(x: cx, y: top - 16), CGPoint(x: cx + w * 0.39, y: top)]), bodyShade)
      fill(c, poly([CGPoint(x: cx - 3, y: top - 10), CGPoint(x: cx, y: top - 16), CGPoint(x: cx + 3, y: top - 10)]), tint)
      band(c, cx, top + 8, w * 0.78, tint)
    case "marker":
      toolBody(c, cx, top, bottom, w)
      fill(c, poly([
        CGPoint(x: cx - w * 0.36, y: top), CGPoint(x: cx - w * 0.3, y: top - 10),
        CGPoint(x: cx + w * 0.3, y: top - 15), CGPoint(x: cx + w * 0.36, y: top),
      ]), tint)
      band(c, cx, top + 8, w, tint)
    case "pencil":
      toolBody(c, cx, top, bottom, w * 0.82)
      fill(c, poly([CGPoint(x: cx - w * 0.41, y: top), CGPoint(x: cx, y: top - 18), CGPoint(x: cx + w * 0.41, y: top)]), wood)
      fill(c, poly([CGPoint(x: cx - 3.5, y: top - 11), CGPoint(x: cx, y: top - 18), CGPoint(x: cx + 3.5, y: top - 11)]), tint)
    default: // crayon
      toolBody(c, cx, top, bottom, w)
      fill(c, CGPath(roundedRect: CGRect(x: cx - w / 2 + 1.5, y: top + 4, width: w - 3, height: 18), cornerWidth: 2, cornerHeight: 2, transform: nil), tint)
      let p = CGMutablePath()
      p.move(to: CGPoint(x: cx - w * 0.42, y: top + 1))
      p.addQuadCurve(to: CGPoint(x: cx, y: top - 14), control: CGPoint(x: cx - w * 0.4, y: top - 14))
      p.addQuadCurve(to: CGPoint(x: cx + w * 0.42, y: top + 1), control: CGPoint(x: cx + w * 0.4, y: top - 14))
      p.closeSubpath()
      fill(c, p, tint)
    }
  }

  private static func toolBody(_ c: CGContext, _ cx: CGFloat, _ top: CGFloat, _ bottom: CGFloat, _ w: CGFloat) {
    fill(c, CGPath(roundedRect: CGRect(x: cx - w / 2, y: top, width: w, height: bottom + 8 - top), cornerWidth: 3, cornerHeight: 3, transform: nil), body)
    fill(c, CGPath(rect: CGRect(x: cx + w / 2 - 4, y: top, width: 4, height: bottom + 8 - top), transform: nil), bodyShade)
  }

  private static func band(_ c: CGContext, _ cx: CGFloat, _ y: CGFloat, _ w: CGFloat, _ tint: UIColor) {
    fill(c, CGPath(rect: CGRect(x: cx - w / 2, y: y, width: w, height: 4), transform: nil), tint)
  }

  /// Outline glyph for a shape, centred in a `size` box.
  static func shape(_ c: CGContext, _ shape: String, cx: CGFloat, cy: CGFloat, size: CGFloat, color: UIColor) {
    let h = size / 2
    let p = CGMutablePath()
    switch shape {
    case "line":
      p.move(to: CGPoint(x: cx - h, y: cy + h))
      p.addLine(to: CGPoint(x: cx + h, y: cy - h))
    case "arrow":
      p.move(to: CGPoint(x: cx - h, y: cy + h))
      p.addLine(to: CGPoint(x: cx + h, y: cy - h))
      p.move(to: CGPoint(x: cx + h - size * 0.45, y: cy - h))
      p.addLine(to: CGPoint(x: cx + h, y: cy - h))
      p.addLine(to: CGPoint(x: cx + h, y: cy - h + size * 0.45))
    case "rect":
      p.addRoundedRect(in: CGRect(x: cx - h, y: cy - h * 0.75, width: size, height: h * 1.5), cornerWidth: 2, cornerHeight: 2)
    default:
      p.addEllipse(in: CGRect(x: cx - h, y: cy - h, width: size, height: size))
    }
    line(c, p, color, 2)
  }

  static func swatch(_ c: CGContext, cx: CGFloat, cy: CGFloat, r: CGFloat, color: UIColor, selected: Bool) {
    if selected {
      line(c, CGPath(ellipseIn: CGRect(x: cx - r - 3.5, y: cy - r - 3.5, width: (r + 3.5) * 2, height: (r + 3.5) * 2), transform: nil), .white, 2)
    }
    fill(c, CGPath(ellipseIn: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2), transform: nil), color)
    if color.scribbleHex == "#000000" {
      line(c, CGPath(ellipseIn: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2), transform: nil), UIColor.white.withAlphaComponent(0.33), 1)
    }
  }

  /// The "more colours" swatch: a hue wheel.
  static func spectrum(_ c: CGContext, cx: CGFloat, cy: CGFloat, r: CGFloat, selected: Bool) {
    if selected {
      line(c, CGPath(ellipseIn: CGRect(x: cx - r - 3.5, y: cy - r - 3.5, width: (r + 3.5) * 2, height: (r + 3.5) * 2), transform: nil), .white, 2)
    }
    let segments = 36
    for i in 0..<segments {
      let a0 = CGFloat(i) / CGFloat(segments) * .pi * 2
      let a1 = CGFloat(i + 1) / CGFloat(segments) * .pi * 2 + 0.02
      let p = CGMutablePath()
      p.move(to: CGPoint(x: cx, y: cy))
      p.addArc(center: CGPoint(x: cx, y: cy), radius: r, startAngle: a0, endAngle: a1, clockwise: false)
      p.closeSubpath()
      fill(c, p, UIColor(hue: CGFloat(i) / CGFloat(segments), saturation: 0.85, brightness: 1, alpha: 1))
    }
  }

  static func trash(_ c: CGContext, cx: CGFloat, cy: CGFloat, scale k: CGFloat, color: UIColor) {
    let p = CGMutablePath()
    p.move(to: CGPoint(x: cx - 8 * k, y: cy - 7 * k)); p.addLine(to: CGPoint(x: cx + 8 * k, y: cy - 7 * k))
    p.move(to: CGPoint(x: cx - 3 * k, y: cy - 10 * k)); p.addLine(to: CGPoint(x: cx + 3 * k, y: cy - 10 * k))
    p.move(to: CGPoint(x: cx - 6.5 * k, y: cy - 7 * k))
    p.addLine(to: CGPoint(x: cx - 5.5 * k, y: cy + 9 * k))
    p.addLine(to: CGPoint(x: cx + 5.5 * k, y: cy + 9 * k))
    p.addLine(to: CGPoint(x: cx + 6.5 * k, y: cy - 7 * k))
    p.move(to: CGPoint(x: cx - 2 * k, y: cy - 3 * k)); p.addLine(to: CGPoint(x: cx - 2 * k, y: cy + 5 * k))
    p.move(to: CGPoint(x: cx + 2 * k, y: cy - 3 * k)); p.addLine(to: CGPoint(x: cx + 2 * k, y: cy + 5 * k))
    line(c, p, color, 2)
  }

  static func check(_ c: CGContext, cx: CGFloat, cy: CGFloat) {
    let p = CGMutablePath()
    p.move(to: CGPoint(x: cx - 7, y: cy))
    p.addLine(to: CGPoint(x: cx - 2, y: cy + 5.5))
    p.addLine(to: CGPoint(x: cx + 8, y: cy - 6))
    line(c, p, .white, 2.4)
  }

  static func squiggle(_ c: CGContext, cx: CGFloat, cy: CGFloat) {
    let p = CGMutablePath()
    p.move(to: CGPoint(x: cx - 9, y: cy + 4))
    p.addCurve(to: CGPoint(x: cx + 9, y: cy - 5), control1: CGPoint(x: cx - 4, y: cy - 10), control2: CGPoint(x: cx + 1, y: cy + 10))
    line(c, p, .white, 2)
  }

  static func cross(_ c: CGContext, cx: CGFloat, cy: CGFloat, k: CGFloat, width: CGFloat) {
    let p = CGMutablePath()
    p.move(to: CGPoint(x: cx - k, y: cy - k)); p.addLine(to: CGPoint(x: cx + k, y: cy + k))
    p.move(to: CGPoint(x: cx + k, y: cy - k)); p.addLine(to: CGPoint(x: cx - k, y: cy + k))
    line(c, p, .white, width)
  }

  /// The bubble's glyph: a pen tip drawing (like "pencil.tip.crop.circle").
  static func bubbleGlyph(_ c: CGContext, cx: CGFloat, cy: CGFloat, color: UIColor, tint: UIColor) {
    c.saveGState()
    c.translateBy(x: cx, y: cy)
    c.rotate(by: .pi / 4)
    c.translateBy(x: -cx, y: -cy)
    fill(c, CGPath(roundedRect: CGRect(x: cx - 4.5, y: cy - 13, width: 9, height: 19), cornerWidth: 1.5, cornerHeight: 1.5, transform: nil), color)
    fill(c, poly([CGPoint(x: cx - 4.5, y: cy + 6), CGPoint(x: cx, y: cy + 14), CGPoint(x: cx + 4.5, y: cy + 6)]), color)
    fill(c, poly([CGPoint(x: cx - 1.8, y: cy + 10.8), CGPoint(x: cx, y: cy + 14), CGPoint(x: cx + 1.8, y: cy + 10.8)]), tint)
    c.restoreGState()
  }
}

/// Easing used by the ring (Android's Decelerate / Overshoot interpolators).
enum Ease {
  static func decelerate(_ t: CGFloat) -> CGFloat { 1 - (1 - t) * (1 - t) }
  static func overshoot(_ t: CGFloat, tension: CGFloat = 1.6) -> CGFloat {
    let u = t - 1
    return u * u * ((tension + 1) * u + tension) + 1
  }
}

/// A 0→1 (or from→to) value driven by CADisplayLink, for the ring's
/// fan-out animations.
final class Tween {
  private var link: CADisplayLink?
  private var start = 0.0
  private var duration = 0.0
  private var from: CGFloat = 0
  private var to: CGFloat = 1
  private var onUpdate: ((CGFloat) -> Void)?
  private var onDone: (() -> Void)?

  func run(from: CGFloat, to: CGFloat, ms: Double, update: @escaping (CGFloat) -> Void, done: (() -> Void)? = nil) {
    cancel()
    self.from = from
    self.to = to
    duration = ms / 1000
    start = CACurrentMediaTime()
    onUpdate = update
    onDone = done
    let l = CADisplayLink(target: self, selector: #selector(step))
    l.add(to: .main, forMode: .common)
    link = l
  }

  func cancel() {
    link?.invalidate()
    link = nil
  }

  @objc private func step() {
    let t = CGFloat(min(1, (CACurrentMediaTime() - start) / max(0.001, duration)))
    onUpdate?(from + (to - from) * Ease.decelerate(t))
    if t >= 1 {
      cancel()
      let done = onDone
      onDone = nil
      done?()
    }
  }
}
