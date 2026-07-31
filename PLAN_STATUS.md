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
| OPS-020 | ✅ | Arbeit lief direkt in `C:\Users\basti\Documents\GHGFlix` auf `feature/zimaos-docker-server` (die Claude-Worktree hing an einem 29 Commits alten `main`). |

**Testlage nach Phase 7:** Server 5 Dateien grün (u. a. 16 Routen-, 32 Kopplungs-,
41 Spuren-Tests), Handy/TV 220 Tests grün (28 Laden, 34 Oberfläche, 43 Fokus,
20 Netzsuche, 39 Untertitel, 33 QR, 23 Update), Studio 15 Tests grün im
Linux-Container.

**Nicht am Gerät geprüft (kann diese Umgebung nicht):** ob ein EAS-Bau
tatsächlich durchläuft, ob die OTA-Auslieferung auf dem Fernseher ankommt und
ob der Signaturschlüssel bei EAS derselbe geblieben ist. Bleibt der erste
Punkt der nächsten Sitzung.

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

## Versionen

Desktop-App **v0.9.6** (zuletzt auf `main`) · `feature/zimaos-docker-server`:
App **3.1.0** · Server **2.4.0** — main hat diesen Stand noch nicht (OPS-021).
