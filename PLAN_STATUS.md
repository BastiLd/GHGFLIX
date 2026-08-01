# PLAN_STATUS — Umsetzungsstand des GHGFlix-Masterplans

Referenz: [`GHGFlix_Masterplan.md`](GHGFlix_Masterplan.md) · Stand: 31.07.2026 ·
Branches: `fix/supabase-sync` → `feat/arch-consolidation` → `feat/mobile-v2` →
`feat/tv-mode` → `feat/server-hardening` → `chore/docs-qa` → `feature/zimaos-docker-server`
(aufeinander aufbauend, verifiziert per `git merge-base --is-ancestor` — keine Divergenzen).
`feature/zimaos-docker-server` enthält ALLES und ist der aktuelle Arbeitsstand.
**Offen: `main` wurde seit v0.9.6 (07.07.) nie aktualisiert** — bewusst nicht
gemergt, bevor Phase 7 unten nicht abgeschlossen ist (main soll nur einen
lauffähigen Stand bekommen).
Gesamtbericht: [`BERICHT.md`](BERICHT.md)

## Entscheidungen (Abschnitt 3 des Plans — empfohlene Defaults verwendet, robert kann jederzeit ändern)

1. TV-Plattform: **Android TV / Fire TV zuerst** (noch nicht begonnen)
2. Vertrieb: **erst Sideload, Store optional später**
3. Sync-Zielbild: **Docker-Server = Source of Truth, Supabase = optionales Cloud-Relay** (ARCH-01)
4. Konten: **ein Account, mehrere Profile (wie aktuell)**
5. TV-Transcoding: **Direct Play bevorzugen** (relevant ab Phase 4)
6. `GHGFLIX_PASSWORD`: **offen — bitte prüfen/setzen** (SEC-001)

## Phase 1 — kritische Bugfixes ✅ (dieser Branch)

### Supabase-Sync (Kern-Bug aus Abschnitt 1.1)

| ID | Status | Notiz |
|---|---|---|
| S-001 | ✅ | Neue Sektion „Server-Sync mit Supabase (Cloud-Relay)“ in `Settings.tsx`, nur `IS_WEB` — spricht `GET/POST /api/settings` + `POST /api/supabase/import` an (waren serverseitig fertig, aber von der UI unerreichbar) |
| S-002 | ✅ | Service-Role-Key-Feld mit Warnung; Key wird nie zurückgegeben (nur `supabase_key_set`) |
| S-003 | ✅ | Auto-Import direkt nach Speichern eines neuen Keys + Server-Loop tickt 5 s nach Boot |
| S-004 | ✅ | Push/Pull-Checkboxen, Zustand aus `GET /api/settings` |
| S-005 | ✅ | Klartext-Status „Verbunden / Fehler seit … / nicht konfiguriert“ (via `supabase_status`) |
| S-006 | ✅ | `startSupabaseSync()` — 60-s-Loop für aktives Cloud-Profil (`src/lib/supabase.ts`) |
| S-007 | ✅ | Pull-on-focus über `visibilitychange` |
| S-008 | ✅ | Fehlerzähler `supabaseSyncHealth()`, Logging statt Toast-Spam |
| S-010 | ✅ | Optionaler `supabase_user_id`-Filter (Setting/ENV `SUPABASE_USER_ID`) |
| S-011 | ✅ | `upsertTmdbProgress` awaited `applyPendingProgress` (Race Condition behoben) |
| S-019 | ✅ | Validierung: URL/Key vertauscht, publishable- statt secret-Key |
| S-021 | ✅ | Leerer Wert löscht Setting-Zeile → ENV-Fallback bleibt intakt |
| S-022 | ✅ | `SUPABASE_USER_ID`-Kommentar in docker-compose.yml ergänzt |
| S-034 | ✅ | Versionen: App 0.9.8, Server 2.1.0 |
| S-035/DOC-002 | ✅ | README-ZimaOS Abschnitt „Synchronisierung“ überarbeitet |
| SEC-002 | ✅ | `/api/settings` GET liefert nur `supabase_key_set`-Boolean |
| SRV-014 | ✅ | Sync-Status/Fehler strukturiert über `/api/settings` abrufbar |
| S-013/S-014/S-033 | ⏳ | **Manuelle End-to-End-Tests durch robert nötig** (Desktop ↔ Server ↔ Supabase in beide Richtungen) |

### Audio/Video-Sync (Abschnitt 1.2)

| ID | Status | Notiz |
|---|---|---|
| AV-01/AV-02 | ✅ | Transcode-Seek: bei `start > 0` wird Video neu encodiert statt keyframe-versetzt kopiert (`stream.js`). Abschaltbar: `TRANSCODE_ACCURATE_SEEK=off` |
| AV-03 | ✅ | `X-GHG-Stream-Start`-Header; Client-Offset-Annahme stimmt jetzt exakt |
| AV-07 | ✅ | ffmpeg-stderr wird gepuffert; Timestamp-Warnungen + Fehler-Exits werden geloggt |
| AV-11 | ✅ | Audiospur-Wechsel läuft über denselben Pfad → mitbehoben |
| AV-13 | ✅ | mpv: explizit `--video-sync=audio` (außer Laufruhe-Modus) |
| AV-14 | ✅ | mpv: `--no-config` Standard; Opt-in „Eigene mpv.conf zulassen“ in Einstellungen → Leistung |
| AV-20/AV-12 | ✅ | Mobile-/Web-Player-Offset-Annahme dokumentiert & durch Server-Fix korrekt |
| AV-04/AV-24/AV-30 | ⏳ | **Manuelle Testmatrix (Seek-Tests mit Referenzclip) durch robert nötig** |

