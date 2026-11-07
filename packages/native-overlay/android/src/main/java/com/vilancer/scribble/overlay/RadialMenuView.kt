package com.vilancer.scribble.overlay

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.sin

/**
 * The drawing tools as a compact ring of round buttons fanned out around
 * the floating bubble (instead of a big panel):
 *
 *   inner ring:  tool · shape · colour · size · clear · done
 *   outer ring:  the options of whichever inner button is open
 *
 * The view lives in its own window placed next to the bubble. A touch that
 * misses every button is handed to the ink layer (so the user can just start
 * drawing) and the ring tucks itself away.
 */
@SuppressLint("ViewConstructor")
class RadialMenuView(
  context: Context,
  private val listener: Listener,
) : View(context) {

  interface Listener {
    fun onStyleChanged(style: InkStyle)
    fun onClear()
    fun onDone()
    /** A touch that hit no button: forward it to the ink layer. Returns
     * true while the gesture is being forwarded. */
    fun onPassThrough(e: MotionEvent)
  }

  var style = InkStyle()
    set(value) {
      field = value
      invalidate()
    }
  var swatches: List<Int> = DEFAULT_SWATCHES
  var widths: List<Float> = DEFAULT_WIDTHS
  var grid: List<List<Int>> = emptyList()

  /** Where the bubble's centre is, in this view's coordinates, and which way
   * the ring opens (+1 = to the right, -1 = to the left). */
  var anchorX = 0f
  var anchorY = 0f
  var direction = -1
    set(value) {
      field = value
      invalidate()
    }

  private val d = resources.displayMetrics.density
  private val btnR = 21f * d
  private val innerR = 112f * d
  private val outerR = 178f * d
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
  private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
  private val clip = Path()
  private val r = RectF()

  private enum class Section { TOOL, SHAPE, COLOUR, SIZE }

  private var open: Section? = null
  private var gridOpen = false

  private data class Hit(val x: Float, val y: Float, val radius: Float, val action: () -> Unit)

  private val hits = ArrayList<Hit>()
  private var forwarding = false
  private var pressedIndex = -1

  // Open/close animation: each button flies out from the bubble, staggered.
  private var progress = 1f
  private var subProgress = 1f
  private var animator: ValueAnimator? = null
  private var subAnimator: ValueAnimator? = null

  /** Close any sub-ring and play the fan-out animation. */
  fun animateIn() {
    open = null
    gridOpen = false
    animator?.cancel()
    animator = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = 320
      interpolator = DecelerateInterpolator()
      addUpdateListener {
        progress = it.animatedValue as Float
        invalidate()
      }
      start()
    }
  }

  /** Fold the buttons back into the bubble, then call [done]. */
  fun animateOut(done: () -> Unit) {
    animator?.cancel()
    animator = ValueAnimator.ofFloat(progress, 0f).apply {
      duration = 160
      interpolator = DecelerateInterpolator()
      addUpdateListener {
        progress = it.animatedValue as Float
        invalidate()
      }
      addListener(object : android.animation.AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: android.animation.Animator) = done()
      })
      start()
    }
  }

  private fun animateSub() {
    subAnimator?.cancel()
    subAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = 260
      interpolator = DecelerateInterpolator()
      addUpdateListener {
        subProgress = it.animatedValue as Float
        invalidate()
      }
      start()
    }
  }

  /** Per-button eased progress, staggered by index, with a little
   * overshoot so the buttons "pop" into place. */
  private fun staggered(p: Float, i: Int, n: Int): Float {
    val span = 0.45f
    val start = if (n <= 1) 0f else (1f - span) * i / (n - 1)
    val t = ((p - start) / span).coerceIn(0f, 1f)
    return overshoot.getInterpolation(t)
  }

  private val overshoot = OvershootInterpolator(1.6f)

  private fun angle(i: Int, n: Int, spreadDeg: Float, centreDeg: Float): Double {
    val start = centreDeg - spreadDeg / 2f
    val step = if (n <= 1) 0f else spreadDeg / (n - 1)
    return Math.toRadians((start + step * i).toDouble())
  }

  /** Point on a ring. Angle 0 = straight out from the edge the bubble sits
   * on; negative = up, positive = down. */
  private fun at(radius: Float, a: Double, k: Float = 1f): Pair<Float, Float> =
    (anchorX + direction * radius * k * cos(a).toFloat()) to (anchorY + radius * k * sin(a).toFloat())

  /** Draw something scaled about (x, y) by k, with matching alpha. */
  private inline fun scaled(c: Canvas, x: Float, y: Float, k: Float, block: () -> Unit) {
    if (k <= 0.01f) return
    val save = c.saveLayerAlpha(null, (255 * k.coerceIn(0f, 1f)).toInt())
    c.scale(k.coerceAtLeast(0.01f), k.coerceAtLeast(0.01f), x, y)
    block()
    c.restoreToCount(save)
  }

  override fun onDraw(c: Canvas) {
    hits.clear()
    val inner = listOf(Section.TOOL, Section.SHAPE, Section.COLOUR, Section.SIZE, null, null)
    val n = inner.size
    var openAngle = 0.0
    for (i in 0 until n) {
      val a = angle(i, n, 125f, 0f)
      val k = staggered(progress, i, n)
      val (x, y) = at(innerR, a, k)
      val section = inner[i]
      val selected = section != null && section == open
      scaled(c, x, y, k) {
        button(c, x, y, selected)
        when (i) {
          0 -> toolGlyph(c, x, y, style.tool)
          1 -> if (style.shape != null) Icons.shape(c, style.shape!!, x, y, 16f * d, d, Color.WHITE) else squiggle(c, x, y)
          2 -> Icons.swatch(c, x, y, 13f * d, style.color, false, d)
          3 -> sizeDot(c, x, y, style.widthDp)
          4 -> Icons.trash(c, x, y, d * 0.9f, Color.WHITE)
          else -> check(c, x, y)
        }
      }
      if (selected) openAngle = a
      hits.add(Hit(x, y, btnR + 4f * d) {
        when (i) {
          4 -> listener.onClear()
          5 -> listener.onDone()
          else -> {
            open = if (open == section) null else section
            gridOpen = false
            if (open != null) animateSub()
          }
        }
      })
    }

    if (gridOpen) {
      drawGrid(c)
      return
    }
    if (progress < 1f) return
    val section = open ?: return
    val options: Int = when (section) {
      Section.TOOL -> TOOLS.size
      Section.SHAPE -> SHAPES.size + 1
      Section.COLOUR -> swatches.size + 1
      Section.SIZE -> widths.size
    }
    val spread = min(24f * (options - 1), 150f)
    val centre = Math.toDegrees(openAngle).toFloat().coerceIn(-78f + spread / 2f, 78f - spread / 2f)
    for (k in 0 until options) {
      val a = angle(k, options, spread, centre)
      val sp = staggered(subProgress, k, options)
      val (x, y) = at(innerR + (outerR - innerR) * sp, a)
      if (sp < 0.05f) continue
      when (section) {
        Section.TOOL -> {
          val t = TOOLS[k]
          button(c, x, y, style.shape == null && style.tool == t)
          toolGlyph(c, x, y, t)
          hits.add(Hit(x, y, btnR + 2f * d) { pick(style.copy(tool = t, shape = null)) })
        }
        Section.SHAPE -> {
          val s = if (k == 0) null else SHAPES[k - 1]
          button(c, x, y, style.shape == s)
          if (s == null) squiggle(c, x, y) else Icons.shape(c, s, x, y, 16f * d, d, Color.WHITE)
          hits.add(Hit(x, y, btnR + 2f * d) { pick(style.copy(shape = s)) })
        }
        Section.COLOUR -> {
          if (k < swatches.size) {
            val col = swatches[k]
            Icons.swatch(c, x, y, 16f * d, col, col == style.color, d)
            hits.add(Hit(x, y, btnR) { pick(style.copy(color = col)) })
          } else {
            Icons.spectrum(c, x, y, 16f * d, gridOpen, d)
            hits.add(Hit(x, y, btnR) {
              gridOpen = true
            })
          }
        }
        Section.SIZE -> {
          val w = widths[k]
          button(c, x, y, style.widthDp == w)
          fill.color = style.color
          c.drawCircle(x, y, ((1.5f + w * 0.75f) * d).coerceAtMost(btnR - 4f * d), fill)
          hits.add(Hit(x, y, btnR + 2f * d) { pick(style.copy(widthDp = w)) })
        }
      }
    }
  }

  private fun pick(next: InkStyle) {
    style = next
    open = null
    listener.onStyleChanged(next)
  }

  private fun drawGrid(c: Canvas) {
    if (grid.isEmpty()) return
    val cell = 22f * d
    val cols = grid[0].size
    val w = cell * cols
    val h = cell * grid.size
    val left = if (direction < 0) anchorX - innerR - btnR - 12f * d - w else anchorX + innerR + btnR + 12f * d
    val top = (anchorY - h / 2f).coerceIn(4f * d, height - h - 4f * d)
    r.set(left - 6f * d, top - 6f * d, left + w + 6f * d, top + h + 6f * d)
    fill.color = PANEL
    c.drawRoundRect(r, 14f * d, 14f * d, fill)
    for ((ri, row) in grid.withIndex()) {
      for ((ci, col) in row.withIndex()) {
        val x = left + ci * cell
        val y = top + ri * cell
        r.set(x + 1f * d, y + 1f * d, x + cell - 1f * d, y + cell - 1f * d)
        fill.color = col
        c.drawRoundRect(r, 3f * d, 3f * d, fill)
        if (col == style.color) {
          ring.color = Color.WHITE
          ring.strokeWidth = 2f * d
          c.drawRoundRect(r, 3f * d, 3f * d, ring)
        }
        hits.add(Hit(x + cell / 2f, y + cell / 2f, cell / 2f) {
          pick(style.copy(color = col))
          gridOpen = false
        })
      }
    }
  }

  private fun button(c: Canvas, x: Float, y: Float, selected: Boolean) {
    fill.color = 0x40000000
    c.drawCircle(x, y + 1.5f * d, btnR + 0.5f * d, fill)
    fill.color = PANEL
    c.drawCircle(x, y, btnR, fill)
    ring.strokeWidth = if (selected) 2f * d else 1f * d
    ring.color = if (selected) Color.WHITE else 0x33FFFFFF
    c.drawCircle(x, y, btnR, ring)
  }

  private fun toolGlyph(c: Canvas, x: Float, y: Float, tool: String) {
    c.save()
    clip.reset()
    clip.addCircle(x, y, btnR - 2f * d, Path.Direction.CW)
    c.clipPath(clip)
    c.scale(0.62f, 0.62f, x, y)
    Icons.tool(c, tool, x, y + 30f * d, d, style.color)
    c.restore()
  }

  private fun squiggle(c: Canvas, x: Float, y: Float) {
    ring.color = Color.WHITE
    ring.strokeWidth = 2f * d
    ring.strokeCap = Paint.Cap.ROUND
    clip.reset()
    clip.moveTo(x - 9f * d, y + 4f * d)
    clip.cubicTo(x - 4f * d, y - 10f * d, x + 1f * d, y + 10f * d, x + 9f * d, y - 5f * d)
    c.drawPath(clip, ring)
  }

  private fun sizeDot(c: Canvas, x: Float, y: Float, w: Float) {
    fill.color = Color.WHITE
    c.drawCircle(x, y, ((0.6f + w * 0.55f) * d).coerceAtMost(btnR - 5f * d), fill)
  }

  private fun check(c: Canvas, x: Float, y: Float) {
    ring.color = Color.WHITE
    ring.strokeWidth = 2.4f * d
    ring.strokeCap = Paint.Cap.ROUND
    clip.reset()
    clip.moveTo(x - 7f * d, y)
    clip.lineTo(x - 2f * d, y + 5.5f * d)
    clip.lineTo(x + 8f * d, y - 6f * d)
    c.drawPath(clip, ring)
  }

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(e: MotionEvent): Boolean {
    if (e.actionMasked == MotionEvent.ACTION_DOWN) {
      pressedIndex = hits.indexOfLast { hypot(e.x - it.x, e.y - it.y) <= it.radius }
      forwarding = pressedIndex < 0
    }
    if (forwarding) {
      listener.onPassThrough(e)
      if (e.actionMasked == MotionEvent.ACTION_UP || e.actionMasked == MotionEvent.ACTION_CANCEL) forwarding = false
      return true
    }
    if (e.actionMasked == MotionEvent.ACTION_UP) {
      val idx = hits.indexOfLast { hypot(e.x - it.x, e.y - it.y) <= it.radius }
      if (idx >= 0 && idx == pressedIndex) {
        performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY)
        performClick()
        hits[idx].action()
        invalidate()
      }
      pressedIndex = -1
    }
    return true
  }

  override fun performClick(): Boolean {
    super.performClick()
    return true
  }

  companion object {
    private const val PANEL = 0xF21C1C1E.toInt()
    val TOOLS = listOf("pen", "marker", "pencil", "crayon")
    val SHAPES = listOf("line", "arrow", "rect", "ellipse")
    val DEFAULT_SWATCHES = listOf(
      0xFFFFFFFF.toInt(), 0xFF000000.toInt(), 0xFF0A84FF.toInt(),
      0xFF30D158.toInt(), 0xFFFFD60A.toInt(), 0xFFFF453A.toInt(),
    )
    val DEFAULT_WIDTHS = listOf(2f, 3f, 4f, 6f, 9f, 12f, 18f)
  }
}
