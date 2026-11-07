package com.vilancer.scribble.overlay

import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

/** The tool/colour/size the local user has picked in the toolbar. `shape` is
 * non-null while a shape (line, arrow, rect, ellipse) is selected instead of
 * a freehand tool. Mirrors `@vilancer/protocol/render`. */
data class InkStyle(
  var tool: String = "pen",
  var color: Int = Color.parseColor("#FF453A"),
  var widthDp: Float = 6f,
  var shape: String? = null,
)

/** Per-tool rendering recipe, kept in step with TOOL_RECIPES in
 * packages/protocol/src/render/index.ts. */
data class ToolRecipe(
  val widthScale: Float,
  val opacity: Float,
  val casing: Boolean,
  val roundCap: Boolean,
  val texture: Texture,
) {
  enum class Texture { NONE, GRAIN, WAX }

  companion object {
    val PEN = ToolRecipe(1f, 1f, true, true, Texture.NONE)
    private val ALL = mapOf(
      "pen" to PEN,
      "marker" to ToolRecipe(3f, 0.45f, false, false, Texture.NONE),
      "pencil" to ToolRecipe(0.75f, 0.9f, false, true, Texture.GRAIN),
      "crayon" to ToolRecipe(2f, 0.85f, false, true, Texture.WAX),
    )

    fun of(tool: String?): ToolRecipe = ALL[tool] ?: PEN
  }
}

/** Fade timing, kept in step with HOLD_MS / FADE_MS / STALE_MS in
 * packages/protocol/src/core/index.ts (overridable from JS). */
data class FadeTiming(val holdMs: Long = 2000, val fadeMs: Long = 500, val staleMs: Long = 1500)

/** One stroke on the ink layer, local or remote. Points are normalized to
 * the display (u = x / displayWidth, v = y / displayHeight). */
class InkStroke(
  val key: String,
  val local: Boolean,
  var color: Int,
  var widthDp: Float,
  var tool: String,
  now: Long,
) {
  val us = ArrayList<Float>(64)
  val vs = ArrayList<Float>(64)
  var endedAt: Long = -1
  var lastMoveAt: Long = now
  val createdAt: Long = now
  var kind: String = "stroke"

  fun add(u: Float, v: Float, now: Long) {
    us.add(u)
    vs.add(v)
    lastMoveAt = now
    if (us.size > MAX_POINTS) {
      us.removeAt(0)
      vs.removeAt(0)
    }
  }

  fun replacePoints(points: List<Pair<Float, Float>>, now: Long) {
    us.clear()
    vs.clear()
    for ((u, v) in points) {
      us.add(u)
      vs.add(v)
    }
    lastMoveAt = now
  }

  /** Same function as computePhaseAndAlpha in protocol/core: 1 while live or
   * holding, a linear fade, then 0 (dead). */
  fun alpha(now: Long, timing: FadeTiming): Float {
    val end = when {
      endedAt >= 0 -> endedAt
      now - lastMoveAt >= timing.staleMs -> lastMoveAt + timing.staleMs
      else -> return 1f
    }
    val elapsed = now - end
    if (elapsed < timing.holdMs) return 1f
    if (elapsed < timing.holdMs + timing.fadeMs) return 1f - (elapsed - timing.holdMs).toFloat() / timing.fadeMs
    return 0f
  }

  companion object {
    const val MAX_POINTS = 256
  }
}

/** Draws strokes with the per-tool recipes. Textures are generated once and
 * tinted per colour (cached). */
