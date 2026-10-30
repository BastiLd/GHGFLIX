# Player und Kanaele: Implementierungsstand

Stand: 30.10.2026, sechster Umsetzungsstand. Branch: codex/player-channels-stability. Ausgangspunkt: 8151d0b.

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

## Fünfter Umsetzungsstand: native App und zusätzliche Datenrennen

- Vollständiger Mobile-App-Start geprüft und Initialisierungsabsturz behoben (#16). Die Updateprüfung liest die tatsächliche Expo-App-Version statt einer veralteten Konstante (#20).
- Native Kanalansicht ergänzt (#17): vorhandene Gruppen/Bilder, Kanalnavigation, Suche, Formatfilter und manuelle Zuordnung, gespeicherte/ungelesene Beiträge, Gruppen-/Kanalbearbeitung, Mehrfachzuordnung und bestätigte Löschaktionen. Beiträge öffnen über die externe Quell-App/den Browser; ein eingebetteter nativer YouTube-Player ist damit nicht implementiert.
- In-App-Zähler in der nativen Navigation, bei aktiver App alle 60 Sekunden aktualisiert. Keine ungefragte Betriebssystem-Berechtigung. Native Geräte-Push-Zustellung bleibt offen und wird in der Oberfläche als nicht verfügbar benannt.
- Handy-Gruppenbilder über die echte Fotoauswahl; maximal 960 Pixel, JPEG und begrenzte Dateigröße. Abbruch erhält das bisherige Bild. Die TV-Ansicht zeigt gespeicherte Bilder und verweist für die Auswahl auf Handy/Web/Desktop.
- Neue Abos führen ihre Ergebnisse nach dem Netzabruf mit den aktuellen Daten zusammen. Parallele Bearbeitungen/Löschungen bleiben erhalten; doppelte gleichzeitige Abos werden verhindert, in Server und Rust (#18).
- Ungelesen-Gesamtzahl zählt Beiträge mehrfach zugeordneter Kanäle nur einmal (#19).
- Android-Inhalte berücksichtigen Statusleiste und sichere Bildschirmränder (#22). TV-Navigationsschrift kompakter, Einstellungen vollständig sichtbar.
- Playwright verwendet einen eigenen Ausgabe-Unterordner; seine automatische Bereinigung entfernt keine benachbarten Emulator-/Integrationstestartefakte mehr (#21).
- Native Player-Knöpfe verteilen sich nach verfügbarer Breite auf explizite Fokuszeilen; Antippen weckt die Steuerung, ohne Wiedergabe umzuschalten (#23). Video-Touch-Ereignisse und sichere Bildschirmränder werden berücksichtigt.
- Neue native Bibliotheken erfordern einen neuen nativen Build: runtimeVersion 2, Android versionCode 16. Kein OTA-Update an alte Binärdateien und keine Veröffentlichung vorgenommen.

## Verifikation

- Frontend: 27 gezielte Vitest-Tests für Property-Handoff, Ereignisrennen, Drag-Seeking, unbekannte Dauer, Tastatur, Queue-Auswahl, Mini-Ladeabbruch und Browser-Medienwechsel erfolgreich.
- TypeScript und Vite-Produktionsbuild erfolgreich. Vorhandene Bundle-/Importwarnungen bestehen weiter.
- Vollstaendige Server-Testsuite erfolgreich, einschliesslich FFmpeg-Tests. Erweiterter Kanaltest: 69 Pruefungen erfolgreich.
- Vollstaendige Mobile-Testsuite erfolgreich, inklusive simuliertem D-Pad und Player-Steuerung.
- Rust cargo check --tests und alle zehn gezielten Rust-Kanaltests erfolgreich. Native Oberflaeche wurde damit nicht getestet.

- 15 Headless-Chromium-Tests erfolgreich (einschließlich Zähler bei Mehrfachzuordnung): Kanalnavigation/Formatänderung und tatsächliche Wiedergabe einer generierten WebM-Datei bei 1440x900, 390x844 und 1920x1080. Pro Player-Test drei Vollbild/Mini/Vergrößern-Zyklen, Dauer 90 Sekunden, Pause-Erhalt beim mittleren Zyklus, anschließendes pausiertes Spulen und zusätzlich Schließen/Neustart/Vollbild mit einem Klick. Backend-Antworten und Byte-Range-Medientransport sind Test-Fixtures.
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
- Eigene Gruppenbild-Uploads sind im Browser und über den nativen Android-Fotodialog im Emulator geprüft. iOS-Dateiauswahl und tatsächliche TV-Lesbarkeit auf Geräten bleiben abzunehmen.
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

**Nein.** Neben Geräteabnahme fehlen noch die native Tauri-/Expo-Push-Anbindung und ihre nötige Provider-/Build-Konfiguration sowie längere Last-/Dauertests. Web-Push ist implementiert, am Zielserver aber noch nicht eingerichtet/zugestellt. Die native Android-App wurde zusätzlich als APK im eigenen fensterlosen Android-Emulator geprüft. Das Tablet-Systemimage mit TV-Layout und D-Pad-Eingaben ersetzt weder ein echtes Android-TV-System noch einen Fernseher. Native Kanalbeiträge öffnen extern; vollständige Funktionsgleichheit mit dem Web-Player ist nicht nachgewiesen. Die normale Erfahrung gilt daher weiterhin nicht als vollständig abgenommen, und der VLC-Modus bleibt zurückgestellt.

Arbeitsumgebung: Drei ältere, ausschließlich generierte Integrationstestordner aus fehlgeschlagenen Läufen konnten wegen einer automatischen Policy-Ablehnung des nachträglichen Löschbefehls nicht bereinigt werden. Neue Testläufe räumen ihre eigenen Daten nach dem Prozess-Fix erfolgreich auf. Keine Nutzerbibliothek, kein NAS-Deployment und keine Geräteinstallation verändert.

Quellen zur technischen Einordnung: [YouTube-Videoresource](https://developers.google.com/youtube/data/reference/rest/v3/videos) und [PushSubscription.options](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription/options). Eine Dauer oder ein Bildformat ersetzt keinen eindeutigen Formatsignal-Nachweis für den konkreten Beitrag.

## Zusätzliche Verifikation vom 30.10.2026

- Gesamte Server- und Mobile-Suiten erneut erfolgreich; neuer Mobile-API-Vertragstest gegen wirklichen HTTP-Invoke-Handler und SQLite. Abonnementrennen wurden vor dem Fix reproduziert. Vollständiger App-Start ist jetzt Bestandteil der Mobile-Oberflächenprüfung.
- 14 React-Komponententests für native Kanäle, Fotoübergabe, Zähler-Lebenszyklus und Player-Bedienung. React Native/Video sind darin ersetzt; diese Tests belegen keine native Darstellung.
- Android-x86_64-APK aus lokalem Gradle-Release-Build gebaut. Nur im eigenen Emulator installiert, mit dem generierten Debug-Signaturschlüssel; kein signiertes ARM-Geräterelease. iOS-JavaScript-Export erfolgreich, kein iOS-Binärbuild auf Windows.
- Eigenes Android-35-Google-Play-Tablet-Systemimage, fensterlos/ohne Ton, eigener ADB-Server Port 5041, AVD GHGFlixStability. Darstellung 390x844 dp und 1280x800 dp geprüft. Keine Maus-/Tastatursteuerung des Nutzerdesktops. D-Pad-Eingaben ausschließlich per ADB in diesem AVD.
- Isolierter lokaler Testserver mit eigener SQLite-Datenbank, synthetischem RSS und generiertem H.264/AAC-Testfilm (90 Sekunden). Native Wiedergabe hat Frames dekodiert und Fortschritt gespeichert. Keine Nutzerbibliothek für Wiedergabe verwendet.
- Native Fotoauswahl tatsächlich geöffnet: generiertes PNG 1600x900 gewählt, als JPEG 960x540 am Testserver angekommen. Abbrechen der erneuten Fotoauswahl erhält denselben Bildhash. Mehrfachzuordnung und Kanal-Glocke über native Oberfläche gespeichert und am Server nachgelesen.
- Native Gruppen, Formatdialog, Fernbedienungs-OK und Zurück geprüft. Unbekannter Testbeitrag erscheint nicht als sicher erkanntes Short. App-Version 3.3.0 in nativer Oberfläche kontrolliert. Statusleisten-Überlappung am Handy vor/nach Fix visuell verglichen.
- Wiederverwendbare lokale Hilfen: `tests/integration/mobile-server.mjs` erzeugt ausschließlich Testdaten; `tests/integration/emulator-ui.py` verweigert Eingaben, wenn nicht exakt das eigene Test-AVD am eigenen ADB-Port antwortet. APK, Export, Screenshots und Logs liegen ignoriert unter `test-results/`; Playwright allein unter `test-results/browser/`.

Bei der ersten Serverauswahl veränderte automatische NAS-Erkennung die angezeigte Liste während einer Koordinatenaktion; dadurch entstand eine unbestätigte Kopplungsanfrage. Es wurden keine Zugangsdaten eingegeben, keine Kopplung abgeschlossen und keine Installation/Bereitstellung vorgenommen. Danach ausschließlich explizite Verbindung zum lokalen Testserver und Prüfung aktueller UI-Knoten vor Klicks.

Native Player-Nachprüfung (#23): Bei 390x844 dp alle sechs Knöpfe vollständig in zwei Zeilen sichtbar. Tatsächliche dekodierte Testframes, Pause bei 0:20, Sprung auf 0:50 unter Beibehaltung der Pause und identischer Frame/Zeit nach Ausblenden und Touch-Wiederherstellung. Screenshots `emulator-player-hidden.png` und `emulator-player-woken-paused.png` visuell verglichen. Zusätzliche React-Regressionsprüfung kontrolliert Zeilenwechsel per D-Pad und Neuzuordnung bei Breitenänderung. Die GitHub-Prüfung führt künftig die Frontend-, Mobile- und Kanalrennen-Regressionsprüfungen mit Node 24 aus; das ist keine Behauptung eines bereits erfolgreichen CI-Laufs.

## Sechster Umsetzungsstand und Pause auf Nutzerwunsch

- Vorheriger CI-Lauf bc96cd9 vollständig erfolgreich, einschließlich Rust: https://github.com/BastiLd/GHGFLIX/actions/runs/41052449795.
- Native Folgenwechsel bekommen eine eigene Sitzung je Server/Profil/Titel. Verspätete Metadaten werden verworfen. Manuelles Überspringen speichert den bestätigten Fortschritt statt pauschal gesehen zu setzen. Vollständige Folgenkette bleibt über mehrere Folgen/Staffeln erhalten; Weiterschauen/Verlauf laden die Folgenliste anhand der bestehenden showId nach, mit sichtbarem Wiederholen bei Fehler (#25).
- Native Quellenwechsel sind serialisiert, überholte Spulwünsche werden übersprungen. Nur Metadaten der aktuellen Quelle entsperren Zeitereignisse; aktuelle native Position gewinnt gegen alte Ereignisdaten. Fortsetzen erfolgt nach sourceLoad, nicht nach700ms. Pause bleibt bei Umwandlung/Spurwechsel erhalten, nur bestätigte endliche Positionen werden gespeichert, URLs verwenden das gewählte Profil (#26). replaceAsync wird verwendet, wenn verfügbar; API gegen installierte Expo-Video-Typen/Implementierung geprüft. Referenz: https://docs.expo.dev/versions/latest/sdk/video/.
- Metadatenfehler zeigen Fehler/Wiederholen/Zurück. Der echte503-Test im Emulator deckte zusätzlich auf, dass die App HTTP-Fehler als Daten weitergab und abstürzte. HTTP-Status und Medienstruktur werden nun geprüft; dazu25 erfolgreiche native Komponentenregressionen. Die abschließende native Wiederholungsprüfung dieses letzten Fixes steht bei der Pause noch aus; #27 bleibt deshalb offen.
- Zeitleiste unterstützt Pos1/Ende neben Pfeiltasten; unbekannte/nicht endliche Dauer löst keinen Seek aus (#28). Der erste Dauertest erreichte wegen fehlender Pos1-Unterstützung das natürliche Filmende; kein belegter Wiedergabeabsturz.
- Fünf neue native Regressionen schlugen vor Fix fehl. Aktuell25 Komponentenprüfungen erfolgreich. Gesamte bisherige Mobile-Suite,27 Frontend-Tests und Produktionsbuild erfolgreich; die letzte HTTP-Statusprüfung wurde danach gezielt geprüft. Android-x86_64-Build und iOS-JavaScript-Export durchgeführt; iOS-Export liegt vor dem abschließenden HTTP-Statusfix. Kein iOS-Binärbuild und keine Nutzergeräteinstallation.
- Echte gebaute Android-App im eigenen fensterlosen API35-Tablet-Emulator: Folge1 ->2 ->3 mit dekodierten Frames, getrennte gespeicherte Positionen69.08/34.60/2.02s ohne falsches Gesehen; umgewandelter FFV1-Testfilm pausiert0:55 ->1:25, auch nach fünf Sekunden weiterhin pausiert. Fortschritt85/90.021 am isolierten Server bestätigt. Das ist keine physische TV-Abnahme. Der letzte Weiterschauen-Start wurde durch die503-Fehlerinjektion unterbrochen; dessen abschließender Erfolg wird noch nicht behauptet.
- Längerer Server-Browser-Test erfolgreich:24 Vollbild/Mini-Zyklen (8 je Direkt-MP4/HLS/fragmentiertemMP4),35 zusätzliche Pause/Seek/Resume-Runden. Gemessene Belastungsphasen98/93/97Sekunden; keine simulierten HTTP-/Medienantworten, echte SQLite/FFmpeg und dekodierte Vorschaubilder176x100. Kein Stunden-/Mehrnutzer-Lasttest. Wiederholbar mit GHGFLIX_STRESS_CYCLES=8 und GHGFLIX_PLAYBACK_SOAK_SECONDS=90, dann node tests/integration/player.mjs nach Produktionsbuild. Die frühere Zwischenmeldung mit36 Runden war ungenau; die Ergebnisdatei zählt35.
- Isolierter Emulator-HTTP-Proxy tests/integration/emulator-proxy.mjs erlaubt nur Testserverports19844/19845 und kann über test-results/mobile-offline ausschließlich dessen Medienmetadaten mit503 beantworten. Nach erneutem Umspringen der Servererkennung wurde der Emulator auf diesen Proxy gesetzt; vor dem Schutz entstand wiederum eine unbestätigte Kopplungsansicht. Keine Anmeldung, Installation oder Bereitstellung auf dem NAS.

Fortsetzung: zuerst letzten HTTP-Fehlerfix in gebauter APK mit503 ->Wiederholen ->Fortsetzen aus Weiterschauen prüfen und #27 erst danach schließen. Native Push-Anbindung/Providerkonfiguration, längere Mehrnutzer-/Dauertests und physische Desktop-/PiP-/TV-/iOS-Abnahme bleiben offen. VLC-Modus weiterhin zurückgestellt. Nutzer bat um Abschluss innerhalb zweier Minuten oder kurze Pause; aktueller Arbeitsschritt wird gesichert und pausiert.
