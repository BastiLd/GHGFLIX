# GHGFlix auf den Fernseher bringen

Geschrieben für einen **PeaQ Smart Google TV** — das ist ein Android-TV-Gerät
mit Google-TV-Oberfläche. Alles hier gilt genauso für andere Android-TV- und
Fire-TV-Geräte.

---

## Die Kurzantwort auf „welchen Link öffne ich wo?"

Es sind **zwei verschiedene Adressen** — das ist der häufigste Punkt der
Verwirrung:

| Adresse | Wo eingeben? | Was passiert? |
|---|---|---|
| `http://192.168.68.10:8484/app` | **am PC/Handy im Browser** | Anleitungs-Seite zum Nachlesen. Zeigt auch an, ob schon eine App-Datei bereitliegt. |
| `http://192.168.68.10:8484/apk` | **am Fernseher in der App „Downloader"** | Lädt die App-Datei herunter und installiert sie. |

Also: `/app` ist **nur zum Nachlesen**, `/apk` ist **die Installation**.
Am Fernseher tippst du `/apk` ein — nicht in den TV-Browser, sondern in
**Downloader** (Google TV hat ab Werk oft gar keinen Browser).

## Und wie aktualisiere ich später?

Genau gleich — die App wird beim Installieren einfach ersetzt:

1. Neue App-Datei bauen (Studio → GHGFlix → **APK bauen**, oder am PC per
   `eas build`)
2. Sie auf dem Server ablegen und dabei die alte überschreiben:
   `/DATA/AppData/ghgflix/data/apk/GHGFlix.apk`
3. Am Fernseher **Downloader** öffnen → dieselbe Adresse `…:8484/apk` → **Go**
   → **Installieren** → fertig

Deine Einstellungen (Server-Adresse, Passwort) bleiben dabei erhalten. Ein
Deinstallieren ist nur nötig, wenn die Meldung „App nicht installiert"
erscheint — dann wurde die neue Datei mit einem anderen Schlüssel signiert.

> **Wichtig:** Es liegt erst dann eine App-Datei bereit, wenn du sie einmal
> gebaut und abgelegt hast (Schritt 2.1 weiter unten). Vorher zeigt
> `…:8484/apk` nur „Noch keine App-Datei hinterlegt".

**Ganz ohne Installation** geht es auch: irgendeinen Browser am TV öffnen und
`http://192.168.68.10:8484/?tv=1` eingeben.

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

**Dann die Datei auf den Server legen — am einfachsten per Skript:**

```powershell
cd "$env:USERPROFILE\Documents\GHGFlix"
powershell -ExecutionPolicy Bypass -File scripts\apk-hochladen.ps1
```

Das Skript sucht die zuletzt heruntergeladene `.apk` (Downloads/Desktop),
fragt nach dem Server-Passwort und legt sie am richtigen Ort ab. Voraussetzung
ist ein gesetztes `GHGFLIX_PASSWORD` — ohne Passwort wäre so ein Upload ein
offenes Tor und ist deshalb gesperrt.

**Oder von Hand:** In ZimaOS → **Files** → zu diesem Ordner navigieren und die
Datei dort ablegen, umbenannt in `GHGFlix.apk`:

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

### ⭐ „Installiert, aber die App ist nirgends zu finden"

Das häufigste und verwirrendste Problem — und es lag **nicht** an dir:

> Download läuft, „Installieren" drücken, Bildschirm wird kurz schwarz, dann
> ist man zurück und **nichts** ist da. Beim zweiten Versuch fragt Android
> sogar nach einem „Update" — die App ist also installiert, nur unsichtbar.

**Ursache:** Der Startbildschirm von Android TV zeigt ausschließlich Apps, die
im Manifest die Kategorie `LEANBACK_LAUNCHER` tragen. Eine normale Handy-App
hat nur `LAUNCHER` — und wird deshalb komplett ausgeblendet, obwohl sie
sauber installiert ist.

