# GHGFlix 3.5.0 — Prüfung und Übergabe

Stand: 31.10.2026. Umsetzung im separaten Worktree `ghgflix-release/Main`, Branch `codex/release-integration`. Der stabile Player-/Kanalstand wurde mit den zusätzlichen Desktop-, Profil-, Handy- und TV-Änderungen aus dem ursprünglichen Hauptordner verbunden. Alle 116 übernommenen Ursprungsdateien wurden per SHA-256 nochmals verglichen: im ursprünglichen Ordner unverändert. Persönliche NAS-/Profil-/Betriebsskripte wurden nicht veröffentlicht.

## Umfang

- Playerquellen und Metadaten wechseln mit eigener Identität; veraltete Lade-/Seek-Ereignisse verändern den aktuellen Titel nicht. Zeit, Dauer, Pause, Vorspulen, Rückkehr aus Mini/PiP und Warteschlangenwechsel bleiben abgestimmt.
- Vollbild wird am tatsächlichen Fenster-/Browserzustand abgeglichen. Die gemeldete Folge »Vollbild → zurück → erneut starten → einmal Vollbild« hat eine gezielte Regression. Reales Tauri-Fenster/mpv bleibt Geräteabnahme.
- Manuelle Folgenwechsel markieren übersprungene Folgen nicht pauschal als gesehen. Ladefehler haben Wiederholen/Zurück; hängende native Streams enden nach 45 Sekunden und können nicht durch alte Ereignisse wieder aufleben.
- Personalisierbare Kanalgruppen, eigene Bilder, Mehrfachzuordnung, Formatfilter mit unbekanntem Zustand, Suche und In-App-Meldungen; optionaler Web-/Expo-Push mit sichtbarem Einrichtungsstatus.
- Getrennte Mobile-/TV-Pakete mit eigenem Layout, App-Identifier, Runtime und Updatekanal. Kompakte TV-Navigation, Fokus-/Zurückführung, mobile Unterleiste, Profilbilder und Fortschrittsabgleich.
- Bei der Zusammenführung zusätzlich behoben: gesperrter Browserspeicher verhindert Wiedergabe nicht (#31), Wiedergabeliste/PiP im kompakten Webplayer erreichbar (#32), abgebrochene Verbindungen beenden den Testproxy nicht (#33), TV erhält kein Handy-APK-Updateangebot (#34).

## Tatsächliche Prüfungen

| Prüfung | Ergebnis und Grenze |
| --- | --- |
| Web-/Controller-Regressionen | 28 bestanden |
| Native Komponenten/Logik | 35 bestanden; React Native/Provider in diesen Tests ersetzt |
| Mobile-Basissuite | vollständig bestanden, einschließlich 25 Update- und 7 Client-Regressionen |
| Server-Suite | vollständig bestanden: Scanner, Profile, Kopplung, Spuren, Medienwege, Kanäle, Push, Sync, Bonusmaterial und Untertitelcache |
| Rust | 50 Tests bestanden; kein Nachweis einer nativen Windows-UI-Sitzung |
| Browser-Matrix | 15 Tests bei Desktop-, Handy- und TV-Größen bestanden |
| Separate Handy-/TV-Oberflächen | 16 Browser-Simulationen bestanden; Fernbedienung, Dialoge, Fehlerwiederholung, lange Spurlisten und 960×540 |
| Touch-Web mit isoliertem Server | 6 Chromium-Tests bestanden, darunter alle sieben Playeraktionen bei 320×568, 390×844 und 640×360 |
| WebKit-iPhone-Simulation | Navigation, Serverfehler und private Profilbilder bestanden (3); zwei Videotests bewusst nicht ausgeführt. Kein echtes iPhone/HLS-System |
| Längerer Wiedergabetest | Direkt-MP4, HLS und fragmentiertes MP4 parallel mit getrennten SQLite-Profilen, echtem HTTP/FFmpeg und erzeugten 90-s-Clips. 12 Vollbild/Mini-Zyklen, zusätzlich 23/22/22 Pause-/Seek-/Resume-Runden über 187/183/182 s. Dauer, dekodierte Frames, JPEG-Vorschau und gespeicherte Position geprüft |
| Signierte Android-APKs | Managed EAS Release-Builds; Paketnamen, Versionen, vier ABIs und Signaturen geprüft. ARM-Binärdateien vorhanden, ARM-Laufzeit nicht geprüft |
| Nativer eigener Android-35-Tablet-Emulator | Mobile: direkte Folge, Pause, Rückspulen, manuell nächste Folge; Folge 2 bei 59.569/90 s und Folge 3 bei 8.943/90 s getrennt, beide ungesehen. FFV1→HLS: dekodiertes Bild, Pause und Sprung 8→38 s. TV: dieselbe Serverposition übernommen, HLS, OK-Pause, Sprache/Untertitel, Zurück schließt erst Dialog; Navigation/Gruppen bei 960×540. Kein Android-TV-Betriebssystem und kein physisches Gerät |
| Windows | Produktionsbuild EXE/MSI erfolgreich; nicht installiert oder per Maus bedient |
| iOS | JavaScript-Export erfolgreich; kein nativer iOS-Build |

Originale Testlogs und Emulatorbilder liegen im ignorierten `test-results` des Integrationsworktrees. Reproduzierbare Tests liegen im Repository. Browser-Simulationen verwenden synthetische Daten bzw. einen isolierten lokalen Server, niemals die produktive Mediathek. Der 90-s-Test beweist weder mehrstündige UHD-Wiedergabe noch NAS-Kapazität.

## Build-Herkunft

Windows-Binaries: Anwendungsstand `b8b975b`. Finale Android-Binaries: Anwendungsstand `1de3588`, Version 3.5.0 / versionCode 19. Spätere Änderungen am Release-Tag betreffen Prüfdokumentation/CI und Tests. Der Test für lange TV-Spurlisten wartet ausdrücklich auf den asynchronen Dialogfokus, bevor er Tasten sendet; drei gezielte Wiederholungen bestanden. SHA-256-Datei und Build-Manifest werden zusammen mit den Paketen veröffentlicht. Frühere APKs mit versionCode 18 dienten der Emulatorprüfung und werden nicht als finales Paket verteilt.

## Was noch echte Geräte oder Einrichtung benötigt

[DEVICE_ACCEPTANCE.md](DEVICE_ACCEPTANCE.md) enthält die kurze Geräteliste einschließlich des gemeldeten Vollbildfehlers, echter PiP-Fenster, Hardwaredecoder, TV-Fernbedienung, Overscan und Langzeitwiedergabe. [PUSH.md](PUSH.md) beschreibt die optionale Providerkonfiguration. Produktiver Cloud-/NAS-Abgleich wurde nicht als erfolgreich ausgegeben und das NAS nicht von diesem Release-Schritt aus installiert.

Issues #1/#2/#3/#5/#30 bleiben für diese Abnahme/Einrichtung offen. Der VLC-artige Modus wird danach gemeinsam entworfen; Pro-Funktionen sind nicht Teil dieses Releases.
