# Getrennte Android-Apps und Vorschau

Stand: 26.10.2026, Version 3.4.0 (versionCode 16). Änderungen ausschließlich
im Main-Bereich. Lokale Test-Builds; kein veröffentlichtes Produktionsrelease.

| Produkt | Android-Paket | Bedienung | Runtime / EAS-Kanal |
| --- | --- | --- | --- |
| GHGFlix Mobile | com.bastild.ghgflix | Touch, fünf untere Tabs | mobile-2 / preview |
| GHGFlix TV | com.bastild.ghgflix.tv | D-Pad, feste linke Navigation | tv-1 / tv-preview |

Gemeinsame Datenzugriffe und Medienansichten liegen weiterhin unter mobile/src.
TV hat einen eigenen Einstieg und eine eigene Shell unter tv. Die Produktwahl
erfolgt beim Bau, nicht anhand der Fensterbreite. Eine gedrehte Handy-App bleibt
eine Handy-App. TV besitzt Leanback-Launcher, Banner und Querformat.

## Lokal bauen

In PowerShell, ohne Administratorrechte; Android-SDK und JDK erforderlich:

```powershell
cd C:\Users\basti\Nextcloud\Documents\GHGFLIX\GHGFlix-Zentrale\Main\mobile
npm run build:mobile
npm run build:tv
```

Die Befehle nacheinander ausführen: Beide verwenden denselben generierten
Android-Bauordner. Das Skript erneuert Bundle, Autolinking und eingebettete
Update-ID. Metro verwendet je Produkt einen eigenen Cache. Gradles Build-Cache
bleibt für diese lokalen Produktwechsel ausgeschaltet, damit kein TV-Bundle in
der Handy-APK landet. Dieser Fehler wurde beim echten Emulator-Test entdeckt.

Ausgaben:

- mobile/build/GHGFlix-Mobile-3.4.0-local.apk
- tv/build/GHGFlix-TV-3.4.0-local.apk

Die lokalen APKs sind mit dem generierten lokalen Testschlüssel signiert.
Eine bestehende Handy-Installation mit anderem Schlüssel lässt sich damit
nicht aktualisieren. Bestehende Daten oder Installationen deshalb nicht für
einen Test deinstallieren. Die neue TV-Paket-ID kann parallel installiert werden.
Es wurde ausschließlich auf den eigens angelegten Emulatoren installiert.

EAS verwendet die Profile `preview` für Mobile und `tv` für TV. Die unterschiedlichen
Runtimes verhindern gemeinsame OTA-Auslieferung. Der alte Server-Endpunkt `/apk`
unterscheidet die Produkte noch nicht; TV verwendet deshalb dessen APK-Updater
nicht. Ein produktiver TV-Verteilungskanal ist noch einzurichten und zu prüfen.

## Tatsächliche Änderungen

- TV: feste, auch bei 960×540 Layoutpunkten erreichbare Navigation; größere
  Schrift und Karten, Overscan-Abstände, klare flache Fokusrahmen.
- Stabile Fokusregistrierung, Rückkehr zum zuvor gewählten Eintrag, sichtbares
  Nachscrollen, keine doppelte OK-Auslösung und Fokusbindung in Dialogen.
- Dialoge liegen außerhalb langer Scroll-Inhalte; lange Spurlisten scrollen
  die gewählte Sprache ins Bild. Zurück schließt zuerst den Dialog.
- Mobile: sichere Bildschirmränder, größere Touch-Ziele, fünf untere Tabs,
  Merkliste und Profil oben; kein unsichtbares TV-Fokusfeld.
- Player: sichtbare Ladefehler, lesbare Bedienung, Touch-Springen und erneutes
  Einblenden der Steuerung nach Tipp; nächste Folge ersetzt den Player. TV-OK
  landet beim Öffnen und erneuten Einblenden auf Play/Pause statt auf Zurück.
- Android versucht native Decoder auch für MKV/HEVC, statt die Browser-Regel
  des Servers als Gerätefähigkeit zu übernehmen. Bei Decoderfehlern folgt HLS
  mit maximal 1080p. Endgültige Fehler und 45 Sekunden ohne Stream-Antwort zeigen
  eine verständliche Meldung mit Wiederholen.
- Unveränderter Fortschritt wird nicht wiederholt gesendet. Ein pausierter
  Player überschreibt dadurch nicht laufend neuere Positionen anderer Geräte.
  Fehlgeschlagene Meldungen bleiben erneut sendbar.
- Startabsturz durch zu frühen API-Zugriff beseitigt. Fehlende Serververbindung
  zeigt einen Fehler mit Wiederholen statt einer leeren Bibliothek.
- Bestehender Test-Renderer räumt Effekte auf und beendet sich wieder sauber.

## Zwei unterschiedliche Vorschauen

`http://127.0.0.1:5188/` ist eine Browser-Vorschau derselben React-Komponenten.
Sie nutzt standardmäßig klar gekennzeichnete Beispieldaten. `?live=1` verbindet
sie mit dem echten lokalen Testserver. Sie ersetzt keinen Android-Test.