## Phase 2 — Sync-Architektur ✅ (`feat/arch-consolidation`)

| ID | Status | Notiz |
|---|---|---|
| ARCH-01/02/12 | ✅ | Zielbild entschieden + dokumentiert: Server = Source of Truth, Supabase = optionales Relay, Mobile/TV nur gegen Server ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)) |
| ARCH-05 | ✅ | Sync-Schlüssel-Konvention zentral dokumentiert (4 Code-Stellen benannt) |
| ARCH-06 | ✅ | Mermaid-Architekturdiagramm |
| ARCH-16 | ✅ | Stabile `server_id` (UUID) + Ausgabe in `/api/ping` |
| S-017 | ✅ | Sync-Cursor an Server-ID gebunden, inkl. Migration alter URL-Cursor |
| ARCH-03/04/17, S-009 | 📋 | Bewusst Backlog — Begründung in ARCHITECTURE.md |

## Phase 3 — Mobile-App ✅ (`feat/mobile-v2`)

| ID | Status | Notiz |
|---|---|---|
| MOB-008 | ✅ | Konkrete Verbindungsfehler (Timeout / falscher Dienst / Netzfehler) |
| MOB-020 | ✅ | `versionCode` 2 / `buildNumber`, App-Version 1.1.0 |
| MOB-033 | ✅ | Cleartext-Traffic begründet dokumentiert (README) |
| MOB-034 | ✅ | URL-Autokorrektur (`http://` wird ergänzt) |
| MOB-041 | ✅ | „Meine Liste“-Reihe + Herz-Toggle (Show & Film) |
| MOB-042 | ✅ | Gesehen-Status: Long-Press auf Folgen, Button bei Filmen |
| MOB-023 (APK) | 📋 | Anleitung fertig (mobile/README) — Build braucht kostenloses expo.dev-Konto |
| MOB-003/004/005/006/011/012/013/014/018 u. a. | 📋 | Backlog (größere Features: Untertitel, Chromecast, QR-Pairing, …) |

## Phase 4 — TV ✅ Teil A (`feat/tv-mode`)

| ID | Status | Notiz |
|---|---|---|
| TV-044/045/046 | ✅ | Browser-TV-Modus: Auto-Erkennung, Pfeiltasten-2D-Navigation, Fokus-Ringe, 10-Foot-CSS, Overscan-Safe-Area (`src/lib/tvMode.ts`) |
| TV-047 | ✅ | Direktlink `?tv=1` aktiviert den Modus dauerhaft |
| TV-048 | ⏳ | Kompatibilitätsliste: bitte auf deinen echten TVs testen und in tv/README ergänzen |
| TV-004/OPS-014 | ✅ | Sideload-Anleitung USB-Stick / Downloader / adb ([tv/README.md](tv/README.md)) |
| TV-001…TV-043, TV-049…TV-055 | 📋 | **Native Android-TV-App = größtes offenes Stück** (eigenes `tv/`-Expo-Projekt mit D-Pad-Fokusführung; braucht echte Geräte zum Testen) |

## Phase 5 — Server-Härtung ✅ Kern (`feat/server-hardening`)

| ID | Status | Notiz |
|---|---|---|
| SEC-003 | ✅ | Token-Ablauf 180 Tage (altes Format migriert) |
| SEC-004 | ✅ | `/api/logout_all` + „Alle Geräte abmelden“-Button (Web) |
| SEC-008/SRV-007 | ✅ | Login-Sperre: 5 Min nach 8 Fehlversuchen pro IP |
| SRV-005 | ✅ | Graceful Shutdown (SIGTERM beendet ffmpeg sauber) |
| SRV-017 | ✅ | `TRANSCODE_MAX` (Standard 3) mit klarer 503-Meldung |
| SRV-034 | ✅ | Security-Header (nosniff, X-Frame-Options, Referrer-Policy) |
| S-030 | ✅ | Tägliche pending_progress-Aufräumroutine (180 Tage) |
| SEC-001 | ⚠️ | **BITTE PRÜFEN: `GHGFLIX_PASSWORD` setzen!** |
| SRV-001/024/025, SEC-010/012, PERF-* | 📋 | Backlog (Refactoring, API-Versionierung, Pagination, CSP, Lasttests) |

## Phase 6 — Doku/QA/CI ✅ Kern (`chore/docs-qa`)

| ID | Status | Notiz |
|---|---|---|
| DOC-001/007/008/011 | ✅ | README: Handy/TV, Troubleshooting Sync + Ton/Bild, PLAN_STATUS-Link |
| DOC-002/S-035 | ✅ | Server-README Sync-Abschnitt (bereits Phase 1) |
| DOC-004 | ✅ | tv/README.md |
| DOC-005 | ✅ | Architektur-Diagramm |
| QA-005 | ✅ | [docs/TEST_CHECKLIST.md](docs/TEST_CHECKLIST.md) |
| QA-003/OPS-001 | ✅ | CI-Workflow `Checks` (tsc, Web-Build, Server-Syntax) |
| QA-001/002 etc. | ⏳ | **Manuelle Tests durch robert** — Checkliste benutzen |
| OPS-004/005/SRV-016 | ✅ | War schon da: Multi-Arch-Docker-Build (amd64+arm64) in CI |

## Zwischenstand 17.–31.07. (undokumentiert nachgetragen)

