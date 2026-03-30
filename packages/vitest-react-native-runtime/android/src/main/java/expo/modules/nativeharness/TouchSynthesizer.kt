package expo.modules.nativeharness

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyCharacterMap
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View

/**
 * Synthesizes real touch and key events dispatched through the Android view hierarchy.
 * Uses public MotionEvent/KeyEvent APIs — no private API access or reflection needed.
 */
object TouchSynthesizer {
  private val mainHandler = Handler(Looper.getMainLooper())
  private const val TAP_HOLD_MS = 50L
  private const val SETTLE_DELAY_MS = 100L

  fun tap(view: View, onComplete: () -> Unit) {
    val coords = viewCenter(view)
    val root = view.rootView
    val downTime = SystemClock.uptimeMillis()

    val down = createTouchEvent(MotionEvent.ACTION_DOWN, downTime, downTime, coords[0], coords[1])
    root.dispatchTouchEvent(down)
    down.recycle()

    mainHandler.postDelayed({
      val eventTime = SystemClock.uptimeMillis()
      val up = createTouchEvent(MotionEvent.ACTION_UP, downTime, eventTime, coords[0], coords[1])
      root.dispatchTouchEvent(up)
      up.recycle()

      mainHandler.postDelayed(onComplete, SETTLE_DELAY_MS)
    }, TAP_HOLD_MS)
  }

  fun longPress(view: View, durationMs: Long, onComplete: () -> Unit) {
    val coords = viewCenter(view)
    val root = view.rootView
    val downTime = SystemClock.uptimeMillis()

    val down = createTouchEvent(MotionEvent.ACTION_DOWN, downTime, downTime, coords[0], coords[1])
    root.dispatchTouchEvent(down)
    down.recycle()

    mainHandler.postDelayed({
      val eventTime = SystemClock.uptimeMillis()
      val up = createTouchEvent(MotionEvent.ACTION_UP, downTime, eventTime, coords[0], coords[1])
      root.dispatchTouchEvent(up)
      up.recycle()

      mainHandler.postDelayed(onComplete, SETTLE_DELAY_MS)
    }, durationMs)
  }

  fun typeText(activity: Activity, text: String, onComplete: () -> Unit) {
    val focusedView = activity.currentFocus ?: activity.window.decorView
    val charMap = KeyCharacterMap.load(KeyCharacterMap.VIRTUAL_KEYBOARD)
    val events = charMap.getEvents(text.toCharArray())

    if (events != null && events.isNotEmpty()) {
      dispatchKeyEvents(focusedView, events, 0) {
        mainHandler.postDelayed(onComplete, SETTLE_DELAY_MS)
      }
    } else {
      mainHandler.postDelayed(onComplete, SETTLE_DELAY_MS)
    }
  }

  private fun dispatchKeyEvents(view: View, events: Array<KeyEvent>, index: Int, onComplete: () -> Unit) {
    if (index >= events.size) {
      onComplete()
      return
    }
    view.dispatchKeyEvent(events[index])
    mainHandler.postDelayed({
      dispatchKeyEvents(view, events, index + 1, onComplete)
    }, 5)
  }

  private fun createTouchEvent(
    action: Int,
    downTime: Long,
    eventTime: Long,
    x: Float,
    y: Float
  ): MotionEvent {
    val properties = MotionEvent.PointerProperties().apply {
      id = 0
      toolType = MotionEvent.TOOL_TYPE_FINGER
    }
    val coords = MotionEvent.PointerCoords().apply {
      this.x = x
      this.y = y
      pressure = 1.0f
      size = 1.0f
    }
    return MotionEvent.obtain(
      downTime,
      eventTime,
      action,
      1,
      arrayOf(properties),
      arrayOf(coords),
      0, 0,
      1.0f, 1.0f,
      0, 0,
      InputDevice.SOURCE_TOUCHSCREEN,
      0
    )
  }

  private fun viewCenter(view: View): FloatArray {
    val location = IntArray(2)
    view.getLocationInWindow(location)
    return floatArrayOf(
      location[0] + view.width / 2f,
      location[1] + view.height / 2f
    )
  }
}
