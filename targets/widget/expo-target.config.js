// targets/widget/expo-target.config.js  —  NEW FILE
// iPhone home-screen + lock-screen widget for turf owners ("PlayOn Slots").
// Built by @bacons/apple-targets during `eas build -p ios`.

/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "PlayOnSlots",
  displayName: "PlayOn Slots",
  // Turf buttons inside the widget need iOS 17+. The main app still supports
  // older iPhones — they just won't see this widget.
  deploymentTarget: "17.0",
  entitlements: {
    // Same App Group as the main app → the app can hand today's slots to the widget
    "com.apple.security.application-groups": ["group.com.playonnew.app"],
  },
});