`http://127.0.0.1:5191/` zeigt regelmäßig aktualisierte Screenshots direkt aus
den echten Android-Emulatoren. Sie ist nur eine Anzeige. Bedient wird in den
separaten Android-Fenstern: TV mit Pfeilen und Enter, Android-Zurück mit
Strg+Rücktaste; Handy mit Maus als Touch und Ziehen zum Wischen.

Die Emulatoren heißen GHGFlixTV (Android TV 11, 1280×720, x86, Port 5562)
und GHGFlixPhone (1080×2340, x86_64, Port 5560). Ihre eigenen AVD-Daten liegen
unter preview/runtime/avd. Bestehende persönliche AVDs wurden nicht verändert.
Die TV-Systemdateien stammen aus Googles offiziellem Android-SDK-Repository.

Der separate Medienserver läuft ausschließlich auf 127.0.0.1:8490; ADB Reverse
verbindet die Emulatoren mit diesem Port. Testdatenbank: preview/runtime/server.
`node preview/start-real-server.mjs` scannt fünf ausdrücklich ausgewählte Ordner
unter E:/Medien: vier Filme und die vorhandenen drei Avatar-Episoden. Vorhandene
lokale Beschreibungen werden nur lesend übernommen. API-Schlüssel werden nicht
verwendet. Originalvideos werden weder kopiert, verschoben noch gelöscht.
Fortschritt und Favoriten des Tests landen in der separaten Testdatenbank.

## Prüfungen und Grenzen

`mobile/npm test`: vollständige bestehende Client-Suite plus sieben neue
Regressionstests bestanden. `preview/npm test`: elf Bedienungstests bestanden
(TV-Reihen, Fokus-Rückkehr, Dialoge, Einstellungen, kleine TV-Auflösung,
Player, Touch, lange Spurliste, Serverfehler sowie Video-Abbruch und erfolgreiche
Wiederholung, auch mit TV-OK auf dem Fehlerbildschirm). Browser-Build erfolgreich. Die 31 HLS-Serverprüfungen bestanden
ohne Überspringen, einschließlich des benötigten 1080p-Fallbacks.

Reale APKs wurden lokal gebaut und in den eigenen Emulatoren installiert.
Der native TV-Test hat bereits Verbindung, Profil, Bibliothek, D-Pad,
echte Big-Hero-6-Datei, Springen, Pause und Geschwindigkeitsdialog mit Zurück
geprüft. Der finale Build zeigt flache Fokusrahmen ohne die zuvor beobachteten
Android-Schattenartefakte. Der Handy-Test hat Verbindung, Profil, Filmraster,
Details, Suche, echte Wiedergabe, Pause, Steuerung nach dem Ausblenden und die
gespeicherte Fortsetzungsposition nach Zurück geprüft. Screenshots stehen unter
preview/evidence (native-tv-*, native-mobile-*).

Ein zusätzlicher Test mit Avatar S01E05 (3840×2160, HEVC, E-AC3) hat den alten
schwarzen Umwandlungsweg reproduziert (503). Nach der Player-Korrektur läuft
dieselbe Datei im TV-Emulator über HLS. Ein echtes ausgegebenes Segment wurde
mit ffprobe als H.264, 1920×1080 bestätigt. Native Aufnahme:
preview/evidence/native-tv-hevc-player.png. Das bestätigt diesen Fallback,
nicht native 4K-Dekodierung oder HDR-Farbtreue.

Der anschließende reale Zwei-Geräte-Test hat den TV bei 292,14 Sekunden
pausiert gelassen und am Handy 323,724 Sekunden gespeichert. Über weitere
40,6 Sekunden änderten sich weder diese neuere Position noch deren
Server-Zeitstempel. Der pausierte TV hat nichts zurückgeschrieben.
Messdaten: preview/evidence/native-progress-sync.json. Gemeinsamer aktueller
Screenshot: preview/evidence/native-overview.jpg. Größen und SHA-256 der
gebauten APKs: preview/evidence/builds.json.

Emulatoren prüfen keine physische TV-Fernbedienung oder herstellerspezifische
Decoder. Weitere HEVC-Varianten, HDR, Mehrkanalton, Untertitel verschiedener Container,
Netzwerkunterbrechungen und ein produktiv signierter Updateweg brauchen
zusätzliche Geräteprüfungen. Aus einer abgespielten H.264-Datei folgt keine
Bestätigung für alle anderen Medienformate.
# Player, Icons und Sprachen – 26. Oktober 2026

TV und Handy verwenden jetzt dieselben Lucide-Icons wie die Desktop-App.
Die 26 Masken werden mit `scripts/make-client-icons.mjs` aus der vorhandenen
Desktop-Abhängigkeit erzeugt und in den APKs mitgeliefert. Es gibt keine
zusätzliche native Abhängigkeit und keinen Icon-Download zur Laufzeit.

