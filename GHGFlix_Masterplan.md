# GHGFlix — Masterplan: Sync-Fix, Ton/Bild-Sync-Fix, Mobile-App, TV-App

**Erstellt:** 16.07.2026 · **Zweck:** Dieses Dokument an einen neuen Chat (z. B. Claude Fable 5) übergeben, damit dort die komplette Umsetzung erfolgt. Dieser Chat hat NICHTS am Code verändert — nur recherchiert und geplant.

**Repo:** `GHGFlix/` (Tauri 2 + React 19 Desktop-App, `server/` = Node-Docker-Server für ZimaOS, `mobile/` = Expo-Go-Handy-App). Version aktuell 0.9.7 / Server v2.0.0.

---

## 0. Wie dieser Plan zu benutzen ist

1. Nicht alles auf einmal umsetzen. Reihenfolge einhalten (siehe Abschnitt 2 „Phasen"), da spätere Punkte auf früheren aufbauen (z. B. TV-App braucht erst den reparierten Sync).
2. Vor jeder Phase: neuen Git-Branch anlegen (`fix/supabase-sync`, `fix/av-sync`, `feat/mobile-v2`, `feat/tv-app`, …), nach jeder Phase: bauen, manuell testen, committen, danach erst nächste Phase.
3. Jeder Punkt unten hat eine ID (z. B. `S-014`). Bitte in Commit-Messages referenzieren, das macht Review einfacher.
4. Abschnitt 1 enthält die **bereits gefundenen Root Causes** mit exakten Dateipfaden/Zeilen — das erspart erneute Fehlersuche. Bitte zuerst lesen.
5. Abschnitt 3 enthält offene Fragen, die vor bzw. während der Umsetzung mit dem Nutzer (robert) zu klären sind — wo sinnvoll, mit empfohlener Standardentscheidung, damit die Umsetzung nicht blockiert, falls keine Antwort kommt.
6. Die Liste hat **über 300 Einzelpunkte** (Fixes, Verbesserungen, Neuerungen) über 12 Kategorien. Nicht jeder Punkt ist gleich wichtig — Prioritätsmarkierung `[P1]` (kritisch/blockierend), `[P2]` (wichtig), `[P3]` (nice-to-have) ist bei jedem Punkt dabei.

---

## 1. Bereits gefundene Root Causes (durch Code-Analyse bestätigt)

### 1.1 Warum Desktop ↔ Docker-Server über Supabase NICHT synchronisiert (Kern-Bug)

Es gibt im Repo **drei parallele, unabhängige Sync-Mechanismen**, die sich teils überschneiden und teils gar nicht verbunden sind:

- **(A) Desktop ↔ Supabase direkt** — `src/lib/supabase.ts`, Funktion `syncProgress(profileId)`. Nutzt den **anon key** (`supabase_anon_key`) + Supabase-Auth (Login mit E-Mail/Passwort). Wird **nur einmal** aufgerufen, und zwar in `src/pages/Profiles.tsx` Zeile 49, wenn der Nutzer im Profil-Bildschirm ein Cloud-Profil auswählt. **Kein Intervall-Loop, kein Pull im Hintergrund, kein Pull bei App-Start.**
- **(B) Desktop ↔ GHGFlix-Server (LAN/Tailscale) direkt** — `src/lib/serverSync.ts`, REST gegen `/api/sync/progress` auf dem Server. Läuft alle 30s (`startServerSync()`), hat eigene Push/Pull-Cursor in `localStorage`. Funktioniert unabhängig von Supabase — das ist der Pfad, der **heute schon funktionieren sollte**, wenn er in den Desktop-Einstellungen aktiviert ist (Einstellungen → Konto → „GHGFlix-Server (ZimaOS)").
- **(C) Docker-Server ↔ Supabase** — `server/src/supabase.js`. Läuft alle 60s im Hintergrund (`startSupabaseLoop()`, aufgerufen in `server/src/index.js:497`), aber **nur wenn `supabase_key` (Service-Role-Key!) gesetzt ist** — siehe `supabaseConfigured()`.

**Der eigentliche Bug:** Die im Frontend geteilte UI-Sektion „Konto & Sync (Supabase)" (`src/pages/Settings.tsx`, Zeile 1382 ff., wird SOWOHL in der Desktop-App ALS AUCH in der Server-Weboberfläche angezeigt) hat nur zwei Felder: „Project URL" und „Anon Key". Der Button `saveSupabase()` (Zeile 535) speichert IMMER unter dem Setting-Key `supabase_anon_key`:

```
await setSetting("supabase_url", supaUrl.trim());
await setSetting("supabase_anon_key", supaKey.trim());
```

Aber der Server-seitige Hintergrund-Sync (Pfad C, der einzige Mechanismus, der Desktop und Docker OHNE offenen Browser dauerhaft über Supabase verbindet) liest einen **anderen** Setting-Key:

```js
// server/src/supabase.js Zeile 6-7
const url = () => (settingOr("supabase_url", "SUPABASE_URL", "") || "").replace(/\/$/, "");
const key = () => settingOr("supabase_key", "SUPABASE_SERVICE_KEY", "");   // ← "supabase_key", NICHT "supabase_anon_key"!
```

Der Server sucht `supabase_key` (Service-Role-Key), die UI speichert aber nur `supabase_anon_key`. Selbst wenn man in der Server-Weboberfläche (`IS_WEB`-Modus) die Supabase-Sektion ausfüllt, landet der Wert im Browser-Client über `invoke("set_setting", {key:"supabase_anon_key", ...})` → `POST /api/invoke/set_setting` → `server/src/invoke.js` Zeile 293 (schreibt ungefiltert jeden Key) → wird korrekt als `supabase_anon_key` in der Server-DB gespeichert — aber `supabase.js` schaut nie dort nach.

**Zusätzlich:** Es gibt auf Server-Seite bereits fertigen Code für Push/Pull-Toggles und einen manuellen Import (`server/src/index.js` Zeile 454-478: `GET/POST /api/settings` mit den Feldern `supabase_key`, `supabase_push`, `supabase_pull`, sowie `POST /api/supabase/import`) — **aber es gibt im gesamten Frontend (`src/`) keine einzige Stelle, die diese Endpunkte aufruft.** Bestätigt per Grep: 0 Treffer für `supabase_push`, `supabase_pull`, `/api/supabase/import`, `/api/settings` in `src/`. Die Server-seitige Relay-Funktion ist vollständig implementiert, aber komplett unerreichbar von der UI — reines Anzeigeproblem/fehlendes Formular, kein Backend-Bug.

**Auch ohne diesen Bug wäre der Service-Role-Key technisch nötig:** Ein `anon key` unterliegt Supabase Row Level Security (RLS). Der Server hat keine eingeloggte Nutzer-Session, daher würde `pullFromSupabase()`/`pushToSupabase()` mit einem anon key an RLS scheitern (steht so auch im Code-Kommentar: „needs the SERVICE-ROLE key because the server acts for all profiles (RLS bypass)").

**Nebenbefund:** Pfad (A) synct nur einmalig beim Profil-Wechsel — selbst wenn der Bug oben behoben wird, sieht der Desktop-Nutzer neue Fortschritte von anderen Geräten nicht automatisch während er die App offen hat.

### 1.2 Warum Ton und Bild manchmal auseinanderlaufen

Zwei unabhängige Wiedergabepfade, zwei unterschiedliche Ursachen:

**(a) Server-Transcoding (Browser/Handy/TV, wenn Datei nicht direkt abspielbar ist)** — `server/src/stream.js`, Funktion `serveTranscode()`. Es gibt bereits einen Fix-Versuch gegen *graduelles* Auseinanderlaufen (`-af aresample=async=1:min_hard_comp=0.100:first_pts=0`, `-fflags +genpts`) — das hilft gegen langsames Driften über Zeit, behebt aber NICHT das wahrscheinlichere Problem: **Seek/Resume-Versatz.**

Bei jedem Seek/Resume während Transcoding wird `-ss <start>` **vor** `-i` gesetzt (Input-Seeking, Zeile 112). Wenn `copyVideo` aktiv ist (Zeile 107: `row.vcodec === "h264" && !q`, was für die meisten Quellen zutrifft, die nur wegen Container/Audio transcodiert werden müssen), wird das Video **unverändert kopiert** (`-c:v copy`). Input-Seeking mit Stream-Copy springt zwingend zum **nächsten vorherigen Keyframe** — der reale Video-Start weicht damit je nach GOP-Länge der Quelldatei bis zu mehrere Sekunden vom angeforderten `start` ab. Die Audiospur dagegen wird **neu encodiert** (`-c:a aac`) und beginnt exakt bei `start`. Ergebnis: Nach jedem Sprung/Resume während Transcoding-Wiedergabe können Bild und Ton für die ersten paar Sekunden (manchmal dauerhaft, je nach Player-Verhalten) einen Versatz haben — das erklärt „manchmal", weil es vom Abstand zum nächsten Keyframe abhängt (kleiner Versatz = unbemerkbar, großer Versatz = deutlich hörbar/sichtbar).

Verschärfend: Client-seitig (`mobile/App.js` Zeile 570, analog im Web-Player) wird angenommen, der transcodierte Stream beginne **exakt** bei `t=<start>` (`offsetRef.current = at`) — es gibt keine Rückmeldung vom Server, wo der Stream *tatsächlich* zu spielen begonnen hat. Dadurch verschiebt sich nicht nur der A/V-Sync, sondern auch die angezeigte Wiedergabeposition/Fortschrittsanzeige leicht.

**(b) Desktop mpv-Wiedergabe** — `src/pages/Player.tsx`, Funktion `buildMpvArgs()` (Zeile 74-117). Kein explizites `--video-sync=audio` gesetzt (mpv-Default wird verwendet — i. d. R. ok, aber nicht garantiert über alle mpv-Versionen/Builds hinweg identisch). Kein `--no-config`/isolierendes Profil — falls auf dem Nutzer-PC eine eigene `mpv.conf` existiert (z. B. von einer separaten mpv-Installation), können deren Einstellungen die App-Argumente überschreiben oder mit ihnen kollidieren, ohne dass das für den Nutzer sichtbar wäre. `hwdec=auto` ist Standard — bei schwacher GPU/inkompatiblem Codec können Hardware-Decoding-Aussetzer zu Frame-Drops führen, die sich wie A/V-Versatz anfühlen, besonders bei 4K/HEVC ohne aktiviertes `perf_mode`.

---

## 2. Phasen (empfohlene Reihenfolge)

1. **Phase 1 — kritische Bugfixes** (`S-*`, `AV-*`): Supabase-Sync reparieren, A/V-Sync-Bug beheben. Ohne diese Phase bringt eine neue Mobile/TV-App nur weitere Baustellen mit den gleichen Sync-Problemen.
2. **Phase 2 — Sync-Architektur konsolidieren** (`ARCH-*`): die drei Sync-Pfade aufräumen/vereinheitlichen, damit Mobile- und TV-App nicht einen VIERTEN eigenen Sync-Mechanismus brauchen.
3. **Phase 3 — Mobile-App fertigstellen** (`MOB-*`): bestehende Expo-Go-App (funktioniert strukturell bereits, siehe Vorgespräch) polieren, robuster machen, Play-Store/TestFlight-reif machen.
4. **Phase 4 — TV-App(s) bauen** (`TV-*`): neue TV-Oberflächen (Android TV zuerst, siehe Frage in Abschnitt 3).
5. **Phase 5 — Server/Backend-Härtung** (`SRV-*`, `SEC-*`, `PERF-*`): Robustheit, Sicherheit, Performance für den jetzt deutlich höheren Gerätetraffic (4 Clients statt 1).
6. **Phase 6 — Tests, CI, Doku** (`QA-*`, `OPS-*`, `DOC-*`): dauerhaft absichern, damit das nicht wieder kaputtgeht.

---

## 3. Offene Fragen an robert (bitte vor/während Umsetzung klären)

Falls keine Antwort kommt, wird jeweils die **empfohlene Option** (fett) umgesetzt, damit die Arbeit nicht blockiert.

1. **TV-Plattform-Priorität:** Welche TV-Plattform zuerst? **Android TV/Fire TV (empfohlen — eine Codebasis mit der Expo-Mobile-App, kein zusätzlicher Store-Zwang, Sideload möglich)**, oder zusätzlich/stattdessen LG webOS / Samsung Tizen (mehr Aufwand, eigene SDKs, aber deckt „echte" Smart-TVs ohne Zusatzgerät ab)?
2. **Vertrieb:** Nur Sideload/APK (kostenlos, kein Store), oder auch Veröffentlichung im Google Play Store für Android TV (einmalig 25 $ Entwicklergebühr)? **Empfehlung: erst Sideload, Store optional später.**
3. **Supabase als zentrale Wahrheit:** Soll Supabase künftig die **einzige** Sync-Quelle für alle Geräte sein (Desktop, Docker-Server, Mobile, TV synchronisieren alle NUR über Supabase), oder soll der direkte Desktop↔Docker-LAN-Sync (Pfad B, `serverSync.ts`) parallel bestehen bleiben (funktioniert auch ohne Internet/Supabase-Account)? **Empfehlung: Docker-Server bleibt „Source of Truth" fürs Heimnetz (schnell, kein Cloud-Zwang), Supabase wird zum optionalen Cloud-Relay dahinter — siehe ARCH-01.**
4. **Mehrbenutzer/Konten:** Soll jedes Familienmitglied einen eigenen Supabase-Login bekommen, oder reicht ein gemeinsamer Account mit mehreren Profilen (wie aktuell)? **Empfehlung: wie aktuell — ein Account, mehrere Profile.**
5. **Transcoding-Qualität für TV:** TVs zeigen Bildfehler von Transcoding stärker (großer Bildschirm). Soll die TV-App bevorzugt Direct Play erzwingen und nur im Notfall transcodieren, mit deutlicher Warnung? **Empfehlung: ja.**
6. **Passwortschutz:** Ist `GHGFLIX_PASSWORD` aktuell gesetzt? Falls nicht, sollte das vor einer TV-/Mobile-Erweiterung nachgeholt werden (mehr Geräte = größere Angriffsfläche). Siehe `SEC-001`.

---

## 4. Supabase-Sync — Fixes (`S-001` … `S-035`)

- **S-001** [P1] `src/pages/Settings.tsx`: Die geteilte „Konto & Sync (Supabase)"-Sektion in zwei separate Formulare aufteilen: (1) Desktop/Browser-seitiger **Anon-Key-Login** (bestehend, für Pfad A — Profile & UI-Login), (2) **NEU**: Server-seitiges Formular NUR im `IS_WEB`-Modus für **Service-Role-Key** (`supabase_key`) + Push/Pull-Toggles + „Jetzt importieren"-Button, das gegen `/api/settings` (GET/POST) und `/api/supabase/import` spricht.
- **S-002** [P1] Neues Feld „Service Role Key" mit klarer Warnung („niemals mit anderen teilen, dieser Key umgeht alle Zugriffsbeschränkungen") im Server-Formular ergänzen.
- **S-003** [P1] Nach dem Speichern des Service-Role-Keys: sofort `POST /api/supabase/import` anbieten/anstoßen, damit bestehende Cloud-Daten nicht erst nach 60s Intervall auftauchen.
- **S-004** [P1] Push/Pull-Checkboxen (`supabase_push`, `supabase_pull`) im Server-Formular ergänzen, aktueller Zustand aus `GET /api/settings` laden.
- **S-005** [P1] Klartext-Statusanzeige „Supabase: verbunden / nicht konfiguriert / Fehler seit …" im Server-Formular (`supabase_configured` aus `/api/settings` auswerten, siehe `SRV-014` für Fehler-Logging).
- **S-006** [P1] `src/lib/supabase.ts`: `syncProgress()` nicht mehr nur einmalig beim Profilwechsel aufrufen, sondern zusätzlich einen Intervall-Loop analog zu `startServerSync()` einführen (z. B. alle 60s, nur wenn ein Cloud-Profil aktiv ist).
- **S-007** [P1] Zusätzlich Pull-on-focus: beim Zurückkehren ins Browserfenster/App-Fokus (`visibilitychange`) einmal sofort synchronisieren, nicht auf den nächsten Intervall-Tick warten.
- **S-008** [P2] `syncProgress()`: Fehler nicht nur als Toast anzeigen, sondern zusätzlich lokal loggen/zählen, damit man einen dauerhaft kaputten Sync von einem einmaligen Netzwerkfehler unterscheiden kann.
- **S-009** [P2] Realtime-Option prüfen: Supabase Realtime-Subscriptions auf `watch_progress` nutzen, damit Änderungen sofort statt erst beim nächsten Poll ankommen (optional, siehe Frage 3 in Abschnitt 3 — nur sinnvoll, wenn Supabase „zentrale Wahrheit" wird).
- **S-010** [P1] `server/src/supabase.js`: In `pullFromSupabase()` wird `rest("profiles", {select:"*"})` OHNE Filter nach `user_id` abgefragt — bei mehreren Supabase-Accounts im selben Projekt werden fremde Profile mitgeladen. Nach `user_id` des konfigurierten Kontos filtern (Service-Key-Kontext klären, ggf. `user_id` als zusätzliches Server-Setting).
- **S-011** [P2] `upsertTmdbProgress()` (server/src/index.js:81-107) awaited den `import("./scanner.js").then(...)`-Aufruf nicht — Race Condition, bei der die HTTP-Antwort zurückkommt, bevor `applyPendingProgress` gelaufen ist. Mit `await` versehen.
- **S-012** [P2] Gleiches Problem in `pullFromSupabase()` (Zeile 82: `await import("./scanner.js")` wird zwar awaited, aber `applyPendingProgress(db)` selbst läuft synchron direkt danach — prüfen, ob das bei großen Bibliotheken (viele pending rows) den Request blockiert; ggf. in einen Hintergrund-Tick auslagern).
- **S-013** [P1] End-to-End-Testszenario definieren und durchspielen: Film auf Desktop bis 50 % schauen → Docker-Server-Weboberfläche im Browser öffnen → prüfen, ob „Weiterschauen" den Fortschritt zeigt (max. 60s Wartezeit).
- **S-014** [P1] Gleiches Szenario umgekehrt: auf dem Docker-Server/Handy schauen → Desktop-App neu starten → Fortschritt muss übernommen werden.
- **S-015** [P2] Uhrzeit-Synchronität prüfen: `updated_at`/`updatedAt` basiert überall auf `Date.now()` des jeweiligen Geräts (Last-Write-Wins). Bei falscher Systemuhr auf einem Gerät „gewinnt" der falsche Stand. Serverseitige Zeitstempel-Autorität einführen (Server-`now()` statt Client-Zeit beim Schreiben verwenden) oder zumindest eine Toleranzwarnung bei großer Client/Server-Zeitabweichung.
- **S-016** [P2] Konfliktauflösung dokumentieren und im UI sichtbar machen (z. B. „Zuletzt synchronisiert: vor 3 Minuten, 2 Einträge gesendet, 1 empfangen") statt stiller Toasts, die man leicht verpasst.
- **S-017** [P2] `cursorKey()`/`localStorage`-Cursor in `serverSync.ts`: Bei mehreren Server-Adressen (Lokal/Domain/Tailscale) für dieselbe Docker-Instanz entstehen unterschiedliche Cursor-Keys (`base` ist Teil des Keys) — das kann zu doppeltem Pull/Redundanz führen, wenn die Auto-Wahl zwischen Adressen wechselt. Cursor stattdessen an eine stabile Server-ID (`/api/ping` liefert schon `name` — eine echte UUID pro Server-Installation ergänzen) statt an die URL binden.
- **S-018** [P3] `supabase/schema.sql` im Repo mit aktuellem Stand abgleichen (RLS-Policies, Indizes auf `watch_progress(profile_id, updated_at)` für Performance bei großem Verlauf).
- **S-019** [P2] Fehleranzeige, wenn `supabase_url`/`supabase_key` offensichtlich vertauscht wurden (Service-Key beginnt anders als Anon-Key — Validierung ergänzen, analog zur bestehenden `urlLooksWrong`-Prüfung für die URL).
- **S-020** [P3] Sync-Historie/Log-Ansicht in den Server-Einstellungen (letzte 20 Sync-Läufe mit Zeitpunkt, gepusht/gepullt, Fehler).
- **S-021** [P1] Migrations-Hinweis: Bestehende Docker-Installationen, die `SUPABASE_SERVICE_KEY` bereits per Docker-Compose-Env gesetzt haben, dürfen durch S-001 nicht kaputtgehen — `settingOr()` liest ohnehin Env vor Setting, sicherstellen, dass das Verhalten erhalten bleibt.
- **S-022** [P2] `docker-compose.yml`/`docker-compose.zimaos.yml`: `SUPABASE_SERVICE_KEY`-Beispielzeile mit Kommentar ergänzen, damit auch Nutzer, die lieber Env-Variablen statt UI nutzen, wissen, dass es diese Option gibt.
- **S-023** [P2] Mobile-App (`mobile/App.js`) an denselben Sync-Endpunkt anschließen bzw. bestätigen, dass sie über den Server ohnehin automatisch mitsynchronisiert ist (Server = Quelle) — mit Testszenario „Handy schaut Folge, TV/Desktop zeigen Fortschritt".
- **S-024** [P2] Sync-Konfiguration exportierbar machen (Server-Adresse + Token als QR-Code anzeigbar), damit man sie nicht auf jedem Gerät manuell abtippen muss (siehe auch `MOB-018`).
- **S-025** [P3] Unit-Tests für `progressAsTmdb`/`upsertTmdbProgress`/`applyPendingProgress` (reine Funktionen, gut testbar mit einer In-Memory-SQLite-DB).
- **S-026** [P3] Unit-Tests für `serverSync.ts`s `syncOnce()` mit gemocktem `fetch`.
- **S-027** [P2] Rate-Limiting/Backoff, falls `/api/sync/progress` fehlschlägt (aktuell: stiller Catch, nächster Versuch in 30s/60s — bei dauerhaftem Fehler sollte die UI das nach spätestens 2-3 Fehlversuchen anzeigen).
- **S-028** [P2] Sync-Konflikt bei gelöschten Profilen behandeln (was passiert, wenn ein Supabase-Profil gelöscht wird, während der Server noch `supabase_id`-verknüpfte lokale Profile hat?).
- **S-029** [P3] Batch-Größe/Payload-Limit für `/api/sync/progress` POST (aktuell unbegrenzt — bei sehr großer Bibliothek/Verlauf ggf. in Chunks aufteilen).
- **S-030** [P2] Sicherstellen, dass `pending_progress`-Tabelle nicht unbegrenzt wächst, wenn TMDb-IDs nie aufgelöst werden können (z. B. Medien, die auf einem Gerät existieren, auf dem anderen aber nicht in der Bibliothek sind) — Aufräum-Routine/TTL ergänzen.
- **S-031** [P2] Beim Erststart der TV-/Mobile-App: automatischer Verbindungstest + klare Fehlermeldung, wenn Sync grundsätzlich nicht erreichbar ist (nicht nur stiller Fehlschlag).
- **S-032** [P3] Health-Endpoint erweitern (`/api/ping`) um `supabase_configured`, `last_sync_at`, damit externe Monitoring-Tools (z. B. ein künftiges TV-Dashboard) den Sync-Status sehen können.
- **S-033** [P1] Nach Umsetzung von S-001–S-007: kompletter Regressionstest aller drei Sync-Pfade (A, B, C) einzeln UND in Kombination (z. B. Supabase UND lokaler Server-Sync gleichzeitig aktiv — dürfen sich nicht gegenseitig überschreiben).
- **S-034** [P2] Changelog-Eintrag + Versionsbump (`package.json`, `server/src/index.js` `VERSION`) nach Abschluss.
- **S-035** [P2] `README.md`/`server/README-ZimaOS.md` Abschnitt „Synchronisierung" aktualisieren, sobald das neue Formular existiert (Screenshots/Anleitung für Service-Role-Key).

---

## 5. Sync-Architektur — Konsolidierung (`ARCH-01` … `ARCH-18`)

- **ARCH-01** [P1] Zielbild festlegen (siehe Frage 3): Docker-Server bleibt lokale „Source of Truth", Supabase wird optionales Cloud-Relay **zwischen Servern/Standorten**, nicht zwischen jedem Einzelgerät und Supabase direkt. Mobile- und TV-App sprechen **ausschließlich mit dem Docker-Server** (wie aktuell die Web-Oberfläche), nicht mit Supabase.
- **ARCH-02** [P1] Falls ARCH-01 umgesetzt wird: Pfad (A) `src/lib/supabase.ts`s `syncProgress` wird nur noch auf dem Desktop gebraucht, wenn KEIN eigener Docker-Server existiert (reiner Supabase-Modus für Nutzer ohne NAS). Klar dokumentieren, wann welcher Pfad greift.
- **ARCH-03** [P2] Eine gemeinsame TypeScript/JS-Bibliothek für „Sync-Client-Logik" extrahieren (Push/Pull/Cursor/LWW-Vergleich ist in `serverSync.ts`, `supabase.ts` und `server/src/supabase.js` dreimal ähnlich implementiert) — Duplizierung reduzieren, Bugs wie S-011 nur an einer Stelle möglich machen.
- **ARCH-04** [P2] Einheitliches Datenformat für Progress-Sync über alle Pfade (aktuell: mal `positionSec`/`durationSec`, mal `position`/`duration`, mal `position_sec`/`duration_sec` — technisch okay, aber fehleranfällig beim Erweitern).
- **ARCH-05** [P2] Zentrale Konstante/Doku für den `ON_CONFLICT`-Schlüssel (`profile_id,media_type,tmdb_id,season,episode`) — an drei Stellen dupliziert, bei Schema-Änderung leicht inkonsistent zu machen.
- **ARCH-06** [P1] Entscheidung dokumentieren + Architekturdiagramm erstellen (Mermaid o. ä.) das zeigt: Desktop, Docker-Server, Mobile, TV, Supabase und welche Pfeile (Pfade) zwischen ihnen erlaubt sind.
- **ARCH-07** [P2] Favoriten/„Meine Liste" (`/api/favorites`) ist aktuell NUR server-lokal, wird nicht über Supabase gesynct — falls gewünscht (siehe Frage 3), Sync dafür ergänzen (analog zu Progress).
- **ARCH-08** [P3] Zuordnungen/Erkennungs-Overrides (manuelle TMDb-Zuordnungen) geräteübergreifend synchronisieren — aktuell unklar, ob das schon passiert; recherchieren und ggf. ergänzen.
- **ARCH-09** [P2] Konsistente Fehlerbehandlung: alle drei Sync-Pfade sollen bei Fehlern denselben Toast-/Log-Mechanismus nutzen.
- **ARCH-10** [P2] Sync-Status als globaler Store-State (`useStore`) verfügbar machen, damit jede Seite (nicht nur Settings) z. B. ein kleines Sync-Icon in der Kopfzeile zeigen kann.
- **ARCH-11** [P3] Offline-Queue: Wenn kein Server erreichbar ist, Fortschrittsänderungen lokal puffern und bei Wiederverbindung nachsenden (auf Mobile/TV besonders relevant, da Netzwerk instabiler ist als am Desktop).
- **ARCH-12** [P2] Für TV/Mobile: definieren, ob sie IMMER gegen den Docker-Server sprechen (kein „lokaler Modus" wie die Desktop-App mit eigener SQLite) — vermutlich ja, das vereinfacht vieles.
- **ARCH-13** [P2] Versionsverträglichkeit prüfen: Mobile/TV-App gegen ältere Server-Versionen (API-Versionierung/Feature-Detection über `/api/ping` → `version`).
- **ARCH-14** [P3] Migrations-Skript für Nutzer, die aktuell schon (kaputten) Supabase-Sync konfiguriert haben, damit ihre Einstellungen beim Update sauber übernommen werden.
- **ARCH-15** [P2] Entscheiden, ob Profile künftig geräteübergreifend über eine stabile ID (nicht Name-Matching wie aktuell in `serverProfileId()`) verknüpft werden — Namensabgleich ist fehleranfällig bei Tippfehlern/Umlauten.
- **ARCH-16** [P2] Stabile Server-Installations-ID einführen (random UUID bei erstem Start, in Settings gespeichert) — nötig für S-017 und ARCH-06.
- **ARCH-17** [P3] Prüfen, ob ein WebSocket/SSE-Kanal für „Sync-Push" (statt Polling alle 30/60s) sinnvoll ist, sobald TV/Mobile dazukommen (weniger Akkuverbrauch auf Mobile, schnellere Aktualisierung).
- **ARCH-18** [P1] Nach Konsolidierung: alle Punkte aus Abschnitt 4 (S-001 bis S-035) erneut gegen die NEUE Architektur validieren, falls sich das Zielbild geändert hat.

---

## 6. Audio/Video-Sync — Fixes (`AV-01` … `AV-30`)

### Server-Transcoding (`server/src/stream.js`)

- **AV-01** [P1] Root Cause beheben: Bei `copyVideo`-Pfad (`-c:v copy`) mit `start > 0` NICHT blind auf `-ss` vor `-i` verlassen. Optionen: (a) bei Seek/Resume grundsätzlich kurz neu-encodieren statt kopieren (Qualitätsverlust minimal für die ersten Sekunden, dafür sauberer Sync), oder (b) den tatsächlich getroffenen Keyframe-Zeitpunkt ermitteln (z. B. via `ffprobe -read_intervals`) und dem Client zurückmelden, damit `offsetRef` korrekt gesetzt wird.
- **AV-02** [P1] Empfehlung für (a): `-ss` weiterhin vor `-i` für Performance (schnelles Seeking), aber zusätzlich `-c:v libx264 -preset veryfast` statt `copy` erzwingen, wenn `start > 5` Sekunden UND die Quelle nicht bereits exakt am Keyframe beginnt — CPU-Kosten gegen Korrektheit abwägen, ggf. konfigurierbar machen.
- **AV-03** [P1] Alternative/Ergänzung: Genauen Video-Startzeitpunkt an den Client zurückgeben (`/api/transcode/...` Response-Header oder erstes Manifest-Datenpaket mit `actualStart`), Client passt `offsetRef`/Fortschrittsanzeige entsprechend an, statt blind `start` anzunehmen.
- **AV-04** [P1] Testmatrix aufbauen: mehrere Testdateien mit unterschiedlicher GOP-Länge (kurze Keyframe-Intervalle vs. lange, z. B. manche Kamera-Rohschnitte mit nur 1 Keyframe pro 10s) durchspielen, jeweils an 5 verschiedenen Zeitpunkten seeken, A/V-Versatz messen (z. B. per Klatschen-Testclip mit sichtbarem Blitz + Ton gleichzeitig).
- **AV-05** [P2] `-avoid_negative_ts make_zero` und `-fflags +genpts` Zusammenspiel mit variabler Framerate (VFR)-Quellen prüfen — `genpts` kann bei VFR-Inhalten (z. B. manche Handy-Aufnahmen, Anime mit gemischter Framerate) selbst ungenaue PTS erzeugen. Ggf. `-vsync cfr` mit fester Ziel-Framerate erzwingen für den Transcode-Pfad.
- **AV-06** [P2] `aresample=async=1:min_hard_comp=0.100:first_pts=0` Parameter dokumentieren/tunen — `min_hard_comp` ggf. testweise senken/erhöhen und A/B-Vergleich der resultierenden Drift-Werte über eine 90-Minuten-Testdatei.
- **AV-07** [P2] Logging ergänzen: ffmpeg-`stderr` wird aktuell komplett verworfen (`ff.stderr.on("data", () => {})`, stream.js Zeile 132) — zumindest bei Fehlern/Warnungen (`Non-monotonous DTS`, `Application provided invalid pts` etc.) mitloggen, das sind direkte Hinweise auf A/V-Sync-Probleme.
- **AV-08** [P2] Sync-Diagnose-Modus: optionaler Debug-Endpunkt, der ffmpeg mit `-vf "drawtext=text='%{pts}'"` + Audio-Pegel-Overlay rendert, um Sync-Probleme visuell zu verifizieren (Entwickler-Tool, nicht für Endnutzer).
- **AV-09** [P3] Prüfen, ob `-async 1`-artige alte Optionen irgendwo (Doku/Altlasten) noch empfohlen werden und durch die modernen `aresample`-Filter ersetzt werden sollten.
- **AV-10** [P2] Hardware-beschleunigtes Transcoding (`-hwaccel`) als Option für schwache NAS-Boards evaluieren — Nebeneffekt prüfen, ob HW-Encoding eigene Sync-Eigenheiten hat.
- **AV-11** [P1] Denselben Seek-Bug (AV-01) auch im **Direct-Play-Pfad mit Audiospur-Wechsel** prüfen (`audioIndex`-Parameter) — Spurwechsel während Wiedergabe triggert vermutlich denselben Transcode-Neustart mit denselben Keyframe-Problemen.
- **AV-12** [P2] Nach Fix: gleiche Prüfung für alle Clients (Web-Player, Mobile-App `expo-video`, künftige TV-App) — sicherstellen, dass alle den ggf. neuen `actualStart`-Rückgabewert (AV-03) korrekt verarbeiten.

### Desktop mpv (`src/pages/Player.tsx`, `src-tauri`)

- **AV-13** [P1] `buildMpvArgs()`: explizit `--video-sync=audio` setzen (nicht auf mpv-Default verlassen), außer wenn `playback_smoothing` aktiv ist (dann bewusst `display-resample`, wie aktuell schon für den Smoothing-Modus).
- **AV-14** [P2] `--no-config` bzw. `--config-dir=<app-eigener-ordner>` ergänzen, damit externe/system-weite `mpv.conf`-Dateien die App-Argumente nicht überschreiben können. Falls Nutzer eigene mpv-Configs bewusst nutzen wollen, als Opt-in-Einstellung anbieten.
- **AV-15** [P2] Diagnose-Feature: „Wiedergabe-Info" im Player (bereits vorhandene Tastenkürzel-Liste erwähnt kein Sync-Debug) um `avsync`-mpv-Property erweitern (mpv exponiert `avsync` als Property — direkt im UI anzeigbar für Support-Zwecke, z. B. über ein Debug-Overlay das per Tastenkombination aufklappt).
- **AV-16** [P2] `hwdec=auto-copy` als saferen Default statt `hwdec=auto` evaluieren (kopiert Frames zurück in Systemspeicher, oft weniger Kompatibilitätsprobleme, minimal mehr CPU) — A/B-Test auf Referenzhardware.
- **AV-17** [P3] Automatische Diagnose bei Nutzerbeschwerde: Button „Wiedergabeproblem melden" der die letzten mpv-Log-Zeilen (inkl. `avsync`-Werte über Zeit) exportiert.
- **AV-18** [P2] Prüfen, ob `--demuxer-readahead-secs=20` (großzügiges Puffern) in Kombination mit langsamen Netzlaufwerken/NAS-Mounts zu Nachlade-Rucklern führt, die sich wie Sync-Aussetzer anfühlen — ggf. adaptiv je nach Quelle (lokal vs. Netzwerkpfad) konfigurieren.
- **AV-19** [P3] Frame-Drop-Zähler von mpv (`drop-frame-count`, `decoder-frame-drop-count` Properties) im Player mitloggen, um zu unterscheiden „echtes A/V-Sync-Problem" vs. „nur Ruckler durch Frame-Drops".

### Mobile (`mobile/App.js`, `expo-video`)

- **AV-20** [P1] Denselben Seek-Offset-Bug (AV-01/AV-03) betrifft `PlayerScreen` in `mobile/App.js` direkt (`srcFor()`, `seekBy()`, Zeile 626-634) — nach Server-Fix client-seitig `offsetRef` korrekt aus der (neuen) Server-Antwort übernehmen statt den angeforderten Wert blind zu übernehmen.
- **AV-21** [P2] `expo-video`s `timeUpdateEventInterval = 5` (Zeile 573) — ggf. verkürzen für genaueres Progress-Tracking, gegen Akku-/Performance-Kosten abwägen.
- **AV-22** [P2] Fallback-Logik „Direct→Transcode bei Fehler" (Zeile 613-624) testen: Wenn dieser Fallback mitten in der Wiedergabe greift, sicherstellen, dass kein doppelter Sync-Offset-Fehler entsteht (Kombination aus AV-01 und dem Fallback-Sprung).
- **AV-23** [P3] Untertitel-Sync (falls Untertitel im Mobile-Player künftig unterstützt werden, siehe `MOB-XXX`) von Anfang an gegen denselben Offset-Bug testen.

### Allgemein / Cross-Cutting

- **AV-24** [P1] Definition of Done: Referenz-Testclip mit eingebranntem Timecode + Audio-Klick jede Sekunde erstellen (bzw. ein bekanntes Test-Video wie ein A/V-Sync-Test-Pattern verwenden), auf allen 4 Plattformen (Desktop/mpv, Server-Web/Transcode, Mobile, künftig TV) an 5 Zeitpunkten seeken und Versatz in ms dokumentieren — Ziel: < 1 Frame (< 40ms) Versatz nach jedem Seek.
- **AV-25** [P2] Automatisierten Test dafür bauen, der regelmäßig (CI oder manuell vor Releases) läuft, damit der Bug nicht wiederkommt.
- **AV-26** [P2] Nutzer-Feedback-Mechanismus: kleiner „Sync-Problem melden"-Button im Player, der Timestamp + Datei + Wiedergabemodus (direct/transcode) loggt, um künftige Edge Cases zu sammeln.
- **AV-27** [P3] Community-/Nutzer-Doku: kurzer Absatz in README, was „Direct Play" vs. „Transcode" bedeutet und warum Transcode gelegentlich kurze Sync-Sprünge haben kann (Transparenz, auch wenn AV-01 den Hauptfall behebt).
- **AV-28** [P2] Prüfen, ob Untertitel-Timing (separates Thema, aber verwandt) vom selben Seek-Bug betroffen ist (externe SRT-Dateien werden über mpv geladen, `--sub-auto=fuzzy` — bei Server-Transcode-Pfad werden Untertitel vermutlich separat/clientseitig gehandhabt, verifizieren).
- **AV-29** [P3] Lippensynchron-Versatz durch Audiospur-Verzögerung in Quelldateien selbst (manche MKV-Dateien haben absichtlichen Audio-Delay im Container) — prüfen, ob `ffprobe`-Auswertung (`stream.js`) diesen `start_time`-Offset pro Stream berücksichtigt, nicht nur den globalen Format-`duration`.
- **AV-30** [P1] Nach allen Fixes: Regressionstest mit den ursprünglich vom Nutzer gemeldeten Dateien/Szenarien (falls robert konkrete Beispieldateien nennen kann — siehe Rückfrage, die im neuen Chat gestellt werden sollte: „Bei welchen Dateien/Situationen genau tritt es auf — nach Seek? Von Anfang an? Nur bei bestimmten Formaten?").

---

## 7. Mobile App (Expo Go) — Verbesserungen (`MOB-001` … `MOB-045`)

Basis: `mobile/App.js` existiert bereits vollständig funktionsfähig (Verbindung, Profile, Bibliothek, Player) — hier geht es um Härtung, fehlende Funktionen ggü. Desktop/Web, und TV-Vorbereitung (gemeinsamer Code mit Android-TV-App, siehe Abschnitt 8).

- **MOB-001** [P1] Nach AV-Fixes: A/V-Sync auf Mobile erneut verifizieren (siehe AV-20).
- **MOB-002** [P1] Nach S-Fixes: Sync-Verhalten (Server = Quelle) erneut end-to-end testen.
- **MOB-003** [P2] Download/Offline-Wiedergabe (aktuell nicht vorhanden) — zumindest evaluieren, ob das gewünscht ist (großer Aufwand, ggf. explizit aus Scope nehmen und dokumentieren warum).
- **MOB-004** [P2] Chromecast/AirPlay-Support aus der Mobile-App heraus (an den Fernseher casten, ohne eigene TV-App) als Zwischenlösung, falls TV-App-Entwicklung länger dauert.
- **MOB-005** [P2] Hintergrund-Wiedergabe (Audio weiterspielen, wenn App minimiert wird) — für reine Hörspiele/Musik-Inhalte falls relevant, sonst explizit als „kein Ziel" dokumentieren.
- **MOB-006** [P2] Push-Benachrichtigungen für neue Inhalte (z. B. „Neue Folge von X verfügbar") — benötigt Expo Notifications + Server-seitigen Trigger bei Scan-Abschluss.
- **MOB-007** [P3] Biometrische Entsperrung (Face ID/Fingerabdruck) als Zusatzschutz vor dem Server-Passwort, falls Kindersicherung gewünscht.
- **MOB-008** [P2] Bessere Fehlermeldungen bei Verbindungsfehlern (aktuell generischer „Suche Server…"-Zustand, siehe `App.js` Zeile 140-148) — konkrete Meldung, WARUM keine Verbindung zustande kommt (Timeout vs. falsches Passwort vs. DNS-Fehler).
- **MOB-009** [P2] Netzwerkwechsel-Erkennung (WLAN → Mobilfunk) triggert automatischen Reconnect/Re-Resolve der besten Server-Adresse, nicht erst beim nächsten manuellen Öffnen.
- **MOB-010** [P2] Player-UI: Lautstärkeregler, Helligkeitsregler per vertikalem Wisch (wie native Video-Apps) ergänzen — aktuell nur Play/Pause/Seek/Next.
- **MOB-011** [P2] Untertitel-Unterstützung im Mobile-Player (aktuell nicht ersichtlich in `PlayerScreen`) — `expo-video` unterstützt Text-Tracks, ergänzen + Sprachwahl.
- **MOB-012** [P2] Mehrere Audiospuren wählbar machen (Server liefert bereits `audioStreams` in `/api/play/...`, aber `mobile/App.js` nutzt das aktuell nicht sichtbar in der UI — Spurwahl-Button ergänzen).
- **MOB-013** [P2] Bild-im-Bild (PiP) für Mobile, analog zum Desktop-Feature — `expo-video` unterstützt PiP, aktivieren.
- **MOB-014** [P2] Intro-Skip-Funktion (Desktop-Feature „Intro überspringen") auf Mobile nachbauen — Server liefert vermutlich schon Kapitel-/Intro-Marker-Daten, prüfen und Button ergänzen.
- **MOB-015** [P2] „Nächste Folge in 10s"-Autoplay-Prompt mit Abbrechen-Option (aktuell direkter `playNext()`-Button ohne Auto-Advance).
- **MOB-016** [P2] Suchverbesserung: aktuelle Suche filtert nur den bereits geladenen Titel-Cache clientseitig (`filt()`-Funktion, Zeile 319) — bei sehr großen Bibliotheken (1000+ Titel) serverseitige Suche/Pagination erwägen.
- **MOB-017** [P3] Genre-/Kategorie-Reihen wie in der Desktop-App („Neu hinzugefügt", „Top bewertet") auf Mobile-Startseite ergänzen (Server-API `/api/library` müsste das liefern oder Client filtert selbst).
- **MOB-018** [P2] QR-Code-Verbindungsaufbau: Server zeigt in der Weboberfläche einen QR-Code mit Adresse+Token, Mobile-App scannt ihn statt Adresse per Hand einzutippen (nutzt `expo-camera` oder `expo-barcode-scanner`).
- **MOB-019** [P2] Passwort-Login-UX verbessern: aktuell wird bei jedem `save()` in `ConnectScreen` versucht neu einzuloggen, auch wenn kein Passwort geändert wurde — Logik in `save()` (Zeile 189-206) prüfen/vereinfachen.
- **MOB-020** [P1] `app.json`: `version`/`android.versionCode`/`ios.buildNumber` Felder ergänzen (aktuell nur `version: "1.0.0"`, kein `android`-`versionCode` — für Store-/OTA-Updates nötig, siehe `MOB-030`).
- **MOB-021** [P2] App-Icon + Splash-Screen als echte Bilddateien ergänzen (`app.json` hat aktuell nur Hintergrundfarben, kein `icon`/`splash.image` — für einen seriösen Store-Eintrag/Sideload-Eindruck nötig).
- **MOB-022** [P2] Adaptive Icon für Android (`android.adaptiveIcon`) ergänzen.
- **MOB-023** [P1] EAS Build (Expo Application Services) einrichten, um eine installierbare `.apk`/`.aab` (Android) bzw. `.ipa` (iOS, falls gewünscht) zu erzeugen — für den Sideload-Weg auf Fire TV/Android TV ebenfalls Basis (siehe `TV-004`).
- **MOB-024** [P2] Crash-Reporting/Error-Boundary ergänzen (aktuell keine ersichtlich) — z. B. Sentry-Expo-Plugin oder minimal ein globaler Error-Boundary mit Neustart-Button.
- **MOB-025** [P2] Automatischer Update-Check (Expo OTA Updates via `expo-updates`), damit Bugfixes nicht immer einen neuen QR-Scan/Sideload brauchen.
- **MOB-026** [P3] Dark/Light-Mode-Umschalter (aktuell hart auf `userInterfaceStyle: "dark"` in `app.json` — okay als bewusste Design-Entscheidung passend zum Netflix-Look, aber als Option dokumentieren/entscheiden).
- **MOB-027** [P2] Barrierefreiheit: `accessibilityLabel`s auf allen `Pressable`-Elementen ergänzen (aktuell keine ersichtlich) — Screenreader-Unterstützung.
- **MOB-028** [P3] Tablet-Layout (größere Poster-Reihen, ggf. 2-spaltiges Layout) für iPad/Android-Tablets — aktuell offenbar fixe Breiten (`width: 105` etc.) ohne Responsive-Anpassung.
- **MOB-029** [P2] Landscape-Modus für den Player erzwingen/optimieren (aktuell `orientation: "default"` in `app.json` — Player sollte bei Wiedergabe automatisch ins Querformat wechseln).
- **MOB-030** [P2] Versionierungs-/Release-Prozess dokumentieren (wie baut man eine neue `.apk`, wie verteilt man sie an Familie/Freunde ohne Play Store).
- **MOB-031** [P3] Google Play Store Store-Eintrag vorbereiten (Screenshots, Beschreibung, Datenschutzerklärung) — nur falls Frage 2 in Abschnitt 3 mit „ja" beantwortet wird.
- **MOB-032** [P3] Apple TestFlight/App Store Vorbereitung — nur falls iOS-Vertrieb gewünscht ist (aktuell `expo-video`/`ios.supportsTablet` vorhanden, aber kein expliziter Fokus erkennbar).
- **MOB-033** [P2] Netzwerk-Sicherheit: `NSAllowsArbitraryLoads: true` (iOS) und `usesCleartextTraffic: true` (Android) sind aktuell komplett offen (jedes `http://`, nicht nur die eigene Server-Domain) — auf die tatsächlich benötigten Domains/IP-Ranges eingrenzen wo möglich, oder zumindest bewusst dokumentieren warum es offen sein muss (LAN-IPs sind nicht vorhersagbar, daher vermutlich nötig — aber Kommentar im Code ergänzen).
- **MOB-034** [P2] Eingabevalidierung der Server-Adresse (aktuell wird jede Eingabe direkt als URL genutzt) — Autokorrektur für fehlendes `http://`-Präfix ergänzen (UX-Verbesserung, Nutzer vergessen das oft).
- **MOB-035** [P3] Mehrsprachigkeit vorbereiten (aktuell komplett Deutsch hartkodiert wie die Desktop-App — falls internationale Nutzung geplant ist, `i18n`-Grundgerüst einziehen; sonst explizit aus Scope nehmen).
- **MOB-036** [P2] Testabdeckung: zumindest ein paar Komponenten-/Integrationstests mit React Native Testing Library für die kritischen Screens (ConnectScreen, PlayerScreen).
- **MOB-037** [P2] Performance: `FlatList`-Konfiguration (`initialNumToRender`, `windowSize`) für sehr große Bibliotheken tunen, damit das Scrollen auf schwächeren Handys/Fire-TV-Sticks flüssig bleibt.
- **MOB-038** [P2] Bilder-Caching (aktuell `Image` von React Native ohne explizites Caching-Setup) — `expo-image` statt `Image` verwenden für besseres Disk-Caching der Poster/Backdrops.
- **MOB-039** [P2] Fehlerresilienz bei Server-Neustart während Wiedergabe (z. B. Docker-Container-Update mitten in einer Serie) — automatischer Reconnect-Versuch statt dauerhaftem Fehlerzustand.
- **MOB-040** [P3] „Für später merken"/Download-Queue-Konzept analog zur Desktop-„Warteschlange"-Funktion auf Mobile nachbauen.
- **MOB-041** [P2] Favoriten/„Meine Liste" auf Mobile ergänzen (Server-API `/api/favorites` existiert bereits, wird von `mobile/App.js` aktuell nicht genutzt).
- **MOB-042** [P2] „Als gesehen markieren"/„Gesehen-Status umschalten" manuell in der Mobile-UI ergänzen (Server-API `/api/watched` existiert, wird aktuell nicht von der Mobile-App aufgerufen).
- **MOB-043** [P1] Code-Review/Syntax-Check von `mobile/App.js` mit tatsächlich installierten Dependencies (`npm install && npx expo-doctor` bzw. `npx tsc --noEmit` falls TypeScript ergänzt wird) — im vorherigen Chat nur manuell gegen den Server-Code abgeglichen, kein echter Expo-Start durchgeführt (keine Internetverbindung im Analyse-Sandbox verfügbar).
- **MOB-044** [P2] TypeScript-Migration von `App.js` erwägen (aktuell reines JS, Rest des Projekts ist TS) — Konsistenz + Fehlerprävention, mittlerer Aufwand da Datei ca. 720 Zeilen.
- **MOB-045** [P2] Gemeinsame Code-Basis mit der neuen TV-App geometrisch planen (siehe `TV-002`) BEVOR viele der obigen Punkte umgesetzt werden, damit nicht doppelte Arbeit entsteht.

---

## 8. TV-App(s) — Neuentwicklung (`TV-001` … `TV-055`)

Kontext: Aktuell existiert **keine** TV-optimierte Oberfläche. Docker-Server liefert eine Browser-Weboberfläche, die auf jedem Smart-TV-Browser technisch läuft, aber nicht für Fernbedienungs-Navigation ausgelegt ist (keine Fokus-Ringe, kein D-Pad-Handling).

### 8.1 Grundsatzentscheidungen

- **TV-001** [P1] Plattform-Priorität final festlegen (siehe Frage 1, Abschnitt 3).
- **TV-002** [P1] Technologie-Entscheidung: React Native (`react-native-tvos` bzw. Expo TV-Support ab SDK 52+) für Android TV/Fire TV, damit **ein Großteil der Komponenten aus `mobile/App.js` wiederverwendet werden kann** (empfohlen — spart massiv Aufwand ggü. komplett neuem Code).
- **TV-003** [P2] Für webOS/Tizen (falls gewünscht, siehe Frage 1): separate Entscheidung — vermutlich eigenes leichtgewichtiges Web-Bundle basierend auf dem bestehenden React-Web-Build (`server/webapp`) mit TV-Fokus-Layer obendrauf (kein Nativ-Code nötig, da beide Plattformen im Kern Web-Views sind).
- **TV-004** [P1] Sideload-Weg definieren: Android-TV-`.apk` via `adb install` (USB oder Netzwerk-ADB) — Kurzanleitung erstellen.

### 8.2 Gemeinsames TV-UI-Grundgerüst (Android TV/Fire TV, ggf. auch als Basis für webOS/Tizen-Variante)

- **TV-005** [P1] Neues Verzeichnis `tv/` (analog zu `mobile/`) mit eigenem `package.json`/`app.json` auf Basis der Expo-TV-Vorlage anlegen.
- **TV-006** [P1] Fernbedienungs-/D-Pad-Navigation: fokussierbare Komponenten mit sichtbarem Fokus-Rahmen für JEDE interaktive Kachel (Poster, Buttons, Menüpunkte) — `react-native-tvos`s `TVFocusGuideView`/`hasTVPreferredFocus` konsequent einsetzen.
- **TV-007** [P1] Grid-Navigation für Poster-Reihen (horizontal mit Pfeiltasten scrollen, vertikal zwischen Reihen wechseln) — braucht eigene Fokus-Verwaltung, nicht 1:1 aus der Touch-UI der Mobile-App übernehmbar.
- **TV-008** [P1] Großzügigere Schriftgrößen/Kachelgrößen für 3-4m Sitzabstand („10-Foot-UI"-Designrichtlinien: Mindestschriftgröße, Safe-Area-Ränder ca. 5% vom Bildschirmrand einhalten wegen TV-Overscan).
- **TV-009** [P1] Safe-Area/Overscan-Handling (ältere TVs/manche Plattformen schneiden Bildränder ab) — Padding-Konstanten zentral definieren.
- **TV-010** [P1] Player-Steuerung per Fernbedienung: Play/Pause (Media-Keys), Zurück/Vor-Spulen (Links/Rechts gedrückt halten), Zurück-Taste = zur Übersicht (analog zu `BackHandler` bereits in `mobile/App.js` vorhanden, für TV-Remote-Keys erweitern).
- **TV-011** [P1] Lange-Tastendruck-Erkennung für schnelles Spulen (typisches TV-UX-Pattern, fehlt in der aktuellen Mobile-Player-Logik komplett).
- **TV-012** [P2] Sprachsteuerung/Google-Assistant-Integration für Android TV evaluieren (z. B. „Spiele [Serie]" — optional, hoher Aufwand, ggf. P3).
- **TV-013** [P1] Server-Verbindungsaufbau für TV: Da TV-Fernbedienungen schlecht zum Text-Tippen sind, QR-Code-Verbindung (siehe `MOB-018`) hier BESONDERS wichtig — TV zeigt QR-Code, Nutzer scannt mit Handy, das schickt die Zugangsdaten ans TV (z. B. via kurzlebigen Pairing-Code über den Server, analog zu YouTube-TV/Netflix-Pairing-Flows).
- **TV-014** [P1] Alternative/Fallback: On-Screen-Keyboard-Navigation per D-Pad für die manuelle Adresseingabe (für Nutzer ohne Zweitgerät griffbereit).
- **TV-015** [P1] Profile-Auswahlbildschirm TV-optimiert (große Kacheln, D-Pad-navigierbar, analog Netflix-Profilauswahl).
- **TV-016** [P1] Startseite mit Reihen (Weiterschauen, Serien, Filme, ggf. Genre-Reihen wie Desktop) TV-optimiert nachbauen.
- **TV-017** [P1] Serien-/Film-Detailseite TV-optimiert (großes Backdrop, Beschreibung, Staffel-Tabs per D-Pad).
- **TV-018** [P1] Player-UI TV-optimiert: großer Fortschrittsbalken, sichtbare Steuerungsleiste bei Tastendruck, automatisches Ausblenden nach Inaktivität (wie Desktop-mpv-Overlay).
- **TV-019** [P2] „Nächste Folge"-Autoplay mit Abbrechen-Möglichkeit per Fernbedienung (analog `MOB-015`).
- **TV-020** [P2] Intro-Skip-Button TV-optimiert (großer, klar fokussierbarer Button oben rechts während der Intro-Phase).
- **TV-021** [P2] Suche: TV-optimierte Texteingabe ist mühsam — alternative Eingabemethoden erwägen (Sprach-Suche via Mikrofon-Taste auf manchen Fernbedienungen, oder zumindest großes On-Screen-Keyboard mit Vorschlägen).
- **TV-022** [P2] Wiedergabe-Qualität/Transcoding-Einstellung TV-spezifisch: Standardmäßig höhere Qualität anfordern (großer Bildschirm), siehe Frage 5.
- **TV-023** [P2] Netzwerk-Bandbreitentest beim ersten Start (TVs hängen oft an WLAN mit schlechterer Anbindung als der PC) — bei Bedarf automatisch niedrigere Transcode-Qualität vorschlagen.
- **TV-024** [P2] Fehlerbildschirme TV-optimiert (großer Text, klare Handlungsempfehlung, kein winziger Toast wie auf Mobile).
- **TV-025** [P2] Einstellungen-Bildschirm TV-optimiert (Server-Adresse, Passwort, Bildqualität, ggf. Untertitel-Standardsprache).
- **TV-026** [P3] Mehrbenutzer-Fernbedienungs-Handling (falls mehrere Personen im Raum verschiedene Profile schnell wechseln wollen).
- **TV-027** [P2] Speicherverbrauch/Performance auf schwacher TV-Hardware (Fire TV Stick Lite hat wenig RAM) — Bundle-Größe, Bilder-Auflösung pro Kachel (kleinere `w185`/`w300`-TMDb-Bildgrößen für TV-Kacheln nutzen, nicht die gleichen wie Desktop).
- **TV-028** [P2] App-Start-Zeit optimieren (TV-Apps werden oft komplett beendet zwischen Nutzungen, schneller Kaltstart ist wichtiger als bei Mobile).
- **TV-029** [P3] Bildschirmschoner-/Leerlauf-Verhalten (App soll nach X Minuten Inaktivität auf der Startseite den TV nicht dauerhaft wachhalten außer bei aktiver Wiedergabe — `expo-keep-awake` NUR während Wiedergabe wie in Mobile bereits korrekt gemacht, sicherstellen, dass TV-Variante das genauso macht).

### 8.3 Android TV / Fire TV spezifisch

- **TV-030** [P1] `app.json`/`app.config.js` mit `expo-build-properties`-TV-Flags (`isTv: true`) korrekt konfigurieren.
- **TV-031** [P1] Android-TV-Manifest-Anforderungen: `android.software.leanback`-Feature, Banner-Icon (320×180) für den Android-TV-Launcher.
- **TV-032** [P1] Fire-TV-Kompatibilität testen (Amazon Fire OS ist ein Android-Fork mit eigenen Eigenheiten, z. B. andere Remote-Key-Codes für manche Tasten) — auf echter Fire-TV-Stick-Hardware testen, nicht nur Emulator.
- **TV-033** [P2] EAS Build für TV-Zielarchitektur konfigurieren (separates Build-Profil `tv` in `eas.json`).
- **TV-034** [P2] Google Play Store „Android TV"-Kategorie-Listing vorbereiten (nur falls Store-Vertrieb gewünscht, siehe Frage 2).
- **TV-035** [P3] Amazon Appstore-Listing für Fire TV vorbereiten (separater Store von Google Play, falls gewünschter Vertriebsweg).
- **TV-036** [P2] HDMI-CEC-Kompatibilität prüfen (TV-Fernbedienung soll auch bei per HDMI-CEC gesteuerten Geräten funktionieren, meist automatisch über Standard-Android-TV-Remote-Handling gegeben, aber verifizieren).

### 8.4 webOS/Tizen (nur falls Frage 1 das einschließt)

- **TV-037** [P2] LG webOS TV SDK installieren, minimales „Hello World" deployen (Grundlagen-Setup dokumentieren).
- **TV-038** [P2] Samsung Tizen Studio installieren, minimales „Hello World" deployen.
- **TV-039** [P2] Bestehenden `server/webapp`-React-Build als Basis nehmen, TV-Fokus-Layer (siehe 8.2-Prinzipien, aber als reines Web/CSS-`:focus`-basiertes System statt React-Native) ergänzen — eigenes CSS-Modul `tv-mode.css` mit klaren `:focus-visible`-Stilen für alle Kacheln/Buttons.
- **TV-040** [P2] Tastatur-/Fernbedienungs-Codes für webOS/Tizen abbilden (`keydown`-Handler für `ArrowLeft/Right/Up/Down/Enter/Back` — beide Plattformen nutzen im Kern Standard-`KeyboardEvent`s mit teils plattformspezifischen Keycodes für „Zurück", das muss pro Plattform recherchiert/gemappt werden).
- **TV-041** [P2] `.ipk` (webOS) und `.wgt` (Tizen) Paketierung einrichten, lokale Installation über Entwicklermodus testen.
- **TV-042** [P3] LG Content Store / Samsung Seller Office Store-Listing vorbereiten (nur falls Store-Vertrieb gewünscht).
- **TV-043** [P2] Performance-Test auf echter (älterer) TV-Hardware — webOS/Tizen-Browser-Engines sind oft mehrere Jahre alt und deutlich schwächer als aktuelle Chrome-Versionen, aggressive Optimierung (weniger DOM-Nodes, keine schweren CSS-Animationen) nötig.

### 8.5 Universeller Fallback: Browser-„TV-Modus" für JEDEN Smart-TV

(Diese Variante funktioniert auf praktisch jedem Gerät mit Browser, ganz ohne App-Installation — sinnvoll als Sofort-Lösung/Fallback parallel zu den nativen Apps.)

- **TV-044** [P1] Im bestehenden `server/webapp`-React-Build einen erkennungsbasierten „TV-Modus" ergänzen: User-Agent-Erkennung (Tizen/webOS/`SMART-TV`/`GoogleTV`/`AFT`-Strings) ODER manueller Schalter in den Einstellungen, der große Kacheln + sichtbare Fokus-Ringe + D-Pad/Pfeiltasten-Navigation per `tabindex`+`:focus-visible` aktiviert.
- **TV-045** [P1] `keydown`-Listener für Pfeiltasten global ergänzen, der den Fokus zwischen Kacheln im Grid bewegt (kein natives DOM-`tabindex`-Durchtabben reicht für ein 2D-Grid — braucht eigene Links/Rechts/Hoch/Runter-Logik ähnlich TV-007).
- **TV-046** [P1] Diese Variante ist die schnellste Möglichkeit, „TV nutzbar zu machen" (kein Store, kein Sideload, funktioniert sofort auf JEDEM Gerät mit Browser) — als Phase-4a VOR den nativen Apps umsetzen, damit robert sofort etwas Nutzbares hat.
- **TV-047** [P2] Direkter Link/QR-Code auf der Server-Startseite „Für Smart-TV öffnen" der den TV-Modus direkt aktiviert.
- **TV-048** [P2] Getestete Kompatibilitätsliste pflegen (welche TV-Marken/Browser-Versionen funktionieren, bekannte Einschränkungen).

### 8.6 Cross-Cutting TV

- **TV-049** [P1] Sync mit Docker-Server (siehe Abschnitt 4-5) muss von Anfang an in der TV-App korrekt eingebunden sein — nicht erst nachträglich, sonst Wiederholung des Kernbugs aus Abschnitt 1.1 in einem vierten System.
- **TV-050** [P1] A/V-Sync-Fixes (Abschnitt 6) müssen VOR TV-Rollout validiert sein — auf großem Bildschirm fallen Sync-Fehler stärker auf als auf dem Handy.
- **TV-051** [P2] Gemeinsames Design-System (Farben `C.red`/`C.bg` etc. aus `mobile/App.js`) zwischen Mobile und TV teilen (gemeinsames Theme-Modul, kein Copy-Paste der Farbwerte).
- **TV-052** [P2] Barrierefreiheit: TV-spezifische Screenreader-Unterstützung (Android TV TalkBack) für die wichtigsten Bildschirme.
- **TV-053** [P2] Analytics/Nutzungsstatistik (rein lokal/privat, kein externes Tracking) — z. B. „meistgeschaute Geräte-Art" in den Server-Statistiken ergänzen, um künftige Priorisierung zu erleichtern.
- **TV-054** [P3] Mehrere TV-Geräte gleichzeitig im Haushalt testen (zwei Fire-TV-Sticks + Desktop + Handy gleichzeitig verbunden, alle synchron).
- **TV-055** [P1] Abschließender End-to-End-Test: Auf Desktop eine Folge bis Minute 10 schauen → auf Fire TV/Android TV fortsetzen (muss ab Minute 10 starten, Ton/Bild synchron, siehe AV-24) → auf Handy weiterschauen → alles muss konsistent sein.

---

## 9. Server/Backend — allgemeine Verbesserungen (`SRV-001` … `SRV-035`)

- **SRV-001** [P2] `server/src/index.js` ist eine einzelne ~500-Zeilen-Datei mit reinem `if/else`-Routing — bei wachsender API-Fläche (jetzt zusätzlich TV-spezifische Endpunkte) in Module aufteilen (`routes/library.js`, `routes/sync.js`, `routes/playback.js`, …) für Wartbarkeit.
- **SRV-002** [P2] Eingabevalidierung generell härten (viele Endpunkte casten `+m[1]`/`parseInt` ohne `NaN`-Prüfung — z. B. `/api/shows/(\d+)` ist per Regex zwar abgesichert, aber `profileId = parseInt(...) || 1` bei ungültigem Wert fällt still auf Profil 1 zurück statt Fehler zu melden).
- **SRV-003** [P2] Konsistente Fehlerformate über alle Endpunkte (aktuell mal `{error: "..."}`, mal impliziter 500 — ein einheitliches Error-Response-Schema einführen, hilft v. a. der neuen TV-/Mobile-App beim Fehler-Handling).
- **SRV-004** [P2] Request-Logging (aktuell nur `console.error` bei Crashes) — strukturiertes Zugriffs-Log ergänzen (nützlich für Debugging von Sync-/Sessionsproblemen über mehrere Geräte).
- **SRV-005** [P2] Graceful Shutdown (`SIGTERM`-Handler, der laufende ffmpeg-Prozesse sauber beendet, bevor der Container stoppt — wichtig bei Docker-Updates während aktiver Wiedergabe auf TV/Mobile).
- **SRV-006** [P2] `pending_progress`/`progress`-Tabellen-Indizes prüfen (`EXPLAIN QUERY PLAN` auf den Sync-Queries) — bei großem Verlauf über Monate/mehrere Geräte könnten die Sync-Abfragen langsam werden.
- **SRV-007** [P3] Rate-Limiting pro IP/Token für `/api/login` (aktuell kein Schutz gegen Passwort-Brute-Force ersichtlich).
- **SRV-008** [P2] `authed()`-Check global konsistent für ALLE neuen TV-/Sync-Endpunkte sicherstellen (bei neuen Routen leicht vergessen, siehe `SRV-003`-Refactor als Absicherung — zentrale Middleware statt Copy-Paste-Check).
- **SRV-009** [P2] CORS aktuell `Access-Control-Allow-Origin: *` (komplett offen) — für ein System mit Passwortschutz/Token vertretbar, aber dokumentieren warum, und prüfen ob mit TV-Apps (die ggf. keine CORS-Preflights senden) überhaupt nötig ist oder eingeschränkt werden kann.
- **SRV-010** [P2] `/api/detect` (Auto-Erkennung von Bibliotheksordnern) und `/api/browse` traversieren das gesamte `/host`-Dateisystem — Zugriffskontrolle/Sandboxing nochmal explizit gegenprüfen (laut README bereits mit `isSystemDir`-Filter, aber Pfad-Traversal-Angriffe wie `../../etc` explizit testen).
- **SRV-011** [P2] Healthcheck (`/api/ping`) um Supabase-Sync-Status erweitern (siehe `S-032`).
- **SRV-012** [P2] Backup-Strategie verifizieren: README erwähnt „wöchentliches Auto-Backup" für die Desktop-App — existiert das Äquivalent für die Server-SQLite-DB (`/data`-Volume)? Falls nicht, ergänzen (bei jetzt 4 Geräten, die vom Server abhängen, ist Datenverlust kritischer).
- **SRV-013** [P2] Datenbank-Migrationen versionieren (`db.js` prüfen, ob Schema-Änderungen für neue Sync-Felder sauber migriert werden, ohne bestehende Docker-Volumes zu zerstören).
- **SRV-014** [P1] Fehler-Logging für den Supabase-Sync-Loop verbessern (aktuell `console.error("[supabase]", ...)`, Zeile 143 in `server/src/supabase.js` — nur in Docker-Logs sichtbar, nicht im UI). Für `S-005` (Statusanzeige) muss der Server Fehler auch strukturiert über `/api/settings` oder einen neuen `/api/supabase/status`-Endpunkt zurückgeben können.
- **SRV-015** [P2] Umgebungsvariablen-Dokumentation (`README-ZimaOS.md`) um alle neuen Punkte ergänzen (`SUPABASE_SERVICE_KEY`, ggf. neue TV-bezogene Variablen).
- **SRV-016** [P3] Multi-Architektur-Docker-Images sicherstellen (ARM64 für ZimaBoard/Raspberry-Pi-artige Geräte, falls nicht schon der Fall — `node:24-alpine` Basis-Image unterstützt das, verifizieren im CI-Build).
- **SRV-017** [P2] Konfigurierbare Transcode-Grenzen (max. gleichzeitige Transcodes) — bei mehreren gleichzeitig schauenden Geräten (Desktop+TV+Handy gleichzeitig aktiv) kann ein schwaches NAS überlastet werden; Warteschlange/Limit mit Nutzerfeedback ergänzen.
- **SRV-018** [P2] Automatischer Qualitäts-Downgrade bei CPU-Überlast bei laufendem Transcode (adaptive Bitrate) — evaluieren, ob das den Umfang sprengt (ggf. P3/Backlog).
- **SRV-019** [P3] Prometheus/einfaches Monitoring-Endpoint für Selbst-Hoster, die mehr Einblick wollen (optional, P3).
- **SRV-020** [P2] Node.js-Version/Dependency-Audit (`npm audit` im CI, siehe `OPS-*`).
- **SRV-021** [P2] Server-seitige Bild-Cache-Größenbegrenzung/Aufräum-Routine (analog zum Desktop-„Vorschau-Cache leeren"-Feature) — bei jetzt mehr Clients ggf. mehr angeforderte Bildgrößen im Cache.
- **SRV-022** [P2] Konsistenzprüfung zwischen `progress`- und `pending_progress`-Tabellen als Wartungs-Endpunkt (Admin-Tool, um Sync-Leichen aufzuspüren).
- **SRV-023** [P3] WebSocket/SSE-Endpoint für Live-Updates vorbereiten, falls `ARCH-17` umgesetzt wird.
- **SRV-024** [P2] API-Versionierung einführen (`/api/v1/...`), bevor TV-/Mobile-Apps in freier Wildbahn sind — verhindert Breaking Changes für ältere installierte Apps bei künftigen Server-Updates.
- **SRV-025** [P2] Timeout-Handling bei sehr großen Bibliotheken (`/api/library` liefert aktuell alles auf einmal ohne Pagination) — bei mehreren tausend Titeln ggf. Pagination/Lazy-Loading einführen, wichtig für schwächere TV-/Mobile-Hardware.
- **SRV-026** [P3] GraphQL/tRPC statt handgeschriebenem REST evaluieren — vermutlich Overkill für dieses Projekt, nur als bewusste „nicht tun"-Notiz aufnehmen.
- **SRV-027** [P2] Server-seitiges Zusammenfassen von Multi-Geräte-„Weiterschauen" (wenn 2 Geräte gleichzeitig denselben Titel schauen, welcher Stand gewinnt? Aktuell Last-Write-Wins per Timestamp — UX-Frage, ob das gewünscht ist oder eine Warnung „wird auf Gerät X gerade geschaut" sinnvoller wäre).
- **SRV-028** [P2] Downloadable-Export erweitern um Sync-Konfiguration (Server-Adressen, nicht Passwörter) für einfacheres Geräte-Setup.
- **SRV-029** [P3] IPv6-Unterstützung verifizieren (`BROWSE_ROOTS`/Netzwerkerkennung).
- **SRV-030** [P2] Dockerfile: `HEALTHCHECK` erweitern um DB-Erreichbarkeit, nicht nur HTTP-Ping (aktuell Zeile 39-40 im Dockerfile nur `/api/ping`).
- **SRV-031** [P2] Speicherverbrauch des Node-Prozesses bei langer Laufzeit (Wochen) beobachten/Leak-Tests (Sync-Loop läuft alle 60s dauerhaft — Speicherverlauf über Zeit prüfen).
- **SRV-032** [P3] Konfigurierbarer Log-Level (aktuell fix, kein `DEBUG`-Modus für tiefere Sync-Diagnose).
- **SRV-033** [P2] `server/package.json` Dependencies/Node-Version-Pin dokumentieren und in CI testen (`OPS-*`).
- **SRV-034** [P2] Sicherheits-Header ergänzen (`X-Content-Type-Options`, `X-Frame-Options` o. ä. — aktuell nicht ersichtlich in `index.js`).
- **SRV-035** [P1] Nach allen Server-Änderungen: kompletter Neuaufbau-Test des Docker-Images (`docker compose build --no-cache && docker compose up`) um sicherzustellen, dass der Mehrstufen-Build (Dockerfile) mit allen Frontend-Änderungen weiterhin funktioniert.

---

## 10. Sicherheit (`SEC-001` … `SEC-018`)

- **SEC-001** [P1] Falls noch nicht geschehen: `GHGFLIX_PASSWORD` setzen, BEVOR TV-/Mobile-Apps mit Fernzugriff (Tailscale/Domain) live gehen — mehr Geräte/Einstiegspunkte erhöhen die Dringlichkeit.
- **SEC-002** [P1] Service-Role-Key (nach `S-002`) darf NIE an Clients (Mobile/TV/Browser) ausgeliefert werden — sicherstellen, dass er ausschließlich serverseitig verwendet wird und kein Endpunkt ihn versehentlich in einer Response mitschickt (z. B. `/api/settings` GET darf `supabase_key` NICHT im Klartext zurückgeben, nur einen `configured: true/false`-Boolean, analog zum bestehenden `tmdb_key_set`-Muster).
- **SEC-003** [P2] Token-Ablauf/Rotation für `/api/login`-Tokens (aktuell offenbar unbegrenzt gültig, `tokens`-Set nur auf 50 Einträge begrenzt, kein Ablaufdatum) — Ablaufzeit ergänzen, besonders wichtig bei mehr Geräten mit gespeicherten Tokens (Handy/TV könnten gestohlen/verkauft werden).
- **SEC-004** [P2] Token-Widerruf-UI („Alle Geräte abmelden"-Button in den Einstellungen) — aktuell keine Möglichkeit ersichtlich, ein verlorenes Handy/TV-Token zu invalidieren ohne Passwort zu ändern.
- **SEC-005** [P2] HTTPS-Erzwingung/Warnung, wenn Server über eine öffentliche Domain OHNE Reverse-Proxy-HTTPS erreichbar gemacht wird (README warnt bereits „Wichtig: Passwort setzen" bei Domain-Zugriff — Warnung im Server-UI selbst ergänzen, nicht nur in der Doku).
- **SEC-006** [P2] Mobile-App: Token/Passwort werden in `AsyncStorage` unverschlüsselt gespeichert (Standard-Verhalten von `@react-native-async-storage`) — `expo-secure-store` für sensible Werte (Token, Passwort) statt `AsyncStorage` verwenden.
- **SEC-007** [P2] TV-App: gleiche Absicherung wie `SEC-006` für die TV-Variante übernehmen.
- **SEC-008** [P2] Login-Brute-Force-Schutz (siehe `SRV-007`) — nach N Fehlversuchen von derselben IP kurzzeitig sperren.
- **SEC-009** [P3] Zwei-Faktor-Option für den Server-Zugriff evaluieren (vermutlich Overkill für ein Heimnetz-Tool, P3/Backlog).
- **SEC-010** [P2] Content-Security-Policy für die Web-Oberfläche ergänzen (aktuell in Tauri `csp: null`, im Server-Kontext noch nicht geprüft — für die Browser-/TV-Variante sinnvoll gegen XSS).
- **SEC-011** [P2] Abhängigkeits-Audit (`npm audit`) für `mobile/`, `server/` und Haupt-`package.json` VOR dem TV-/Mobile-Rollout durchführen und kritische Findings beheben.
- **SEC-012** [P2] Supabase RLS-Policies (`supabase/schema.sql`) explizit gegenprüfen — sicherstellen, dass ein Nutzer NUR seine eigenen `profiles`/`watch_progress`-Zeilen per Anon-Key lesen/schreiben kann (relevant für Pfad A, direktes Desktop↔Supabase).
- **SEC-013** [P2] Prüfen, ob `import("./scanner.js")`-artige dynamische Imports (Server) irgendwo mit nutzerkontrolliertem Pfad kombiniert werden könnten (Code-Injection-Risiko, vermutlich nicht, aber explizit verifizieren).
- **SEC-014** [P3] Abhängigkeit von `Access-Control-Allow-Origin: *` (SRV-009) nochmal aus Security-Sicht bewerten, nicht nur Funktionalität.
- **SEC-015** [P2] Datenschutz-Hinweis (README/App) ergänzen: welche Daten an TMDb, ggf. Supabase gesendet werden (Transparenz, besonders relevant sobald mehr Geräte/ein App-Store-Eintrag involviert sind, die ggf. eine Datenschutzerklärung verlangen — siehe `MOB-031`).
- **SEC-016** [P2] Kindersicherung/FSK-Einstellung (laut README bereits vorhanden auf Desktop) — verifizieren, dass sie auch serverseitig durchgesetzt wird (nicht nur clientseitig versteckt, sonst umgehbar über die API direkt) und in Mobile/TV übernommen wird.
- **SEC-017** [P3] Penetrationstest-artiger Self-Check vor Rollout (grundlegende Dinge: SQL-Injection in den `db.prepare`-Statements — aktuell durchgängig parametrisiert, das ist gut, stichprobenartig verifizieren, dass das überall eingehalten wird, auch in neu hinzukommendem Code).
- **SEC-018** [P1] Nach Abschluss aller SEC-Punkte: kurze Sicherheits-Zusammenfassung für robert schreiben (was ist jetzt abgesichert, was ist bewusstes Restrisiko für ein Heimnetz-Projekt).

---

## 11. Performance & Robustheit (`PERF-001` … `PERF-020`)

- **PERF-001** [P2] Lasttest: 3-4 Geräte gleichzeitig (Desktop + TV + 2× Mobile) parallel streamen lassen, insbesondere mit Transcoding, auf der tatsächlichen Zielhardware (ZimaBoard/NAS) — Engpässe dokumentieren.
- **PERF-002** [P2] Bildgrößen pro Client-Typ optimieren (TV braucht ggf. größere Poster als Mobile, aber weniger als Desktop-Fullscreen-Backdrops — TMDb-`size`-Parameter pro Plattform sinnvoll wählen, siehe `TV-027`).
- **PERF-003** [P2] Datenbank-Vacuum/Optimize-Routine automatisieren (Desktop hat laut README einen „Datenbank optimieren"-Button — serverseitiges Äquivalent periodisch automatisch laufen lassen).
- **PERF-004** [P2] Scan-Performance bei sehr großen Bibliotheken (mehrere tausend Dateien) nochmal profilen, jetzt wo mehr Geräte während eines laufenden Scans zugreifen könnten.
- **PERF-005** [P3] CDN/Caching-Header für statische Assets (`webapp/`-Build) prüfen — aktuell wahrscheinlich kein aggressives Browser-Caching konfiguriert, für wiederkehrende TV-/Mobile-Aufrufe relevant.
- **PERF-006** [P2] Bundle-Größe der TV-App (SRV-Hardware-Constraint aus `TV-027`) messen und mit Ziel-Budget (< X MB) abgleichen.
- **PERF-007** [P2] Mobile-App-Startzeit messen (Time-to-Interactive vom Icon-Tap bis Bibliothek sichtbar) und optimieren, falls > 2-3s.
- **PERF-008** [P2] Bild-Lazy-Loading in langen Poster-Reihen (Mobile/TV) sicherstellen, damit nicht 50 Bilder gleichzeitig geladen werden.
- **PERF-009** [P3] Debouncing der Suche (Mobile aktuell filtert bei jedem Tastendruck clientseitig, unkritisch bei kleiner Bibliothek, aber bei serverseitiger Suche (`MOB-016`) relevant).
- **PERF-010** [P2] ffmpeg-Prozess-Ressourcenlimits (`--threads`, `nice`-Priorität) konfigurierbar machen, damit ein Transcode nicht den ganzen NAS lahmlegt während jemand anderes browst.
- **PERF-011** [P2] Sync-Intervalle (30s/60s) nochmal gegen Akkuverbrauch auf Mobile abwägen — ggf. auf Mobile ein längeres Intervall oder Pausierung im Hintergrund (`AppState`-API) einbauen, um Akku zu sparen.
- **PERF-012** [P3] Offline-Erkennung, um unnötige Sync-Versuche zu vermeiden (`NetInfo`-Paket für Expo ergänzen).
- **PERF-013** [P2] Datenbankgröße-Monitoring (Progress-Tabelle wächst dauerhaft, nie aufgeräumt außer bei explizitem Reset) — Alterungsstrategie überlegen (z. B. sehr alte, abgeschlossene Einträge komprimieren).
- **PERF-014** [P3] HTTP/2 oder Keep-Alive-Tuning für den Node-`http`-Server (aktuell Standard-`node:http`, kein explizites Tuning ersichtlich).
- **PERF-015** [P2] Thumbnail-Generierung (`invoke.js`/`makeThumb`) Warteschlange/Limit, damit nicht mehrere gleichzeitige Anfragen (von TV+Mobile+Desktop gleichzeitig beim Erstscan) das System überlasten.
- **PERF-016** [P2] Player-Ladezeit (Time-to-First-Frame) auf allen Plattformen messen und als Erfolgsmetrik für die Sync-/AV-Fixes mit protokollieren.
- **PERF-017** [P3] Speicherverbrauch der TV-App über lange Laufzeiten (TV-Apps laufen oft tagelang im Hintergrund) beobachten.
- **PERF-018** [P2] Netzwerk-Retry-Strategie vereinheitlichen (exponentielles Backoff statt fixer Intervalle bei wiederholten Fehlern, über alle Clients hinweg konsistent).
- **PERF-019** [P3] Preloading der nächsten Folge (Metadaten, nicht Video) beim Ende der aktuellen Folge, um den „Nächste Folge"-Übergang verzögerungsfrei zu machen.
- **PERF-020** [P1] Nach Abschluss aller Performance-Punkte: dokumentiertes Vorher/Nachher (grobe Zahlen reichen: Ladezeiten, gleichzeitige Streams, wahrgenommene Flüssigkeit) für robert zusammenfassen.

---

## 12. Testing / QA (`QA-001` … `QA-022`)

- **QA-001** [P1] Test-Plan für Abschnitt 1.1 (Supabase-Sync) als Checkliste vor „fertig" abhaken (siehe `S-013`, `S-014`, `S-033`).
- **QA-002** [P1] Test-Plan für Abschnitt 1.2 (A/V-Sync) als Checkliste (siehe `AV-04`, `AV-24`, `AV-30`).
- **QA-003** [P2] Basis-CI-Pipeline (GitHub Actions, `.github/`-Ordner existiert bereits — prüfen was aktuell drin läuft, erweitern um: `npx tsc --noEmit`, `cargo test` (Rust-Tests bereits laut README vorhanden), Server-Node-Tests, Mobile-Expo-Doctor-Check).
- **QA-004** [P2] Automatisierter Smoke-Test für den Docker-Build (`docker build` in CI, Container hochfahren, `/api/ping` abfragen).
- **QA-005** [P2] Manuelle Test-Checkliste für jede Plattform (Desktop/Web/Mobile/TV) vor jedem Release erstellen und pflegen.
- **QA-006** [P3] Visuelle Regressionstests für die neuen TV-/Mobile-Bildschirme (Screenshot-Vergleich, z. B. mit Playwright für die Web-/TV-Modus-Variante).
- **QA-007** [P2] Test mit tatsächlich fehlerhaften/exotischen Mediendateien (variable Framerate, ungewöhnliche Container, mehrere Audiospuren, beschädigte Dateien) gegen die neuen AV-Fixes.
- **QA-008** [P2] Test mit instabiler Netzwerkverbindung (Wifi-Ausfall während Wiedergabe/Sync simulieren) auf Mobile/TV.
- **QA-009** [P2] Test mit mehreren gleichzeitig aktiven Profilen auf verschiedenen Geräten (Konfliktszenarien aus `S-016`/`S-028` gezielt nachstellen).
- **QA-010** [P2] Barrierefreiheits-Check (Screenreader auf Mobile/TV testen, siehe `MOB-027`/`TV-052`).
- **QA-011** [P3] Last-/Stresstest-Skript (viele parallele API-Requests simulieren, z. B. mit `k6` oder `autocannon`) gegen den Server.
- **QA-012** [P2] Test der Migrationsschritte für Bestandsnutzer (jemand mit bereits konfiguriertem, „kaputtem" Supabase-Sync sollte nach dem Update nicht plötzlich Daten verlieren).
- **QA-013** [P2] Test des kompletten Ersteinrichtungs-Flows für einen komplett neuen Nutzer (Docker-Server neu aufsetzen → TV-App installieren → verbinden → schauen) end-to-end, um „Ist das wirklich einfach genug?" zu verifizieren.
- **QA-014** [P2] Test auf tatsächlicher Fire-TV-Stick- UND Android-TV-Box-Hardware (nicht nur Emulator) — Emulatoren verhalten sich bei Fernbedienungs-Events oft anders als echte Geräte.
- **QA-015** [P3] Test auf mind. 2 unterschiedlichen echten Smart-TV-Marken für den Browser-„TV-Modus" (`TV-044`).
- **QA-016** [P2] Regressionstest ALLER bestehenden Desktop-Features nach den Sync-/Architektur-Änderungen (nichts an der bestehenden, funktionierenden Desktop-Erfahrung kaputt machen).
- **QA-017** [P2] Test der Passwortschutz-Szenarien (mit/ohne Passwort, falsches Passwort, abgelaufener Token) über alle Clients.
- **QA-018** [P3] Test des Exports/Imports (JSON-Backup) nach allen Schema-Änderungen weiterhin funktionsfähig.
- **QA-019** [P2] Test des kompletten Bibliotheks-Rebuilds (README erwähnt dieses Feature explizit als datenerhaltend) nach allen Änderungen erneut verifizieren.
- **QA-020** [P2] Cross-Device-Timing-Test: Wie schnell (Sekunden) ist ein Fortschritt auf Gerät B sichtbar, nachdem er auf Gerät A gespeichert wurde? Zielwert festlegen (z. B. < 60s) und messen.
- **QA-021** [P3] Nutzer-Akzeptanztest mit robert selbst nach jeder Phase (kurzes Feedback einholen, bevor die nächste Phase beginnt).
- **QA-022** [P1] Abschließender Gesamt-Test aller in Abschnitt 3 gestellten Fragen/Entscheidungen gegen das tatsächlich gebaute Ergebnis (Haben wir gebaut, was entschieden wurde?).

---

## 13. DevOps / CI / Docker (`OPS-001` … `OPS-015`)

- **OPS-001** [P2] `.github/`-Workflows sichten und um die neuen Test-/Build-Schritte (Mobile, TV, Server) erweitern.
- **OPS-002** [P2] Separates CI-Workflow für `mobile/` (EAS Build Trigger bei Tag/Release).
- **OPS-003** [P2] Separates CI-Workflow für `tv/` (analog).
- **OPS-004** [P2] Docker-Image automatisch bei Release-Tag bauen und zu einer Registry pushen (GitHub Container Registry o. ä.), falls nicht schon vorhanden.
- **OPS-005** [P3] Multi-Arch-Docker-Build in CI (`amd64` + `arm64`) automatisieren, siehe `SRV-016`.
- **OPS-006** [P2] Versionsnummern-Konsistenz automatisch prüfen (Desktop `package.json`, Server `VERSION`-Konstante, Mobile `app.json`, künftig TV `app.json` — sollten bei Releases synchron sein oder zumindest bewusst unabhängig versioniert und dokumentiert sein).
- **OPS-007** [P2] Automatisierte Release-Notes/Changelog-Generierung.
- **OPS-008** [P3] Dependabot/Renovate für automatische Dependency-Updates aktivieren.
- **OPS-009** [P2] Docker-Compose-Beispieldateien (`docker-compose.yml`, `docker-compose.zimaos.yml`) nach allen Server-Änderungen (neue Env-Variablen) aktuell halten.
- **OPS-010** [P3] Staging-/Test-Server-Instanz getrennt von robert's Produktiv-ZimaOS-Server einrichten, um Updates vorab zu testen, bevor sie den echten Server treffen.
- **OPS-011** [P2] Rollback-Strategie dokumentieren (falls ein Docker-Update nach den großen Änderungen fehlschlägt, wie kommt man zur letzten funktionierenden Version zurück — Docker-Image-Tags mit Versionsnummer statt nur `latest` nutzen).
- **OPS-012** [P2] Datenbank-Backup VOR jedem größeren Migrations-Schritt automatisch anstoßen (Sicherheitsnetz für die Sync-Architektur-Änderungen aus Abschnitt 5).
- **OPS-013** [P3] Monitoring/Alerting einrichten, falls der Supabase-Sync-Loop dauerhaft fehlschlägt (z. B. einfache Log-basierte Warnung).
- **OPS-014** [P2] Nach TV-App-Fertigstellung: Sideload-Installationsanleitung als eigenes Dokument (`tv/README.md`) analog zu `mobile/README.md` schreiben.
- **OPS-015** [P1] Gesamten Umsetzungsfortschritt (welche IDs aus diesem Plan sind erledigt) in einer einfachen Tracking-Datei (`PLAN_STATUS.md` o. ä.) im Repo pflegen, damit über mehrere Chat-Sessions hinweg der Stand nachvollziehbar bleibt.

---

## 14. Dokumentation (`DOC-001` … `DOC-012`)

- **DOC-001** [P2] `README.md` (Hauptrepo) um Mobile- und TV-App-Abschnitte erweitern (analog zum bestehenden Server-Abschnitt).
- **DOC-002** [P1] `server/README-ZimaOS.md` Abschnitt „Synchronisierung" komplett überarbeiten (siehe `S-035`) — insbesondere den neuen Service-Role-Key-Schritt klar erklären.
- **DOC-003** [P2] `mobile/README.md` um alle in Abschnitt 7 ergänzten Funktionen erweitern.
- **DOC-004** [P1] Neues `tv/README.md` erstellen (Installation/Sideload/Nutzung).
- **DOC-005** [P2] Architektur-Diagramm (siehe `ARCH-06`) im Repo als Bild/Mermaid-Datei ablegen, in `README.md` verlinken.
- **DOC-006** [P3] `CONTRIBUTING.md` falls das Projekt künftig auch für andere offen sein soll (aktuell MIT-lizenziert laut `LICENSE`).
- **DOC-007** [P2] Troubleshooting-Abschnitt „Sync funktioniert nicht" mit den in Abschnitt 1.1 gefundenen typischen Ursachen als Checkliste für künftige Selbst-Diagnose.
- **DOC-008** [P2] Troubleshooting-Abschnitt „Ton und Bild nicht synchron" analog für Abschnitt 1.2.
- **DOC-009** [P3] Screenshots/kurze GIFs für die neue TV-/Mobile-UI in der Doku ergänzen, sobald vorhanden.
- **DOC-010** [P2] Datenschutz-/Sicherheits-Hinweis (siehe `SEC-015`) als eigener Doku-Abschnitt.
- **DOC-011** [P2] `PLAN_STATUS.md` (siehe `OPS-015`) mit Verweis von der `README.md` aus auffindbar machen.
- **DOC-012** [P1] Diesen Plan (`GHGFlix_Masterplan.md`) selbst nach Abschluss aller Phasen als „erledigt/archiviert" markieren bzw. durch eine kurze Zusammenfassung ersetzen, damit das Repo nicht dauerhaft einen riesigen Rohplan mit sich trägt.

---

## 15. Kurzfassung: Anzahl der Punkte

| Kategorie | Anzahl |
|---|---|
| Befunde/Kontext (Abschnitt 1) | — (Diagnose, keine Einzel-Tasks) |
| S — Supabase-Sync-Fixes | 35 |
| ARCH — Sync-Architektur | 18 |
| AV — Audio/Video-Sync | 30 |
| MOB — Mobile App | 45 |
| TV — TV-App(s) | 55 |
| SRV — Server/Backend | 35 |
| SEC — Sicherheit | 18 |
| PERF — Performance | 20 |
| QA — Testing | 22 |
| OPS — DevOps/CI | 15 |
| DOC — Dokumentation | 12 |
| **Gesamt** | **305** |

Damit sind deutlich mehr als 250 konkrete Änderungen/Verbesserungen/Neuerungen enthalten.

---

## 16. Kurz-Briefing für den neuen Chat (zum Reinkopieren als erste Nachricht)

> Ich habe hier einen fertigen Plan (`GHGFlix_Masterplan.md`) für mein Projekt GHGFlix. Bitte Abschnitt 0 (Wie benutzen) und Abschnitt 1 (Root Causes) zuerst lesen, dann Phase 1 (Supabase-Sync-Fix + Audio/Video-Sync-Fix) umsetzen. Bei den Fragen in Abschnitt 3: [hier robert's Antworten einfügen, falls vorhanden — sonst werden die empfohlenen Standardoptionen verwendet]. Bitte nach jeder Phase kurz berichten und auf Bestätigung warten, bevor die nächste Phase beginnt.
   