# Player-Steuerung und Untertitel – QA vom 02.11.2026

Die Handy-APK kann ihre Bedienung durch Tippen ein- und ausblenden. Die Zeitleiste lässt sich mit Zeit-/Bildvorschau ziehen. Vorherige Folgen, eigene Untertitelstile und konfigurierbare Gesten ergänzen die bestehenden Player. Zusätzlich wurden zwei Fehler bei nativen Wiedergabeereignissen behoben. Die Umsetzung umfasst native Mobile-/TV-Komponenten und den gemeinsamen Browser-/Windows-Player; die Verifikation ist je Plattform unten abgegrenzt.

## Verhalten und Bedienung

- Einmal tippen schaltet die Bedienung um; Doppeltippen links/rechts spult standardmäßig 10 Sekunden. Weitere schnelle Tipps addieren Sprünge.
- Halten spielt vorübergehend mit 2×. Loslassen, Abbruch oder App-Wechsel stellt das vorherige Tempo wieder her.
- Links senkrecht wischen regelt Helligkeit, rechts Lautstärke. Alle erweiterten Gesten lassen sich einzeln ausschalten; Tempo und Sprungweite sind einstellbar.
- Die native Lautstärkeauswahl bietet **Nur GHGFlix** als Standard und optional **System-Medienlautstärke**. Android setzt echte Fensterhelligkeit und stellt sie im Hintergrund wieder her. Browser/Windows dunkeln das Videobild ab.
- Beim Ziehen wird erst nach Loslassen gespult. Abbruch verwirft die Vorschauposition, eine Pause bleibt erhalten. Vorhandene Server-Sprites werden verwendet; ohne Bild bleibt die Zeitvorschau.
- Vorherige/nächste Folgen reichen über Staffelgrenzen. Browser/Windows können Filme im bisherigen Queue-Verlauf erneut aufrufen, ohne die Warteschlange nochmals zu verbrauchen. Dieser Verlauf liegt im Speicher und ist nach Server und Profil getrennt.
- Eigene Untertitel: Größe 50–300 %, freie Text-/Hintergrund-/Randfarben, getrennte Deckkräfte, drei Schriftfamilien, Fettschrift, Kontur/Schatten, Randstärke, Position und Zeitversatz. Vorschau, Zurücksetzen, Validierung und Speicherung sind in Player und Einstellungen vorhanden. Bestehende Werte werden migriert.

Entsprechend der bestätigten Anforderung werden ausschließlich eigene GHGFlix-Untertitelwerte verwendet. Die Geräte-Untertiteleinstellungen werden nicht importiert. Einzelheiten stehen in [PLAYER_TOUCH_UND_UNTERTITEL.md](../PLAYER_TOUCH_UND_UNTERTITEL.md).

## Ursachen und weitere Korrekturen

| Befund | Ursache und Korrektur | Regression |
| --- | --- | --- |
| P2: Tippen konnte die sichtbare Bedienung nicht verbergen | Bisheriger Weck-Pfad durch eine gemeinsame Gestenerkennung mit eindeutiger Lebensdauer ersetzt; Buttons und Scrubber bleiben getrennte Eingabeflächen | `red-touch.log`, Browser-, Komponenten- und Android-Eingabetests |
| P2: Native Zeitleiste nur tippbar | Echter Responder-Drag mit Vorschau, abschließendem Seek und Abbruch; Auto-Hide pausiert während des Ziehens | Browser/Preview und Android-Scrub |
| P1: Spulen nach natürlichem Videoende konnte trotz Pausenanzeige wieder starten | ExoPlayers `playWhenReady` konnte aktiv bleiben; Videoende und Seek mit Pausenwunsch pausieren nun ausdrücklich | `red-end-seek.log`, `player-session.test.jsx` |
| P1: Falscher Ladefehler nach erfolgreichem Start | `sourceLoad` und `statusChange` können in anderer Reihenfolge eintreffen; aktuelle Readiness bzw. bestätigter Fortschritt beendet den Ladezustand | `red-native-ready.log`, Regression mit vertauschter Ereignisfolge |
| Android-Helligkeit im Testgerät nicht lesbar | Der Expo-SDK-54-Reader setzt einen optionalen Systemeinstellungseintrag voraus. Ein kleines lokales Expo-Modul liest Fenster-/Systemhelligkeit mit definiertem Fallback, ohne globale Einstellungen zu ändern | Tatsächlicher Fensterwert `sbrt` und Wiederherstellung im Android-35-AVD |
| P2: Tastaturfokus nach Schließen der mobilen Web-Optionen verloren | Ein konkurrierendes `autoFocus` lief vor der Speicherung des Auslösers; die gemeinsame Fokusverwaltung übernimmt jetzt Öffnen und Rückkehr | `focus-regression-before.log`, echter Shift+Tab-/Tab-/Escape-Durchlauf |

