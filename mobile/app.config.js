const basis = require("./app.json").expo;
module.exports = () => {
  const tv = process.env.EXPO_PUBLIC_APP_VARIANT === "tv";
  return {
    ...basis,
    name: tv ? "GHGFlix TV" : "GHGFlix Mobile",
    orientation: tv ? "landscape" : "default",
    runtimeVersion: tv ? "tv-3" : "mobile-3",
    plugins: [["./plugins/withAndroidTv.js", { tv }], ...basis.plugins.filter(p => (Array.isArray(p) ? p[0] : p) !== "./plugins/withAndroidTv.js")],
    android: { ...basis.android, package: tv ? "com.bastild.ghgflix.tv" : "com.bastild.ghgflix",
      ...(!tv && process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}) },
    extra: { ...basis.extra, appVariant: tv ? "tv" : "mobile" },
  };
};
