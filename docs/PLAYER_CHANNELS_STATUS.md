# Player und Kanaele: Implementierungsstand

Stand: 30.10.2026, zweiter Umsetzungsstand. Branch: codex/player-channels-stability. Ausgangspunkt: 8151d0b.

## Implementiert

- Native Player-Abonnenten lesen aktuelle Eigenschaften nach dem Anmelden ein. Neuere Events gewinnen gegen verspaetete Antworten; EOF wird nicht als Startwert wiederholt.
- Der grosse Player verwendet den aktuellen Ende-Callback; spaet abgeschlossene Abonnements werden beim Verlassen abgemeldet.
- Zeitleistenziehen zeigt eine Vorschau und sucht erst beim Loslassen. Tastaturbedienung, Abbruch und unbekannte Dauer sind beruecksichtigt.
- Veraltete Einzelbilder/Sprites werden nicht als aktuelle Vorschau eingesetzt. Vorscha caches werden bei Medien-/Versionswechsel neu aufgebaut.
- Browser-PiP reagiert auch auf Schliessen durch den Browser; fehlende PiP-Unterstuetzung meldet keinen falschen Erfolg.
- Warteschlangeneintraege lassen sich direkt auswaehlen, auch fuer Filme. Staffelreste und andere Eintraege bleiben erhalten.
- Kanaele koennen mehreren Gruppen angehoeren. Legacy-gruppeId bleibt lesbar; gruppenIds hat Vorrang. Gruppenloeschung erhaelt andere Mitgliedschaften. Desktop und Server sind angepasst.
- Gruppenbilder lassen sich lokal auswaehlen, auf maximal 960 Pixel verkleinern und ueber vorhandene Einstellungen speichern. Umbenennung und Farben bleiben erhalten.
- Ungepruefte Videoformate sind sichtbar gekennzeichnet. TV-Abstaende, Titel und Navigation sind kompakter.
- Mobile-Test-Renderer raeumt Effekte beim Neuaufbau und Testende auf, damit Player-Timer die Suite nicht blockieren.

## Zweiter Umsetzungsstand

- Vollbild: explizites Beenden beim Zurückgehen, PiP und Route-Unmount; gemeinsamer serialisierter Fenstercontroller; Synchronisation bei Resize/Fokus/Browser-Vollbildereignissen; fehlgeschlagene Operationen werden angezeigt. Fehlerbericht und Lösung: Issue #5.
- Abgebrochene Initialisierung zerstört nicht mehr die laufende Mini-Wiedergabe (Issue #7). Ein noch nicht angehängter Effekt besitzt den Player nicht.
- Navigation Gruppe -> Kanalkacheln -> Beiträge mit Rückweg. Filter für Videos, Shorts, Livestreams, Podcasts, Trailer und Ungeprüft. Live/Podcast/Trailer sind manuell zuordenbar; keine erfundene automatische Erkennung. Zuordnungen werden auf Server und Desktop gespeichert.
- Schmale Webansicht mit unterer Navigation, umbrechenden Filtern und Playerknöpfen. Mini-Player passt in den Viewport und zeigt Bedienelemente bei Touch/Fokus (Issue #6).
- Opt-in Web Push einschließlich Service Worker, geschützter Schlüsselablage, Gerätespeicherung, Kanalpräferenzen, Endpoint-Prüfung und Bereinigung abgelaufener Anmeldungen. Setup und Grenzen: PUSH.md. Kein Live-Push wurde an Nutzergeräte geschickt.

## Verifikation

- Frontend: zehn gezielte Vitest-Tests fuer Property-Handoff, Ereignisrennen, Drag-Seeking, unbekannte Dauer, Tastatur und Queue-Auswahl erfolgreich.
- TypeScript und Vite-Produktionsbuild erfolgreich. Vorhandene Bundle-/Importwarnungen bestehen weiter.
- Vollstaendige Server-Testsuite erfolgreich, einschliesslich FFmpeg-Tests. Erweiterter Kanaltest: 69 Pruefungen erfolgreich.
- Vollstaendige Mobile-Testsuite erfolgreich, inklusive simuliertem D-Pad und Player-Steuerung.
- Rust cargo check --tests und alle sechs gezielten Rust-Kanaltests erfolgreich. Native Oberflaeche wurde damit nicht getestet.

- Sechs Headless-Chromium-Tests erfolgreich: Kanalnavigation/Formatänderung und tatsächliche Wiedergabe einer generierten WebM-Datei bei 1440x900, 390x844 und 1920x1080. Pro Player-Test drei Vollbild/Mini/Vergrößern-Zyklen, Dauer 90 Sekunden, anschließendes Spulen und zusätzlich Schließen/Neustart/Vollbild mit einem Klick. Backend-Antworten und Byte-Range-Medientransport sind Test-Fixtures.
- Kanalbilder der Browserprüfung visuell auf Desktop und Handy kontrolliert; kein horizontaler Inhaltsüberlauf. Keine Nutzerdesktop-Steuerung.
- Push-Tests bestehen mit simuliertem Transport, nicht mit einem echten Provider/Gerät.

## Offen: kein vollstaendiger Abschluss des Gesamtplans

- Automatische, verlässliche Live/Podcast/Trailer-Quelldaten über die bisher vorhandenen RSS/Shorts-Daten hinaus. Manuelle Zuordnung ist umgesetzt.
- Web-Push-Provider-/Geräteabnahme und Einrichtung am Zielserver. Native Tauri-/Expo-Push-Anbindung ist nicht implementiert; die Oberfläche kennzeichnet fehlende Unterstützung.
- Native Desktop-mpv-, iOS-/Android- und echte TV-Abnahme; reales PiP-Fenster, HLS/Transcode-Langzeit- und Lasttests. Chromium-Simulation ersetzt diese nicht.
- Eigene Gruppenbild-Uploads und tatsächliche TV-Lesbarkeit auf Geräten abnehmen.
- Keine Bereitstellung auf NAS oder Installation auf Nutzergeraeten erfolgt.
- VLC-artiger Modus bleibt wie vereinbart zurueckgestellt.

## GitHub

- https://github.com/BastiLd/GHGFLIX/issues/1 (Player)
- https://github.com/BastiLd/GHGFLIX/issues/2 (Gruppen)
- https://github.com/BastiLd/GHGFLIX/issues/3 (Restumfang und Geraeteabnahme)

Issues bleiben bis zur jeweiligen Abnahme offen.

Weitere Issues: #5 Vollbild; #6 mobile Webansicht; #7 abgebrochene Player-Initialisierung. #6/#7 sind durch Browserregressionen geprüft, #5 bleibt für die native Abnahme offen.