Untertitel- und Gestenwerte werden in `shared/` validiert. UI-Adapter für React und React Native verwenden dieselben Feldbeschreibungen. Maus-/Touch-Ereignisse werden getrennt; lange Berührungen lösen keine nachträglichen Mausklicks aus. Dialoge halten den Tastaturfokus, Escape verwirft noch nicht bestätigte Eingaben, ungültige Zahlen und Farben werden zurückgewiesen.

## Nachweise und Ergebnisse

Basis: `d7bd8cb` auf dem tatsächlichen Remote-Default `main`. Änderungen liegen ausschließlich auf `codex/fix/audit-player-controls` im isolierten Worktree. Das andere lokale Hauptcheckout wurde nicht verändert. Der Baseline-Lauf verwendete einen getrennten Wegwerf-Worktree. Die anfangs fehlende synthetische Preview-Videodatei wird jetzt über ein Global-Setup erzeugt.

| Prüfung | Befehl / Oberfläche | Ergebnis |
| --- | --- | --- |
| Unit / gemeinsame Gesten / Migration / Verlauf | `npm test` | 55 Tests, 12 Dateien bestanden |
| Native React-Komponenten / Session-Rennen | `npm run test:mobile:channels` | 39 Tests, 6 Dateien bestanden |
| Bestehende mobile Node-Suiten | `npm test --prefix mobile` | bestanden |
| Browser mit echten Pointer-, Touch- und Tastaturereignissen | `npm run test:browser -- --workers=2` | 27 Tests bestanden; Desktop, 390×844, 1920×1080 |
| Mobile-/TV-Komponenten im Browser | `npm test --prefix preview` | 19 Tests bestanden; Touch, D-Pad, Dialoge, Fehler, Querformat |
| Reale lokale Medienintegration | `npm run test:integration` | HTTP/SQLite/ffmpeg, Direct MP4, HLS und fragmentiertes MP4; decodierte Frames, Seek/Pause/Resume, Vollbild/Mini und Thumbnail bestanden |
| Produktionsbuild | `npm run build` | TypeScript und Vite bestanden; Hinweis auf große JS-Chunks bleibt |
| Native Android Mobile | `npm run build:mobile --prefix mobile` | APK gebaut, Versionscode 23; Update 22→23 im eigenen Test-AVD behielt Verbindung/Profil |
| Native Android TV | `npm run build:tv --prefix mobile` | APK gebaut; vollständige TV-Geräteabnahme offen |
| iOS-JavaScript | Expo-Export mit `--platform ios` | Bundle exportiert; kein nativer iOS-Build/-Gerätetest |
| Native Android-Interaktion | ADB-Eingaben und frische UIAutomator-Bäume im isolierten Android-35-AVD | Tippen in beide Richtungen, pausiertes Ziehen, Doppeltipp, getrennte Playerlautstärke, echte Helligkeit und Hintergrund-Restore bestanden |
| Weitere native Android-Prüfungen | Tatsächliche UI-Eingaben, synthetische Serie/VTT | System-Medienlautstärke 5→9/15, Vor/Zurück über Staffelgrenze und eigene Untertitelwerte nach Kaltstart bestanden |

Alle Medien, Profile, Queues und Serverantworten in diesen Prüfungen sind synthetisch. Die native Installation erfolgte ausschließlich auf dem eigens gestarteten AVD `GHGFlixPlayerQA`, nicht auf einem privaten Telefon. Browser-Komponententests sind keine Betriebssystemtests. Die vier Android-Lautstärke-/Helligkeitsbelege verwenden tatsächliche native Zustände, nicht nur ein eingeblendetes HUD.

Die lokale Gesamtmatrix umfasst **34 PASS, 3 BLOCKED, 3 NOT_RUN, 3 NOT_APPLICABLE, 0 FAIL**. Sie enthält auch die unten genannten offenen Abnahmen. Der Struktur-/Dateinachweis-Gate besteht; der strenge Gate für den Gesamtumfang bleibt wegen dieser sechs offenen Prüfungen absichtlich rot. Ein separat ausgewiesener Nachweis für die ausgeführten Prüfungen besteht den strengen Gate. Dieser Teilnachweis ersetzt keine vollständige Freigabe.

Nachweise liegen lokal unter `evidence/player-quality-20261102/` und werden wegen Umfang und lokaler Testdetails nicht ins Repository aufgenommen. `checks.json` ist die Gesamtmatrix, `verified-checks.json` der ausdrücklich begrenzte Teilnachweis. Vorher-/Nachher-Bilder verwenden denselben synthetischen Clip und dieselben Viewports. Die neue Untertitelvorschau und das native Ergebnis wurden visuell geprüft. Es werden keine Nutzerscreenshots oder privaten Medien veröffentlicht.

## Offene Abnahmen und Grenzen