Zwischen Phase 6 (16.07.) und heute lief ohne PLAN_STATUS-Pflege eine lange
Session direkt auf `feature/zimaos-docker-server`: Server-seitige Erkennung neu
1:1 vom Desktop portiert (Show/Season-Gruppierung, Poster/Banner-Trennung,
Sprite-Vorschaubilder), Supabase-Sync-Kernbug behoben (lokal↔Cloud-Profil-
Verknüpfung), komplette Mobile-App-Neuentwicklung (9 Module statt 1 Datei,
Player, TV-Fernbedienungs-Fokussystem, Ton-/Untertitelspuren, Einstellungen,
QR-Kopplung, Selbst-Update), VetNow-Studio-Integration (App 3.1.0 / Server
2.4.0). Dabei sind **frühere Backlog-Punkte als erledigt gemeldet worden, die
es nicht sind** (TV-001…TV-055 native App, MOB-Untertitel/QR-Pairing) — siehe
Phase 7. Diese Lücke ist der Grund, warum PLAN_STATUS ab jetzt wieder gepflegt
werden sollte, statt Fortschritt nur in Chat-Zusammenfassungen zu behaupten.

## Phase 7 — Stabilisierung ✅ (umgesetzt 31.07.2026)

Ziel: App läuft wieder zuverlässig, bevor an Umfang oder Politur
weitergearbeitet wird. Jeder Punkt wurde vor dem Fix reproduziert und nach dem
Fix nachgewiesen — nicht nur behauptet.

