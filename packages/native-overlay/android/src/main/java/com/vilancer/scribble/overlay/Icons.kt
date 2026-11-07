package com.vilancer.scribble.overlay

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.SweepGradient

/** Hand-drawn vector glyphs for the toolbar and bubble, so the overlay has
 * no resource or font dependency. All sizes are in px; `d` is the density. */
object Icons {
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
  }
  private val path = Path()
  private val rect = RectF()

  private const val BODY = 0xFFF2F2F7.toInt()
  private const val BODY_SHADE = 0xFFC7C7CC.toInt()
  private const val WOOD = 0xFFE9C79A.toInt()

  /**
   * A drawing tool standing upright, tip at the top, like the tool tray in
   * iOS Markup. (cx, bottom) is the base centre; the tip is tinted `tint`.
   */
  fun tool(c: Canvas, tool: String, cx: Float, bottom: Float, d: Float, tint: Int) {
    val w = 22f * d
    val bodyTop = bottom - 46f * d
    when (tool) {
      "pen" -> {
        body(c, cx, bodyTop, bottom, w * 0.78f, d)
        // conical nib
        path.reset()
        path.moveTo(cx - w * 0.39f, bodyTop)
        path.lineTo(cx, bodyTop - 16f * d)
        path.lineTo(cx + w * 0.39f, bodyTop)
        path.close()
        fill.color = BODY_SHADE
        c.drawPath(path, fill)
        path.reset()
        path.moveTo(cx - 3f * d, bodyTop - 10f * d)
        path.lineTo(cx, bodyTop - 16f * d)
        path.lineTo(cx + 3f * d, bodyTop - 10f * d)
        path.close()
        fill.color = tint
        c.drawPath(path, fill)
        band(c, cx, bodyTop + 8f * d, w * 0.78f, d, tint)
      }
      "marker" -> {
        body(c, cx, bodyTop, bottom, w, d)
        path.reset()
        path.moveTo(cx - w * 0.36f, bodyTop)
        path.lineTo(cx - w * 0.3f, bodyTop - 10f * d)
        path.lineTo(cx + w * 0.3f, bodyTop - 15f * d)
        path.lineTo(cx + w * 0.36f, bodyTop)
        path.close()
        fill.color = tint
        c.drawPath(path, fill)
        band(c, cx, bodyTop + 8f * d, w, d, tint)
      }
      "pencil" -> {
        body(c, cx, bodyTop, bottom, w * 0.82f, d)
        path.reset()
        path.moveTo(cx - w * 0.41f, bodyTop)
        path.lineTo(cx, bodyTop - 18f * d)
        path.lineTo(cx + w * 0.41f, bodyTop)
        path.close()
        fill.color = WOOD
        c.drawPath(path, fill)
        path.reset()
        path.moveTo(cx - 3.5f * d, bodyTop - 11f * d)
        path.lineTo(cx, bodyTop - 18f * d)
        path.lineTo(cx + 3.5f * d, bodyTop - 11f * d)
        path.close()
        fill.color = tint
        c.drawPath(path, fill)
      }
      else -> { // crayon
        body(c, cx, bodyTop, bottom, w, d)
        rect.set(cx - w / 2f + 1.5f * d, bodyTop + 4f * d, cx + w / 2f - 1.5f * d, bodyTop + 22f * d)
        fill.color = tint
        c.drawRoundRect(rect, 2f * d, 2f * d, fill)
        path.reset()
        path.moveTo(cx - w * 0.42f, bodyTop + 1f * d)
        path.quadTo(cx - w * 0.4f, bodyTop - 14f * d, cx, bodyTop - 14f * d)
        path.quadTo(cx + w * 0.4f, bodyTop - 14f * d, cx + w * 0.42f, bodyTop + 1f * d)
        path.close()
        c.drawPath(path, fill)
      }
    }
  }

  private fun body(c: Canvas, cx: Float, top: Float, bottom: Float, w: Float, d: Float) {
    rect.set(cx - w / 2f, top, cx + w / 2f, bottom + 8f * d)
    fill.color = BODY
    c.drawRoundRect(rect, 3f * d, 3f * d, fill)
    rect.set(cx + w / 2f - 4f * d, top, cx + w / 2f, bottom + 8f * d)
    fill.color = BODY_SHADE
    c.drawRect(rect, fill)
  }

  private fun band(c: Canvas, cx: Float, y: Float, w: Float, d: Float, tint: Int) {
    rect.set(cx - w / 2f, y, cx + w / 2f, y + 4f * d)
    fill.color = tint
    c.drawRect(rect, fill)
  }

  /** Outline glyph for a shape, centred on (cx, cy) in a `size` box. */
  fun shape(c: Canvas, shape: String, cx: Float, cy: Float, size: Float, d: Float, color: Int) {
    line.color = color
    line.strokeWidth = 2f * d
    val h = size / 2f
    when (shape) {
      "line" -> c.drawLine(cx - h, cy + h, cx + h, cy - h, line)
      "arrow" -> {
        c.drawLine(cx - h, cy + h, cx + h, cy - h, line)
        path.reset()
        path.moveTo(cx + h - size * 0.45f, cy - h)
        path.lineTo(cx + h, cy - h)
        path.lineTo(cx + h, cy - h + size * 0.45f)
        c.drawPath(path, line)
      }
      "rect" -> {
        rect.set(cx - h, cy - h * 0.75f, cx + h, cy + h * 0.75f)
        c.drawRoundRect(rect, 2f * d, 2f * d, line)
      }
      else -> c.drawCircle(cx, cy, h, line)
    }
  }

  fun swatch(c: Canvas, cx: Float, cy: Float, r: Float, color: Int, selected: Boolean, d: Float) {
    if (selected) {
      line.color = Color.WHITE
      line.strokeWidth = 2f * d
      c.drawCircle(cx, cy, r + 3.5f * d, line)
    }
    fill.color = color
    c.drawCircle(cx, cy, r, fill)
    if (color == Color.BLACK) {
      line.color = 0x55FFFFFF
      line.strokeWidth = 1f * d
      c.drawCircle(cx, cy, r, line)
    }
  }

  private var spectrum: SweepGradient? = null
  private var spectrumAt = Float.NaN

  /** The "more colours" swatch: a hue wheel ring. */
  fun spectrum(c: Canvas, cx: Float, cy: Float, r: Float, selected: Boolean, d: Float) {
    if (spectrum == null || spectrumAt != cx * 31 + cy) {
      spectrum = SweepGradient(
        cx, cy,
        intArrayOf(0xFFFF453A.toInt(), 0xFFFFD60A.toInt(), 0xFF30D158.toInt(), 0xFF64D2FF.toInt(), 0xFF0A84FF.toInt(), 0xFFBF5AF2.toInt(), 0xFFFF453A.toInt()),
        null,
      )
      spectrumAt = cx * 31 + cy
    }
    if (selected) {
      line.color = Color.WHITE
      line.strokeWidth = 2f * d
      c.drawCircle(cx, cy, r + 3.5f * d, line)
    }
    fill.shader = spectrum
    c.drawCircle(cx, cy, r, fill)
    fill.shader = null
  }

  /** Stroke-size button: a dot whose radius shows the current size. */
  fun size(c: Canvas, cx: Float, cy: Float, widthDp: Float, d: Float) {
    line.color = 0x66FFFFFF
    line.strokeWidth = 1.5f * d
    c.drawCircle(cx, cy, 14f * d, line)
    fill.color = Color.WHITE
    c.drawCircle(cx, cy, (1.2f + widthDp * 0.55f) * d, fill)
  }

  fun trash(c: Canvas, cx: Float, cy: Float, d: Float, color: Int) {
    line.color = color
    line.strokeWidth = 2f * d
    c.drawLine(cx - 8f * d, cy - 7f * d, cx + 8f * d, cy - 7f * d, line)
    c.drawLine(cx - 3f * d, cy - 10f * d, cx + 3f * d, cy - 10f * d, line)
    path.reset()
    path.moveTo(cx - 6.5f * d, cy - 7f * d)
    path.lineTo(cx - 5.5f * d, cy + 9f * d)
    path.lineTo(cx + 5.5f * d, cy + 9f * d)
    path.lineTo(cx + 6.5f * d, cy - 7f * d)
    c.drawPath(path, line)
    c.drawLine(cx - 2f * d, cy - 3f * d, cx - 2f * d, cy + 5f * d, line)
    c.drawLine(cx + 2f * d, cy - 3f * d, cx + 2f * d, cy + 5f * d, line)
  }

  fun close(c: Canvas, cx: Float, cy: Float, d: Float, color: Int) {
    fill.color = 0xFF3A3A3C.toInt()
    c.drawCircle(cx, cy, 15f * d, fill)
    line.color = color
    line.strokeWidth = 2.2f * d
    c.drawLine(cx - 5f * d, cy - 5f * d, cx + 5f * d, cy + 5f * d, line)
    c.drawLine(cx + 5f * d, cy - 5f * d, cx - 5f * d, cy + 5f * d, line)
  }

  /** The bubble's glyph: a pen tip drawing a squiggle (like the
   * "pencil.tip.crop.circle" SF Symbol). */
  fun bubbleGlyph(c: Canvas, cx: Float, cy: Float, d: Float, color: Int, tint: Int) {
    c.save()
    c.rotate(45f, cx, cy)
    fill.color = color
    rect.set(cx - 4.5f * d, cy - 13f * d, cx + 4.5f * d, cy + 6f * d)
    c.drawRoundRect(rect, 1.5f * d, 1.5f * d, fill)
    path.reset()
    path.moveTo(cx - 4.5f * d, cy + 6f * d)
    path.lineTo(cx, cy + 14f * d)
    path.lineTo(cx + 4.5f * d, cy + 6f * d)
    path.close()
    c.drawPath(path, fill)
    fill.color = tint
    path.reset()
    path.moveTo(cx - 1.8f * d, cy + 10.8f * d)
    path.lineTo(cx, cy + 14f * d)
    path.lineTo(cx + 1.8f * d, cy + 10.8f * d)
    path.close()
    c.drawPath(path, fill)
    c.restore()
  }
}
