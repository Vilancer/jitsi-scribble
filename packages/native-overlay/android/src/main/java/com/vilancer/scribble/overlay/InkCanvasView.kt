package com.vilancer.scribble.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import android.view.MotionEvent
import android.view.View
import kotlin.math.hypot

/**
 * The full-screen ink layer. Renders every stroke (remote ones pushed from
 * JS, local ones drawn here) and, while draw mode is on, turns the user's
 * touches into strokes or shapes.
 *
 * Coordinates are normalized to the whole display, because that is what a
 * screen share captures: (0,0) is the display's top-left corner, (1,1) its
 * bottom-right.
 */
@SuppressLint("ViewConstructor")
class InkCanvasView(
  context: Context,
  private val listener: Listener,
) : View(context) {

  interface Listener {
    /** A local stroke began. `frameW`/`frameH` are the display size in px. */
    fun onLocalBegin(id: String, u: Float, v: Float, style: InkStyle, frameW: Int, frameH: Int)
    fun onLocalAppend(id: String, points: FloatArray)
    fun onLocalEnd(id: String, kind: String)
    /** A finished shape, sent as one stroke. */
    fun onLocalShape(id: String, points: FloatArray, style: InkStyle, frameW: Int, frameH: Int)
    /** A finger went down on the ink layer (draw mode). */
    fun onTouchStart() {}
  }

  var style = InkStyle()
  var timing = FadeTiming()
  var displayW = 1
  var displayH = 1

  private val density = resources.displayMetrics.density
  private val painter = InkPainter(density)
  private val strokes = LinkedHashMap<String, InkStroke>()
  private val screenPos = IntArray(2)
  private var counter = 0
  private var animating = false

  // Active local gesture
  private var activeId: String? = null
  private var activeShape: String? = null
  private var downX = 0f
  private var downY = 0f
  private var downAt = 0L
  private var maxTravel = 0f
  private val pending = ArrayList<Float>()
  // The "stroke started" message is held back until the touch is known to be
  // a drag (moved, or held), so a tap that only closes the tool ring never
  // reaches the other side.
  private var beganRemote = false
  private var downU = 0f
  private var downV = 0f
  private var downStyle = InkStyle()

  /** Set for the current gesture by the controller when the tool ring was
   * open: a quick tap then only closes the ring instead of drawing a
   * "look here" circle. A drag still draws. */
  var dismissTapOnly = false
  private val main = Handler(Looper.getMainLooper())
  private val flushRunnable = Runnable { flushPending() }
  private var flushScheduled = false

  // ── remote strokes (from JS) ──────────────────────────────────────────────

  fun remoteBegin(key: String, u: Float, v: Float, color: Int, widthDp: Float, tool: String) {
    if (strokes.containsKey(key)) return
    enforceCaps()
    val now = System.currentTimeMillis()
    strokes[key] = InkStroke(key, false, color, widthDp, tool, now).also { it.add(u, v, now) }
    kick()
  }

  fun remoteAppend(key: String, points: FloatArray) {
    val now = System.currentTimeMillis()
    val s = strokes[key] ?: InkStroke(key, false, DEFAULT_REMOTE_COLOR, 4f, "pen", now).also {
      enforceCaps()
      strokes[key] = it
    }
    var i = 0
    while (i + 1 < points.size) {
      s.add(points[i], points[i + 1], now)
      i += 2
    }
    kick()
  }

  fun remoteEnd(key: String, kind: String) {
    val s = strokes[key] ?: return
    if (s.endedAt < 0) {
      s.endedAt = System.currentTimeMillis()
      s.kind = kind
    }
    kick()
  }

  /** "all", "local", "remote", or a sender prefix (keys are "<from> <id>"). */
  fun clear(scope: String) {
    val it = strokes.entries.iterator()
    while (it.hasNext()) {
      val s = it.next().value
      val drop = when (scope) {
        "all" -> true
        "local" -> s.local
        "remote" -> !s.local
        else -> !s.local && s.key.startsWith("$scope ")
      }
      if (drop) it.remove()
    }
    invalidate()
  }

  private fun enforceCaps() {
    while (strokes.size >= MAX_STROKES) strokes.remove(strokes.keys.first())
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    getLocationOnScreen(screenPos)
    val ox = screenPos[0].toFloat()
    val oy = screenPos[1].toFloat()
    val w = displayW.toFloat()
    val h = displayH.toFloat()
    val now = System.currentTimeMillis()
    val it = strokes.entries.iterator()
    while (it.hasNext()) {
      val s = it.next().value
      val a = s.alpha(now, timing)
      if (a <= 0f && s.key != activeKey()) {
        it.remove()
        continue
      }
      painter.draw(canvas, s, a, w, h, ox, oy)
    }
  }

  private fun activeKey(): String? = activeId?.let { localKey(it) }

  private val frameCallback = object : Choreographer.FrameCallback {
    override fun doFrame(frameTimeNanos: Long) {
      invalidate()
      if (strokes.isNotEmpty()) {
        Choreographer.getInstance().postFrameCallback(this)
      } else {
        animating = false
      }
    }
  }

  private fun kick() {
    invalidate()
    if (!animating) {
      animating = true
      Choreographer.getInstance().postFrameCallback(frameCallback)
    }
  }

  // ── local drawing ─────────────────────────────────────────────────────────

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(event: MotionEvent): Boolean {
    // One pointer only: a second finger ends nothing and draws nothing.
    if (event.getPointerId(event.actionIndex) != 0 && event.actionMasked != MotionEvent.ACTION_CANCEL) return true
    val now = System.currentTimeMillis()
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        listener.onTouchStart()
        val id = "ooa-${now.toString(36)}-${counter++}"
        activeId = id
        activeShape = style.shape
        downX = event.rawX
        downY = event.rawY
        downAt = now
        maxTravel = 0f
        val s = InkStroke(localKey(id), true, style.color, style.widthDp, style.tool, now)
        enforceCaps()
        strokes[s.key] = s
        beganRemote = false
        pending.clear()
        if (activeShape == null) {
          downU = event.rawX / displayW
          downV = event.rawY / displayH
          downStyle = style.copy()
          s.add(downU, downV, now)
        } else {
          s.add(event.rawX / displayW, event.rawY / displayH, now)
        }
        kick()
      }
      MotionEvent.ACTION_MOVE -> {
        val id = activeId ?: return true
        val s = strokes[localKey(id)] ?: return true
        maxTravel = maxOf(maxTravel, hypot(event.rawX - downX, event.rawY - downY))
        val shape = activeShape
        if (shape != null) {
          val pts = Shapes.points(shape, downX, downY, event.rawX, event.rawY)
            .map { (x, y) -> (x / displayW) to (y / displayH) }
          s.replacePoints(pts, now)
        } else {
          // Raw → display offset: rawX/rawY are already display coordinates.
          val dx = event.rawX - event.x
          val dy = event.rawY - event.y
          for (i in 0 until event.historySize) {
            addLocalPoint(s, event.getHistoricalX(i) + dx, event.getHistoricalY(i) + dy, now)
          }
          addLocalPoint(s, event.rawX, event.rawY, now)
          if (!beganRemote && (maxTravel >= TAP_SLOP_DP * density || now - downAt >= TAP_MAX_MS)) beginRemote(id)
          if (beganRemote) scheduleFlush()
        }
        invalidate()
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        val id = activeId ?: return true
        val s = strokes[localKey(id)]
        val shape = activeShape
        val tap = maxTravel < TAP_SLOP_DP * density && now - downAt < TAP_MAX_MS
        val dismissOnly = dismissTapOnly
        dismissTapOnly = false
        if (shape == null && tap && dismissOnly) {
          // Just closing the tool ring: draw nothing, send nothing.
          activeId = null
          pending.clear()
          s?.let { strokes.remove(it.key) }
          invalidate()
          return true
        }
        if (shape == null) {
          if (!beganRemote) beginRemote(id)
          flushPending()
        }
        activeId = null
        if (s == null) return true
        if (shape != null) {
          if (maxTravel < 12f * density || event.actionMasked == MotionEvent.ACTION_CANCEL) {
            strokes.remove(s.key)
          } else {
            s.endedAt = now
            val flat = FloatArray(s.us.size * 2)
            for (i in s.us.indices) {
              flat[i * 2] = s.us[i]
              flat[i * 2 + 1] = s.vs[i]
            }
            listener.onLocalShape(id, flat, style.copy(), displayW, displayH)
          }
        } else {
          s.kind = if (tap) "tap" else "stroke"
          s.endedAt = now
          listener.onLocalEnd(id, s.kind)
        }
        kick()
      }
    }
    return true
  }

  private fun addLocalPoint(s: InkStroke, x: Float, y: Float, now: Long) {
    val n = s.us.size
    if (n > 0) {
      val lx = s.us[n - 1] * displayW
      val ly = s.vs[n - 1] * displayH
      if (hypot(x - lx, y - ly) < 1.5f * density) return
    }
    val u = x / displayW
    val v = y / displayH
    s.add(u, v, now)
    pending.add(u)
    pending.add(v)
  }

  private fun beginRemote(id: String) {
    beganRemote = true
    listener.onLocalBegin(id, downU, downV, downStyle, displayW, displayH)
  }

  private fun scheduleFlush() {
    if (flushScheduled) return
    flushScheduled = true
    main.postDelayed(flushRunnable, FLUSH_MS)
  }

  private fun flushPending() {
    main.removeCallbacks(flushRunnable)
    flushScheduled = false
    val id = activeId
    if (!beganRemote) return // keep buffering until the stroke is announced
    if (pending.isEmpty() || id == null) {
      pending.clear()
      return
    }
    listener.onLocalAppend(id, pending.toFloatArray())
    pending.clear()
  }

  private fun localKey(id: String) = "local $id"

  companion object {
    private const val MAX_STROKES = 24
    private const val TAP_SLOP_DP = 10f
    private const val TAP_MAX_MS = 300L
    private const val FLUSH_MS = 32L
    private const val DEFAULT_REMOTE_COLOR = 0xFF0A84FF.toInt()
  }
}
