package expo.modules.ghgflixplayerdevice

import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues

/** Read the window or last system brightness without assuming that the optional
 * screen_auto_brightness_adj setting exists (Expo SDK 54's reader assumes it).
 * No global setting is written and no permission is requested. */
class GHGFlixPlayerDeviceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GHGFlixPlayerDevice")
    AsyncFunction("getBrightnessAsync") {
      val activity = appContext.currentActivity ?: error("No foreground activity")
      val windowValue = activity.window.attributes.screenBrightness
      if (windowValue >= 0f) windowValue.coerceIn(0f, 1f)
      else (Settings.System.getInt(activity.contentResolver, Settings.System.SCREEN_BRIGHTNESS, 102) / 255f).coerceIn(0f, 1f)
    }.runOnQueue(Queues.MAIN)
  }
}
