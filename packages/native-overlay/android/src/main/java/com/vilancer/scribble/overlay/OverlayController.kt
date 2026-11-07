package com.vilancer.scribble.overlay

import android.animation.ValueAnimator
import android.content.ComponentCallbacks
import android.content.Context
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.graphics.Point
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.animation.OvershootInterpolator
import kotlin.math.min

/** Everything JS can configure when showing the overlay. */
data class OverlayOptions(
  val hideInkFromCapture: Boolean = false,
  val hideControlsFromCapture: Boolean = false,
  val timing: FadeTiming = FadeTiming(),
  val swatches: List<Int> = RadialMenuView.DEFAULT_SWATCHES,
  val widths: List<Float> = RadialMenuView.DEFAULT_WIDTHS,
  val grid: List<List<Int>> = emptyList(),
  val style: InkStyle = InkStyle(),
)

/**
 * Owns the overlay windows (ink layer, tool ring, bubble) and their state.
 * Every method must run on the main thread; ScribbleOverlayModule hops
 * there before calling in.
 *
 * Interaction:
 *  - tap the bubble: draw mode on, tool ring fans out around the bubble
 *  - start drawing anywhere: the ring tucks away, the bubble stays "on"
 *  - tap the bubble again: ring comes back; with the ring open, a tap ends
 *    draw mode (so does the ✓ button)
 *  - left alone with draw mode off, the bubble fades and tucks half off
 *    the screen edge; any touch brings it back
 */