| ID | Status | Notiz |
|---|---|---|
| DOCK-001 | ✅ | **Studio-Port-Bug.** `vetnow-app/studio/lib/proc.js` `stop()` beendete unter Linux nur den getrackten Top-Level-PID per SIGTERM. Da der Start als `bash -c "… && npx expo start"` läuft, ist das die Schale — der eigentliche Metro-Prozess überlebte als Waise und hielt den Port. Der nächste Start meldete „Port is being used", `npx expo` durfte mit `CI=1` nicht nachfragen, übersprang den Dev-Server und endete trotzdem mit Code 0 (sah also erfolgreich aus). Behoben: Start mit `detached: true` (eigene Prozessgruppe), Stopp per `process.kill(-pid)` mit SIGKILL-Nachschlag, plus Preflight, der einen von früher belegten Port über `/proc` findet und freiräumt. **Nachgewiesen** in `studio/test/proc.test.js` — läuft im echten `node:22-bookworm`-Container: Test 1 reproduziert den Fehler, Test 2–5 belegen die Behebung inkl. „stoppen und sofort neu starten" und „Altlast aufräumen ohne Containerneustart". 15/15 grün. |
| MOB-050 | ✅ | SDK-54-Upgrade jetzt fest in `mobile/package.json` + `package-lock.json` (expo 54.0.36, RN 0.81.5, react 19.1.0, alle expo-Module auf die von `expo@54/bundledNativeModules.json` vorgegebenen Fassungen). Vorher steckte es nur als Handbefehl im Container und wurde bei jedem Studio-Start durch `git reset --hard` verworfen. Vorher geprüft, dass der Player die Umstellung überlebt: die Typdefinitionen von `expo-video` 3.0.16 enthalten alle benutzten Bestandteile (`replace`, `availableAudioTracks`, `audioTrack`, Ereignisse `timeUpdate`/`playingChange`/`statusChange`) unverändert. `npx expo-doctor`: 18/18. |
| MOB-050b | ✅ | **Folgefehler des SDK-Wechsels, vorher gefunden statt hinterher:** `expo-file-system` 19 hat `downloadAsync`/`getContentUriAsync`/`cacheDirectory` nach `expo-file-system/legacy` verschoben. `src/update.js` hätte still auf „nur Browser öffnen" zurückgeschaltet — das bequeme Selbst-Installieren wäre kommentarlos verschwunden. Jetzt Weiche mit Rückfall auf den alten Pfad. Außerdem: `expo-intent-launcher` wurde von `update.js` benutzt, stand aber **nie** in den Abhängigkeiten — der Weg „App installiert sich selbst" konnte also noch nie funktionieren. Ergänzt. |
| SRV-040 | ✅ | **QR-Kopplung war totes Programm.** `/api/pair/start`, `/api/pair/check` und `/koppeln` steckten im `if (p === "/api/apk" && POST)`-Block. Eine Anfrage kann nie beides sein → über HTTP nie erreichbar, obwohl `koppeln.js` für sich 32 grüne Tests hatte. Herausgelöst; die Anmeldepflicht des Uploads blieb erhalten. Neuer `server/test/routen.test.mjs` startet den **echten** Server und klopft die Routen von außen ab — gegen den alten Stand 9 Fehlschläge, gegen den neuen 16/16 grün. Genau diese Testebene (HTTP statt Modul) hat gefehlt. |
| MOB-051 | ✅ | **APK ließ sich nicht installieren.** `eas.json` stand auf `appVersionSource: "remote"`: dann führt EAS den versionCode auf dem Server und ignoriert `app.json`. Stand dieser Zähler niedriger als die auf dem Fernseher installierte 13, war jeder neue Bau aus Android-Sicht ein Rückschritt → Installation bricht ohne brauchbare Meldung ab. Jetzt `"local"` + `versionCode: 14` sichtbar in `app.json`. Zusätzlich erklärt `/app` (Installationsseite) jetzt direkt am Fernseher den Fall „Download geht, Installieren nicht" samt Lösung (alte Fassung zuerst deinstallieren) — der Hinweis stand bisher nur im PowerShell-Skript, das am TV niemand sieht. |
| SRV-041 | ✅ | **Stiller Datenverlust-Fehler, beim Testlauf entdeckt.** Die Sicherung gegen leere Docker-Mounts in `scanner.js` verglich einen vereinheitlichten Bibliothekspfad per SQL-`LIKE` gegen die roh gespeicherten Dateipfade. Unter Linux fällt das nicht auf, unter Windows traf der Vergleich nie zu — die Sicherung griff dort also überhaupt nicht und ein leerer Mount hätte die Bibliothek gelöscht. Beide Seiten laufen jetzt über `pfadNorm`/`liegtUnter`, dieselbe Regel auch für `isOffline`. Der zugehörige Test war rot und ist jetzt grün. |
| TEST-001 | ✅ | **Zwei Testhelfer prüften unter Windows in Wahrheit gar nichts.** Der Modul-Hook in `mini-renderer.mjs` und `laden.test.mjs` erkannte absolute Pfade an `name.startsWith("/")` — unter Windows („C:\…") nie zutreffend. Jede übersetzte Datei bekam dadurch statt des echten Moduls die react-native-Attrappe, die zu **jedem** Namen eine Funktion liefert: alle Export-Prüfungen bestanden scheinbar, und `useFokusSystem()` gab immer `null` zurück. Von den 34 Oberflächen-Tests liefen faktisch nur 7. Behoben über `path.isAbsolute`; zusätzlich die React-Attrappe von einem Proxy auf ein einfaches Objekt umgestellt, weil Babels `_interopRequireWildcard` die Eigenschaften kopiert und dabei jeden Proxy aushebelt. Jetzt laufen alle 34 wirklich durch (Poster anwählbar, Player-Leiste erreichbar, Steuerkreuz). |
| OPS-022 | ✅ | **Das Server-Abbild trug die falsche Versionsnummer.** `.github/workflows/docker.yml` vergab fest den Tag `2.3.2`, während der Server im Code längst `2.4.0` meldete — ein Abbild `ghcr.io/bastild/ghgflix-server:2.4.0` gab es also nie. Wer in ZimaOS die im letzten Bericht genannte Version eintrug, bekam einen Pull-Fehler statt eines Updates. Der Tag wird jetzt aus `server/package.json` gelesen, und ein Prüfschritt bricht den Bau ab, falls `package.json` und `src/index.js` auseinanderlaufen. Server steht jetzt auf **2.4.1**. |
| OPS-020 | ✅ | Arbeit lief direkt in `C:\Users\basti\Documents\GHGFlix` auf `feature/zimaos-docker-server` (die Claude-Worktree hing an einem 29 Commits alten `main`). |

**Testlage nach Phase 7:** Server 5 Dateien grün (u. a. 16 Routen-, 32 Kopplungs-,
41 Spuren-Tests), Handy/TV 220 Tests grün (28 Laden, 34 Oberfläche, 43 Fokus,
20 Netzsuche, 39 Untertitel, 33 QR, 23 Update), Studio 15 Tests grün im
Linux-Container.

**Nicht am Gerät geprüft (kann diese Umgebung nicht):** ob ein EAS-Bau
tatsächlich durchläuft, ob die OTA-Auslieferung auf dem Fernseher ankommt und
ob der Signaturschlüssel bei EAS derselbe geblieben ist. Bleibt der erste
Punkt der nächsten Sitzung.

## Messungen am echten System (01.08.2026) — vor weiterer Arbeit lesen

Drei Annahmen haben sich beim Nachmessen als falsch herausgestellt. Wer hier
weiterarbeitet, spart sich damit die Suche an der falschen Stelle.

**1. Die APK ist nicht beschädigt.** „Problem beim Parsen des Pakets" liess
Datei-Beschädigung vermuten. Nachgemessen: die Datei auf dem Server ist
byteweise identisch mit der lokalen (SHA-256 gleich), ein vollständiges ZIP,
v2-signiert, `resources.arsc` STORED und 4-Byte-ausgerichtet, alle 48 `.so`
4096-Byte-ausgerichtet, alle vier Architekturen vorhanden. Der Abbruch
passiert beim **Herunterladen am Fernseher**. Lösung ist deshalb der
ADB-Weg (`scripts/tv-installieren.ps1`), nicht weiteres Schrauben an der APK.

**2. Die Erkennung von Miraculous Staffel 6 ist korrekt.** Gemeldet war
„Staffel 6 wird nicht erkannt". Tatsächlich liegen in
`Z:\TO-MOONDOOM\Series\Miraculouse - …\Season 06` genau **22 Videodateien**,
und die App hat genau **22 Folgen** erkannt. Es fehlen die *Dateien* E18, E24
und E25 (nach E17 springt es auf E19) — miraculous.to listet 25 Folgen. Am
Scanner ist hier nichts zu reparieren.

**3. Die falschen „Specials" kommen aus einem Dateinamen.** In `Season 01`
liegt `… - S01E53 - Action.mkv`. Staffel 1 hat keine 53. Folge, deshalb wird
die Datei zu `S00E02` und erscheint unter Specials. Die echten Specials
(New York, Shanghai, Paris, London, Tokyo) und der Film „Awakening" sind als
Dateien **gar nicht vorhanden** — sie können also auch nicht erscheinen.

**4. Eine Website-Kopie ist als TV-Bibliothek eingetragen:**
`C:\Users\basti\Documents\Websites Download\miraculous to\miraculous\miraculous.to\en`
Dort liegen 170 HTML-Dateien und 18 Bilder, aber **kein einziges Video** (es
ist ein HTTrack-Abzug der Website). Diese Bibliothek kann nie etwas liefern
und sollte in den Einstellungen entfernt werden.

**5. ADB zum Fernseher funktioniert.** 192.168.68.157, Port 5555 offen,
Android 11, Gerät autorisiert (`device`). GHGFlix ist dort derzeit **nicht
installiert** — die früheren Downloader-Versuche sind also nie durchgekommen.

**6. Offener Fehler: Trailer.** Im Web (`/#/show/28`) meldet der
YouTube-Einbettung „Fehler 153 – Fehler bei der Konfiguration des
Videoplayers". Noch nicht untersucht.

**7. Die Versionsangabe zur APK war falsch — und das hat in die Irre geführt.**
Auf dem Fernseher liegt laut `dumpsys` **Version 2.0.0 (versionCode 4)**,
während der Server dieselbe Datei als „3.1.0" führte. Grund: Das
Upload-Skript legt die Nummer aus `mobile/app.json` als Textdatei neben die
APK — sie stammt also vom Zeitpunkt des Hochladens und **nicht aus der Datei
selbst**. Wurde eine ältere APK hochgeladen, behauptet der Server eine
Fassung, die gar nicht drinsteckt. Genau deshalb schien die automatische
Serversuche „zu fehlen": Sie kam mit 3.0.0, auf dem Gerät lief aber 2.0.0.
`scripts/tv-installieren.ps1` liest die Version jetzt nach der Installation
am Gerät selbst aus und warnt, wenn sie von der Server-Angabe abweicht.

**Folgerung für den nächsten Bau:** Alles, was seither an der App gemacht
wurde (Netflix-Leiste, Netzsuche, SDK 54, `expo-updates`), ist auf dem
Fernseher noch NICHT vorhanden. Sobald einmal ein Bau mit `expo-updates`
installiert ist, kommen alle weiteren reinen JavaScript-Änderungen
(Filme-/Specials-Tabs, Trailer, Feinschliff) ohne neuen Bau per OTA nach.

## Phase 8 — Build-Pipeline vereinfachen (nach Phase 7)

Ziel: EAS-Free-Tier-Wartezeit nicht mehr im täglichen Testzyklus. Entscheidung
Nutzer: „einfacher Dev-Client, du entscheidest sonst" → Dev-Client + OTA.

| ID | Status | Notiz |
|---|---|---|
| MOB-052 | ✅ (vorbereitet) | `expo-updates` ist eingebaut und in `app.json` konfiguriert (`updates.url` auf das vorhandene EAS-Projekt, `runtimeVersion: "1"` als feste Zahl, `channel` je Bauprofil in `eas.json`). Damit gilt ab dem **nächsten** Bau: reine JavaScript-Änderungen gehen mit `npx eas-cli update --branch preview` in Sekunden an Handy und Fernseher — ohne neuen APK-Bau, ohne Sideload. Ein voller Bau ist nur noch nötig, wenn sich native Bestandteile ändern; dann `runtimeVersion` um eins erhöhen. Bewusst **ohne** `expo-dev-client`: der würde in den Auslieferungsbau den Entwickler-Starter mit hineinziehen, und für schnelles Ausprobieren gibt es ja schon Expo Go im Studio. Steht auf „vorbereitet", weil die Auslieferung erst nach dem ersten Bau mit diesen Einstellungen wirklich belegt ist. |
| MOB-053 | 📋 | Selbst-Update in der App (fragt den Server nach einer neueren APK) und OTA laufen derzeit nebeneinander. Sinnvoll wäre, dass die App unterscheidet: „nur JS neu" (kommt von selbst per OTA) gegenüber „neue APK nötig" (native Änderung). Solange `runtimeVersion` von Hand gepflegt wird, ist das kosmetisch — beide Wege funktionieren. |

## Phase 9 — Vollständige 1:1-Parität zu Desktop/Plex/Jellyfin (großer Umfang, laut Nutzer „wirklich alles")

Der große Parallel-Audit (7 Subagents: Mobile-Parität, Server-Erkennung/Artwork,
Supabase-Verifikation, Build/Versionen, Studio-Port-Bug, TV/Web-Parität,
Desktop-Release-Prozess) ist am **monatlichen Ausgabenlimit** gescheitert (0/7
Ergebnisse) — nur DOCK-001/MOB-050/SRV-040/MOB-051 oben wurden von Hand
verifiziert. Der Rest dieser Phase startet ohne vollständige Bestandsaufnahme
und sollte **zuerst** eine neue, vollständige Prüfung durchführen (Limit
inzwischen ggf. zurückgesetzt/erhöht), dann gezielt nacharbeiten.

| ID | Status | Notiz |
|---|---|---|
| PARITY-001 | 📋 | Vollständige Feature-für-Feature-Prüfung Mobile/TV/Web gegen Desktop: Artwork-/Erkennungsqualität, My List, Suche, Stats, Extras, ContextMenu-Äquivalente, Mascot/Empty-States, MiniPlayer/Scrubber. Auch Desktop-only Extras nachziehen (Bildgrößen-Einstellungen, Intro-Quellmodi) — laut Nutzerentscheidung **nichts bewusst auslassen**. |
| PARITY-002 | 📋 | Jetzt, wo Mobile/TV überhaupt läuft: erstmals echten Sync von einem Nicht-Windows-Gerät gegenprüfen (`sync_devices` hatte beim Schreiben dieses Eintrags nur 2× „Windows-PC", 0 Mobile/TV-Geräte je synchronisiert). |
| TV-native-check | 📋 | Nutzer hat sich für **native TV-App als Hauptweg** entschieden (nicht Browser-TV-Modus). PLAN_STATUS stufte die native Android-TV-App zuletzt (Phase 4, 16.07.) als „größtes offenes Stück" ein; die Session danach behauptet, ein komplettes Fokus-/Fernbedienungssystem gebaut zu haben. Das muss verifiziert werden (nicht nur „existiert", sondern Plex/Jellyfin-Qualität) — inkl. TV-001…TV-043/TV-049…055 aus Phase 4 gegenchecken, was davon durch die neue Mobile-App tatsächlich abgedeckt ist. |
| SYNC-010 | 📋 | Desktop-`device_key` (`src/lib/supabase.ts:342`, `localStorage`) hat sich innerhalb von 6 Stunden zweimal neu generiert (vermutlich bei jedem Rebuild/Reinstall) — `sync_devices` sammelt so Karteileichen. Stabilere Geräte-Identität oder Cleanup/Upsert-by-Machine ergänzen. |

## Phase 10 — Doku/Hygiene (niedrige Priorität)

| ID | Status | Notiz |
|---|---|---|
| DOCS-010 | 📋 | Dieses Dokument + `GHGFlix_Masterplan.md`/`BERICHT.md` laufend pflegen statt nur in Chat-Zusammenfassungen zu behaupten — genau diese Lücke hat SRV-040 und die TV-Status-Verwirrung verursacht. |
| OPS-021 | 📋 | Sobald Phase 7 grün ist: `feature/zimaos-docker-server` → `main` mergen (main ist seit v0.9.6 nicht aktualisiert). |
| REL-001 | 📋 | Desktop-Auto-Updater prüfen (`tauri-plugin-updater` o. ä.) statt jedes Mal `scripts\rebuild-windows.ps1` manuell laufen zu lassen. |

## Phase 11 — die fünf offenen Punkte der Übergabe ✅ (01.08.2026)

Reihenfolge wie vom Nutzer vorgegeben. Jeder Punkt hat Tests, die den
FEHLERFALL abbilden, nicht nur den Erfolgsfall.

| ID | Status | Notiz |
|---|---|---|
| PKT-1 | ✅ | **Auswahl-Fenster für Ordner** (Desktop + Web, nicht in der TV-App). Ordner angeben → rekursiv nach Videos durchsuchen → schwebendes Fenster mit Vorschaubild, erratenem Titel und Staffel/Folge je Fund; einzeln oder alle auf einmal bestätigen/ablehnen. Neu: `src-tauri/src/ordnerwahl.rs`, `server/src/ordnerwahl.js`, `src/components/FolderScanDialog.tsx`; Einstieg in Einstellungen → Bibliotheken → „Ordner durchsuchen & auswählen“. **Der Kern ist die Ignorierliste** (Einstellung `ignored_files`): der Scanner läuft später von selbst wieder — ohne gemerkte Ablehnung wäre jede Ablehnung beim nächsten Scan aufgehoben. Genau dieser Durchlauf ist getestet (`server/test/ordnerwahl.test.mjs`, 27 Prüfungen, mit echtem Scan gegen echte Dateien). Rückgängig machen geht in Einstellungen → „Abgelehnte Dateien“. Vorschaubilder für noch nicht indexierte Dateien brauchten eine eigene Freigabe, weil `media_thumbnail` sonst nur Bibliotheksdateien zulässt. |
| PKT-2 | ✅ | **iPhone-Video repariert (HLS).** Ursache belegt: `serveTranscode()` liefert einen ENDLOSEN fragmentierten MP4-Strom (`frag_keyframe+empty_moov`, `-f mp4` in eine Pipe). Chrome/Android spielen das; AVFoundation (jedes `<video>` unter iOS, alle iPhone-Browser, Safari am Mac) verlangt vor dem ersten Bild einen vollständigen Kopf und wartet bei einem Strom ohne Länge ewig → schwarzes Bild. Neu: `server/src/hls.js` mit `/api/hls/<art>/<id>/master.m3u8` → Sitzung + `index.m3u8` + MPEG-TS-Häppchen. Client-Wahl per **Fähigkeitsprüfung** (`canPlayType("application/vnd.apple.mpegurl")`), nicht per Browsererkennung; `/api/play` liefert `hlsUrl` und `hlsPflicht`. Drei Härtungen fürs NAS: (a) `-readrate 1.5 -readrate_initial_burst 30`, damit nicht die ganze Datei vorab auf die Platte geschrieben wird — der MP4-Weg bremst sich über die Pipe von selbst, HLS nicht; welche Schalter das vorhandene ffmpeg kennt, wird **einmal nachgesehen** statt aus der Version geraten (unbekannter Schalter = ffmpeg bricht ab = wieder schwarzes Bild). (b) höchstens 2 Sitzungen je Datei, sonst häuft mehrfaches Spulen ffmpeg-Prozesse an und `TRANSCODE_MAX` ist sofort erreicht. (c) Häppchen unter `DATA_DIR/hls-cache` statt `/tmp` (im Container klein), umstellbar per `HLS_DIR`. Test `server/test/hls.test.mjs` (30 Prüfungen) erzeugt ein echtes Video, holt Playlist und Häppchen und prüft das **Sync-Byte 0x47 alle 188 Byte** — also dass wirklich abspielbares Material herauskommt, nicht nur ein Statuscode 200. |
| PKT-2b | ✅ | **Nebenbefund, blockierte PKT-2:** `mobile/src/player.js` hängte den Zugangsschlüssel ein ZWEITES Mal an eine Adresse, die ihn schon trug (`…?x=1&token=ABC?token=ABC`). Der Server las als Token den Text „ABC?token=ABC“ → mit gesetztem Server-Passwort endete **jede** Wiedergabe am Handy in einem 401. Behoben. |
| PKT-3 | ✅ | **Filme- und Specials-Tabs.** Desktop `ShowDetail.tsx` und Handy `mobile/src/seiten.js`: Staffeln, dann abgesetzt „Specials“ und „Filme“. Zuordnung in `serienfilme.rs`/`serienfilme.js`: (1) Film liegt im Serienordner, (2) Filmtitel beginnt mit dem Serientitel und geht darüber hinaus — reine Gleichheit zählt **nicht**, sonst erschiene bei jeder Serie der gleichnamige Film. (3) Handentscheidungen des Nutzers schlagen beides und hängen an TMDb-ID/Titel statt an der Zeilen-ID, damit sie „Bibliothek neu aufbauen“ überleben — genau das ist getestet (`server/test/serienfilme.test.mjs`, 14 Prüfungen; 4 weitere in Rust). |
| PKT-4 | ✅ | **Trailer + Fehler 153.** Ursache von „Fehler 153 – Fehler bei der Konfiguration des Videoplayers“ gefunden: `Referrer-Policy: no-referrer` (aus SRV-034) — damit sendet der Browser beim Laden des YouTube-`<iframe>` keinen Referer, und YouTube verweigert die Einbettung. Jetzt `strict-origin-when-cross-origin` (Browser-Standard; fremde Seiten sehen nur den Ursprung, nie Pfad oder Token) plus `referrerPolicy` direkt am `<iframe>` — Letzteres ist nötig, weil die Desktop-App gar keine Server-Header hat. Regressionstest in `routen.test.mjs`. Außerdem: TMDb liefert Videos immer nur in EINER Sprache; bisher wurde hart `en-US` geholt und es gab genau einen Trailer. Jetzt werden eingestellte Sprache und Englisch zusammengeführt, Doppelte fallen raus, und das neue Fenster bietet **Staffelauswahl** (TMDb führt Trailer auch je Staffel), **Sprachauswahl** und Gruppierung nach Art (Trailer/Teaser/Ausschnitt/…) plus „Auf YouTube öffnen“ als Rückfallebene. |
| PKT-5 | ✅ | **YouTube-Kanäle abonnieren + Benachrichtigung + Leaks/Blog.** Neue Seite „Kanäle“ (`/kanaele`) mit zwei Bereichen: YouTube und Leaks & Blog. Bewusst über den **offenen Atom-Feed** `youtube.com/feeds/videos.xml?channel_id=UC…` — kein API-Schlüssel, kein Kontingent. Eingabe darf Kanal-Adresse, `@name` oder Kanal-ID sein; für Blogs reicht die Seitenadresse, der verlinkte RSS-/Atom-Feed wird gefunden. Server (`kanaele.js`) und Desktop (`kanaele.rs`) holen alle 30 Minuten im Hintergrund ab — deshalb stimmt die Zahl auch, wenn die Oberfläche stundenlang zu war. Zähler in der Seitenleiste (rot), Toast plus Systembenachrichtigung, wenn sie steigt. **Beim ERSTEN Abruf eines neuen Abos gilt nichts als neu** — sonst löste ein frisch abonnierter Kanal sofort 15 Meldungen aus. Test `server/test/kanaele.test.mjs` (39 Prüfungen) fährt einen eigenen Feed-Server hoch, holt zweimal ab und ergänzt dazwischen genau einen Eintrag — das ist die einzige Art, die beiden stillen Fehler („meldet nichts“ / „meldet alles immer wieder“) zu sehen. 5 weitere Prüfungen in Rust. |

**Testlage nach Phase 11:** Server **9 Dateien, alle grün** (32 Kopplung, Profile,
Scanner, 41 Spuren, 20 Routen, 30 HLS, 27 Ordnerwahl, 14 Serienfilme, 39 Kanäle) ·
Rust **20 Unit-Tests grün** (`cargo test --lib`) · `cargo check` und
`npx tsc --noEmit` ohne Fehler · Handy `test/laden.test.mjs` 28 grün.

**Offen und ehrlich benannt:**
- `mobile/test/oberflaeche.test.mjs` läuft in dieser Umgebung nicht durch (über
  200 s ohne Ergebnis). **Nachgemessen: das passiert auch mit den
  unveränderten Dateien** (per `git stash` gegengeprüft) — es liegt also nicht
  an den Änderungen dieser Sitzung, sondern ist ein bestehendes Problem des
  Testaufbaus (Babel-Übersetzung ohne Zwischenspeicher). Sollte separat
  angesehen werden.
- Punkt 4 und 5 sind **Desktop + Web**. Die Handy-/TV-App bekam aus dieser
  Runde Punkt 3 (Filme-/Specials-Reiter), den HLS-Weg für iOS und den
  Token-Fehler behoben. Trailer-Fenster und Kanäle dort nachzuziehen ist
  danach eine reine JavaScript-Änderung und geht per OTA ohne neuen Bau.
- Nicht am Gerät geprüft (kann diese Umgebung nicht): ob ein EAS-Bau
  durchläuft, ob die OTA-Auslieferung ankommt und ob das iPhone das neue HLS
  wirklich abspielt.

## Phase 12 — Erkennung nachgeschärft + Kanäle-Seite ausgebaut (01.08.2026, Abend)

| ID | Status | Notiz |
|---|---|---|
| ERK-001 | ✅ | **Nichtssagende Ordnernamen.** `Websites Download\miraculous to\Downloads\…` landete als Serie „Downloads" (4 Staffeln, 90 Folgen, nie von TMDb gefunden). `isGenericDir()` kennt jetzt Namen wie Downloads/Videos/Neuer Ordner/temp (auch mit Zusatz „Downloads (2)"); trifft einer zu, steigt `showSourceName` bis zu drei Ebenen hoch. Dazu `stripDomainSuffix()`: „miraculous to" kommt von miraculous.to, das Länderkürzel gehört nicht zum Titel. Mit Gegenproben, damit „Downton Abbey", „Film Noir Collection" und „Person of Interest" unangetastet bleiben. |
| ERK-002 | ✅ | **Zusammengezogene Folgennummern.** `101` in „Staffel 1" heißt 1×01, nicht Folge 101. Vorher entstand S01E101 — mit solchen Nummern findet TMDb nie einen Folgentitel. Zerlegt wird **nur**, wenn die führende Ziffernfolge exakt der Staffel aus dem Ordnernamen entspricht; „Staffel 1\250" bleibt Folge 250. |
| ERK-003 | ✅ | **Der eigentliche Miraculous-Fehler.** Nach ERK-002 stimmten die Nummern, die Vorschaubilder aber weiter nicht: `S1E20` zeigte „Guitar Villain", die Datei heißt `120 - Pixelator.mp4`. **miraculous.to nummeriert anders als TMDb.** Die App nimmt die Nummer aus dem Dateinamen und holt Titel + Bild von TMDb für *diese* Nummer. Der Dateiname trägt aber auch den Titel — dafür gibt es den Titel-Abgleich, der nur nicht griff: `candidate_of()` suchte ausschließlich nach `SxxEyy`. Versteht jetzt beide Schreibweisen. **Am echten Bestand: 162 Folgen, 135 per Titel erkannt, 68 standen falsch** (Staffel 3: 21 von 26, Staffel 4: 20 von 26, Staffel 6: 16 von 25). Stichprobe danach 70/77 — der Rest sind Schreibvarianten („The Evilustrator"/„The Evillustrator", „Mr."/„Mister"). Drei Dateien blieben ehrlich unentschieden statt geraten. |
| ERK-004 | ✅ | **Titel-Abgleich im Server war viel zu locker** (kein Eindeutigkeitstest, keine zweistufige Umnummerierung — zwei Dateien konnten dieselbe Folge beanspruchen und die UNIQUE-Bedingung verletzen). Jetzt gleiche Logik wie im Desktop. Dazu Knopf „Titel-Abgleich (alle Staffeln)", weil das Problem immer die ganze Serie betrifft. |
| ERK-005 | ✅ | **Staffel-6-Vertauschung + der Weg zurück** (siehe Commit 9531444): der Titel-Abgleich pinnte auch NICHT erkannte Dateien dauerhaft, 17 von 22 Folgen standen falsch, und weil Platzierungen bei jedem Scan neu greifen, half „Bibliothek neu aufbauen" nicht. `set_placement` für Unerkanntes entfernt, Mindestqualität für Titelreste eingeführt, neuer Knopf „Nummern aus Dateinamen" als Rücknahme. |
| KAN-010 | ✅ | **Kanäle-Seite mit Gruppen.** Eine Kachel = ein Film, eine Filmreihe oder eine Serie; darin die zugehörigen YouTube-Kanäle und Blogs. Die Gruppe hängt am **Abo**, nicht am Beitrag — einmal einsortiert landet alles Neue von selbst richtig. Kachelansicht ist Standard, eine Gruppe darf „beim Öffnen direkt aufgehen" (höchstens eine). Je Kachel ein Einstellungsknopf oben rechts: Name, Symbol, Textfarbe, Zuordnung der Abos, löschen. |
| KAN-011 | ✅ | **Shorts von normalen Videos trennen.** Der Atom-Feed verrät nichts über das Format. `youtube.com/shorts/<id>` antwortet aber unterschiedlich — echtes Short mit 200, normales Video mit einer Umleitung auf `/watch`. Deshalb wird der Umleitung bewusst **nicht** gefolgt; in Rust braucht das einen eigenen HTTP-Client, sonst käme immer 200 und jedes Video gälte als Short. Ergebnis wird dauerhaft gemerkt, höchstens 25 Prüfungen je Durchlauf. Ungeprüftes gilt als normales Video — lieber einmal zu viel zeigen als etwas verschwinden lassen. |
| KAN-012 | ✅ | Volltextsuche, Sortierung (neu/alt/Kanal), Merkliste „Später ansehen", Gesehen-Markierung mit Ausblenden, Kanal-Einzelansicht, Abonnieren direkt in die geöffnete Gruppe. **Nur Desktop und Web** — Handy und TV bewusst unberührt (Nutzerwunsch). |
| OPS-030 | ✅ | **Taskleisten-Verknüpfung.** Der NSIS-Installer entfernt sie beim Ersetzen der alten Fassung; Startmenü und Desktop legt er neu an, die Taskleiste nicht. Wieder anheften geht nicht per Programm — nachgeprüft, die Verbenliste einer .exe kennt nur noch „An Start anheften". `rebuild-windows.ps1 -Installieren` sichert die `.lnk` vorher und schreibt sie sofort zurück; gelingt das nicht, sagt es klar, dass ein Rechtsklick nötig ist. |

**Testlage nach Phase 12:** Server **10 Dateien grün** (Kanäle jetzt 60 Prüfungen,
Ordnernamen 30) · Rust **26 Unit-Tests grün** · `cargo check` und `tsc` sauber.

## Versionen

Stand `feature/zimaos-docker-server`: Handy-/TV-App **3.3.0** (versionCode 15,
runtimeVersion 1) · Server **2.5.0** · Desktop-App **1.2.0**.

In ZimaOS also `ghcr.io/bastild/ghgflix-server:2.5.0` eintragen — oder einfach
`:latest`. Nachprüfen unter `http://<server-ip>:8484/api/ping`. `main` steht
weiterhin auf v0.9.6 und hat nichts davon (OPS-021).

**Neue Umgebungsvariablen (alle mit brauchbarem Standard, nichts muss gesetzt
werden):** `HLS_DIR` (wohin die HLS-Häppchen geschrieben werden, Standard
`DATA_DIR/hls-cache`) · `FEED_INTERVAL_SEC` (wie oft Kanäle geprüft werden,
Standard 1800).
