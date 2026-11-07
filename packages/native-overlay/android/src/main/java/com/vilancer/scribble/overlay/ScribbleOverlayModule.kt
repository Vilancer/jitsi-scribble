package com.vilancer.scribble.overlay

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class StyleRecord : Record {
  @Field var tool: String = "pen"
  @Field var color: String = "#FF453A"
  @Field var width: Double = 6.0
  @Field var shape: String? = null
}

class ShowOptionsRecord : Record {
  @Field var hideInkFromCapture: Boolean = false
  @Field var hideControlsFromCapture: Boolean = false
  @Field var holdMs: Double = 2000.0
  @Field var fadeMs: Double = 500.0
  @Field var staleMs: Double = 1500.0
  @Field var swatches: List<String>? = null
  @Field var widths: List<Double>? = null
  @Field var grid: List<List<String>>? = null
  @Field var style: StyleRecord? = null
}

/**
 * JS surface of the Android overlay. Every view operation hops to the main
 * thread; events go back to JS via sendEvent (safe from any thread).
 */
class ScribbleOverlayModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var controller: OverlayController? = null

  private fun ctl(): OverlayController? {
    val existing = controller
    if (existing != null) return existing
    val ctx = appContext.reactContext?.applicationContext ?: return null
    return OverlayController(ctx) { name, body -> sendEvent(name, body) }.also { controller = it }
  }

  private fun onMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
  }

  override fun definition() = ModuleDefinition {
    Name("ScribbleOverlay")

    Events(
      OverlayController.EVENT_STROKE,
      OverlayController.EVENT_STYLE,
      OverlayController.EVENT_ACTION,
      OverlayController.EVENT_STATE,
    )

    Function("canDrawOverlays") {
      ctl()?.canDraw() ?: false
    }

    /** Opens the system "Display over other apps" screen for this app. The
     * user comes back on their own; JS re-checks canDrawOverlays() then. */
    Function("requestPermission") {
      val ctx = appContext.reactContext ?: return@Function false
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${ctx.packageName}"),
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        ctx.startActivity(intent)
        true
      } catch (_: Exception) {
        false
      }
    }

    AsyncFunction("show") { opts: ShowOptionsRecord ->
      val c = ctl() ?: return@AsyncFunction false
      if (!c.canDraw()) return@AsyncFunction false
      val options = OverlayOptions(
        hideInkFromCapture = opts.hideInkFromCapture,
        hideControlsFromCapture = opts.hideControlsFromCapture,
        timing = FadeTiming(opts.holdMs.toLong(), opts.fadeMs.toLong(), opts.staleMs.toLong()),
        swatches = opts.swatches?.mapNotNull(::parseColor)?.takeIf { it.isNotEmpty() } ?: RadialMenuView.DEFAULT_SWATCHES,
        widths = opts.widths?.map { it.toFloat() }?.takeIf { it.isNotEmpty() } ?: RadialMenuView.DEFAULT_WIDTHS,
        grid = opts.grid?.map { row -> row.mapNotNull(::parseColor) } ?: emptyList(),
        style = opts.style?.let(::toStyle) ?: InkStyle(),
      )
      c.show(options)
    }.runOnQueue(Queues.MAIN)

    Function("hide") {
      onMain { controller?.hide() }
    }

    Function("isShowing") {
      controller?.showing ?: false
    }

    Function("setDrawing") { on: Boolean ->
      onMain { controller?.setDrawing(on) }
    }

    Function("setStyle") { style: StyleRecord ->
      val s = toStyle(style)
      onMain { controller?.setStyle(s) }
    }

    Function("remoteBegin") { key: String, u: Double, v: Double, color: String?, width: Double?, tool: String? ->
      val c = color?.let(::parseColor) ?: 0xFF0A84FF.toInt()
      onMain { controller?.remoteBegin(key, u.toFloat(), v.toFloat(), c, (width ?: 4.0).toFloat(), tool ?: "pen") }
    }

    Function("remoteAppend") { key: String, points: List<Double> ->
      val arr = FloatArray(points.size) { points[it].toFloat() }
      onMain { controller?.remoteAppend(key, arr) }
    }

    Function("remoteEnd") { key: String, kind: String? ->
      onMain { controller?.remoteEnd(key, kind ?: "stroke") }
    }

    Function("clear") { scope: String ->
      onMain { controller?.clear(scope) }
    }

    OnDestroy {
      val c = controller
      controller = null
      main.post { c?.hide() }
    }
  }

  private fun toStyle(r: StyleRecord) = InkStyle(
    tool = r.tool,
    color = parseColor(r.color) ?: 0xFFFF453A.toInt(),
    widthDp = r.width.toFloat(),
    shape = r.shape,
  )

  private fun parseColor(s: String): Int? = try {
    Color.parseColor(s)
  } catch (_: Exception) {
    null
  }
}
