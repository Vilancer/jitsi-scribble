// app.json plus the one value that must not be committed: the Apple team that
// signs the iOS build (the screen-share App Group needs a paid team).
//   APPLE_TEAM_ID=<team id> npx expo prebuild --platform ios --clean
module.exports = ({ config }) => ({
  ...config,
  ios: { ...config.ios, ...(process.env.APPLE_TEAM_ID ? { appleTeamId: process.env.APPLE_TEAM_ID } : {}) },
});