**Behoben ab App-Version 1.4.0.** Ergänzt wurden Leanback-Kategorie,
`uses-feature`-Einträge („Touchscreen nicht erforderlich") und ein
320×180-Kachelbild für das TV-Menü.

Damit die neue Fassung greift:

1. Am TV **Einstellungen → Apps → Alle Apps anzeigen** öffnen
2. Falls dort ein Eintrag **GHGFlix** steht: **Deinstallieren**
   (das ist die alte, unsichtbare Fassung)
3. Neue APK bauen (Version 1.5.0 oder höher), auf den Server legen
4. In Downloader wieder `…:8484/apk` → **Go** → **Installieren**

Danach liegt GHGFlix mit rotem Kachelbild auf dem Startbildschirm.

> Prüfen, welche Fassung du hast: Die App-Version steht in GHGFlix unter
> **Einstellungen**. Alles unter 1.5.0 ist veraltet.

### ⭐ „App startet, wird schwarz und springt zurück"

Die App stürzt beim Start ab. So kommst du an die Ursache:

#### Weg 1: Die App zeigt es dir selbst (ab Version 1.5.0)

GHGFlix fängt Fehler jetzt ab und **speichert sie**. Beim nächsten Start steht
oben ein rotes Banner mit der Meldung und den ersten Zeilen der Fehlerspur.
Einfach die App nochmal öffnen — wenn sie so weit kommt, siehst du dort direkt,
was passiert ist.

Kommt gar nichts (auch kein Banner), war es ein Absturz **vor** dem Start der
Oberfläche. Dann hilft nur Weg 2.

> **Hinweis:** Port 5555 ist bei manchen Geräten erst offen, NACHDEM
> **USB-Debugging** eingeschaltet wurde. Klappt `adb connect` beim ersten Mal
> nicht, also erst USB-Debugging anschalten und es dann nochmal versuchen —
> genau so hat es hier funktioniert, obwohl es kein „Drahtloses Debugging" gibt.

#### Weg 1b: Diagnose-Fassung der App (kein PC nötig) ⭐

Wenn dein Fernseher **kein „Drahtloses Debugging"** anbietet — bei vielen
günstigen Android-TVs ist nur „USB-Debugging" vorhanden — kommst du per adb
nicht ans Log. Dafür gibt es eine eigene Diagnose-Fassung der App:

```powershell
cd "$env:USERPROFILE\Documents\GHGFlix\mobile"
npx eas-cli build --platform android --profile diagnose
```

Diese Fassung importiert am Anfang **nichts** außer React Native und prüft die
Zusatzmodule erst nach dem ersten Bild. Auf dem Fernseher siehst du dann:

- ob das Grundgerüst überhaupt startet (steht Text da → ja)
- Android-Version, Modell, ob Hermes läuft
- **welches Modul sich nicht laden lässt** — grün „OK" oder rot „FEHLER"

Bildschirm abfotografieren, fertig. Damit lässt sich die Ursache eingrenzen,
ohne je einen PC anzuschließen.

#### Weg 2: Echte Logs per adb vom PC

1. **Am Fernseher** Entwickleroptionen freischalten:
   *Einstellungen → System → Info* → 7-mal auf **Build** drücken
2. *Einstellungen → System → Entwickleroptionen* → **USB-Debugging** einschalten
   und, falls vorhanden, **Debugging über WLAN / Netzwerk-Debugging**
3. IP des Fernsehers notieren: *Einstellungen → Netzwerk & Internet* → dein WLAN

4. **Am PC** die Android-Platform-Tools holen (einmalig).

   > `winget install Google.PlatformTools` bricht oft mit
   > **„Der Installer-Hash stimmt nicht überein"** ab — Google tauscht das
   > Paket häufiger aus, als der winget-Katalog nachzieht. Nimm deshalb
   > direkt den Weg über Google, der klappt immer:

   ```powershell
   $ziel = "$env:USERPROFILE\platform-tools"
   Invoke-WebRequest "https://dl.google.com/android/repository/platform-tools-latest-windows.zip" -OutFile "$env:TEMP\pt.zip"
   Expand-Archive "$env:TEMP\pt.zip" -DestinationPath $env:USERPROFILE -Force
   cd $ziel
   .\adb.exe version
   ```

   **Wichtig:** `adb` ist danach nur in DIESEM Ordner aufrufbar, deshalb immer
   mit `.\adb.exe` davor — oder dauerhaft in den Suchpfad legen:

   ```powershell
   [Environment]::SetEnvironmentVariable("Path", $env:Path + ";$env:USERPROFILE\platform-tools", "User")
   ```

   (danach PowerShell einmal schließen und neu öffnen, dann geht schlicht `adb`)

5. **Verbinden.** Hier gibt es ZWEI Wege — welcher geht, hängt vom Fernseher ab:

   **Weg A: Drahtloses Debugging mit Kopplung** (Android 11+, das ist bei
   Google TV der Normalfall)

   Der einfache `adb connect …:5555` schlägt hier fehl
   (`cannot connect … (10060)`), weil Port 5555 gar nicht offen ist. Google TV
   verlangt erst eine Kopplung mit Code:

   1. Am TV: *Einstellungen → System → Entwickleroptionen*. Dort den Abschnitt
      **DEBUGGING** suchen — er steht meist **weiter oben**, über „NETZWERKE".
      Untereinander stehen dort **USB-Debugging** und **Drahtloses Debugging**
      (je nach Gerät auch „Debugging über WLAN" oder „ADB über Netzwerk").
      **Drahtloses Debugging** einschalten.
   2. Dort **„Gerät mit Kopplungscode koppeln"** öffnen.
      Es erscheint ein Fenster mit **zwei** Angaben:

      ```
      WLAN-Kopplungscode:   123456                  <- sechsstellig
      IP-Adresse und Port:  192.168.68.157:41234    <- Port ist 41234
      ```

      Gebraucht wird die Zahl **nach dem Doppelpunkt** (hier `41234`) — sie ist
      vier- bis fünfstellig. **Nicht** die MAC-Adresse aus den WLAN-Infos
      verwenden, die endet oft auf ähnlich aussehende Ziffern!
      Dieses Fenster am Fernseher offen lassen.
   3. Am PC — die Zahlen von Schritt 2 einsetzen:

   ```powershell
   cd "$env:USERPROFILE\platform-tools"
   .\adb.exe pair 192.168.68.55:37129
   # Es wird nach dem sechsstelligen Code gefragt -> eingeben
   ```

   4. Danach steht im Fenster **„Drahtloses Debugging"** oben eine ANDERE
      Portnummer (das ist der Verbindungs-Port, nicht der Kopplungs-Port):

   ```powershell
   .\adb.exe connect 192.168.68.55:42871
   .\adb.exe devices
   ```

   **Weg B: Einmal per USB-Kabel** (falls es kein drahtloses Debugging gibt)

   TV per USB-Kabel an den PC (USB-Buchse des TV, die Daten kann), dann:

   ```powershell
   cd "$env:USERPROFILE\platform-tools"
   .\adb.exe devices        # am TV "USB-Debugging zulassen?" bestaetigen
   .\adb.exe tcpip 5555     # oeffnet Port 5555
   # Kabel abziehen, dann:
   .\adb.exe connect 192.168.68.55:5555
   ```

   > **Wenn `Expand-Archive` meckert** („Zugriff verweigert" auf `adb.exe`):
   > Es läuft noch ein adb-Dienst. Erst beenden, dann neu entpacken:
   > ```powershell
   > Get-Process adb -ErrorAction SilentlyContinue | Stop-Process -Force
   > ```

6. Log leeren, App am TV starten, Log ansehen:

   ```powershell
   cd "$env:USERPROFILE\platform-tools"
   .\adb.exe logcat -c
   # jetzt am Fernseher GHGFlix oeffnen, ca. 10 Sekunden warten, dann:
   .\adb.exe logcat -d -b crash > "$env:USERPROFILE\Desktop\ghgflix-log.txt"
   .\adb.exe logcat -d *:E >> "$env:USERPROFILE\Desktop\ghgflix-log.txt"
   notepad "$env:USERPROFILE\Desktop\ghgflix-log.txt"
   ```

7. Fertig? Verbindung trennen:

   ```powershell
   .\adb.exe disconnect
   ```

Die interessanten Zeilen beginnen mit `FATAL EXCEPTION`, `AndroidRuntime` oder
`ReactNativeJS`.

> **Häufigste Ursache** bei günstigen Android-TV-Geräten: die neue
> React-Native-Architektur (Fabric), die Expo SDK 53 standardmäßig einschaltet.
> Ab GHGFlix 1.5.0 ist sie bewusst abgeschaltet — allein das behebt den
> Startabsturz in den meisten Fällen.

### „Cannot find native module 'ExpoAsset'" (behoben in 1.8.0)

Trat als Absturz direkt beim Start auf. Ursache: `expo-asset` war keine
**direkte** Abhängigkeit, sondern lag verschachtelt unter `node_modules/expo/`.
Expos Autolinking bindet den nativen Teil dann nicht in die APK ein.

Merksatz für künftige Module: **Alles, was nativen Code mitbringt, gehört
direkt in `mobile/package.json`.** In Expo Go fällt so etwas nie auf, weil dort
alle Module vorinstalliert sind — der Fehler zeigt sich erst im eigenen Build.

### Weitere Fälle

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
