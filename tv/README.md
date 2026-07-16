# GHGFlix auf dem Fernseher

Zwei Wege — der erste funktioniert **sofort auf jedem Smart-TV**, der zweite
ist eine echte App für Android TV / Fire TV.

---

## Weg 1: TV-Modus im Browser (sofort, keine Installation) ✅ empfohlen zum Start

Funktioniert auf **jedem** Fernseher mit Browser (Samsung Tizen, LG webOS,
Android TV, Fire TV mit Silk-Browser, …).

1. Am TV den Browser öffnen
2. Adresse eingeben: `http://<server-ip>:8484/?tv=1`
   (z. B. `http://192.168.1.50:8484/?tv=1` — das `?tv=1` schaltet den
   TV-Modus dauerhaft ein)
3. Falls ein Server-Passwort gesetzt ist: einloggen (einmalig)
4. Fertig — Navigation mit den **Pfeiltasten** der Fernbedienung,
   **OK** = auswählen, **Zurück** = eine Seite zurück

Der TV-Modus zeigt rote Fokus-Rahmen, größere Schrift und hält Abstand zum
Bildschirmrand (Overscan). Er aktiviert sich auf TVs auch automatisch; unter
*Einstellungen → Allgemein → TV-Modus* lässt er sich erzwingen/abschalten.

> Tipp: Die Seite als Lesezeichen/Startseite im TV-Browser speichern, dann
> ist GHGFlix zwei Tasten entfernt.

---

## Weg 2: Android-TV-/Fire-TV-App (APK sideloaden)

Die GHGFlix-Handy-App (`mobile/`) läuft auch auf Android TV und Fire TV.
Dafür einmal eine APK bauen und auf den TV bringen ("Sideload").

### Schritt 1: APK bauen (einmalig, am PC)

```
cd mobile
npm install
npx eas-cli build --platform android --profile preview
```

(Kostenloses Konto auf https://expo.dev nötig. Beim ersten Lauf legt EAS die
Konfiguration an — Profil `preview` erzeugt eine direkt installierbare `.apk`.)
Am Ende gibt es einen **Download-Link zur `GHGFlix.apk`**.

### Schritt 2a: Installation per USB-Stick (Fire TV & Android TV)

1. `GHGFlix.apk` auf einen **FAT32-formatierten USB-Stick** kopieren
2. **Unbekannte Quellen erlauben:**
   - *Fire TV:* Einstellungen → Mein Fire TV → Entwickleroptionen →
     „Apps unbekannter Herkunft“ → **AN** (ggf. vorher unter Einstellungen →
     Mein Fire TV 7× auf die Seriennummer tippen, um Entwickleroptionen
     freizuschalten)
   - *Android TV:* Einstellungen → Apps → Sicherheit & Einschränkungen →
     „Unbekannte Quellen“ für den Datei-Manager erlauben
3. Einen **Datei-Manager** aus dem Store des TVs laden (z. B. „X-plore“ oder
   „File Commander“; auf Fire TV: „ES File Explorer“-Alternativen)
4. USB-Stick in den TV/Stick stecken → Datei-Manager öffnen → auf dem Stick
   die `GHGFlix.apk` auswählen → **Installieren**
5. App starten → Server-Adresse eintragen (`http://192.168.1.50:8484`)
   oder einfach `192.168.1.50:8484` — das `http://` wird ergänzt →
   ggf. Passwort → Profil wählen → fertig

> Fire TV Stick ohne USB-Port? Weg 2b nehmen oder einen OTG-Adapter verwenden.

### Schritt 2b: Alternative ohne USB — „Downloader“-App (nur Fire TV)

1. Auf dem Fire TV die App **„Downloader“** (orange, von AFTVnews) installieren
2. „Apps unbekannter Herkunft“ für Downloader erlauben (siehe oben)
3. In Downloader den **EAS-Download-Link** der APK eingeben → lädt & installiert

### Schritt 2c: Alternative per Netzwerk-ADB (für Fortgeschrittene)

```
# Am TV: Entwickleroptionen → ADB-Debugging AN
adb connect <tv-ip>:5555
adb install GHGFlix.apk
```

---

## Bekannte Einschränkungen (Stand jetzt)

- Die App ist für Touch gebaut; per Fernbedienung ist sie bedienbar, aber
  noch nicht optimiert (echte D-Pad-Fokusführung = Masterplan TV-005…TV-011,
  noch offen). Für die Couch ist **Weg 1** aktuell die rundere Erfahrung.
- Beste Qualität: Server-Einstellung Transcoding „original“ lassen und Inhalte
  als MP4/H.264 vorhalten (Direct Play, keine Umwandlung nötig).
