package com.vilancer.scribble.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.view.MotionEvent
import android.view.View
import kotlin.math.hypot

/**
 * The floating button. Drag it anywhere (it snaps to the nearest side when
 * released); tap it to open or close the drawing tools.
 */
@SuppressLint("ViewConstructor")
class BubbleView(
  context: Context,
  private val listener: Listener,
) : View(context) {

  interface Listener {
    fun onBubbleTap()
    fun onBubbleDrag(dx: Float, dy: Float)
    fun onBubbleDragEnd()
  }

  var active = false
    set(value) {
      field = value
      invalidate()
    }
  var tint: Int = 0xFFFF453A.toInt()
    set(value) {
      field = value
      invalidate()
    }
  /** Remote ink is on screen right now: pulse a ring so a user who has the
   * tools closed still notices someone is pointing at something. */
  var remoteActive = false
    set(value) {
      if (field != value) {
        field = value
        invalidate()
      }
    }

  private val d = resources.displayMetrics.density
  val sizePx = (56f * d).toInt()
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
  private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
  private var downX = 0f
  private var downY = 0f
  private var lastX = 0f
  private var lastY = 0f
  private var dragging = false

  init {
    elevation = 6f * d
    contentDescription = "Drawing tools"
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(sizePx, sizePx)
  }

  override fun onDraw(c: Canvas) {
    val cx = width / 2f
    val cy = height / 2f
    val r = width / 2f - 3f * d
    fill.color = 0x40000000
    c.drawCircle(cx, cy + 1.5f * d, r + 1f * d, fill)
    fill.color = if (active) Color.WHITE else 0xF21C1C1E.toInt()
    c.drawCircle(cx, cy, r, fill)
    ring.strokeWidth = if (remoteActive && !active) 3f * d else 1f * d
    ring.color = if (remoteActive && !active) 0xFF0A84FF.toInt() else 0x33FFFFFF
    c.drawCircle(cx, cy, r, ring)
    Icons.bubbleGlyph(c, cx, cy, d, if (active) 0xFF1C1C1E.toInt() else Color.WHITE, tint)
  }

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(e: MotionEvent): Boolean {
    when (e.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        // Press feedback: a quick shrink, released on up.
        animate().scaleX(0.88f).scaleY(0.88f).setDuration(90).start()
        downX = e.rawX
        downY = e.rawY
        lastX = e.rawX
        lastY = e.rawY
        dragging = false
      }
      MotionEvent.ACTION_MOVE -> {
        if (!dragging && hypot(e.rawX - downX, e.rawY - downY) > 8f * d) dragging = true
        if (dragging) {
          // While dragging, lift the bubble a little.
          if (scaleX < 1.05f) animate().scaleX(1.08f).scaleY(1.08f).setDuration(120).start()
          listener.onBubbleDrag(e.rawX - lastX, e.rawY - lastY)
          lastX = e.rawX
          lastY = e.rawY
        }
      }
      MotionEvent.ACTION_UP -> {
        animate().scaleX(1f).scaleY(1f).setDuration(220)
          .setInterpolator(android.view.animation.OvershootInterpolator(3f)).start()
        if (dragging) listener.onBubbleDragEnd() else {
          performClick()
          listener.onBubbleTap()
        }
        dragging = false
      }
      MotionEvent.ACTION_CANCEL -> {
        animate().scaleX(1f).scaleY(1f).setDuration(150).start()
        if (dragging) listener.onBubbleDragEnd()
      }
    }
    return true
  }

  override fun performClick(): Boolean {
    super.performClick()
    return true
  }
}