class OverlayController(
  private val app: Context,
  private val emit: (name: String, body: Map<String, Any?>) -> Unit,
) : InkCanvasView.Listener, RadialMenuView.Listener, BubbleView.Listener {

  private val wm = app.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  private val main = Handler(Looper.getMainLooper())
  private val d = app.resources.displayMetrics.density

  private var canvas: InkCanvasView? = null
  private var menu: RadialMenuView? = null
  private var bubble: BubbleView? = null
  private var dismiss: DismissTargetView? = null
  private var dismissParams: WindowManager.LayoutParams? = null
  private var canvasParams: WindowManager.LayoutParams? = null
  private var menuParams: WindowManager.LayoutParams? = null
  private var bubbleParams: WindowManager.LayoutParams? = null
  private var options = OverlayOptions()
  private var style = InkStyle()
  private var menuOpen = false
  private var tucked = false

  var drawing = false
    private set
  val showing: Boolean get() = bubble != null

  private val remoteQuiet = Runnable { bubble?.remoteActive = false }
  private val tuckRunnable = Runnable { tuck() }
  /** Drawing turns itself off after a quiet spell with the tools closed,
   * so touches go back to the apps without hunting for a button. */
  private val autoOff = Runnable { if (drawing && !menuOpen) setDrawing(false) }

  private fun armAutoOff() {
    main.removeCallbacks(autoOff)
    if (drawing && !menuOpen) main.postDelayed(autoOff, AUTO_OFF_MS)
  }

  private val configCallbacks = object : ComponentCallbacks {
    override fun onConfigurationChanged(newConfig: Configuration) {
      val size = displaySize()
      val c = canvas ?: return
      if (size.x != c.displayW || size.y != c.displayH) {
        c.displayW = size.x
        c.displayH = size.y
        // Ink is anchored to what's on screen; a rotation moves everything,
        // so old ink would point at the wrong thing. Drop it instantly.
        c.clear("all")
        setMenuOpen(false)
        snapBubble(animate = false)
      }
    }

    @Deprecated("Deprecated in Java")
    override fun onLowMemory() = Unit
  }

  fun canDraw(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(app)

  fun show(opts: OverlayOptions): Boolean {
    if (!canDraw()) return false
    options = opts
    style = opts.style.copy()
    if (showing) {
      applyOptions()
      emitState()
      return true
    }
    val size = displaySize()

    val ink = InkCanvasView(app, this).apply {
      displayW = size.x
      displayH = size.y
      timing = opts.timing
      style = this@OverlayController.style
    }
    val inkParams = baseParams(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT).apply {
      flags = flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
        fitInsetsTypes = 0
      }
      gravity = Gravity.TOP or Gravity.START
      title = "ScribbleInk"
    }

    val ring = RadialMenuView(app, this).apply {
      swatches = opts.swatches
      widths = opts.widths
      grid = opts.grid
      style = this@OverlayController.style
      visibility = View.GONE
    }
    val menuW = min((420f * d).toInt(), size.x)
    val menuH = (430f * d).toInt()
    val ringParams = baseParams(menuW, menuH).apply {
      flags = flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
      gravity = Gravity.TOP or Gravity.START
      title = "ScribbleTools"
    }

    val bb = BubbleView(app, this).apply { tint = style.color }
    val bbParams = baseParams(bb.sizePx, bb.sizePx).apply {
      flags = flags or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
      gravity = Gravity.TOP or Gravity.START
      x = size.x - bb.sizePx - (8f * d).toInt()
      y = (size.y * 0.4f).toInt()
      title = "ScribbleBubble"
    }

    val dt = DismissTargetView(app).apply { visibility = View.GONE }
    val dtParams = baseParams(dt.sizePx, dt.sizePx).apply {
      flags = flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
      gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
      y = (72f * d).toInt()
      title = "ScribbleDismiss"
    }

    try {
      wm.addView(ink, inkParams)
      wm.addView(ring, ringParams)
      wm.addView(dt, dtParams)
      wm.addView(bb, bbParams)
    } catch (e: Exception) {
      Log.w(TAG, "could not add overlay windows", e)
      safeRemove(ink)
      safeRemove(ring)
      safeRemove(dt)
      safeRemove(bb)
      return false
    }
    dismiss = dt
    dismissParams = dtParams
    canvas = ink
    menu = ring
    bubble = bb
    canvasParams = inkParams
    menuParams = ringParams
    bubbleParams = bbParams
    drawing = false
    menuOpen = false
    tucked = false
    applyOptions()
    app.registerComponentCallbacks(configCallbacks)
    scheduleTuck()
    emitState()
    return true
  }

  fun hide() {
    if (!showing) return
    try {
      app.unregisterComponentCallbacks(configCallbacks)
    } catch (_: Exception) {
    }
    main.removeCallbacks(remoteQuiet)
    main.removeCallbacks(tuckRunnable)
    main.removeCallbacks(autoOff)
    safeRemove(dismiss)
    dismiss = null
    safeRemove(bubble)
    safeRemove(menu)
    safeRemove(canvas)
    bubble = null
    menu = null
    canvas = null
    drawing = false
    menuOpen = false
    emitState()
  }

  fun setDrawing(on: Boolean) {
    if (!showing) return
    if (drawing != on) {
      drawing = on
      bubble?.active = on
      updateCanvasTouch()
      emitState()
    }
    if (on) {
      untuck()
      openRing()
    } else {
      main.removeCallbacks(autoOff)
      setMenuOpen(false)
      scheduleTuck()
    }
  }

  fun setStyle(next: InkStyle) {
    style = next.copy()
    canvas?.style = style
    menu?.style = style
    bubble?.tint = style.color
  }

  // ── remote ink, forwarded from JS ─────────────────────────────────────────

  fun remoteBegin(key: String, u: Float, v: Float, color: Int, widthDp: Float, tool: String) {
    canvas?.remoteBegin(key, u, v, color, widthDp, tool)
    remoteActivity()
  }

  fun remoteAppend(key: String, points: FloatArray) {
    canvas?.remoteAppend(key, points)
    remoteActivity()
  }

  fun remoteEnd(key: String, kind: String) = canvas?.remoteEnd(key, kind)

  fun clear(scope: String) = canvas?.clear(scope)

  fun clearSender(from: String) = canvas?.clearSender(from)

  private fun remoteActivity() {
    // Someone is pointing at something: make sure the bubble is visible and
    // ringed, even if it had tucked itself away.
    untuck()
    bubble?.remoteActive = true
    main.removeCallbacks(remoteQuiet)
    main.postDelayed(remoteQuiet, options.timing.holdMs + options.timing.fadeMs + 1000)
    scheduleTuck()
  }

  // ── listeners ─────────────────────────────────────────────────────────────

  override fun onLocalBegin(id: String, u: Float, v: Float, style: InkStyle, frameW: Int, frameH: Int) =
    emit(EVENT_STROKE, styleBody(style) + mapOf(
      "phase" to "begin", "id" to id, "points" to listOf(u.toDouble(), v.toDouble()),
      "frameW" to frameW, "frameH" to frameH,
    ))

  override fun onLocalAppend(id: String, points: FloatArray) =
    emit(EVENT_STROKE, mapOf("phase" to "append", "id" to id, "points" to points.map { it.toDouble() }))

  override fun onLocalEnd(id: String, kind: String) {
    emit(EVENT_STROKE, mapOf("phase" to "end", "id" to id, "kind" to kind))
    armAutoOff()
  }

  override fun onLocalShape(id: String, points: FloatArray, style: InkStyle, frameW: Int, frameH: Int) {
    armAutoOff()
    emit(EVENT_STROKE, styleBody(style) + mapOf(
      "phase" to "shape", "id" to id, "points" to points.map { it.toDouble() },
      "frameW" to frameW, "frameH" to frameH,
    ))
  }

  override fun onStyleChanged(style: InkStyle) {
    setStyle(style)
    emit(EVENT_STYLE, styleBody(style) + mapOf("shape" to style.shape))
    // Pick and draw: once something is chosen, fold the ring away so the
    // very next touch draws. Tap the bubble to bring it back.
    if (menuOpen) main.postDelayed({ if (menuOpen) setMenuOpen(false) }, PICK_CLOSE_DELAY_MS)
  }

  /** Trash: clear the whole screen (mine and theirs, with a short fade),
   * remove my ink on the other side too, and put the ring away. */
  override fun onClear() {
    canvas?.fadeOutAll()
    emit(EVENT_ACTION, mapOf("action" to "clear"))
    main.postDelayed({ if (menuOpen) setMenuOpen(false) }, PICK_CLOSE_DELAY_MS)
  }

  override fun onDone() = setDrawing(false)

  /** A touch on the ring's window that missed every button: the user is
   * starting to draw. Tuck the ring away and hand the gesture to the ink
   * layer. */
  override fun onPassThrough(e: MotionEvent) {
    if (e.actionMasked == MotionEvent.ACTION_DOWN) {
      // Hide the ring but keep its window touchable until the finger lifts:
      // changing the window's flags mid-gesture makes Android cancel it.
      passThrough = true
      menu?.alpha = 0f
      canvas?.dismissTapOnly = true
    }
    canvas?.onTouchEvent(e)
    if (e.actionMasked == MotionEvent.ACTION_UP || e.actionMasked == MotionEvent.ACTION_CANCEL) {
      passThrough = false
      setMenuOpen(false, animate = false)
    }
  }

  private var passThrough = false

  /** The user started drawing straight on the ink layer: put the ring away. */
  override fun onTouchStart() {
    main.removeCallbacks(autoOff)
    if (menuOpen && !passThrough) {
      canvas?.dismissTapOnly = true
      setMenuOpen(false)
    }
  }

  /** One tap on the bubble always shows the tools. With the tools already
   * open, a tap closes them and stops drawing. */
  override fun onBubbleTap() {
    if (tucked) untuck()
    when {
      !drawing -> setDrawing(true)
      !menuOpen -> openRing()
      else -> setDrawing(false)
    }
  }

  override fun onBubbleDrag(dx: Float, dy: Float) {
    val p = bubbleParams ?: return
    val b = bubble ?: return
    untuck()
    setMenuOpen(false)
    p.x = (p.x + dx).toInt()
    p.y = (p.y + dy).toInt()
    update(b, p)
    dismiss?.let {
      it.visibility = View.VISIBLE
      it.hot = overDismiss()
    }
  }

  override fun onBubbleDragEnd() {
    val drop = overDismiss()
    dismiss?.apply {
      hot = false
      visibility = View.GONE
    }
    if (drop) {
      // Dropped on the X: turn the floating pen off. The app hears about it
      // so its own switch can follow.
      hide()
      emit(EVENT_ACTION, mapOf("action" to "dismiss"))
      return
    }
    snapBubble(animate = true)
  }

  /** Is the bubble's centre within reach of the dismiss target? */
  private fun overDismiss(): Boolean {
    val bp = bubbleParams ?: return false
    val b = bubble ?: return false
    val size = displaySize()
    val cx = bp.x + b.sizePx / 2f
    val cy = bp.y + b.sizePx / 2f
    val tx = size.x / 2f
    val ty = size.y - (72f * d) - (dismiss?.sizePx ?: 0) / 2f
    return kotlin.math.hypot(cx - tx, cy - ty) < 80f * d
  }

  // ── ring window ───────────────────────────────────────────────────────────

  private fun setMenuOpen(open: Boolean, animate: Boolean = true) {
    val m = menu ?: return
    val p = menuParams ?: return
    if (open == menuOpen && (open || m.visibility == View.GONE)) return
    menuOpen = open
    if (open) {
      positionMenu()
      m.alpha = 1f
      m.visibility = View.VISIBLE
      m.animateIn()
      p.flags = p.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
      update(m, p)
    } else {
      // Stop taking touches right away; fold the buttons away, then hide.
      p.flags = p.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
      update(m, p)
      val hideNow = { if (!menuOpen) m.visibility = View.GONE }
      if (animate && m.alpha > 0f) m.animateOut(hideNow) else hideNow()
    }
    if (open) main.removeCallbacks(autoOff) else armAutoOff()
  }

  /** Opens the ring, first sliding the bubble away from the top/bottom edge
   * if the ring wouldn't fit there. */
  private fun openRing() {
    val p = bubbleParams ?: return
    val b = bubble ?: return
    val size = displaySize()
    val safe = (RING_CLEARANCE_DP * d).toInt()
    val cy = p.y + b.sizePx / 2
    val targetCy = cy.coerceIn(safe, maxOf(safe, size.y - safe))
    if (targetCy == cy) {
      setMenuOpen(true)
      return
    }
    animateBubble(p.x, targetCy - b.sizePx / 2)
    main.postDelayed({ if (drawing) setMenuOpen(true) }, 240)
  }

  /** Puts the ring window beside the bubble, opening toward the middle of
   * the screen. */
  private fun positionMenu() {
    val m = menu ?: return
    val p = menuParams ?: return
    val bp = bubbleParams ?: return
    val b = bubble ?: return
    val size = displaySize()
    val cx = bp.x + b.sizePx / 2
    val cy = bp.y + b.sizePx / 2
    val overlap = (30f * d).toInt()
    val onRight = cx > size.x / 2
    p.x = if (onRight) cx + overlap - p.width else cx - overlap
    p.y = (cy - p.height / 2).coerceIn(0, maxOf(0, size.y - p.height))
    m.direction = if (onRight) -1 else 1
    m.anchorX = (cx - p.x).toFloat()
    m.anchorY = (cy - p.y).toFloat()
    m.visibleLeft = (-p.x).coerceAtLeast(0).toFloat()
    m.visibleRight = minOf(p.width, size.x - p.x).toFloat()
  }

  // ── bubble placement ──────────────────────────────────────────────────────

  private fun scheduleTuck() {
    main.removeCallbacks(tuckRunnable)
    if (!drawing) main.postDelayed(tuckRunnable, TUCK_AFTER_MS)
  }

  /** Fade the bubble and slide it half off its edge. */
  private fun tuck() {
    if (drawing || tucked) return
    val p = bubbleParams ?: return
    val b = bubble ?: return
    val size = displaySize()
    tucked = true
    val target = if (p.x + b.sizePx / 2 < size.x / 2) -b.sizePx / 2 else size.x - b.sizePx / 2
    animateBubble(target, p.y)
    b.animate().alpha(0.5f).setDuration(220).start()
  }

  private fun untuck() {
    if (!tucked) return
    tucked = false
    bubble?.animate()?.alpha(1f)?.setDuration(160)?.start()
    snapBubble(animate = true)
    scheduleTuck()
  }

  private fun snapBubble(animate: Boolean) {
    val p = bubbleParams ?: return
    val b = bubble ?: return
    val size = displaySize()
    val margin = (8f * d).toInt()
    val targetX = if (p.x + b.sizePx / 2 < size.x / 2) margin else size.x - b.sizePx - margin
    val targetY = p.y.coerceIn((40f * d).toInt(), size.y - b.sizePx - (96f * d).toInt())
    if (!animate) {
      p.x = targetX
      p.y = targetY
      update(b, p)
      return
    }
    animateBubble(targetX, targetY)
  }

  private fun animateBubble(targetX: Int, targetY: Int) {
    val p = bubbleParams ?: return
    val b = bubble ?: return
    val fromX = p.x
    val fromY = p.y
    ValueAnimator.ofFloat(0f, 1f).apply {
      duration = 320
      interpolator = OvershootInterpolator(1.1f)
      addUpdateListener {
        val t = it.animatedValue as Float
        p.x = (fromX + (targetX - fromX) * t).toInt()
        p.y = (fromY + (targetY - fromY) * t).toInt()
        if (bubble != null) update(b, p)
      }
      start()
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private fun applyOptions() {
    canvas?.timing = options.timing
    canvas?.style = style
    menu?.apply {
      swatches = options.swatches
      widths = options.widths
      grid = options.grid
      this.style = this@OverlayController.style
    }
    bubble?.tint = style.color
    setSecure(canvas, canvasParams, options.hideInkFromCapture)
    setSecure(menu, menuParams, options.hideControlsFromCapture)
    setSecure(bubble, bubbleParams, options.hideControlsFromCapture)
    updateCanvasTouch()
  }

  private fun setSecure(view: View?, params: WindowManager.LayoutParams?, secure: Boolean) {
    if (view == null || params == null) return
    params.flags = if (secure) params.flags or WindowManager.LayoutParams.FLAG_SECURE
    else params.flags and WindowManager.LayoutParams.FLAG_SECURE.inv()
    update(view, params)
  }

  private fun updateCanvasTouch() {
    val c = canvas ?: return
    val p = canvasParams ?: return
    p.flags = if (drawing) p.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
    else p.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
    // Android 12+ blocks touches from passing through another app's
    // full-screen overlay unless that window is at most 80% opaque. Only
    // matters while touches pass through (draw mode off).
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) p.alpha = if (drawing) 1f else 0.8f
    update(c, p)
  }

  private fun update(v: View, p: WindowManager.LayoutParams) {
    try {
      wm.updateViewLayout(v, p)
    } catch (_: Exception) {
    }
  }

  private fun emitState() = emit(EVENT_STATE, mapOf("visible" to showing, "drawing" to drawing))

  private fun styleBody(s: InkStyle): Map<String, Any?> = mapOf(
    "color" to String.format("#%06X", 0xFFFFFF and s.color),
    "width" to s.widthDp.toDouble(),
    "tool" to s.tool,
  )

  private fun baseParams(w: Int, h: Int): WindowManager.LayoutParams {
    @Suppress("DEPRECATION")
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    else WindowManager.LayoutParams.TYPE_PHONE
    return WindowManager.LayoutParams(
      w, h, type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT,
    )
  }

  @Suppress("DEPRECATION")
  private fun displaySize(): Point {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val b = wm.maximumWindowMetrics.bounds
      return Point(b.width(), b.height())
    }
    val p = Point()
    wm.defaultDisplay.getRealSize(p)
    return p
  }

  private fun safeRemove(v: View?) {
    if (v == null) return
    try {
      wm.removeViewImmediate(v)
    } catch (_: Exception) {
    }
  }

  companion object {
    private const val TAG = "ScribbleOverlay"
    private const val TUCK_AFTER_MS = 4000L
    /** Long enough to see the selection ring land on what you picked. */
    private const val PICK_CLOSE_DELAY_MS = 180L
    private const val AUTO_OFF_MS = 6000L
    /** How far the bubble's centre must be from the top/bottom edge for the
     * ring (outer radius + button) to fit. */
    private const val RING_CLEARANCE_DP = 205f
    const val EVENT_STROKE = "onLocalStroke"
    const val EVENT_STYLE = "onStyleChange"
    const val EVENT_ACTION = "onAction"
    const val EVENT_STATE = "onStateChange"
  }
}
