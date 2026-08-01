# Übergabe an eine neue Sitzung

Diesen Text im neuen Chat als ersten Prompt einfügen. Er enthält alles, was
nötig ist, um ohne Rückfragen weiterzuarbeiten.

---

## Prompt zum Kopieren

Arbeite an GHGFlix weiter. Lies zuerst `PLAN_STATUS.md` im Projekt — dort
stehen alle Messergebnisse. **Wichtig: Nicht neu untersuchen, was dort schon
gemessen wurde.**

**Repos (beide lokal, beide gepusht):**
- `C:\Users\basti\Documents\GHGFlix` — Branch `feature/zimaos-docker-server`
  (NICHT `main`, das steht auf v0.9.6 und ist ~36 Commits zurück)
- `C:\Users\basti\Documents\vetnow-app` — Branch `main` (VetNow Studio, Docker)

**Stand:** Desktop-App 1.3.0 · Server 2.6.0 · Handy/TV-App 3.3.0
(versionCode 15, gebaut und am Fernseher installiert — nachgeprüft per
`dumpsys`). OTA-Kanal `preview` ist eingerichtet.

**Geräte im Netz:**
- GHGFlix-Server: `http://192.168.68.10:8484` (ZimaOS/Docker, Passwort gesetzt)
- Fernseher: `192.168.68.157`, Android 11, ADB über Port 5555 offen und
  autorisiert. `adb` liegt in `werkzeuge\platform-tools\adb.exe`.
- Medien: `Z:\TO-MOONDOOM\Series`, `Y:`, `X:`, `W:`, `C:\MediaStack`

**Arbeitsweise (bitte einhalten):**
- Antworten und Code-Kommentare auf Deutsch. Kommentare erklären das WARUM,
  besonders bei Fallen (so ist der Bestand geschrieben).
- `.ps1`-Dateien: **nur ASCII**, keine Umlaute (PowerShell 5.1 liest in ANSI).
- **Keine Subagenten** — der Nutzer ist auf dem Pro-Plan und will das nicht.
- Erst messen, dann behaupten. In diesem Projekt sind schon mehrere Dinge als
  „fertig" gemeldet worden, die nie funktioniert haben.
- Tests: `cd server && npm test` · `cd mobile && npm test` ·
  `cd src-tauri && cargo test --lib` · `npx tsc --noEmit`
- Der Nutzer will PowerShell-Befehle zum Kopieren, jeweils mit `cd` davor,
  und einen Hinweis, ob Adminrechte nötig sind (bisher nie).

**Was ZULETZT fertig wurde (Phase 11, siehe PLAN_STATUS):** die fünf offenen
Punkte 1–5 — Auswahl-Fenster für Ordner mit Ignorierliste, HLS für iPhone/iPad
(das schwarze Bild kam vom fragmentierten MP4), Filme-/Specials-Reiter in der
Serienansicht, Trailer mit Staffel- und Sprachauswahl samt Behebung von
YouTube-Fehler 153 (`Referrer-Policy: no-referrer`), und die Kanäle-Seite mit
YouTube-Abos, Benachrichtigung und Leaks/Blog-Bereich.

**Zuletzt fertig (Phase 12, siehe PLAN_STATUS):** Erkennung nachgeschärft
(nichtssagende Ordnernamen, zusammengezogene Folgennummern, Titel-Abgleich für
`120 - Titel`-Dateien — 68 von 162 Miraculous-Folgen standen falsch und sind
korrigiert) sowie die Kanäle-Seite mit Gruppen, Shorts-Trennung, Suche,
Merkliste, Gesehen-Markierung und Kanal-Einzelansicht.

**WICHTIG für die Handy-/TV-App:** Alle Änderungen aus Phase 12 sind
**Desktop und Web** — auf ausdrücklichen Wunsch des Nutzers. Handy und TV
wurden bewusst nicht angefasst.

**Was NOCH ZU TUN ist:**

1. **APK bauen und aufspielen** — der einzige verbliebene Punkt aus der alten
   Liste:
   ```
   cd C:\Users\basti\Documents\GHGFlix\mobile
   npx eas-cli build --platform android --profile preview
   ```
   Dauert ~1 Std (kostenloses EAS-Kontingent). Danach mit
   `scripts\tv-installieren.ps1` über ADB auf den Fernseher — der Weg über
   „Downloader" ist nachweislich der, bei dem der Download abbricht.
   Ab diesem Bau kommen reine JavaScript-Änderungen per OTA in Sekunden
   aufs Gerät: `npx eas-cli update --branch preview`.
2. **Am echten Gerät prüfen**, was diese Umgebung nicht kann:
   iPhone-Wiedergabe über den neuen HLS-Weg, OTA-Auslieferung, EAS-Bau.
3. **`mobile/test/oberflaeche.test.mjs` läuft nicht durch** (über 200 s ohne
   Ergebnis). Nachgemessen: das passiert auch mit unveränderten Dateien, liegt
   also am Testaufbau (Babel-Übersetzung ohne Zwischenspeicher), nicht an den
   letzten Änderungen. `laden.test.mjs` (28 Prüfungen) läuft normal.
4. **Trailer-Fenster und Kanäle-Seite in die Handy-/TV-App nachziehen** —
   beides ist reines JavaScript und geht nach dem ersten Bau per OTA.
5. **`feature/zimaos-docker-server` → `main` mergen** (OPS-021), `main` hängt
   seit v0.9.6 fest.

**Nicht noch einmal untersuchen (schon gemessen, steht in PLAN_STATUS.md):**
- Die APK ist technisch einwandfrei. „Problem beim Parsen des Pakets" kam vom
  abbrechenden Download am Fernseher, nicht von der Datei. Gelöst über
  `scripts\tv-installieren.ps1` (ADB) — funktioniert, zweimal `Success`.
- Miraculous Staffel 6 wird korrekt erkannt: 22 Dateien auf der Platte, 22
  Folgen in der App. Es fehlen die DATEIEN E18, E24, E25.
- Die falschen „Specials" kommen aus `Season 01\… - S01E53 - Action.mkv`.
  Staffel 1 hat keine 53. Folge, daraus wird S00E02. **Tipp:** genau dafür gibt
  es jetzt das Auswahl-Fenster — die Datei einmal ablehnen, dann ist Ruhe.
- Der Ordner `…\Websites Download\miraculous to\…\miraculous.to\en` ist als
  TV-Bibliothek eingetragen, enthält aber 0 Videos (HTTrack-Abzug einer
  Website). Sollte aus den Bibliotheken entfernt werden.
- Die Versionsangabe zu einer hochgeladenen APK stammt aus `app.json` und
  kann falsch sein — deshalb liest `tv-installieren.ps1` sie nach der
  Installation am Gerät aus.
- YouTube-Fehler 153 kam von `Referrer-Policy: no-referrer`. Ist behoben und
  durch einen Test in `server/test/routen.test.mjs` gesichert — wer den Header
  zurückdreht, macht die Trailer wieder kaputt.
