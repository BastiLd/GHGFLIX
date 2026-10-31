import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
// The source revision is shared by the running UI and its public manifest.
// Docker receives it as a build argument; a local checkout can resolve it itself.
let revision = process.env.GHGFLIX_BUILD_SHA || '';
if (!revision) try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { revision = version; }
const buildId = `${version}-${revision}`;

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), {
    name: 'ghgflix-build-info',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify({ app: 'ghgflix-web', version, buildId, revision, minimumServerVersion: '3.6.0' }) });
    },
  }],
  define: { __APP_VERSION__: JSON.stringify(version), __BUILD_ID__: JSON.stringify(buildId) },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8490" },
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
