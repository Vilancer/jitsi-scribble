// ReplayKit broadcast upload extension: react-native-webrtc's iOS screen
// capture. It sends screen frames to the app over a unix socket in the shared
// App Group container (SampleHandler.swift, from Jitsi, Apache-2.0). Built by
// @bacons/apple-targets at prebuild.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'broadcast-upload',
  name: 'BroadcastExtension',
  displayName: 'Scribble Screen Share',
  bundleIdentifier: '.broadcast',
  deploymentTarget: '15.1',
  frameworks: ['ReplayKit'],
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
});
