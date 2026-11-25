package com.lern.privacy

import java.util.concurrent.atomic.AtomicInteger
import android.app.Dialog
import android.os.Build
import android.os.SystemClock
import android.view.View
import android.graphics.Rect
import android.view.ViewTreeObserver
import android.view.WindowManager.LayoutParams
import android.widget.FrameLayout
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LernPrivacyModule : Module() {
  private var generation = 0
  private val revision = AtomicInteger()
  private var request = 0
  private var active = true
  private var cover: Dialog? = null

  override fun definition() = ModuleDefinition {
    Name("LernPrivacy")
    Function("invalidate") { revision.incrementAndGet() }
    Function("elapsed") { SystemClock.elapsedRealtime().toDouble() }
    AsyncFunction("cycle") {
      val activity = appContext.currentActivity
      if (Build.VERSION.SDK_INT >= 33) activity?.setRecentsScreenshotEnabled(false)
      generation
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("reveal") { cycle: Int, tag: String, locked: Boolean, deadline: Double, expectedRevision: Int ->
      if (generation == cycle && active && expectedRevision == revision.get())
        reveal(++request, cycle, tag, locked, deadline, expectedRevision)
    }.runOnQueue(Queues.MAIN)
    OnActivityEntersForeground { active = true }
    OnActivityEntersBackground {
      active = false
      generation++
      val activity = appContext.currentActivity
      if (activity != null && !activity.isFinishing && cover == null) {
        if (Build.VERSION.SDK_INT < 33) activity.window.addFlags(LayoutParams.FLAG_SECURE)
        val shield = Dialog(activity, android.R.style.Theme_DeviceDefault_NoActionBar_Fullscreen)
        shield.setCancelable(false)
        shield.setContentView(FrameLayout(activity))
        shield.window?.addFlags(LayoutParams.FLAG_SECURE or LayoutParams.FLAG_NOT_FOCUSABLE)
        shield.show()
        cover = shield
      }
    }
    OnActivityDestroys {
      generation++
      dismissCover()
    }
  }

  private fun reveal(id: Int, cycle: Int, tag: String, locked: Boolean, deadline: Double, expectedRevision: Int) {
    val shield = cover ?: return
    val window = appContext.currentActivity?.window ?: return
    val root = window.decorView
    fun current() = id == request && cycle == generation && active && cover === shield && expectedRevision == revision.get() &&
      (deadline == 0.0 || SystemClock.elapsedRealtime() < deadline)
    fun ready(): Boolean {
      val marker = root.findViewWithTag<View>(tag) ?: return false
      // RN modals have separate focusable windows. Our shield never takes focus.
      return marker.isShown && marker.getGlobalVisibleRect(Rect()) && (!locked || root.hasWindowFocus())
    }
    fun retry() = root.postOnAnimation { if (current()) reveal(id, cycle, tag, locked, deadline, expectedRevision) }
    if (!current()) return
    if (!ready()) { retry(); return }
    val presented = Runnable {
      if (current()) {
        if (ready()) {
          dismissCover()
          if (Build.VERSION.SDK_INT < 33) window.clearFlags(LayoutParams.FLAG_SECURE)
        } else retry()
      }
    }
    if (Build.VERSION.SDK_INT >= 29 && root.isHardwareAccelerated) {
      root.viewTreeObserver.registerFrameCommitCallback(presented)
    } else {
      root.viewTreeObserver.addOnDrawListener(object : ViewTreeObserver.OnDrawListener {
        private var drawn = false
        override fun onDraw() {
          if (drawn) return
          drawn = true
          root.post {
            if (root.viewTreeObserver.isAlive) root.viewTreeObserver.removeOnDrawListener(this)
            root.postOnAnimation(presented)
          }
        }
      })
    }
    root.invalidate()
  }

  private fun dismissCover() {
    val shield = cover ?: return
    cover = null
    // Android can remove the dialog window itself during activity recreation.
    if (shield.window?.decorView?.isAttachedToWindow == true) shield.dismiss()
  }

}
