/**
 * Expo-Zusatz: GHGFlix auf Android TV / Google TV sichtbar machen.
 *
 * DAS PROBLEM, DAS DAS HIER LÖST:
 * Eine normale Handy-App hat im Manifest nur
 *     <category android:name="android.intent.category.LAUNCHER" />
 * Der Startbildschirm von Android TV zeigt aber AUSSCHLIESSLICH Apps mit
 *     <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
 * Folge: Die App wird sauber installiert (beim zweiten Versuch fragt Android
 * sogar nach einem „Update"), taucht danach aber NIRGENDS auf.
 *
 * Ergänzt werden deshalb:
 *   1. LEANBACK_LAUNCHER an der Haupt-Activity  → App erscheint im TV-Menü
 *   2. uses-feature leanback / touchscreen "nicht erforderlich"
 *      → Android hält die App auf einem Gerät ohne Touchscreen für zulässig
 *   3. android:banner → das Kachelbild im TV-Menü
 *
 * Das 320×180-Banner wird bei jedem Prebuild aus dem versionierten Asset
 * kopiert. Eine nur im generierten android-Ordner vorhandene Bilddatei geht
 * beim Neubau verloren und darf deshalb nicht die einzige Quelle sein.
 */
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

/** <uses-feature ... required="false"> ergänzen, ohne Doppelte zu erzeugen. */
function addUsesFeature(manifest, name, required = false) {
  manifest["uses-feature"] = manifest["uses-feature"] || [];
  const exists = manifest["uses-feature"].find((f) => f?.$?.["android:name"] === name);
  if (exists) { exists.$["android:required"] = String(required); return; }
  manifest["uses-feature"].push({
    $: { "android:name": name, "android:required": String(required) },
  });
}

/** Die Activity finden, die den MAIN/LAUNCHER-Filter trägt. */
function findLauncherActivity(application) {
  const activities = application?.activity ?? [];
  return activities.find((a) =>
    (a["intent-filter"] ?? []).some((f) =>
      (f.action ?? []).some((x) => x?.$?.["android:name"] === "android.intent.action.MAIN"),
    ),
  );
}

module.exports = function withAndroidTv(config, options = { tv: true }) {
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    const tv = options.tv !== false;
    // Mobile erhält keinen TV-Launcher; nur der eigene TV-Build erscheint dort.
    if (tv) addUsesFeature(manifest, "android.software.leanback", true);
    else manifest["uses-feature"] = (manifest["uses-feature"] || []).filter((f) => f?.$?.["android:name"] !== "android.software.leanback");
    addUsesFeature(manifest, "android.hardware.touchscreen");

    const application = manifest.application?.[0];
    if (!application) return cfg;

    // 2) Das unten bei jedem Prebuild kopierte TV-Banner verwenden.
    if (tv) application.$["android:banner"] = "@drawable/ghgflix_tv_banner";
    else delete application.$["android:banner"];

    // 3) Unverschlüsseltes HTTP ausdrücklich erlauben.
    //    Ab Android 9 blockiert das System http:// standardmäßig — die App
    //    meldet dann nur „Network request failed", ohne den Server je zu
    //    erreichen. Der GHGFlix-Server im eigenen Netz läuft aber genau so
    //    (http://192.168.x.x:8484). Expo setzt das zwar über
    //    android.usesCleartextTraffic, hier wird es zusätzlich hart gesetzt,
    //    damit es unabhängig von der Plugin-Reihenfolge sicher im Manifest steht.
    application.$["android:usesCleartextTraffic"] = "true";

    // 3) LEANBACK_LAUNCHER an den vorhandenen MAIN-Filter hängen
    const activity = findLauncherActivity(application);
    if (activity) {
      for (const filter of activity["intent-filter"] ?? []) {
        const isMain = (filter.action ?? []).some(
          (x) => x?.$?.["android:name"] === "android.intent.action.MAIN",
        );
        if (!isMain) continue;
        filter.category = filter.category ?? [];
        const has = filter.category.some(
          (c) => c?.$?.["android:name"] === "android.intent.category.LEANBACK_LAUNCHER",
        );
        if (tv && !has) {
          filter.category.push({ $: { "android:name": "android.intent.category.LEANBACK_LAUNCHER" } });
        }
        if (!tv) filter.category = filter.category.filter((c) => c?.$?.["android:name"] !== "android.intent.category.LEANBACK_LAUNCHER");
      }
      if (tv) activity.$["android:screenOrientation"] = "landscape";
      else delete activity.$["android:screenOrientation"];
    }
    return cfg;
  });
  if (options.tv !== false) config = withDangerousMod(config, ["android", async (cfg) => {
    // Die Ressource wird bei JEDEM Prebuild kopiert, damit das Manifest niemals
    // auf ein beim Neubau verlorenes Banner zeigt.
    const target = path.join(cfg.modRequest.platformProjectRoot, "app/src/main/res/drawable/ghgflix_tv_banner.png");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(cfg.modRequest.projectRoot, "assets/tv-banner.png"), target);
    return cfg;
  }]);
  return config;
};
