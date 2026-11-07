/**
 * withAndroidScreenShare — Expo config plugin enabling react-native-webrtc's Android
 * screen capture (MediaProjection).
 *
 * On Android, rn-webrtc captures the screen via MediaProjection, which on API 29+ must
 * run inside a foreground service typed `mediaProjection` (mandatory on API 34+). rn-webrtc
 * v124 already ships that service (`com.oney.WebRTCModule.MediaProjectionService`, with
 * `foregroundServiceType="mediaProjection"`) in its own AndroidManifest — it merges into the
 * app automatically, so we do NOT re-declare it here. What the library does NOT do for us is
 * flip its runtime opt-in flag: `MediaProjectionService.launch()` early-returns unless
 * `WebRTCModuleOptions.enableMediaProjectionService` is `true`, so screen capture silently
 * fails (and crashes on API 34+). This plugin sets that flag in MainApplication.onCreate.
 *
 * The FOREGROUND_SERVICE / FOREGROUND_SERVICE_MEDIA_PROJECTION uses-permission entries are
 * declared in app.json (`android.permissions`). rn-webrtc starts/stops the service itself on
 * getDisplayMedia / stop, so no JS lifecycle wiring is needed beyond the shared
 * startScreenShare/stopScreenShare in useJitsiConference.
 */
const { withMainApplication, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// White status-bar icon for the screen-share foreground-service notification.
// react-native-webrtc looks up a drawable named "ic_notification"; without it the
// notification has no icon and Android 11+ kills the mediaProjection FGS (killing
// screen capture). System-tinted, so it must be a white/opaque silhouette.
const IC_NOTIFICATION_XML = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24"
    android:tint="#FFFFFFFF">
  <path
      android:fillColor="#FFFFFFFF"
      android:pathData="M20,18c1.1,0 1.99,-0.9 1.99,-2L22,6c0,-1.11 -0.9,-2 -2,-2L4,4c-1.11,0 -2,0.89 -2,2v10c0,1.1 0.89,2 2,2L0,18v2h24v-2h-4zM13,14.47v-2.19c-2.78,0 -4.61,0.85 -6,2.72 0.56,-2.67 2.11,-5.33 6,-5.87L13,7l4,3.73 -4,3.74z"/>
</vector>
`;

// Write res/drawable/ic_notification.xml into the generated Android project.
const withNotificationIcon = (config) =>
  withDangerousMod(config, [
    'android',
    (cfg) => {
      const drawableDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/res/drawable',
      );
      fs.mkdirSync(drawableDir, { recursive: true });
      fs.writeFileSync(path.join(drawableDir, 'ic_notification.xml'), IC_NOTIFICATION_XML);
      return cfg;
    },
  ]);

const ENABLE_LINE =
  'com.oney.WebRTCModule.WebRTCModuleOptions.getInstance().enableMediaProjectionService = true';

const withEnableMediaProjectionFlag = (config) =>
  withMainApplication(config, (cfg) => {
    const main = cfg.modResults;
    if (main.language !== 'kt') {
      throw new Error(
        `[withAndroidScreenShare] expected a Kotlin MainApplication, got "${main.language}". ` +
          'Update this plugin for the new MainApplication format.',
      );
    }
    // Idempotent: repeated prebuilds must not inject the line twice.
    if (main.contents.includes('enableMediaProjectionService')) {
      return cfg;
    }
    const anchor = 'super.onCreate()';
    if (!main.contents.includes(anchor)) {
      throw new Error('[withAndroidScreenShare] could not find super.onCreate() to anchor to.');
    }
    main.contents = main.contents.replace(
      anchor,
      `${anchor}\n    // Enable react-native-webrtc's MediaProjection foreground service\n    // (required for Android screen sharing; mandatory FGS type on API 34+).\n    ${ENABLE_LINE}`,
    );
    return cfg;
  });

const withAndroidScreenShare = (config) =>
  withNotificationIcon(withEnableMediaProjectionFlag(config));

module.exports = withAndroidScreenShare;
