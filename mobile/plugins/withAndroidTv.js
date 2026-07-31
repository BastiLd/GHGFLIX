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
 * ── WARUM DAS BANNER JETZT DAS APP-SYMBOL IST ──────────────────────────────
 * Eine frühere Fassung kopierte ein eigenes 320×180-Bild nach
 * res/drawable/tv_banner.png und trug `@drawable/tv_banner` ins Manifest ein.
 * Kommt diese Datei beim Cloud-Build aus irgendeinem Grund NICHT an (der
 * android-Ordner wird beim Bauen neu erzeugt), verweist das Manifest auf eine
 * Ressource, die es nicht gibt — und Android bricht die App SOFORT BEIM START
 * ab: kurz schwarz, dann zurück ins Menü. Genau dieses Verhalten trat auf.
 *
 * `@mipmap/ic_launcher` ist das App-Symbol und existiert IMMER. Es sieht als
 * Kachel etwas schlichter aus, kann aber unmöglich fehlen. Stabilität geht
 * hier klar vor Optik.
 */
const { withAndroidManifest } = require("expo/config-plugins");

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

module.exports = function withAndroidTv(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // 1) Gerätemerkmale: beides ausdrücklich NICHT erforderlich
    addUsesFeature(manifest, "android.software.leanback");
    addUsesFeature(manifest, "android.hardware.touchscreen");

    const application = manifest.application?.[0];
    if (!application) return cfg;

    // 2) Kachelbild: bewusst das App-Symbol — eine Ressource, die es garantiert
    //    gibt (siehe Erklärung oben).
    application.$["android:banner"] = "@mipmap/ic_launcher";

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
        if (!has) {
          filter.category.push({ $: { "android:name": "android.intent.category.LEANBACK_LAUNCHER" } });
        }
      }
    }
    return cfg;
  });
};
