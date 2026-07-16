# GHGFlix — Abschlussbericht (Masterplan-Umsetzung, 16.07.2026)

Alle Phasen des Masterplans wurden abgearbeitet — die kritischen Bugs sind
behoben, die Architektur ist konsolidiert, Handy und Fernseher sind angebunden,
der Server ist gehärtet und dokumentiert. Was bewusst offen blieb (v. a. die
native Android-TV-App), steht mit Begründung in [`PLAN_STATUS.md`](PLAN_STATUS.md).

---

## Teil 1: Was wurde gemacht

### Phase 1 — Die zwei Kern-Bugs (Branch `fix/supabase-sync`)

**Supabase-Sync repariert.** Der Server las den Schlüssel `supabase_key`
(Service-Role-Key), die Einstellungs-Seite speicherte aber nur
`supabase_anon_key` — deshalb kam NIE eine Verbindung zustande. Die
Server-Weboberfläche hat jetzt unter *Einstellungen → Konto & Sync* ein eigenes
Formular **„Server-Sync mit Supabase (Cloud-Relay)“** mit Service-Role-Key,
Senden/Empfangen-Schaltern, „Jetzt importieren“-Button und einer Klartext-
Statuszeile („Verbunden — letzter Abgleich …“ / „Fehler seit …“). Die
Desktop-App synct Cloud-Profile jetzt **alle 60 s + beim Fenster-Fokus + beim
App-Start** statt nur einmal beim Profilwechsel. Dazu: Race-Condition beim
Fortschritt-Schreiben behoben, Schutz gegen vertauschte URL/Key-Felder, der
Service-Key wird nie an Browser/Apps ausgeliefert.

**Ton/Bild-Versatz behoben.** Ursache: Beim Spulen/Fortsetzen während
Server-Transcoding sprang das Video zum letzten Keyframe zurück (bis mehrere
Sekunden), der Ton startete aber exakt an der gewünschten Stelle. Jetzt wird
das Video bei jedem Sprung exakt ab der Zielstelle neu kodiert — Ton und Bild
starten sample-genau zusammen, auch die Fortschrittsanzeige stimmt wieder.
Zusätzlich am Desktop: mpv nutzt fest `--video-sync=audio` und ignoriert
fremde `mpv.conf`-Dateien (Experten-Schalter unter *Leistung* vorhanden).

### Phase 2 — Architektur (Branch `feat/arch-consolidation`)

Zielbild festgelegt und in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
(mit Diagramm) dokumentiert: **Dein Docker-Server ist die zentrale Wahrheit,
Supabase nur optionales Cloud-Relay, Handy/TV sprechen ausschließlich mit dem
Server.** Jede Server-Installation hat jetzt eine stabile ID; die Desktop-App
bindet ihre Sync-Zeiger daran — kein doppeltes Ziehen mehr, wenn zwischen
lokaler IP, Domain und Tailscale gewechselt wird.

### Phase 3 — Handy-App (Branch `feat/mobile-v2`)

Neu in der App: **„Meine Liste“** auf der Startseite mit Herz-Button auf jeder
Serien-/Film-Seite (synchron mit Desktop und Web), **Gesehen-Markierung**
(Folge gedrückt halten bzw. Button beim Film), verständliche
Verbindungs-Fehlermeldungen, `http://` wird beim Eintippen automatisch
ergänzt, und die App ist Store-/Sideload-bereit versioniert (1.1.0).

### Phase 4 — Fernseher (Branch `feat/tv-mode`)

**TV-Modus für jeden Smart-TV-Browser** — sofort nutzbar, keine Installation:
rote Fokus-Rahmen, größere Schrift, Abstand zum Bildschirmrand und komplette
**Pfeiltasten-Navigation** (2D — links/rechts durch die Reihe, hoch/runter
zwischen Reihen), OK wählt, Zurück-Taste navigiert zurück (inkl. LG-webOS- und
Samsung-Tizen-Tastencodes). Aktivierung automatisch per TV-Erkennung, per Link
`?tv=1` oder per Schalter in den Einstellungen. Die **native Android-TV-App**
ist der größte bewusst offene Punkt (braucht echte Geräte zum Testen) — die
Handy-APK läuft aber schon heute per Sideload auf Fire TV/Android TV
(Anleitung unten).

### Phase 5 — Server-Härtung (Branch `feat/server-hardening`)

Login-Tokens laufen nach 180 Tagen ab, **„Alle Geräte abmelden“**-Button für
verlorene Handys/verkaufte Sticks, Brute-Force-Sperre beim Login (5 Min nach
8 Fehlversuchen), sauberes Herunterfahren bei Docker-Updates (laufende
ffmpeg-Prozesse werden beendet), **Limit für gleichzeitige Transcodes**
(`TRANSCODE_MAX`, Standard 3 — schützt das NAS, wenn alle gleichzeitig
schauen), Security-Header, und eine tägliche Aufräumroutine für verwaiste
Sync-Einträge.

### Phase 6 — Doku, Tests, CI (Branch `chore/docs-qa`)

README mit Handy/TV-Abschnitt und Fehlerbehebungs-Kapiteln („Sync geht nicht“,
„Ton/Bild versetzt“), manuelle [Test-Checkliste](docs/TEST_CHECKLIST.md) für
Releases, und ein CI-Workflow, der bei jedem Push TypeScript, Web-Build und
Server-Syntax prüft.

**Versionen:** Desktop 0.9.9 · Server 2.2.0 · Mobile 1.1.0.

---

## Teil 2: Was DU jetzt tun musst

### 1. Veröffentlichen (einmalig)

Die Arbeit liegt auf aufeinander aufbauenden Branches; `chore/docs-qa` enthält
alles. Mergen und pushen:

