const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
// Inlining von EXPO_PUBLIC_* darf keinen Transform aus dem anderen Produkt
// wiederverwenden. Der native APK-Name allein aendert Metros Cache nicht.
config.cacheVersion = `ghgflix-3.5-${process.env.EXPO_PUBLIC_APP_VARIANT || "mobile"}`;
config.watchFolders = [path.resolve(__dirname, "../tv")];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
module.exports = config;
