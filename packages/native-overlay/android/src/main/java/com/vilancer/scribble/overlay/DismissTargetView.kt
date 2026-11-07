package com.vilancer.scribble.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.view.View

/** The "drop here to close" circle shown at the bottom while the bubble is
 * being dragged. It grows and turns red when the bubble is over it. */
@SuppressLint("ViewConstructor")
class DismissTargetView(context: Context) : View(context) {
  private val d = resources.displayMetrics.density
  val sizePx = (96f * d).toInt()
  var hot = false
    set(value) {
      if (field == value) return
      field = value
      if (value) performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY)
      animate().scaleX(if (value) 1.2f else 1f).scaleY(if (value) 1.2f else 1f).setDuration(120).start()
      invalidate()
    }

  private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
  private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
    strokeWidth = 3f * d
    color = Color.WHITE
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) = setMeasuredDimension(sizePx, sizePx)

  override fun onDraw(c: Canvas) {
    val cx = width / 2f
    val cy = height / 2f
    val r = 30f * d
    fill.color = if (hot) 0xFFFF453A.toInt() else 0xCC1C1C1E.toInt()
    c.drawCircle(cx, cy, r, fill)
    val k = 9f * d
    c.drawLine(cx - k, cy - k, cx + k, cy + k, line)
    c.drawLine(cx + k, cy - k, cx - k, cy + k, line)
  }
}
