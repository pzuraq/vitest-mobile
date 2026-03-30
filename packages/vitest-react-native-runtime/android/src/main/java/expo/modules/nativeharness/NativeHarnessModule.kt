package expo.modules.nativeharness

import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference
import java.util.LinkedList
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger

class NativeHarnessModule : Module() {
  private val handleCounter = AtomicInteger(1)
  private val viewHandles = ConcurrentHashMap<Int, WeakReference<View>>()
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("NativeHarness")

    Function("findByTestId") { testId: String ->
      runOnMainSync {
        val view = findViewByTestId(testId) ?: return@runOnMainSync null
        assignHandle(view)
      }
    }

    Function("getText") { handle: Int ->
      runOnMainSync {
        val view = viewByHandle(handle) ?: return@runOnMainSync null
        readText(view)
      }
    }

    Function("getFrame") { handle: Int ->
      runOnMainSync {
        val view = viewByHandle(handle) ?: return@runOnMainSync null
        val location = IntArray(2)
        view.getLocationOnScreen(location)
        mapOf(
          "x" to location[0].toDouble(),
          "y" to location[1].toDouble(),
          "width" to view.width.toDouble(),
          "height" to view.height.toDouble()
        )
      }
    }

    Function("isVisible") { handle: Int ->
      runOnMainSync {
        val view = viewByHandle(handle) ?: return@runOnMainSync false
        checkVisible(view)
      }
    }

    Function("getViewInfo") { handle: Int ->
      runOnMainSync {
        val view = viewByHandle(handle) ?: return@runOnMainSync null
        val location = IntArray(2)
        view.getLocationOnScreen(location)
        mapOf(
          "testId" to (getTestId(view) ?: view.contentDescription?.toString()),
          "text" to readText(view),
          "isVisible" to checkVisible(view),
          "isEnabled" to view.isEnabled,
          "frame" to mapOf(
            "x" to location[0].toDouble(),
            "y" to location[1].toDouble(),
            "width" to view.width.toDouble(),
            "height" to view.height.toDouble()
          )
        )
      }
    }

    AsyncFunction("tap") { handle: Int, promise: Promise ->
      mainHandler.post {
        val view = viewByHandle(handle)
        if (view == null) {
          promise.reject("ERR_VIEW_NOT_FOUND", "View with handle $handle not found", null)
          return@post
        }
        TouchSynthesizer.tap(view) {
          promise.resolve(null)
        }
      }
    }

    AsyncFunction("longPress") { handle: Int, durationMs: Double, promise: Promise ->
      mainHandler.post {
        val view = viewByHandle(handle)
        if (view == null) {
          promise.reject("ERR_VIEW_NOT_FOUND", "View with handle $handle not found", null)
          return@post
        }
        TouchSynthesizer.longPress(view, durationMs.toLong()) {
          promise.resolve(null)
        }
      }
    }

    AsyncFunction("typeText") { text: String, promise: Promise ->
      mainHandler.post {
        val activity = appContext.currentActivity
        if (activity == null) {
          promise.reject("ERR_NO_ACTIVITY", "No current activity", null)
          return@post
        }
        TouchSynthesizer.typeText(activity, text) {
          promise.resolve(null)
        }
      }
    }
  }

  // -- Handle management --

  private fun assignHandle(view: View): Int {
    for ((h, ref) in viewHandles) {
      if (ref.get() === view) return h
    }
    val handle = handleCounter.getAndIncrement()
    viewHandles[handle] = WeakReference(view)
    return handle
  }

  private fun viewByHandle(handle: Int): View? {
    val ref = viewHandles[handle] ?: return null
    val view = ref.get()
    if (view == null) {
      viewHandles.remove(handle)
    }
    return view
  }

  // -- View tree queries --

  private fun getDecorView(): View? {
    return appContext.currentActivity?.window?.decorView
  }

  private var reactTestIdResId: Int = -1

  private fun getReactTestIdResId(): Int {
    if (reactTestIdResId != -1) return reactTestIdResId
    val ctx = appContext.currentActivity ?: return 0

    // Try the app's merged resources first (resources from AARs merge under app package)
    var resId = ctx.resources.getIdentifier("react_test_id", "id", ctx.packageName)
    if (resId == 0) {
      resId = ctx.resources.getIdentifier("react_test_id", "id", "com.facebook.react")
    }
    // Try reflection as last resort
    if (resId == 0) {
      try {
        val clazz = Class.forName("com.facebook.react.R\$id")
        resId = clazz.getDeclaredField("react_test_id").getInt(null)
      } catch (_: Exception) {}
    }
    reactTestIdResId = resId
    return resId
  }

  private fun getTestId(view: View): String? {
    val resId = getReactTestIdResId()
    if (resId != 0) {
      val tag = view.getTag(resId)
      if (tag is String) return tag
    }
    return view.contentDescription?.toString()
  }

  private fun findViewByTestId(testId: String): View? {
    val root = getDecorView() ?: return null
    return bfs(root) { view -> getTestId(view) == testId }
  }

  private fun bfs(root: View, predicate: (View) -> Boolean): View? {
    val queue = LinkedList<View>()
    queue.add(root)
    while (queue.isNotEmpty()) {
      val view = queue.poll() ?: continue
      if (predicate(view)) return view
      if (view is ViewGroup) {
        for (i in 0 until view.childCount) {
          queue.add(view.getChildAt(i))
        }
      }
    }
    return null
  }

  // -- Text reading --

  private fun readText(view: View): String? {
    if (view is TextView) return view.text?.toString()
    val texts = mutableListOf<String>()
    collectText(view, texts)
    if (texts.isNotEmpty()) return texts.joinToString("")
    return view.contentDescription?.toString()
  }

  private fun collectText(view: View, texts: MutableList<String>) {
    if (view is TextView) {
      val text = view.text?.toString()
      if (!text.isNullOrEmpty()) {
        texts.add(text)
        return
      }
    }
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) {
        collectText(view.getChildAt(i), texts)
      }
    }
  }

  // -- Visibility --

  private fun checkVisible(view: View): Boolean {
    if (!view.isShown) return false
    if (view.alpha < 0.01f) return false
    if (view.width == 0 || view.height == 0) return false
    val rect = Rect()
    return view.getGlobalVisibleRect(rect)
  }

  // -- Main thread helper --

  private fun <T> runOnMainSync(block: () -> T): T {
    if (Looper.myLooper() == Looper.getMainLooper()) return block()
    var result: T? = null
    var thrown: Throwable? = null
    val latch = CountDownLatch(1)
    mainHandler.post {
      try {
        result = block()
      } catch (e: Throwable) {
        thrown = e
      } finally {
        latch.countDown()
      }
    }
    latch.await()
    thrown?.let { throw it }
    @Suppress("UNCHECKED_CAST")
    return result as T
  }
}
