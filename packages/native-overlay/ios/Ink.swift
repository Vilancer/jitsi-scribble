// Stroke model, per-tool rendering and shape outlines, shared by the floating
// pen's ink layer and the picture-in-picture window. Kept in step with the
// Android Ink.kt and with packages/protocol/src/render + src/shapes.
import UIKit

/// The tool/colour/size picked in the ring. `shape` is non-nil while a shape
/// (line, arrow, rect, ellipse) is selected instead of a freehand tool.
struct InkStyle: Equatable {
  var tool = "pen"
  var color = UIColor(red: 1, green: 0.27, blue: 0.23, alpha: 1)
  var width: CGFloat = 6
  var shape: String?

  static func == (a: InkStyle, b: InkStyle) -> Bool {
    a.tool == b.tool && a.width == b.width && a.shape == b.shape && a.color.scribbleHex == b.color.scribbleHex
  }
}

struct FadeTiming {
  var holdMs: Double = 2000
  var fadeMs: Double = 500
  var staleMs: Double = 1500
}

struct ToolRecipe {
  enum Texture { case none, grain, wax }
  let widthScale: CGFloat
  let opacity: CGFloat
  let casing: Bool
  let roundCap: Bool
  let texture: Texture

  static let pen = ToolRecipe(widthScale: 1, opacity: 1, casing: true, roundCap: true, texture: .none)
  static let all: [String: ToolRecipe] = [
    "pen": pen,
    "marker": ToolRecipe(widthScale: 3, opacity: 0.45, casing: false, roundCap: false, texture: .none),
    "pencil": ToolRecipe(widthScale: 0.75, opacity: 0.9, casing: false, roundCap: true, texture: .grain),
    "crayon": ToolRecipe(widthScale: 2, opacity: 0.85, casing: false, roundCap: true, texture: .wax),
  ]

  static func of(_ tool: String?) -> ToolRecipe { tool.flatMap { all[$0] } ?? pen }
}

func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

/// One stroke, local or remote. Points are normalized to the surface it is
/// drawn on (u = x / width, v = y / height).
final class InkStroke {
  static let maxPoints = 256

  let key: String
  let local: Bool
  var color: UIColor
  var width: CGFloat
  var tool: String
  let createdAt: Double
  var lastMoveAt: Double
  var endedAt: Double?
  var kind = "stroke"
  var points: [CGPoint] = []

  init(key: String, local: Bool, color: UIColor, width: CGFloat, tool: String, now: Double) {
    self.key = key
    self.local = local
    self.color = color
    self.width = width
    self.tool = tool
    createdAt = now
    lastMoveAt = now
  }

  func add(_ p: CGPoint, now: Double) {
    points.append(p)
    lastMoveAt = now
    if points.count > Self.maxPoints { points.removeFirst(points.count - Self.maxPoints) }
  }

  func replace(_ pts: [CGPoint], now: Double) {
    points = pts
    lastMoveAt = now
  }

  /// Same curve as computePhaseAndAlpha in protocol/core: 1 while live or
  /// holding, a linear fade, then 0 (dead).
  func alpha(_ now: Double, _ t: FadeTiming) -> CGFloat {
    let end: Double
    if let endedAt { end = endedAt }
    else if now - lastMoveAt >= t.staleMs { end = lastMoveAt + t.staleMs }
    else { return 1 }
    let elapsed = now - end
    if elapsed < t.holdMs { return 1 }
    if elapsed < t.holdMs + t.fadeMs { return CGFloat(1 - (elapsed - t.holdMs) / t.fadeMs) }
    return 0
  }
}

