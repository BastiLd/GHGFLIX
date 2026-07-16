# GHGFlix — Manuelle Test-Checkliste (vor jedem Release)

Masterplan QA-005. Kurz durchklicken, Häkchen setzen. Dauer: ca. 20 Minuten.

## Sync (QA-001, S-013/S-014/S-033)

- [ ] Desktop: Film bis ~50 % schauen → Server-Weboberfläche im Browser: taucht er unter „Weiterschauen“ auf? (≤ 60 s)
- [ ] Umgekehrt: im Browser/Handy 2 Min. schauen → Desktop-App neu starten → Fortschritt übernommen?
- [ ] Supabase aktiv? Status in *Web-Einstellungen → Server-Sync mit Supabase* = „Verbunden“, kein Fehler
- [ ] Beide Sync-Pfade gleichzeitig an (Server-Sync + Supabase): kein Hin- und Herspringen des Fortschritts
- [ ] „Meine Liste“: Herz am Handy setzen → erscheint auf Desktop/Web

## Ton/Bild (QA-002, AV-04/AV-24/AV-30)

- [ ] Browser/Handy, MKV-Datei (Transcode): 5× an verschiedene Stellen springen → Lippen synchron? Position stimmt?
- [ ] Gleiches nach „Fortsetzen“ aus der Weiterschauen-Reihe
- [ ] Audiospur während der Wiedergabe wechseln → weiterhin synchron?
- [ ] Desktop mpv: 90 Min. durchlaufen lassen (stichprobenartig) → kein Drift
- [ ] 3 Geräte gleichzeitig streamen (Desktop + Handy + TV) → 4. Transcode bringt klare „bitte warten“-Meldung, nichts stürzt ab

## TV-Modus (TV-044…048)

- [ ] TV-Browser: `http://<ip>:8484/?tv=1` → roter Fokus-Rahmen sichtbar
- [ ] Pfeiltasten: durch Reihen (links/rechts) und zwischen Reihen (hoch/runter) navigierbar
- [ ] OK/Enter startet Wiedergabe, Zurück-Taste führt zur Übersicht
- [ ] Nichts am Bildschirmrand abgeschnitten (Overscan)

## Sicherheit (QA-017)

- [ ] `GHGFLIX_PASSWORD` gesetzt → API ohne Token liefert 401
- [ ] 8× falsches Passwort → 5-Minuten-Sperre greift (429)
- [ ] „Alle Geräte abmelden“ → Handy/Browser müssen sich neu anmelden
- [ ] `GET /api/settings` enthält NIE den Service-Role-Key im Klartext

## Bestand (QA-016)

- [ ] Desktop: Bibliothek scannen, Wiedergabe, Intro-Skip, PiP — wie vorher
- [ ] Docker-Update von vorheriger Version: Daten (Verlauf, Profile, Listen) vollständig da
- [ ] Export/Import (JSON-Backup) funktioniert
