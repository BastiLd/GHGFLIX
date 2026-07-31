/**
 * Expo-Zusatz: GHGFlix auf Android TV / Google TV sichtbar machen.
 *
 * DAS PROBLEM, DAS DAS HIER LÖST:
 * Eine normale Handy-App hat im Manifest nur
 *     <category android:name="android.intent.category.LAUNCHER" />
 * Der Startbildschirm von Android TV zeigt aber AUSSCHLIESSLICH Apps mit
 *     <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
 * Folge: Die App wird sauber installiert (beim zweiten Versuch fragt Android
 * sogar nach einem „Update"), taucht danach aber NIRGENDS auf und lässt sich
 * auch nicht öffnen. Genau dieses Verhalten hatten wir.
 *
 * Ergänzt werden deshalb:
 *   1. LEANBACK_LAUNCHER an der Haupt-Activity  → App erscheint im TV-Menü
 *   2. uses-feature leanback / touchscreen "nicht erforderlich"
 *      → Android hält die App auf einem Gerät ohne Touchscreen für zulässig
 *   3. android:banner am <application>          → das Kachelbild im TV-Menü
 *      (ohne Banner zeigen manche Launcher die App gar nicht an)
 *
 * Das Banner-Bild liegt unter assets/tv-banner.png (320×180). Fehlt es, wird
 * automatisch auf das App-Symbol zurückgefallen — der Build bricht nie ab.
 */
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const BANNER_SRC = "assets/tv-banner.png";
const BANNER_RES = "tv_banner";

/** <uses-feature ... required="false"> ergänzen, ohne Doppelte zu erzeugen. */
function addUsesFeature(manifest, name) {
  manifest["uses-feature"] = manifest["uses-feature"] || [];
  const exists = manifest["uses-feature"].some((f) => f?.$?.["android:name"] === name);
  if (exists) return;
  manifest["uses-feature"].push({
    $: { "android:name": name, "android:required": "false" },
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

const withTvManifest = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // 1) Gerätemerkmale: beides ausdrücklich NICHT erforderlich
    addUsesFeature(manifest, "android.software.leanback");
    addUsesFeature(manifest, "android.hardware.touchscreen");

    const application = manifest.application?.[0];
    if (!application) return cfg;

    // 2) Kachelbild im TV-Startbildschirm
    const hasBanner = fs.existsSync(path.join(cfg.modRequest.projectRoot, BANNER_SRC));
    application.$["android:banner"] = hasBanner ? `@drawable/${BANNER_RES}` : "@mipmap/ic_launcher";

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
        if (!has) {
          filter.category.push({ $: { "android:name": "android.intent.category.LEANBACK_LAUNCHER" } });
        }
      }
    }
    return cfg;
  });

/** Banner-Bild in die Android-Ressourcen kopieren. */
const withTvBanner = (config) =>
  withDangerousMod(config, [
    "android",
    async (cfg) => {
      try {
        const src = path.join(cfg.modRequest.projectRoot, BANNER_SRC);
        if (fs.existsSync(src)) {
          const dir = path.join(cfg.modRequest.platformProjectRoot, "app/src/main/res/drawable");
          fs.mkdirSync(dir, { recursive: true });
          fs.copyFileSync(src, path.join(dir, `${BANNER_RES}.png`));
        }
      } catch (e) {
        // Ein fehlendes Banner darf den Build NIE zum Scheitern bringen —
        // das Manifest fällt dann auf @mipmap/ic_launcher zurück.
        console.warn("[withAndroidTv] Banner konnte nicht kopiert werden:", e.message);
      }
      return cfg;
    },
  ]);

module.exports = function withAndroidTv(config) {
  return withTvManifest(withTvBanner(config));
};
