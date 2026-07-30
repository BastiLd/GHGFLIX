# GHGFlix auf den Fernseher bringen

Geschrieben für einen **PeaQ Smart Google TV** — das ist ein Android-TV-Gerät
mit Google-TV-Oberfläche. Alles hier gilt genauso für andere Android-TV- und
Fire-TV-Geräte.

**Kurzantwort:** Am schnellsten geht es **ohne USB-Stick** über die App
„Downloader". USB-Stick geht auch, ist aber umständlicher.

---

## Übersicht — welcher Weg für dich?

| Weg | Aufwand | Bedienung | Wann? |
|---|---|---|---|
| **1. Browser-TV-Modus** | 1 Minute, nichts installieren | Pfeiltasten | zum Ausprobieren, sofort |
| **2. App per „Downloader"** | ~10 Minuten einmalig | echte App | **empfohlen** |
| **3. App per USB-Stick** | ~15 Minuten einmalig | echte App | wenn Downloader nicht geht |

Alle drei brauchen den **laufenden GHGFlix-Server** im selben Netzwerk.

---

## Vorher: Server-Adresse herausfinden

Am PC im Browser öffnen:

```
http://<server-ip>:8484/app
```

Also z. B. `http://192.168.68.10:8484/app`.

Die Seite zeigt dir deine Adresse groß an, sagt dir, ob schon eine App-Datei
auf dem Server liegt, und enthält dieselbe Anleitung wie hier — direkt am
Bildschirm.

---

## Weg 1: TV-Modus im Browser (sofort, nichts installieren)

Funktioniert auf **jedem** Fernseher mit Browser.

1. Am TV den Browser öffnen (Google TV: einen Browser aus dem Play Store
   installieren, falls keiner da ist — z. B. „TV Bro" oder „Puffin TV")
2. Adresse eingeben: `http://<server-ip>:8484/?tv=1`
3. Falls ein Server-Passwort gesetzt ist: einmalig einloggen
4. Fertig — **Pfeiltasten** = navigieren, **OK** = auswählen,
   **Zurück** = eine Seite zurück

Der TV-Modus zeigt rote Fokus-Rahmen, größere Schrift und hält Abstand zum
Bildschirmrand. Als Lesezeichen speichern, dann ist es beim nächsten Mal ein
Klick.

> Google TV hat ab Werk oft **keinen** Browser. Deshalb ist Weg 2 auf deinem
> PeaQ meist der angenehmere.

---

## Weg 2: Echte App per „Downloader" ⭐ empfohlen

Kein USB-Stick, kein PC-Kabel — der Fernseher lädt die App direkt vom Server.

### 2.1 Einmalig: App-Datei auf den Server legen

Der Server verteilt die App unter `http://<server-ip>:8484/apk`. Dafür muss die
Datei einmal erzeugt und abgelegt werden.

**Variante A — über das VetNow Studio (am bequemsten):**

1. Studio öffnen: `http://<server-ip>:3000`
2. Gruppe **🎬 GHGFlix** → Karte **Handy-/TV-App (Expo Go)**
3. Auf **APK bauen** klicken (baut in der Expo-Cloud, dauert ~10–20 Minuten)
4. Am Ende steht im Log ein Download-Link → Datei herunterladen

**Variante B — am PC in PowerShell:**

```powershell
cd "$env:USERPROFILE\Documents\GHGFlix\mobile"
npm install
npx eas-cli build --platform android --profile preview
```

(Einmalig ein kostenloses Konto auf **expo.dev** anlegen; beim ersten Mal
fragt es nach einem Keystore → einfach bestätigen, Expo verwaltet ihn.)

**Dann die Datei auf den Server legen:**

In ZimaOS → **Files** → zu diesem Ordner navigieren und die Datei dort
ablegen, umbenannt in `GHGFlix.apk`:

```
/DATA/AppData/ghgflix/data/apk/GHGFlix.apk
```

Den Ordner `apk` gibt es zu Beginn noch nicht — einfach anlegen.

> Dieser Ordner liegt im Daten-Verzeichnis und **überlebt jedes
> Server-Update**. Du legst die Datei also genau einmal ab.

Prüfen: `http://<server-ip>:8484/app` aufrufen — dort muss jetzt
„● App-Datei vorhanden" stehen.

### 2.2 Am Fernseher: Installation erlauben