```
git checkout feature/zimaos-docker-server
git merge chore/docs-qa
git push
```

Der GitHub-Docker-Build baut dann automatisch das neue Server-Image
(`ghcr.io/bastild/ghgflix-server:latest`, amd64 + arm64).

### 2. Server aktualisieren

ZimaOS App Store → GHGFlix → **Update** (oder in Portainer/Docker das Image
neu ziehen und den Container neu erstellen). Deine Daten bleiben erhalten.

### 3. Wichtig: Passwort prüfen (SEC-001)

Falls `GHGFLIX_PASSWORD` noch leer ist: in der docker-compose setzen (oder
Web-Einstellungen). Mit Handy + TV + Tailscale gibt es jetzt deutlich mehr
Zugänge — ohne Passwort ist die Bibliothek für jeden im Netz offen.

### 4. Supabase-Sync einschalten (optional)

Server-Weboberfläche (`http://<server-ip>:8484`) → ⚙️ *Einstellungen → Konto &
Sync → „Server-Sync mit Supabase (Cloud-Relay)“* → Project-URL +
**Service-Role-Key** eintragen (Supabase → Project Settings → API Keys →
`service_role`) → Speichern. Der Erst-Import startet automatisch; die
Statuszeile muss „Verbunden“ zeigen.

### 5. Kurz testen

[`docs/TEST_CHECKLIST.md`](docs/TEST_CHECKLIST.md) durchgehen — besonders die
zwei Sync-Tests und den Spul-Test bei einer MKV-Datei im Browser.

---

## Teil 3: Anleitung Fernseher 📺

### Sofort (jeder Smart-TV, keine Installation)

1. Browser am TV öffnen (Samsung: „Internet“, LG: „Web Browser“, Fire TV: „Silk“)
2. Eingeben: **`http://<server-ip>:8484/?tv=1`** — z. B. `http://192.168.1.50:8484/?tv=1`
3. Ggf. Server-Passwort eingeben (einmalig)
4. Bedienung: **Pfeiltasten** = navigieren (roter Rahmen zeigt die Auswahl),
   **OK** = abspielen/auswählen, **Zurück** = zur Übersicht
5. Tipp: als Lesezeichen/Startseite speichern

### Als echte App (Android TV / Fire TV, per USB-Stick)

**A. APK bauen (einmalig am PC** — kostenloses Konto auf expo.dev nötig**):**

```
cd mobile
npm install
npx eas-cli build --platform android --profile preview
```

Am Ende bekommst du einen Download-Link zur `GHGFlix.apk`.

**B. Auf den Fernseher bringen (USB-Stick):**

1. APK auf einen **FAT32-USB-Stick** kopieren
2. Am TV „Apps unbekannter Herkunft“ erlauben:
   - **Fire TV:** Einstellungen → Mein Fire TV → Entwickleroptionen → „Apps
     unbekannter Herkunft“ AN *(Entwickleroptionen nicht da? Einstellungen →
     Mein Fire TV → Info → 7× auf die Seriennummer klicken)*
   - **Android TV:** Einstellungen → Apps → Sicherheit & Einschränkungen →
     „Unbekannte Quellen“ für deinen Datei-Manager AN
3. Datei-Manager-App aus dem TV-Store laden (z. B. „X-plore“ / „File Commander“)
4. Stick einstecken → Datei-Manager → `GHGFlix.apk` → **Installieren**
5. GHGFlix öffnen → Server-Adresse eintragen (`192.168.1.50:8484` reicht,
   `http://` wird ergänzt) → ggf. Passwort → Profil wählen → schauen

*Ohne USB-Port (Fire TV Stick):* App **„Downloader“** aus dem Amazon-Store
installieren, den EAS-Download-Link der APK eingeben — installiert direkt.
Details + adb-Variante: [`tv/README.md`](tv/README.md)

---

## Teil 4: Anleitung Handy 📱

### Variante 1: PWA (ohne alles, 30 Sekunden)

`http://<server-ip>:8484` im Handy-Browser öffnen → Menü → **„Zum
Startbildschirm hinzufügen“**. Sieht aus wie eine App, kann alles Wichtige.

### Variante 2: Native App (Expo)

- **Zum Ausprobieren:** Expo Go aus dem Store laden, am PC `cd mobile && npm
  install && npx expo start`, QR-Code scannen (Handy + PC im selben WLAN).
- **Dauerhaft:** die oben gebaute `GHGFlix.apk` aufs Handy laden und
  installieren (gleiche APK wie für den TV).

**In der App:** Adressen für Zuhause/Tailscale/Domain eintragen —
„Automatisch wechseln“ nimmt immer die erste erreichbare (zuhause LAN,
unterwegs Tailscale). Herz ♥ = Meine Liste · Folge **gedrückt halten** =
gesehen/ungesehen · Fortschritt landet automatisch auf allen Geräten.

---

## Teil 5: Bewusst offen (Backlog)

Vollständige Liste mit Begründungen in [`PLAN_STATUS.md`](PLAN_STATUS.md).
Die größten Brocken: **native Android-TV-App** mit echter D-Pad-Fokusführung
(TV-005…TV-032 — braucht Fire-TV-/Android-TV-Hardware zum Testen),
Untertitel & Audiospur-Wahl im Handy-Player (MOB-011/012), Chromecast
(MOB-004), QR-Code-Pairing (MOB-018/TV-013) und Offline-Downloads (MOB-003).
Empfehlung fürs nächste Mal: mit der nativen TV-App anfangen — Grundlage
(gemeinsame Codebasis mit `mobile/`, Sync, A/V-Fixes) liegt jetzt bereit.
