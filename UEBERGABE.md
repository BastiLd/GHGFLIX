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
  (NICHT `main`, das steht auf v0.9.6 und ist ~35 Commits zurück)
- `C:\Users\basti\Documents\vetnow-app` — Branch `main` (VetNow Studio, Docker)

**Stand:** Desktop-App 1.1.0 (gebaut) · Server 2.4.2 · Handy/TV-App 3.2.0
(noch NICHT gebaut) · Auf dem Fernseher liegt noch 2.0.0.

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
- Tests: `cd server && node test/*.test.mjs` · `cd mobile && npm test` ·
  `cd src-tauri && cargo check`
- Der Nutzer will PowerShell-Befehle zum Kopieren, jeweils mit `cd` davor,
  und einen Hinweis, ob Adminrechte nötig sind (bisher nie).

**Was NOCH ZU TUN ist (Reihenfolge vom Nutzer gewünscht):**

1. **Auswahl-Fenster für Ordner** (Desktop + Web-Oberfläche): Man gibt einen
   Ordner an, das Programm durchsucht ihn rekursiv nach Videos und zeigt ein
   schwebendes Fenster mit Vorschaubild pro Fund. Mehrere auf einmal
   bestätigen/ablehnen. Nicht in der TV-App.
2. **Video am iPhone reparieren (HLS).** `server/src/stream.js:169` erzeugt
   fragmentiertes MP4 (`frag_keyframe+empty_moov`). Android kann das, iOS
   nicht — dort bleibt das Bild schwarz. HLS-Ausgabe für Apple-Clients
   ergänzen. Reine Serverarbeit, kein App-Bau nötig.
3. **Filme- und Specials-Tabs** in der Serienansicht (Desktop `ShowDetail.tsx`
   + Handy `mobile/src/seiten.js`). Filme, die zu einer Serie gehören, als
   eigener Tab.
4. **Trailer**: mehrere pro Staffel und pro Film, mit Sprachen. Außerdem der
   offene Fehler: Im Web meldet die YouTube-Einbettung „Fehler 153 – Fehler
   bei der Konfiguration des Videoplayers" (`/#/show/28`).
5. **YouTube-Kanal abonnieren** mit Benachrichtigung bei neuen Videos, plus
   ein Bereich für Leaks/Blog. Ausdrücklich als Letztes.
6. **Dann erst den APK-Bau** (`npx eas-cli build --platform android --profile
   preview`, dauert ~1 Std) — der Nutzer will erst bauen, wenn ALLES fertig
   ist. Danach kommen reine JavaScript-Änderungen per OTA
   (`npx eas-cli update --branch preview`) in Sekunden aufs Gerät.

**Nicht noch einmal untersuchen (schon gemessen, steht in PLAN_STATUS.md):**
- Die APK ist technisch einwandfrei. „Problem beim Parsen des Pakets" kam vom
  abbrechenden Download am Fernseher, nicht von der Datei. Gelöst über
  `scripts\tv-installieren.ps1` (ADB) — funktioniert, zweimal `Success`.
- Miraculous Staffel 6 wird korrekt erkannt: 22 Dateien auf der Platte, 22
  Folgen in der App. Es fehlen die DATEIEN E18, E24, E25.
- Die falschen „Specials" kommen aus `Season 01\… - S01E53 - Action.mkv`.
  Staffel 1 hat keine 53. Folge, daraus wird S00E02.
- Der Ordner `…\Websites Download\miraculous to\…\miraculous.to\en` ist als
  TV-Bibliothek eingetragen, enthält aber 0 Videos (HTTrack-Abzug einer
  Website; die Folgen kommen dort von einem Streaming-Dienst). Sollte aus den
  Bibliotheken entfernt werden.
- Die Versionsangabe zu einer hochgeladenen APK stammt aus `app.json` und
  kann falsch sein — deshalb liest `tv-installieren.ps1` sie nach der
  Installation am Gerät aus.

**Was in dieser Sitzung fertig wurde:** Studio-Port-Bug (Prozessgruppen),
QR-Kopplung war über HTTP nie erreichbar, Datenverlust-Schutz im Scanner war
plattformabhängig, zwei Testhelfer prüften unter Windows gar nichts, SDK 54
festgeschrieben, `expo-updates` für OTA vorbereitet, Netflix-Leiste am Handy,
Staffelzahl ohne Specials, Serversuche mit eigenem Netz und einstellbarer
Parallelität, ADB-Installation, Prüfsummen, Desktop 1.1.0.

**Testlage:** Handy/TV 238 Tests grün · Server alle grün · Rust und
TypeScript ohne Fehler.
