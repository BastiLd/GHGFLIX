const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const variant = process.argv[2], action = process.argv[3];
if (!["tv", "mobile"].includes(variant) || !["start", "build"].includes(action)) throw new Error("Aufruf: client.cjs tv|mobile start|build");
const cwd = path.resolve(__dirname, "..");
const env = { ...process.env, EXPO_PUBLIC_APP_VARIANT: variant, CI: action === "build" ? "1" : "" };
function run(cmd, args, dir = cwd) {
  const r = spawnSync(cmd, args, { cwd: dir, env, stdio: "inherit", shell: false });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status || 1);
}
const expo = path.join(cwd, "node_modules/expo/bin/cli");
if (action === "start") run(process.execPath, [expo, "start", "--android"]);
else {
  run(process.execPath, [expo, "prebuild", "--platform", "android", "--no-install"]);
  // Gradle verfolgt EXPO_PUBLIC_* nicht als Datei-Eingabe. Beim Wechsel TV →
  // Mobile muss deshalb das gebuendelte JS sicher neu erzeugt werden.
  const bundle = path.join(cwd, "android/app/build/generated/assets/createBundleReleaseJsAndAssets/index.android.bundle");
  if (fs.existsSync(bundle)) fs.unlinkSync(bundle);
  const autolink = path.join(cwd, "android/build/generated/autolinking/autolinking.json");
  if (fs.existsSync(autolink)) fs.unlinkSync(autolink);
  const manifest = path.join(cwd, "android/app/build/generated/assets/createReleaseUpdatesResources/app.manifest");
  if (fs.existsSync(manifest)) fs.unlinkSync(manifest);
  // Die APK enthaelt ihr JS-Bundle und benoetigt keinen Entwicklungsserver.
  // Auch Gradles Build-Cache kennt die Produkt-Umgebungsvariable nicht und
  // koennte die gerade geloeschte Datei aus dem anderen Produkt restaurieren.
  const args = ["assembleRelease", `-PreactNativeArchitectures=${variant === "tv" ? "arm64-v8a,x86,x86_64" : "arm64-v8a,x86_64"}`, "-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1536m", "--max-workers=2", "--no-build-cache", "--no-daemon", "--console=plain"];
  // Direkt Java starten: cmd.exe wuerde Anfuehrungszeichen in Argumenten wie
  // org.gradle.jvmargs erneut interpretieren und an Gradle weiterreichen.
  const java = env.JAVA_HOME ? path.join(env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java") : "java";
  run(java, ["-classpath", path.join(cwd, "android/gradle/wrapper/gradle-wrapper.jar"), "org.gradle.wrapper.GradleWrapperMain", ...args], path.join(cwd, "android"));
  const target = path.resolve(cwd, variant === "tv" ? "../tv/build" : "build");
  fs.mkdirSync(target, { recursive: true });
  const name = `GHGFlix-${variant === "tv" ? "TV" : "Mobile"}-3.4.0-local.apk`;
  fs.copyFileSync(path.join(cwd, "android/app/build/outputs/apk/release/app-release.apk"), path.join(target, name));
  console.log(`APK: ${path.join(target, name)}`);
}