/// Draws strokes with the per-tool recipes.
enum InkPainter {
  /// `scale` shrinks widths for a surface drawn smaller than the screen.
  static func draw(_ ctx: CGContext, _ s: InkStroke, alpha a: CGFloat, size: CGSize, scale: CGFloat = 1) {
    guard a > 0, !s.points.isEmpty else { return }
    let recipe = ToolRecipe.of(s.tool)
    let core = max(1, s.width * recipe.widthScale * scale)
    ctx.saveGState()
    defer { ctx.restoreGState() }
    ctx.setLineJoin(.round)

    if s.kind == "tap" {
      let c = CGPoint(x: s.points[0].x * size.width, y: s.points[0].y * size.height)
      let grow = min(1, CGFloat(nowMs() - s.createdAt) / 250)
      let r = max(6, 44 * scale * (0.4 + 0.6 * grow))
      let ring = CGPath(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2), transform: nil)
      stroke(ctx, ring, UIColor.black.withAlphaComponent(0.55 * a), core + 2.5 * scale, round: true)
      stroke(ctx, ring, s.color.withAlphaComponent(a), core, round: true)
      return
    }

    let path = smoothPath(s.points, size: size, longSegment: 20 * scale)
    if recipe.casing {
      stroke(ctx, path, UIColor.black.withAlphaComponent(0.55 * a), core + 2.5 * scale, round: recipe.roundCap)
    }
    switch recipe.texture {
    case .none:
      stroke(ctx, path, s.color.withAlphaComponent(recipe.opacity * a), core, round: recipe.roundCap)
    case .grain, .wax:
      // Textured tools: stroke as a mask, then fill it with a speckled tile.
      ctx.saveGState()
      ctx.addPath(path)
      ctx.setLineWidth(core)
      ctx.setLineCap(recipe.roundCap ? .round : .butt)
      ctx.replacePathWithStrokedPath()
      ctx.clip()
      ctx.setAlpha(recipe.opacity * a)
      if let tile = Texture.tile(s.color, recipe.texture) {
        ctx.setFillColor(UIColor(patternImage: tile).cgColor)
      } else {
        ctx.setFillColor(s.color.cgColor)
      }
      ctx.fill(path.boundingBoxOfPath.insetBy(dx: -core, dy: -core))
      ctx.restoreGState()
    }
  }

  private static func stroke(_ ctx: CGContext, _ path: CGPath, _ color: UIColor, _ width: CGFloat, round: Bool) {
    ctx.addPath(path)
    ctx.setLineCap(round ? .round : .butt)
    ctx.setLineWidth(width)
    ctx.setStrokeColor(color.cgColor)
    ctx.strokePath()
  }

  /// Smooth freehand ink, but keep hard corners (arrow heads, rectangle
  /// corners) sharp, like InkPainter.buildPath on Android.
  static func smoothPath(_ pts: [CGPoint], size: CGSize, longSegment: CGFloat) -> CGPath {
    let p = CGMutablePath()
    func at(_ i: Int) -> CGPoint { CGPoint(x: pts[i].x * size.width, y: pts[i].y * size.height) }
    p.move(to: at(0))
    let n = pts.count
    if n == 1 {
      p.addLine(to: CGPoint(x: at(0).x + 0.1, y: at(0).y))
      return p
    }
    if n > 2 {
      for i in 1..<(n - 1) {
        let a = at(i), prev = at(i - 1), next = at(i + 1)
        let ax = a.x - prev.x, ay = a.y - prev.y
        let bx = next.x - a.x, by = next.y - a.y
        let la = hypot(ax, ay), lb = hypot(bx, by)
        var turn: CGFloat = 0
        if la > 0 && lb > 0 {
          turn = acos(max(-1, min(1, (ax * bx + ay * by) / (la * lb)))) * 180 / .pi
        }
        if turn > 50 || la > longSegment || lb > longSegment {
          p.addLine(to: a)
        } else {
          p.addQuadCurve(to: CGPoint(x: (a.x + next.x) / 2, y: (a.y + next.y) / 2), control: a)
        }
      }
    }
    p.addLine(to: at(n - 1))
    return p
  }
}

/// Speckled tiles for pencil (grain) and crayon (wax), generated once per
/// colour with a fixed seed so the texture doesn't shimmer frame to frame.
enum Texture {
  private static var cache: [String: UIImage] = [:]

