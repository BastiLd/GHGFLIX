# Geräteabnahme für Player und Kanäle

Stand: 31.10.2026. Diese Liste ist eine offene Abnahme, kein Nachweis bestandener Gerätetests.

## Bisherige Evidenz

| Plattform | Tatsächlich geprüft | Noch auf dem Gerät zu prüfen |
| --- | --- | --- |
| Windows-Desktop | React-/Controller-Regressionen, Rust-Tests, erfolgreicher CI-Lauf | Native Tauri-/mpv-Wiedergabe, Fensterwechsel, echtes PiP, Vollbild nach Rückkehr |
| Web | Headless Chromium mit echtem lokalen Server, SQLite, FFmpeg und erzeugten Medien; zusätzliche Layoutsimulationen | Zielbrowser, reale Medienbibliothek, echtes PiP-Fenster und Geräte-Push |
| Android | Gebaute x86_64-App im eigenen fensterlosen API-35-Tablet-Emulator; zwei Layoutgrößen, D-Pad, Fotoauswahl, direkte und umgewandelte Wiedergabe, Folgenwechsel und Fehlerwiederholung | Physisches Handy; signierter ARM-Build; OS-Hintergrundwechsel und Geräteleistung |
| iOS | JavaScript-Export und gemeinsame Komponentenprüfungen | Nativer Build, iPhone/iPad, HLS, Fotoauswahl, OS-Hintergrundwechsel |
| Android TV | TV-Layout und D-Pad im Tablet-Emulator | Android-TV-System, Fernbedienung, Lesbarkeit am tatsächlichen Sitzabstand, Overscan |
| TV-Browser | Browsergröße 1920×1080 simuliert | Fernseher-Browser, verfügbare Codecs, Fokus und Zurück-Taste |

Der Emulator ist kein Android-TV-System. Eine Build-Datei oder bestandene CI ist kein Beleg für eine native Gerätesitzung.

## Kurzer Ablauf pro echtem Gerät

Gerät, OS, App-Version/Commit, Wiedergabeweg (direkt/HLS/Umwandlung), Medienformat und Ergebnis notieren. Nur eine tatsächlich geprüfte Fassung bewerten; bisher keine Installation auf Nutzergeräten oder NAS-Veröffentlichung durch diesen Arbeitszweig.

1. Film und eine Serie mit mindestens drei Folgen starten. Dauer und Zeit prüfen; bei laufender und pausierter Wiedergabe vor- und zurückspulen. Vorschauen an mehreren Stellen laden.
2. Zehnmal zwischen großem Player, Mini und – soweit unterstützt – PiP wechseln. Mini verschieben, vergrößern, PiP schließen. Zeit, Pause, Ton und Warteschlange müssen erhalten bleiben.
3. Gemeldeten Vollbildfehler gezielt prüfen: Folge im Vollbild → zurück zur App → Folge öffnen → **einmal** Vollbild drücken. Das Fenster muss sofort ins Vollbild wechseln. Auch Escape/externe Vollbildbeendigung und erneuten Start prüfen. [Issue #5](https://github.com/BastiLd/GHGFLIX/issues/5) bleibt bis dahin offen.
4. Folge 1 manuell überspringen, danach Folge 2 und 3 wählen. Ein manueller Sprung darf die vorige Folge nicht pauschal als gesehen markieren. Aus Weiterschauen erneut öffnen; Position und verbleibende Folgen müssen stimmen. Ladefehler mit Wiederholen/Zurück prüfen, ohne verlorenen Fortschritt.
5. Zwei Gruppen anlegen, Namen/Bild bearbeiten, denselben Kanal beiden zuweisen. Neustart; Zuordnungen/Bild müssen bestehen bleiben. Formate, Suche und ungelesene Beiträge prüfen. Ein unbekanntes Format muss als unbekannt erkennbar bleiben.
6. Auf TV alle Aktionen ausschließlich mit Fernbedienung erreichen: Fokus sichtbar, Zurück schließt zuerst Dialog/Unterseite, keine abgeschnittenen Ränder. Auf Handy beide Orientierungen und Bildschirmränder prüfen.

## Noch erforderliche Umsetzung und Einrichtung

- Web- und native Expo-Push-Anbindung sind implementiert; Provider-/Build-/Zielserver-Konfiguration und wirkliche Zustellung sind offen ([#30](https://github.com/BastiLd/GHGFLIX/issues/30)). Tauri-Desktop und Android TV unterstützen diesen nativen Push-Weg nicht. In-App-Meldungen bleiben Standard. Einrichtung und Grenzen stehen in [PUSH.md](PUSH.md).
- Die Integrationstests verwenden 90-Sekunden-Testmedien. Wiederholte Wechsel und Spulrunden belegen keine mehrstündige Wiedergabe großer UHD-Dateien oder die Kapazität des NAS. Die Belastungswerte des jeweiligen Laufs stehen in [PLAYER_CHANNELS_STATUS.md](PLAYER_CHANNELS_STATUS.md).
- Der VLC-artige Modus bleibt zurückgestellt, bis die normale Erfahrung abgenommen ist.

Offene Gesamtprüfung: [#1 Player](https://github.com/BastiLd/GHGFLIX/issues/1), [#2 Kanäle](https://github.com/BastiLd/GHGFLIX/issues/2), [#3 Restumfang](https://github.com/BastiLd/GHGFLIX/issues/3).
