const basis = require("./app.json").expo;

module.exports = () => {
  const tv = process.env.EXPO_PUBLIC_APP_VARIANT === "tv";
  return {
    ...basis,
    name: tv ? "GHGFlix TV" : "GHGFlix Mobile",
    version: "3.4.0",
    orientation: tv ? "landscape" : "default",
    runtimeVersion: tv ? "tv-1" : "mobile-2",
    plugins: [["./plugins/withAndroidTv.js", { tv }]],
    android: {
      ...basis.android,
      package: tv ? "com.bastild.ghgflix.tv" : "com.bastild.ghgflix",
      versionCode: 16,
    },
    extra: { ...basis.extra, appVariant: tv ? "tv" : "mobile" },
  };
};
