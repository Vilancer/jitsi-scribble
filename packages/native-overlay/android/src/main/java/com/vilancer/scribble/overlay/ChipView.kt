package com.vilancer.scribble.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View

/**
 * The small "tools" chip that sits next to the bubble while drawing is on
 * and the ring is closed. It shows the current tool in the current colour;
 * tapping it opens the ring. (The bubble itself only turns drawing on/off.)
 */
@SuppressLint("ViewConstructor")
class ChipView(context: Context, private val onTap: () -> Unit) : View(context) {
  var style = InkStyle()
    set(value) {
      field = value
      invalidate()
    }

  private val d = resources.displayMetrics.density
  val sizePx = (40f * d).toInt()
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
  private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeWidth = 1f * d
    color = 0x33FFFFFF
  }
  private val clip = Path()

  init {
    contentDescription = "Drawing tools"
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) = setMeasuredDimension(sizePx, sizePx)

  override fun onDraw(c: Canvas) {
    val cx = width / 2f
    val cy = height / 2f
    val r = width / 2f - 2f * d
    fill.color = 0x40000000
    c.drawCircle(cx, cy + 1f * d, r + 0.5f * d, fill)
    fill.color = 0xF21C1C1E.toInt()
    c.drawCircle(cx, cy, r, fill)
    c.drawCircle(cx, cy, r, ring)
    c.save()
    clip.reset()
    clip.addCircle(cx, cy, r - 2f * d, Path.Direction.CW)
    c.clipPath(clip)
    val shape = style.shape
    if (shape != null) {
      Icons.shape(c, shape, cx, cy, 14f * d, d, style.color.takeUnless { it == 0xFF000000.toInt() } ?: 0xFFFFFFFF.toInt())
    } else {
      c.scale(0.5f, 0.5f, cx, cy)
      Icons.tool(c, style.tool, cx, cy + 30f * d, d, style.color)
    }
    c.restore()
  }

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(e: MotionEvent): Boolean {
    when (e.actionMasked) {
      MotionEvent.ACTION_DOWN -> animate().scaleX(0.88f).scaleY(0.88f).setDuration(80).start()
      MotionEvent.ACTION_UP -> {
        animate().scaleX(1f).scaleY(1f).setDuration(160).start()
        performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
        performClick()
        onTap()
      }
      MotionEvent.ACTION_CANCEL -> animate().scaleX(1f).scaleY(1f).setDuration(120).start()
    }
    return true
  }

  override fun performClick(): Boolean {
    super.performClick()
    return true
  }
}