Im Player bleiben Play/Pause und die Sprungtasten getrennt von den Optionen.
„Sprache & Untertitel“ ist immer sichtbar, sobald die Bedienleiste eingeblendet
ist. Die aktuelle Auswahl steht direkt darunter. „Optionen“ enthält Tempo,
Bildanpassung, Untertitel-Darstellung und Wiedergabeinformationen.

- TV: OK pausiert auch bei verborgener Leiste. Abwärts führt von Play/Pause
  zu „Sprache & Untertitel“. Im Menü wechseln Links/Rechts zwischen Audio und
  Untertiteln, Auf/Ab zwischen Spuren; OK wählt, Zurück schließt das Menü.
- Handy: Video antippen, „Sprache & Untertitel“ öffnen, dann den Reiter Audio
  oder Untertitel wählen. Der Schließen-Knopf führt zurück zum Video.
- „Darstellung“ bietet eine Vorschau und direkt veränderbare Größe, Farbe,
  Hintergrund und Zeitversatz. „Als Standard merken“ speichert die aktuelle
  Sprachwahl für weitere Titel auf diesem Gerät.
- Fehlende Spuren werden erklärt. Bild-Untertitel wie PGS werden als nicht
  unterstützt gekennzeichnet. Die App erzeugt keine fehlenden Tonsprachen.

Der native Test mit Avatar S01E05 deckte einen Serverfehler auf: Jede Wahl
las die gesamte 7,5-GB-Datei erneut. Unter Last konnte die Extraktion am alten
25-Sekunden-Limit scheitern. Untertitel werden jetzt nach Dateipfad, Größe,
Änderungszeit und Spur zwischengespeichert; gleichzeitige Anfragen teilen
denselben Vorgang. Mit DATA_DIR liegt der Cache im Server-Datenordner.
Ein Windows-Abbruch beendet auch den FFmpeg-Prozess hinter einem Wrapper.
Server-Abbruch: 60 Sekunden; Client-Abbruch: 65 Sekunden mit erneuter Auswahl.

Messung der echten Datei: erste deutsche/englische Extraktion 17.997/19.834 ms,
erneuter HTTP-Abruf 23/17 ms. Die deutsche Spur enthält 536 Einblendungen.
Messwerte: `preview/evidence/native-subtitle-cache.json`.
Die Änderungen am Medienserver sind bisher im lokalen Testserver aktiv.

Abschlussprüfung der neu gebauten APKs: Beide sind in den Android-Emulatoren
installiert; ihre SHA-256-Werte auf Android stimmen mit `builds.json` überein.
Am TV wurden OK bei verborgener Leiste, Abwärts zum Sprachmenü, die deutsche
Spur von Avatar S01E05 und „Als Standard merken“ mit Richtungstasten geprüft.
Die echte deutsche Einblendung liegt bei eingeblendeter Steuerung oberhalb
der Zeitleiste. Am Handy wurden Big Hero 6, Pause, Sprachmenü und die sofort
sichtbare Änderung der Untertitelgröße von 100 auf 125 Prozent geprüft.

Nachweise unter `preview/evidence`:
- `native-tv-language.jpg`: deutsche Spur im TV-Menü ausgewählt.
- `native-tv-subtitle-spacing.jpg`: echter deutscher Text über der Bedienung.
- `native-mobile-language.jpg`: Audio-Reiter und Erklärung zur einzigen Spur.
- `native-mobile-subtitle-style.jpg`: native Vorschau mit 125 Prozent.
- `native-icons-player-overview.jpg`: beide echten Android-Ausgaben zusammen.

Alle 16 Browser-Bedienungstests und 245 Client-Prüfungen sind erfolgreich.
Auch der vollständige Server-Testlauf ist erfolgreich, einschließlich
Spurentests mit echter FFmpeg-Datei (41) und neuer Cache-Tests (2).
Build- und Testlogs liegen im ignorierten
Ordner `preview/runtime`. Der physische Fernseher und der NAS-Server wurden
in diesem damaligen Durchgang nicht aktualisiert. Das spätere NAS-Update ist
im folgenden Nachtrag dokumentiert.

## Nachtrag 26.10.2026: kompakter nach Plex-/Jellyfin-Referenzen

Die erste Oberfläche war zu groß. Die finalen APKs haben kleinere Buttons,
Karten, Schriften und Abstände. TV: schmale Player-Zeile und Sprachmenü rechts.
Handy: kleinere Kopf-/Tab-Leiste, mehr sichtbare Folgen und kompakter Player.
Beide APKs wurden erneut gebaut, installiert und mit echten Medien visuell
geprüft; die installierten SHA-256-Werte entsprechen `preview/evidence/builds.json`.
Aktuelle Screenshots tragen das Präfix `compact-native-` unter `preview/evidence`.

Die iPhone-WebApp wurde ebenfalls kompakter gestaltet und auf dem NAS aktiviert.
Referenzinventar, genaue Größenänderungen, Testgrenzen, Zugangsadressen und
Rückfallcontainer stehen in [REFERENZEN_WEBAPP.md](REFERENZEN_WEBAPP.md).

---