  static func tile(_ color: UIColor, _ kind: ToolRecipe.Texture) -> UIImage? {
    let key = "\(color.scribbleHex)-\(kind)"
    if let hit = cache[key] { return hit }
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    color.getRed(&r, green: &g, blue: &b, alpha: &a)
    let size = 64
    let block = kind == .wax ? 2 : 1
    var seed: UInt64 = kind == .wax ? 15838 : 7919
    func rnd() -> CGFloat {
      seed = seed &* 6364136223846793005 &+ 1442695040888963407
      return CGFloat((seed >> 33) % 10000) / 10000
    }
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let img = UIGraphicsImageRenderer(size: CGSize(width: size, height: size), format: format).image { ctx in
      for y in stride(from: 0, to: size, by: block) {
        for x in stride(from: 0, to: size, by: block) {
          let alpha: CGFloat
          if kind == .grain { alpha = (150 + rnd() * 105) / 255 }
          else { alpha = rnd() < 0.18 ? (40 + rnd() * 60) / 255 : (190 + rnd() * 65) / 255 }
          ctx.cgContext.setFillColor(UIColor(red: r, green: g, blue: b, alpha: alpha).cgColor)
          ctx.cgContext.fill(CGRect(x: x, y: y, width: block, height: block))
        }
      }
    }
    cache[key] = img
    return img
  }
}

/// Shape outlines in pixel space; kept in step with packages/protocol/src/shapes.
enum Shapes {
  static func points(_ shape: String, _ a: CGPoint, _ b: CGPoint) -> [CGPoint] {
    switch shape {
    case "arrow":
      let dx = b.x - a.x, dy = b.y - a.y
      let len = hypot(dx, dy)
      if len < 1 { return [a, b] }
      let head = min(max(len * 0.25, 14), 44)
      let angle = atan2(dy, dx)
      let barb = 28 * CGFloat.pi / 180
      func tip(_ sign: CGFloat) -> CGPoint {
        CGPoint(x: b.x - head * cos(angle - sign * barb), y: b.y - head * sin(angle - sign * barb))
      }
      return [a, b, tip(1), b, tip(-1)]
    case "rect":
      return [a, CGPoint(x: b.x, y: a.y), b, CGPoint(x: a.x, y: b.y), a]
    case "ellipse":
      let c = CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
      let rx = abs(b.x - a.x) / 2, ry = abs(b.y - a.y) / 2
      return (0...36).map { i in
        let t = CGFloat(i) / 36 * .pi * 2
        return CGPoint(x: c.x + rx * cos(t), y: c.y + ry * sin(t))
      }
    default:
      return [a, b]
    }
  }
}

extension UIColor {
  /// "#RRGGBB" or "#RRGGBBAA".
  convenience init?(scribbleHex: String?) {
    guard var hex = scribbleHex?.trimmingCharacters(in: .whitespaces), hex.hasPrefix("#") else { return nil }
    hex.removeFirst()
    guard hex.count == 6 || hex.count == 8, let value = UInt64(hex, radix: 16) else { return nil }
    let hasAlpha = hex.count == 8
    let r = CGFloat((value >> (hasAlpha ? 24 : 16)) & 0xFF) / 255
    let g = CGFloat((value >> (hasAlpha ? 16 : 8)) & 0xFF) / 255
    let b = CGFloat((value >> (hasAlpha ? 8 : 0)) & 0xFF) / 255
    let a = hasAlpha ? CGFloat(value & 0xFF) / 255 : 1
    self.init(red: r, green: g, blue: b, alpha: a)
  }

  /// "#RRGGBB" (alpha dropped), the wire format's colour form.
  var scribbleHex: String {
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    getRed(&r, green: &g, blue: &b, alpha: &a)
    func c(_ v: CGFloat) -> Int { Int((max(0, min(1, v)) * 255).rounded()) }
    return String(format: "#%02X%02X%02X", c(r), c(g), c(b))
  }
}
