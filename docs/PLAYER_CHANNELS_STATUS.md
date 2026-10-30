# Player und Kanaele: Implementierungsstand

Stand: 30.10.2026, vierter Umsetzungsstand. Branch: codex/player-channels-stability. Ausgangspunkt: 8151d0b.

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

## Dritter Umsetzungsstand

- Browser-Medienabfragen haben eine Generation: spätere Antworten älterer Titel dürfen den aktuellen Stream nicht ersetzen. Abbruch/Schließen verwirft offene Abfragen, ohne bei einem bloßen Routenwechsel das aktuelle Video neu zu erzeugen (Issue #8).
- Expliziter Titelstart startet die Wiedergabe; Stream-Spulen erhält dagegen den Pausezustand, auch bei Position null. Eine verspätet abgeschlossene ältere Spulanfrage darf die Zeitanzeige nicht zurücksetzen.
- Fortschritt wird während eines Titelwechsels nicht unter der neuen Folge gespeichert. Metadaten-, Varianten- und Fortschrittsantworten abgebrochener Navigationen werden verworfen.
- Mini-Queue-Einträge bleiben bei fehlgeschlagener Abfrage erhalten. Schließen während der Abfrage verwirft die Antwort. Während des Wechsels sind weitere Wechsel/Vergrößern gesperrt; Schließen bleibt möglich. Auch im großen Player wird die Queue erst nach erfolgreichem Ladebefehl verbraucht (Issue #10).
- Mini-Handoff übergibt Titel, Pfad und Rücksprungziel sofort. Beim schnellen Zurückgehen ist der tatsächliche Ladezustand maßgeblich; die verzögerte Darstellung des ersten Frames entscheidet nicht mehr über den Erhalt der Sitzung.
- Kanalabrufe führen Ergebnisse mit dem aktuellen Datenbestand zusammen, statt den alten Snapshot zurückzuschreiben. Eigene Namen, Gruppen, Meldeeinstellungen und Beitragsmarkierungen bleiben erhalten; entfernte Abos werden nicht wiederhergestellt; überlappende Abrufe melden neue Beiträge nur einmal. Gleiche Lösung in Server-JavaScript und Desktop-Rust (Issue #9).

## Vierter Umsetzungsstand

- Push-Status wird mit Browseranmeldung, aktuellem VAPID-Schlüssel und Servereintrag abgeglichen. Verwaiste oder veraltete Anmeldungen werden nicht als aktiv ausgegeben; Erneuern erfolgt nur auf ausdrücklichen Klick. Serverfehler ergeben einen unbekannten Status mit Wiederholen-Schaltfläche. Fehler beim Abmelden oder Speichern erhalten eine korrekte Anzeige (Issue #11).
- Shorts-Erkennung: HTTP 200, Consent-/Fremd-/falsche Video-Redirects sowie Bildformat/Länge sind kein sicherer Nachweis. Nur ein HTTPS-Redirect derselben YouTube-Video-ID auf /watch liefert derzeit die automatische Einstufung als normales Video. Alle anderen Antworten bleiben unbekannt; Shorts/Live/Podcast/Trailer können weiterhin manuell zugeordnet werden. Alte heuristische Format-/Dauer-Caches werden als ungeprüft gelesen; Listen, Gruppen, Markierungen und manuelle Formate bleiben erhalten. Unbekannte Formate werden frühestens nach 24 Stunden erneut geprüft und nur für die angeforderten Feeds (Issue #12; Server und Rust).
- Der wirkliche Pausezustand wird nach Streamwechsel explizit veröffentlicht. Dadurch bleibt der Knopf auch bei sehr schnellem Pausieren und HLS-Spulen korrekt (Issue #13).
- Unter Windows wird der vom Server gestartete Medien-Prozessbaum beendet, einschließlich möglicher FFmpeg-Starter-Kinder. Der Server wartet beim Herunterfahren auf die Beendigung; belegte Transcode-Slots werden nicht vorzeitig freigegeben (Issue #14).
- HLS-Sitzungsstarts sind serialisiert. Vor einer Kapazitätsprüfung werden ersetzte Sitzungen derselben Datei vollständig beendet. Spulen funktioniert deshalb auch bei transcode_max=1 (Issue #15).

## Verifikation

- Frontend: 27 gezielte Vitest-Tests für Property-Handoff, Ereignisrennen, Drag-Seeking, unbekannte Dauer, Tastatur, Queue-Auswahl, Mini-Ladeabbruch und Browser-Medienwechsel erfolgreich.
- TypeScript und Vite-Produktionsbuild erfolgreich. Vorhandene Bundle-/Importwarnungen bestehen weiter.
- Vollstaendige Server-Testsuite erfolgreich, einschliesslich FFmpeg-Tests. Erweiterter Kanaltest: 69 Pruefungen erfolgreich.
- Vollstaendige Mobile-Testsuite erfolgreich, inklusive simuliertem D-Pad und Player-Steuerung.
- Rust cargo check --tests und alle neun gezielten Rust-Kanaltests erfolgreich. Native Oberflaeche wurde damit nicht getestet.

- Zwölf Headless-Chromium-Tests erfolgreich: Kanalnavigation/Formatänderung und tatsächliche Wiedergabe einer generierten WebM-Datei bei 1440x900, 390x844 und 1920x1080. Pro Player-Test drei Vollbild/Mini/Vergrößern-Zyklen, Dauer 90 Sekunden, Pause-Erhalt beim mittleren Zyklus, anschließendes pausiertes Spulen und zusätzlich Schließen/Neustart/Vollbild mit einem Klick. Backend-Antworten und Byte-Range-Medientransport sind Test-Fixtures.
- Zusätzlich neun erfolgreiche Wiederholungsdurchläufe des schnellen Vollbild/Mini-Wechsels nach Behebung des dabei gefundenen Timingfehlers.
- Browser-Regressionsprüfung verzögert die Antwort für Folge 2 während Folge 1 läuft: kein Fortschritt unter Folge 2, keine spätere Verdrängung von Folge 3 und kein vorzeitiger Verbrauch des Queue-Eintrags.
- Gruppenbild-Prüfung in allen drei Größen: erzeugtes PNG 1600x900 wird zu WebP 960x540; eigener Name und Bild bleiben nach Neuladen erhalten, Bildentfernung funktioniert; ein Kanal bleibt gleichzeitig in zwei Gruppen. Speicherung ist in dieser Browserprüfung simuliert. Backend-Gruppen und Erhalt paralleler Bearbeitungen sind separat in Server/Rust getestet.
- Neuer Server-Test hält echte Aufrufe der Abrufroutine mit simulierten RSS-Antworten an, bearbeitet/löscht währenddessen Daten und prüft den anschließenden Bestand. Rust prüft die entsprechende Zusammenführung gegen eine SQLite-Testdatenbank.
- Kanalbilder der Browserprüfung visuell auf Desktop und Handy kontrolliert; kein horizontaler Inhaltsüberlauf. Keine Nutzerdesktop-Steuerung.
- Push-Tests bestehen mit simuliertem Transport, nicht mit einem echten Provider/Gerät. Sieben zusätzliche Komponententests decken Status, Schlüsselwechsel, bewussten Opt-in und Fehler beim An-/Abmelden ab.
- `npm run test:integration`: gebautes Frontend mit echtem lokalen HTTP-Server, SQLite und FFmpeg erfolgreich. Generierte 90-Sekunden-Medien: H.264/AAC-MP4 direkt, FFV1/AAC-MKV als HLS und fragmentiertes MP4. Dekodierte Frames, Dauer, je zwei Vollbild/Mini-Zyklen, Pause/Seek/Resume und tatsächlich erzeugte/dekodierte JPEG-Vorschauen 176x100 geprüft. Keine API-/Medienantworten simuliert. Für den separaten fragmentierten MP4-Pfad wird nur die HLS-Fähigkeitsmeldung deaktiviert; der HLS-Pfad lief mit den tatsächlichen Fähigkeiten des installierten Headless-Chromium. Das ist kein iOS- oder TV-Hardwaretest.
- Server-HLS-Suite: 37 Prüfungen mit echtem FFmpeg, einschließlich wiederholtem Spulen und Ein-Slot-Limit. Windows-Prozessbaum-Test mit eigenem Eltern-/Kindprozess erfolgreich. Im abschließenden Integrationstest konnte der Testdatenordner nach Serverende vollständig entfernt werden.
- Der Integrationsserver bindet mit `HOST=127.0.0.1` ausschließlich lokal und verwendet über `GHGFLIX_WEB_DIR` den Produktionsbuild in dist. Normale Server-Vorgaben bleiben unverändert.

## Offen: kein vollstaendiger Abschluss des Gesamtplans

- Automatische, verlässliche Live/Podcast/Trailer-Quelldaten über die bisher vorhandenen RSS/Shorts-Daten hinaus. Manuelle Zuordnung ist umgesetzt.
- Web-Push-Provider-/Geräteabnahme und Einrichtung am Zielserver. Native Tauri-/Expo-Push-Anbindung ist nicht implementiert; die Oberfläche kennzeichnet fehlende Unterstützung.
- Native Desktop-mpv-, iOS-/Android- und echte TV-Abnahme; reales PiP-Fenster und HLS/Transcode-Langzeit-/Lasttests. Der kurze echte Server-Browser-Integrationstest ersetzt diese nicht.
- Eigene Gruppenbild-Uploads sind im Browser geprüft; die native Dateiübergabe und tatsächliche TV-Lesbarkeit auf Geräten bleiben abzunehmen.
- Keine Bereitstellung auf NAS oder Installation auf Nutzergeraeten erfolgt.
- VLC-artiger Modus bleibt wie vereinbart zurueckgestellt.

## GitHub

- https://github.com/BastiLd/GHGFLIX/issues/1 (Player)
- https://github.com/BastiLd/GHGFLIX/issues/2 (Gruppen)
- https://github.com/BastiLd/GHGFLIX/issues/3 (Restumfang und Geraeteabnahme)

Issues bleiben bis zur jeweiligen Abnahme offen.

Weitere Issues: #5 Vollbild; #6 mobile Webansicht; #7 abgebrochene Player-Initialisierung. #6/#7 sind durch Browserregressionen geprüft, #5 bleibt für die native Abnahme offen.

Dritter Stand: #8 (Browser-Lade-/Spulrennen), #9 (Kanal-Datenverlust) und #10 (Mini-Queue-Abbruch) wurden mit vor dem Fix fehlgeschlagenen Regressionstests nachvollzogen. Die genannten automatisierten Prüfungen sind erfolgreich. #1 und #5 bleiben für die native Player-Abnahme offen; der Gesamtplan ist weiterhin nicht abgeschlossen.

## Fehlen nur noch echte Gerätetests?

**Nein.** Neben Geräteabnahme fehlen noch die native Tauri-/Expo-Push-Anbindung und ihre nötige Provider-/Build-Konfiguration sowie längere Last-/Dauertests. Web-Push ist implementiert, am Zielserver aber noch nicht eingerichtet/zugestellt. Die eigenständige Mobile-/Android-TV-App wurde bisher über ihre bestehende automatisierte Suite geprüft; eine vollständige visuelle und funktionale Gleichheit mit den neuen Web-/Desktop-Kanälen ist nicht nachgewiesen. Die normale Erfahrung gilt daher weiterhin nicht als vollständig abgenommen, und der VLC-Modus bleibt zurückgestellt.

Arbeitsumgebung: Drei ältere, ausschließlich generierte Integrationstestordner aus fehlgeschlagenen Läufen konnten wegen einer automatischen Policy-Ablehnung des nachträglichen Löschbefehls nicht bereinigt werden. Neue Testläufe räumen ihre eigenen Daten nach dem Prozess-Fix erfolgreich auf. Keine Nutzerbibliothek, kein NAS-Deployment und keine Geräteinstallation verändert.

Quellen zur technischen Einordnung: [YouTube-Videoresource](https://developers.google.com/youtube/data/reference/rest/v3/videos) und [PushSubscription.options](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription/options). Eine Dauer oder ein Bildformat ersetzt keinen eindeutigen Formatsignal-Nachweis für den konkreten Beitrag.
