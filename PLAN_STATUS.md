# PLAN_STATUS — Umsetzungsstand des GHGFlix-Masterplans

Referenz: [`GHGFlix_Masterplan.md`](GHGFlix_Masterplan.md) · Stand: 16.07.2026 · Branch: `fix/supabase-sync`

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

## Offene Phasen

- Phase 2 (ARCH-01…18): nicht begonnen
- Phase 3 (MOB-001…045): nicht begonnen
- Phase 4 (TV-001…055): nicht begonnen — Empfehlung: mit TV-044…048 (Browser-TV-Modus) starten
- Phase 5 (SRV/SEC/PERF): nicht begonnen (außer SEC-002, SRV-014)
- Phase 6 (QA/OPS/DOC): nicht begonnen (außer OPS-015 = diese Datei, DOC-002)