class InkPainter(private val density: Float) {
  private val path = Path()
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeJoin = Paint.Join.ROUND
  }
  private val textureCache = HashMap<Long, BitmapShader>()

  fun draw(canvas: Canvas, s: InkStroke, alpha: Float, w: Float, h: Float, ox: Float, oy: Float) {
    if (s.us.isEmpty() || alpha <= 0f) return
    val recipe = ToolRecipe.of(s.tool)
    val core = s.widthDp * density * recipe.widthScale

    if (s.kind == "tap") {
      drawTapRing(canvas, s, alpha, w, h, ox, oy, max(core, 3f * density))
      return
    }

    buildPath(s, w, h, ox, oy)
    paint.strokeCap = if (recipe.roundCap) Paint.Cap.ROUND else Paint.Cap.BUTT
    paint.shader = null

    if (recipe.casing) {
      paint.color = Color.BLACK
      paint.alpha = (0.55f * alpha * 255).toInt()
      paint.strokeWidth = core + 2.5f * density
      canvas.drawPath(path, paint)
    }

    paint.strokeWidth = core
    when (recipe.texture) {
      ToolRecipe.Texture.NONE -> {
        paint.color = s.color
        paint.alpha = (recipe.opacity * alpha * 255).toInt()
      }
      else -> {
        paint.color = Color.WHITE
        paint.alpha = (recipe.opacity * alpha * 255).toInt()
        paint.shader = texture(s.color, recipe.texture)
      }
    }
    canvas.drawPath(path, paint)
    paint.shader = null
  }

  private fun drawTapRing(canvas: Canvas, s: InkStroke, alpha: Float, w: Float, h: Float, ox: Float, oy: Float, core: Float) {
    val x = s.us[0] * w - ox
    val y = s.vs[0] * h - oy
    val grow = min(1f, (System.currentTimeMillis() - s.createdAt) / 250f)
    val r = 44f * density * (0.4f + 0.6f * grow)
    paint.strokeCap = Paint.Cap.ROUND
    paint.color = Color.BLACK
    paint.alpha = (0.55f * alpha * 255).toInt()
    paint.strokeWidth = core + 2.5f * density
    canvas.drawCircle(x, y, r, paint)
    paint.color = s.color
    paint.alpha = (alpha * 255).toInt()
    paint.strokeWidth = core
    canvas.drawCircle(x, y, r, paint)
  }

  /** Quadratic smoothing through point midpoints, so a fast drag reads as a
   * curve rather than a polyline. */
  private fun buildPath(s: InkStroke, w: Float, h: Float, ox: Float, oy: Float) {
    path.reset()
    val n = s.us.size
    val x0 = s.us[0] * w - ox
    val y0 = s.vs[0] * h - oy
    path.moveTo(x0, y0)
    if (n == 1) {
      path.lineTo(x0 + 0.1f, y0)
      return
    }
    if (n == 2) {
      path.lineTo(s.us[1] * w - ox, s.vs[1] * h - oy)
      return
    }
    var px = x0
    var py = y0
    for (i in 1 until n) {
      val x = s.us[i] * w - ox
      val y = s.vs[i] * h - oy
      path.quadTo(px, py, (px + x) / 2f, (py + y) / 2f)
      px = x
      py = y
    }
    path.lineTo(px, py)
  }

  private fun texture(color: Int, kind: ToolRecipe.Texture): BitmapShader {
    val cacheKey = (color.toLong() and 0xFFFFFFFFL) or (kind.ordinal.toLong() shl 32)
    return textureCache.getOrPut(cacheKey) {
      val size = 64
      val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
      val rnd = Random(kind.ordinal * 7919)
      val block = if (kind == ToolRecipe.Texture.WAX) 2 else 1
      for (y in 0 until size step block) {
        for (x in 0 until size step block) {
          val a = when (kind) {
            ToolRecipe.Texture.GRAIN -> 150 + rnd.nextInt(106)
            else -> if (rnd.nextFloat() < 0.18f) 40 + rnd.nextInt(60) else 190 + rnd.nextInt(66)
          }
          val c = Color.argb(a, Color.red(color), Color.green(color), Color.blue(color))
          for (dy in 0 until block) for (dx in 0 until block) bmp.setPixel(x + dx, y + dy, c)
        }
      }
      BitmapShader(bmp, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT)
    }
  }
}

/** Shape outlines in pixel space; kept in step with
 * packages/protocol/src/shapes/index.ts. */
object Shapes {
  private const val ELLIPSE_SEGMENTS = 36
  private val BARB = Math.toRadians(28.0)

  fun points(shape: String, ax: Float, ay: Float, bx: Float, by: Float): List<Pair<Float, Float>> =
    when (shape) {
      "arrow" -> {
        val dx = bx - ax
        val dy = by - ay
        val len = hypot(dx, dy)
        if (len < 1f) {
          listOf(ax to ay, bx to by)
        } else {
          val head = min(max(len * 0.25f, 14f), 44f)
          val angle = atan2(dy.toDouble(), dx.toDouble())
          fun barb(sign: Int) = (bx - head * cos(angle - sign * BARB).toFloat()) to
            (by - head * sin(angle - sign * BARB).toFloat())
          listOf(ax to ay, bx to by, barb(1), bx to by, barb(-1))
        }
      }
      "rect" -> listOf(ax to ay, bx to ay, bx to by, ax to by, ax to ay)
      "ellipse" -> {
        val cx = (ax + bx) / 2f
        val cy = (ay + by) / 2f
        val rx = abs(bx - ax) / 2f
        val ry = abs(by - ay) / 2f
        (0..ELLIPSE_SEGMENTS).map { i ->
          val t = i.toDouble() / ELLIPSE_SEGMENTS * Math.PI * 2
          (cx + rx * cos(t).toFloat()) to (cy + ry * sin(t).toFloat())
        }
      }
      else -> listOf(ax to ay, bx to by)
    }
}
