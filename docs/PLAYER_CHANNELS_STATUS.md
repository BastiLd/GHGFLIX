# Player und Kanaele: Implementierungsstand

Stand: 30.10.2026. Branch: codex/player-channels-stability. Ausgangspunkt: 8151d0b.

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

## Verifikation

- Frontend: sechs gezielte Vitest-Tests fuer Property-Handoff, Ereignisrennen, Drag-Seeking, unbekannte Dauer, Tastatur und Queue-Auswahl erfolgreich.
- TypeScript und Vite-Produktionsbuild erfolgreich. Vorhandene Bundle-/Importwarnungen bestehen weiter.
- Vollstaendige Server-Testsuite erfolgreich, einschliesslich FFmpeg-Tests. Erweiterter Kanaltest: 65 Pruefungen erfolgreich.
- Vollstaendige Mobile-Testsuite erfolgreich, inklusive simuliertem D-Pad und Player-Steuerung.
- Rust cargo check --tests und alle sechs gezielten Rust-Kanaltests erfolgreich. Native Oberflaeche wurde damit nicht getestet.

## Offen: kein vollstaendiger Abschluss des Gesamtplans

- Neue Navigation Gruppe -> Kanal -> Inhaltsformate und Live/Podcast/Trailer-Klassifikation.
- Echte opt-in Geraete-Push-Zustellung samt Konfiguration. Bestehende Browser-Notification waehrend geoeffneter App ist kein Hintergrund-Push.
- Wiederholte reale Wiedergabe-/PiP-/Resize-Tests auf Desktop, Browser, Handy und TV; Last- und Langzeittests.
- Visuelle Abnahme der Gruppenbilder und TV-Abmessungen; Emulator-/Hardwarepruefung. Keine Maus-/Tastaturuebernahme durchgefuehrt.
- Keine Bereitstellung auf NAS oder Installation auf Nutzergeraeten erfolgt.
- VLC-artiger Modus bleibt wie vereinbart zurueckgestellt.

## GitHub

- https://github.com/BastiLd/GHGFLIX/issues/1 (Player)
- https://github.com/BastiLd/GHGFLIX/issues/2 (Gruppen)
- https://github.com/BastiLd/GHGFLIX/issues/3 (Restumfang und Geraeteabnahme)

Issues bleiben bis zur jeweiligen Abnahme offen.