1. **Einstellungen** → **System** → **Info**
2. Bei **Build** (oder „Android-Version") **7-mal hintereinander** drücken
   → Meldung „Du bist jetzt Entwickler"
3. Zurück → **Einstellungen** → **Apps** → **Sicherheit & Einschränkungen**
   → **Unbekannte Quellen**
4. Dort **Downloader** auf **AN** stellen
   *(die App muss dafür erst installiert sein — also erst Schritt 2.3, dann
   hierher zurückkommen)*

### 2.3 „Downloader" installieren

1. Am TV den **Google Play Store** öffnen
2. Nach **Downloader** suchen (blaues Symbol mit Pfeil, von *AFTVnews*)
3. Installieren
4. Jetzt Schritt 2.2 Punkt 3–4 nachholen: **Downloader** bei „Unbekannte
   Quellen" einschalten

### 2.4 App laden und installieren

1. **Downloader** öffnen → Reiter **Home**
2. In das URL-Feld eintippen:

   ```
   http://192.168.68.10:8484/apk
   ```

   (deine Server-IP einsetzen — die steht auf der `/app`-Seite)
3. **Go** drücken → die Datei lädt herunter
4. Es erscheint der Android-Installationsdialog → **Installieren**
5. → **Öffnen**
6. In GHGFlix die Server-Adresse eintragen: `192.168.68.10:8484`
   (`http://` wird automatisch ergänzt) → ggf. Passwort → Profil wählen

Fertig. Beim nächsten Mal liegt GHGFlix normal auf dem Startbildschirm.

> **Tipp:** Google TV versteckt selbst installierte Apps manchmal.
> Zu finden unter **Einstellungen → Apps → Alle Apps anzeigen** — dort kannst
> du GHGFlix auch an den Anfang der Startseite heften.

---

## Weg 3: Echte App per USB-Stick

Falls „Downloader" nicht funktioniert (z. B. kein Play Store).

1. APK am PC besorgen (siehe 2.1) und auf einen **FAT32**-formatierten
   USB-Stick kopieren
2. Am TV Entwickleroptionen freischalten (siehe 2.2 Punkt 1–2)
3. Einen Datei-Manager aus dem Play Store installieren — z. B. **X-plore**
   oder **File Commander**
4. **Einstellungen → Apps → Sicherheit & Einschränkungen → Unbekannte
   Quellen** → deinen **Datei-Manager** einschalten
5. Stick einstecken → Datei-Manager öffnen → `GHGFlix.apk` auswählen →
   **Installieren**

> Hat dein PeaQ keinen freien USB-Anschluss, geht auch ein USB-Hub — oder
> eben Weg 2.

---

## Weg 4: Vom PC per adb (für Bastler)

```powershell
# Am TV: Einstellungen → System → Info → 7x auf "Build"
#        Einstellungen → System → Entwickleroptionen → USB-Debugging AN
#        (bei Netzwerk-Debugging die IP des TVs notieren)
cd "$env:USERPROFILE\Downloads"
adb connect 192.168.68.55:5555
adb install -r GHGFlix.apk
```

`adb` kommt aus den *Android SDK Platform-Tools* (kostenlos von Google).

---

## Häufige Stolpersteine

| Problem | Ursache | Lösung |
|---|---|---|
| Downloader zeigt „404" / „nicht gefunden" | keine APK auf dem Server | Schritt 2.1 machen, dann `http://<ip>:8484/app` prüfen |
| „App nicht installiert" | alte Version mit anderem Signaturschlüssel | alte GHGFlix-App am TV deinstallieren, dann neu installieren |
| „Aus Sicherheitsgründen blockiert" | Unbekannte Quellen nicht erlaubt | Schritt 2.2 — und zwar für **die App, die installiert** (Downloader bzw. Datei-Manager) |
| App findet den Server nicht | falsche IP oder anderes Netz | am PC `http://<ip>:8484/api/ping` aufrufen; TV muss im selben WLAN sein (ein Gast-WLAN zählt nicht dazu!) |
| Video ruckelt | Fernseher lässt umwandeln | in GHGFlix eine niedrigere Qualität wählen, oder `TRANSCODE_MAX` erhöhen |
| Bild da, kein Ton (oder umgekehrt) | Tonformat wird nicht unterstützt | im Player die Tonspur wechseln |

---

## Native Android-TV-App (D-Pad-Fokus)

Die per Sideload installierte Handy-App läuft auf Android TV, ist aber für
Touch gebaut — Bedienung per Fernbedienung geht, ist aber nicht perfekt.
Eine eigene TV-App mit sauberer D-Pad-Fokusführung steht weiter auf der Liste
(siehe [`PLAN_STATUS.md`](../PLAN_STATUS.md)) und braucht echte Geräte zum
Testen.

Bis dahin ist der **Browser-TV-Modus** (Weg 1) die komfortabelste Bedienung
per Fernbedienung, weil er ausdrücklich für Pfeiltasten gebaut ist.
