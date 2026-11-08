// JS surface of the floating pen on iOS: the same module name, functions and
// events as the Android ScribbleOverlayModule, so OutOfAppBridge and
// useOutOfAppOverlay() drive both. iOS needs no permission (the pen only
// floats over this app), so canDrawOverlays is always true.
import ExpoModulesCore
import UIKit

struct StyleRecord: Record {
  @Field var tool: String = "pen"
  @Field var color: String = "#FF453A"
  @Field var width: Double = 6
  @Field var shape: String?
}

struct ShowOptionsRecord: Record {
  @Field var hideInkFromCapture: Bool = false
  @Field var hideControlsFromCapture: Bool = false
  @Field var holdMs: Double = 2000
  @Field var fadeMs: Double = 500
  @Field var staleMs: Double = 1500
  @Field var swatches: [String]?
  @Field var widths: [Double]?
  @Field var grid: [[String]]?
  @Field var style: StyleRecord?
}

public final class ScribbleOverlayModule: Module {
  private var controller: PenController?

  private func ctl() -> PenController {
    if let controller { return controller }
    let c = PenController { [weak self] name, body in
      self?.sendEvent(name, body.compactMapValues { $0 })
    }
    controller = c
    return c
  }

  private func onMain(_ block: @escaping () -> Void) {
    if Thread.isMainThread { block() } else { DispatchQueue.main.async(execute: block) }
  }

  public func definition() -> ModuleDefinition {
    Name("ScribbleOverlay")

    Events(PenController.eventStroke, PenController.eventStyle, PenController.eventAction, PenController.eventState)

    Function("canDrawOverlays") { true }

    Function("requestPermission") { true }

    AsyncFunction("show") { (opts: ShowOptionsRecord) -> Bool in
      var o = PenOptions()
      o.timing = FadeTiming(holdMs: opts.holdMs, fadeMs: opts.fadeMs, staleMs: opts.staleMs)
      if let s = opts.swatches?.compactMap({ UIColor(scribbleHex: $0) }), !s.isEmpty { o.swatches = s }
      if let w = opts.widths?.map({ CGFloat($0) }), !w.isEmpty { o.widths = w }
      o.grid = opts.grid?.map { $0.compactMap { UIColor(scribbleHex: $0) } } ?? []
      if let s = opts.style { o.style = Self.style(s) }
      return self.ctl().show(o)
    }.runOnQueue(.main)

    Function("hide") {
      self.onMain { self.controller?.hide() }
    }

    Function("isShowing") { () -> Bool in
      Thread.isMainThread ? (self.controller?.showing ?? false) : DispatchQueue.main.sync { self.controller?.showing ?? false }
    }

    Function("setDrawing") { (on: Bool) in
      self.onMain { self.controller?.setDrawing(on) }
    }

    Function("setStyle") { (style: StyleRecord) in
      let s = Self.style(style)
      self.onMain { self.controller?.setStyle(s) }
    }

    Function("remoteBegin") { (key: String, u: Double, v: Double, color: String?, width: Double?, tool: String?) in
      let c = UIColor(scribbleHex: color) ?? UIColor(red: 0.04, green: 0.52, blue: 1, alpha: 1)
      self.onMain {
        self.controller?.remoteBegin(key: key, u: CGFloat(u), v: CGFloat(v), color: c, width: CGFloat(width ?? 4), tool: tool ?? "pen")
      }
    }

    Function("remoteAppend") { (key: String, points: [Double]) in
      self.onMain { self.controller?.remoteAppend(key: key, points: points) }
    }

    Function("remoteEnd") { (key: String, kind: String?) in
      self.onMain { self.controller?.remoteEnd(key: key, kind: kind ?? "stroke") }
    }

    Function("clear") { (scope: String) in
      self.onMain { self.controller?.clear(scope) }
    }

    Function("clearSender") { (from: String) in
      self.onMain { self.controller?.clearSender(from) }
    }

    OnDestroy {
      let c = self.controller
      self.controller = nil
      DispatchQueue.main.async { c?.hide() }
    }
  }

  private static func style(_ r: StyleRecord) -> InkStyle {
    InkStyle(
      tool: r.tool,
      color: UIColor(scribbleHex: r.color) ?? UIColor(red: 1, green: 0.27, blue: 0.23, alpha: 1),
      width: CGFloat(r.width),
      shape: r.shape
    )
  }
}
