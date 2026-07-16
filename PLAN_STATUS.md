# PLAN_STATUS — Umsetzungsstand des GHGFlix-Masterplans

Referenz: [`GHGFlix_Masterplan.md`](GHGFlix_Masterplan.md) · Stand: 16.07.2026 ·
Branches: `fix/supabase-sync` → `feat/arch-consolidation` → `feat/mobile-v2` →
`feat/tv-mode` → `feat/server-hardening` → `chore/docs-qa` (aufeinander aufbauend —
`chore/docs-qa` enthält ALLES; zum Veröffentlichen in `main` bzw.
`feature/zimaos-docker-server` mergen, damit der Docker-CI-Build anspringt).
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

## Versionen

Desktop-App **0.9.9** · Server **2.2.0** · Mobile **1.1.0** (versionCode 2)
