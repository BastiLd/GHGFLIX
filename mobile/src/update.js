/**
 * ══════════════════════════════════════════════════════════════════════════
 *  APP-AKTUALISIERUNG
 * ══════════════════════════════════════════════════════════════════════════
 *
 * DAS PROBLEM
 * „Können wir das Updaten auch leichter machen? Ohne dass ich schon wieder
 *  die URL eingeben muss im Downloader?"
 *
 * Bisher lief es so: neue Fassung bauen, auf den Server legen, am Fernseher
 * einen Browser öffnen und „http://192.168.68.157:8484/apk" von Hand über
 * die Bildschirmtastatur eintippen. Bei jedem Update aufs Neue.
 *
 * WIE ES JETZT GEHT
 * Die App kennt ihren Server ohnehin schon. Sie fragt beim Start nach, ob
 * dort eine neuere Fassung liegt, und zeigt dann in den Einstellungen einen
 * Knopf. Ein Druck darauf startet den Download — die Adresse tippt niemand
 * mehr.
 *
 * ZUM VERGLEICH DER VERSIONEN
 * Der Server meldet die Versionsnummer der hinterlegten Datei; sie kommt vom
 * Upload-Skript aus mobile/app.json. Verglichen wird zahlenweise
 * ("3.10.0" ist neuer als "3.9.0" — ein Textvergleich käme hier zum
 * falschen Ergebnis).
 *
 * WARUM NICHT VOLLAUTOMATISCH INSTALLIEREN
 * Android erlaubt einer App nur dann, eine andere zu installieren, wenn der
 * Nutzer das ausdrücklich erlaubt hat, und der Weg dorthin führt über einen
 * nativen Zusatz (expo-intent-launcher). Nach der Geschichte mit expo-asset
 * — ein nur mittelbar installiertes natives Modul hat die Fernseh-App
 * wochenlang beim Start abstürzen lassen — wird hier der Weg ohne
 * zusätzliches Modul gegangen: Die App öffnet den Download, den Rest
 * erledigt Android wie gewohnt. Ist der Zusatz vorhanden, wird er benutzt;
 * fehlt er, greift der einfache Weg.
 */
/* react-native wird bewusst erst beim Aufruf geladen, nicht oben als Import.
   Dadurch bleibt diese Datei auch in einer reinen Node-Umgebung ladbar — und
   genau das erlaubt es, den Versionsvergleich ohne Gerät zu testen
   (test/update.test.mjs). Der Vergleich ist die Stelle, an der solche
   Selbst-Updates typischerweise scheitern. */

/**
 * Versionsnummern vergleichen.
 * @returns {number} >0 wenn a neuer ist, <0 wenn b neuer, 0 bei gleich
 */
export function vergleicheVersion(a, b) {
  const zahlen = (v) => String(v || "0").split(".").map((x) => parseInt(x, 10) || 0);
  const x = zahlen(a), y = zahlen(b);
  const laenge = Math.max(x.length, y.length);
  for (let i = 0; i < laenge; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Beim Server nachfragen, ob eine neuere Fassung bereitliegt.
 *
 * @param {Function} api      der Serverzugriff der App
 * @param {string}   eigene   die eigene Versionsnummer
 * @returns {Promise<{neuer:boolean, version:string|null, groesse:string|null, url:string}|null>}
 */
export async function pruefeUpdate(api, eigene) {
  try {
    const s = await api("/api/apk/status");
    if (!s?.available) return null;
    // Ohne Versionsangabe (Datei von Hand hineinkopiert) lässt sich nicht
    // vergleichen — dann wird das Update angeboten, aber nicht als „neuer"
    // hervorgehoben, um keinen Fehlalarm zu erzeugen.
    const neuer = s.version ? vergleicheVersion(s.version, eigene) > 0 : false;
    return {
      neuer,
      version: s.version || null,
      groesse: s.sizeMb ? `${s.sizeMb} MB` : null,
      datum: s.modified || null,
      url: s.url || "/apk",
    };
  } catch {
    return null;
  }
}

/**
 * Zugriff auf die Datei-Funktionen von Expo.
 *
 * ACHTUNG, STOLPERSTELLE: Ab SDK 54 (expo-file-system 19) steckt hinter
 * "expo-file-system" eine komplett neue Schnittstelle (File/Directory). Die
 * hier gebrauchten Funktionen downloadAsync / getContentUriAsync /
 * cacheDirectory gibt es dort nur noch unter "expo-file-system/legacy".
 *
 * Ohne diese Weiche wäre downloadAsync nach dem SDK-Wechsel einfach
 * `undefined` gewesen. Auffallen würde das kaum: die Prüfung unten hätte
 * still auf Weg 2 umgeschaltet und nur noch den Browser geöffnet — das
 * bequeme „App installiert sich selbst" wäre lautlos verschwunden.
 */
function dateiSystem() {
  try {
    // eslint-disable-next-line global-require
    const alt = require("expo-file-system/legacy");
    if (alt?.downloadAsync) return alt;
  } catch {
    /* SDK 53: diesen Unterpfad gibt es dort noch nicht — unten weiter */
  }
  try {
    // eslint-disable-next-line global-require
    return require("expo-file-system");
  } catch {
    return null;
  }
}

/**
 * Die neue Fassung holen.
 *
 * Erst wird versucht, sie direkt zur Installation zu übergeben (falls
 * expo-intent-launcher vorhanden ist). Klappt das nicht, übernimmt Android
 * den Download wie bei einem angetippten Link — ohne dass jemand eine
 * Adresse eingeben muss.
 *
 * @returns {Promise<{weg:string}>}  welcher Weg genommen wurde
 */
export async function starteUpdate(basis, pfad = "/apk", token = "") {
  const url = `${basis}${pfad}${token ? `?token=${token}` : ""}`;

  // Weg 1: direkt installieren, falls der native Zusatz vorhanden ist
  try {
    // eslint-disable-next-line global-require
    const intent = require("expo-intent-launcher");
    const fs = dateiSystem();
    if (intent?.startActivityAsync && fs?.downloadAsync) {
      const ziel = fs.cacheDirectory + "GHGFlix-update.apk";
      const { uri } = await fs.downloadAsync(url, ziel);
      const inhaltUri = await fs.getContentUriAsync(uri);
      await intent.startActivityAsync("android.intent.action.INSTALL_PACKAGE", {
        data: inhaltUri,
        flags: 1,          // FLAG_GRANT_READ_URI_PERMISSION
        type: "application/vnd.android.package-archive",
      });
      return { weg: "direkt" };
    }
  } catch {
    /* Zusatz fehlt oder Android hat abgelehnt — dann der einfache Weg */
  }

  // Weg 2: Android den Download übernehmen lassen
  // eslint-disable-next-line global-require
  const { Linking } = require("react-native");
  await Linking.openURL(url);
  return { weg: "browser" };
}
