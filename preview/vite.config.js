import { defineConfig, transformWithEsbuild } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [{
    name: "native-client-preview", enforce: "pre",
    async transform(code, id) {
      if (!/\/(mobile|tv)\//.test(id.replaceAll("\\", "/")) || !id.endsWith(".js")) return;
      code = code.replaceAll("process.env.EXPO_PUBLIC_APP_VARIANT", "globalThis.__GHG_DEVICE__");
      // Native Wiedergabe bekommt ausschließlich in der Vorschau einen HTML-Adapter.
      if (id.endsWith("/player.js")) {
        code = 'import * as PreviewVideo from "/src/video.jsx";\n' + code.replace('require("expo-video")', "PreviewVideo");
      }
      return transformWithEsbuild(code, id, { loader: "jsx", jsx: "automatic" });
    },
  }],
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: path.join(root, "src/native.js") },
      { find: /^@react-native-async-storage\/async-storage$/, replacement: path.join(root, "src/storage.js") },
      { find: /^expo-network$/, replacement: path.join(root, "src/network.js") },
      { find: /^expo-constants$/, replacement: path.join(root, "src/constants.js") },
      { find: /^react-native-safe-area-context$/, replacement: path.join(root, "src/safe-area.jsx") },
      { find: /^expo-status-bar$/, replacement: path.join(root, "src/status.js") },
      { find: /^react-dom(\/.*)?$/, replacement: path.join(root, "node_modules/react-dom") + "$1" },
      { find: /^react(\/.*)?$/, replacement: path.join(root, "node_modules/react") + "$1" },
    ], dedupe: ["react", "react-dom"],
  },
  define: { "process.env.EXPO_PUBLIC_APP_VARIANT": "globalThis.__GHG_DEVICE__" },
  optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime", "react-dom/client", "react-native-web"], esbuildOptions: { loader: { ".js": "jsx" } } },
  server: { fs: { allow: [path.resolve(root, ".." )] }, proxy: { "/api": { target: "http://127.0.0.1:8490", changeOrigin: true } } },
  build: { rollupOptions: { input: { app: path.join(root, "app.html") } } },
});
