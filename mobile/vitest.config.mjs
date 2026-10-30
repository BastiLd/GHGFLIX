import { defineConfig, transformWithEsbuild } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [{ name: "mobile-jsx", async transform(code, id) {
    if (/\/mobile\/src\/.*\.js$/.test(id.replaceAll("\\", "/"))) {
      return transformWithEsbuild(code, id, { loader: "jsx", jsx: "automatic" });
    }
  } }],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: { "react-native": fileURLToPath(new URL("./test/native-dom.jsx", import.meta.url)) },
  },
  test: { include: ["mobile/test/*.test.jsx"], setupFiles: ["./mobile/test/native-platform-mocks.js"], environment: "jsdom" },
});