| Status | Umfang | Grund |
| --- | --- | --- |
| BLOCKED | Nativer iOS-Build und Gerätebedienung | Windows-Host ohne Xcode/iOS-Testgerät; der JS-Export genügt hierfür nicht |
| BLOCKED | Nativer Windows-/mpv-Player | Kein verfügbarer nativer mpv-Testlauf; der gemeinsame Web-Player und TypeScript-Build sind geprüft |
| BLOCKED | Android-TV-OS / echte Fernbedienung | Kein TV-Gerät/-Systemimage verfügbar; APK-Build und browserbasierte D-Pad-Prüfungen liegen vor. Das Tablet-AVD ersetzt keinen Android-TV-Test |
| NOT_RUN | Physisches Android-Handy | Native Eingaben liefen auf einem isolierten Android-35-AVD |
| NOT_RUN | Vollständiger Screenreader-Durchlauf | Benennungen/Sliderwerte sind im Accessibility-Baum geprüft; TalkBack/VoiceOver wurden nicht bedient |
| NOT_RUN | Lange Laufzeiten, Speicher-/Akku-Profiling | Wiederholte Bedienung wurde geprüft, strukturiertes Langzeitprofiling nicht |

Bilduntertitel lassen sich nicht beliebig umfärben. Der mpv-Adapter erzwingt den eigenen Stil auch für ASS; das kann die vorgegebene ASS-Gestaltung verändern. Safari/WebKit und iOS-Hardwaredarstellung sind durch Chromium-Prüfungen nicht abgedeckt. Diese Änderungen werden deshalb als Review-Kandidat mit offenen Plattformabnahmen behandelt.

## Test-APKs und Rückweg

- Mobile: `mobile/build/GHGFlix-Mobile-3.6.1-local.apk`
- TV: `tv/build/GHGFlix-TV-3.6.1-local.apk`
- Beide: Versionscode 23, bisheriger Versionsname 3.6.1; getrennte Laufzeiten `mobile-4` / `tv-4`.
- Signiert mit dem lokalen Android-Testschlüssel. Ein Update einer vorhandenen Installation erfordert dieselbe Signatur. Eine bestehende Installation nicht zur Umgehung eines Signaturfehlers deinstallieren.
- Die nativen Module erfordern einen neuen APK-/App-Build; ein JS-OTA-Update einer alten APK reicht nicht.
- Keine NAS-/Produktionsdatenmigration, kein Merge, keine Veröffentlichung als offizielles Release und kein Deployment. Rückweg über vorherigen passenden App-Build bzw. Revert des isolierten Commits; gespeicherte Altwerte bleiben lesbar.

SHA-256 der erzeugten Dateien:

```text
Mobile C7D4942F0BD543FED8D688D6CFD13D66B4025A8312A933CB780682C1B57B3A8B
TV     A1F729D4927CEB14E37E44AA97D5341E2140278CC03E299B789F2F996627215C
```

## GitHub und verwendete Referenzen

Offene und geschlossene Issues wurden nach den Symptomen durchsucht; #23/#32 betreffen frühere Probleme und wurden nicht fälschlich als behoben referenziert. Das Erstellen eines neuen Issues scheiterte mit HTTP 403 `Resource not accessible by integration`. Der lokale `issue-draft.md` ist deshalb kein GitHub-Issue. Ein PR muss wegen der offenen nativen Abnahmen ein Entwurf bleiben; dessen tatsächlicher Schreibstatus wird separat im Abschluss angegeben. Kein automatischer Merge.

Referenzen wurden am 02.11.2026 abgeglichen und auf die bestätigten Anforderungen angewendet; es wurde kein fremder Produktcode oder Medienbestand übernommen:

- [YouTube: mobile Gesten](https://support.google.com/youtube/answer/7509567?hl=en&co=GENIE.Platform%3DAndroid)
- [VLC Android: Videoplayer](https://docs.videolan.me/vlc-user/android/3.X/en/video/video_player.html)
- [Expo SDK 54: Brightness API](https://raw.githubusercontent.com/expo/expo/sdk-54/packages/expo-brightness/src/Brightness.ts)
- [Volume Manager 2.0.8](https://github.com/hirbod/react-native-volume-manager/tree/v2.0.8) und [mpv-Untertiteloptionen](https://mpv.io/manual/stable/)
- [Craft Anything](https://github.com/storytold/craft-anything) als methodische Referenz. Film-/Effect-/VectorCraft wurden auf Player-Interaktion und Evidenz angewendet; Schnitt-, Effekt-, Vektor-, Undo- und Exportfunktionen gehören hier nicht zum Produktumfang.

Neue Abhängigkeiten `expo-brightness` 14.0.8 und `react-native-volume-manager` 2.0.8 sind MIT-lizenziert. SDK 54 und die vorhandene React-Native-Architektur bleiben erhalten. Die Volume-Manager-Version ist absichtlich exakt festgelegt.
