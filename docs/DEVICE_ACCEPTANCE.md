# Geräteabnahme für Player und Kanäle

Stand: 31.10.2026. Diese Liste ist eine offene Abnahme, kein Nachweis bestandener Gerätetests.

## Bisherige Evidenz

| Plattform | Tatsächlich geprüft | Noch auf dem Gerät zu prüfen |
| --- | --- | --- |
| Windows-Desktop | 28 Web-/Controller-Regressionen, 50 Rust-Tests, CI, Windows-EXE/MSI 3.5.0 gebaut | Native Tauri-/mpv-Wiedergabe, Fensterwechsel, echtes PiP, Vollbild nach Rückkehr |
| Web | Headless Chromium mit echtem lokalen Server, SQLite, FFmpeg und erzeugten Medien; zusätzliche Layoutsimulationen | Zielbrowser, reale Medienbibliothek, echtes PiP-Fenster und Geräte-Push |
| Android | Gebaute x86_64-App im eigenen fensterlosen API-35-Tablet-Emulator; zwei Layoutgrößen, D-Pad, Fotoauswahl, direkte und umgewandelte Wiedergabe, Folgenwechsel und Fehlerwiederholung | Physisches Handy/ARM-Laufzeit; OS-Hintergrundwechsel und Geräteleistung |
| iOS | JavaScript-Export, Komponentenprüfungen, WebKit-iPhone-Simulation von Navigation/Profilbildern | Nativer Build, iPhone/iPad, HLS, Fotoauswahl, OS-Hintergrundwechsel |
| Android TV | Separate signierte TV-APK: Start, HLS-Wiedergabe/Fortschritt, D-Pad/Dialog/Zurück und 960×540-Layout im Tablet-Emulator | Android-TV-System, Fernbedienung, Lesbarkeit am tatsächlichen Sitzabstand, Overscan |
| TV-Browser | Browsergröße 1920×1080 simuliert | Fernseher-Browser, verfügbare Codecs, Fokus und Zurück-Taste |

Der Emulator ist kein Android-TV-System. Eine Build-Datei oder bestandene CI ist kein Beleg für eine native Gerätesitzung.

## Kurzer Ablauf pro echtem Gerät

Gerät, OS, App-Version/Commit, Wiedergabeweg (direkt/HLS/Umwandlung), Medienformat und Ergebnis notieren. Nur eine tatsächlich geprüfte Fassung bewerten; keine Installation auf Nutzergeräten. Release-Pakete und Server-Image werden getrennt veröffentlicht; eine Veröffentlichung ist keine NAS-Installation.

1. Film und eine Serie mit mindestens drei Folgen starten. Dauer und Zeit prüfen; bei laufender und pausierter Wiedergabe vor- und zurückspulen. Vorschauen an mehreren Stellen laden.
2. Zehnmal zwischen großem Player, Mini und – soweit unterstützt – PiP wechseln. Mini verschieben, vergrößern, PiP schließen. Zeit, Pause, Ton und Warteschlange müssen erhalten bleiben.
3. Gemeldeten Vollbildfehler gezielt prüfen: Folge im Vollbild → zurück zur App → Folge öffnen → **einmal** Vollbild drücken. Das Fenster muss sofort ins Vollbild wechseln. Auch Escape/externe Vollbildbeendigung und erneuten Start prüfen. [Issue #5](https://github.com/BastiLd/GHGFLIX/issues/5) bleibt bis dahin offen.
4. Folge 1 manuell überspringen, danach Folge 2 und 3 wählen. Ein manueller Sprung darf die vorige Folge nicht pauschal als gesehen markieren. Aus Weiterschauen erneut öffnen; Position und verbleibende Folgen müssen stimmen. Ladefehler mit Wiederholen/Zurück prüfen, ohne verlorenen Fortschritt.
5. Zwei Gruppen anlegen, Namen/Bild bearbeiten, denselben Kanal beiden zuweisen. Neustart; Zuordnungen/Bild müssen bestehen bleiben. Formate, Suche und ungelesene Beiträge prüfen. Ein unbekanntes Format muss als unbekannt erkennbar bleiben.
6. Auf TV alle Aktionen ausschließlich mit Fernbedienung erreichen: Fokus sichtbar, Zurück schließt zuerst Dialog/Unterseite, keine abgeschnittenen Ränder. Auf Handy beide Orientierungen und Bildschirmränder prüfen.

## Noch erforderliche Abnahme und Einrichtung

### Accounts ab 3.6.0

Zusätzlich pro echtem Gerät prüfen: gemeinsames Server-Passwort → E-Mail/Passwort → eigenes Profil; Gerät/App neu starten; Profilbild erstellen/ändern; Kinderprofil bis 6 auswählen; unbekannte/18er-Inhalte und Kanäle bleiben verborgen; Wechsel zum Erwachsenenprofil mit falscher/richtiger PIN sowie ohne PIN mit Account-Passwort; Abmelden und zweiten Account öffnen. Listen, Profile, Fortschritt und Kanäle des ersten Accounts dürfen dabei nicht erscheinen. Die serverweite Mediathek bleibt gemeinsam.

Die einmalige Besitzer-Übernahme und optionale Google-Einrichtung sind in [ACCOUNTS.md](ACCOUNTS.md) beschrieben. Echte Google-Anmeldung benötigt den eigenen OAuth-Client und die passende HTTPS-Weiterleitung; signierte Test-Token und nachgebildete Providerantworten ersetzen diese Abnahme nicht. Die konkreten 3.6.0-Prüfergebnisse stehen in [RELEASE_3.6.0.md](RELEASE_3.6.0.md).

- Web- und native Expo-Push-Anbindung sind implementiert; Provider-/Build-/Zielserver-Konfiguration und wirkliche Zustellung sind offen ([#30](https://github.com/BastiLd/GHGFLIX/issues/30)). Tauri-Desktop und Android TV unterstützen diesen nativen Push-Weg nicht. In-App-Meldungen bleiben Standard. Einrichtung und Grenzen stehen in [PUSH.md](PUSH.md).
- Die Integrationstests verwenden 90-Sekunden-Testmedien. Wiederholte Wechsel und Spulrunden belegen keine mehrstündige Wiedergabe großer UHD-Dateien oder die Kapazität des NAS. Die Belastungswerte des jeweiligen Laufs stehen in [PLAYER_CHANNELS_STATUS.md](PLAYER_CHANNELS_STATUS.md).
- Der VLC-artige Modus bleibt zurückgestellt, bis die normale Erfahrung abgenommen ist.

Offene Gesamtprüfung: [#1 Player](https://github.com/BastiLd/GHGFLIX/issues/1), [#2 Kanäle](https://github.com/BastiLd/GHGFLIX/issues/2), [#3 Restumfang](https://github.com/BastiLd/GHGFLIX/issues/3).

## Pakete 3.5.0 und Installation

Die APKs sind getrennte Produkte: `GHGFlix-Mobile-3.5.0.apk` (`com.bastild.ghgflix`) und `GHGFlix-TV-3.5.0.apk` (`com.bastild.ghgflix.tv`). Beide enthalten ARM64, ARMv7, x86 und x86_64. Android versionCode ist 19. Für TV dieses TV-Paket verwenden; der alte `/apk`-Serverkanal liefert Mobile und bleibt im TV-Produkt gesperrt.

Die vorhandenen lokalen 3.4.0-Test-APKs sind mit einem Android-Debugschlüssel signiert. Der neue Release verwendet verwaltete Produktionsschlüssel. Android erlaubt zwischen unterschiedlichen Signaturen kein direktes Update. Vor einem nötigen Neuinstallieren lokale Verbindung/Einstellungen sichern; Serverprofile und serverseitige Fortschritte nicht löschen. Eine Deinstallation auf einem Nutzergerät wurde hier nicht ausgeführt. Ein altes Expo-3.3-Artefakt war nicht mehr abrufbar; dessen Zertifikatsvergleich ist deshalb nicht belegt.

Windows: EXE oder MSI auswählen, nicht beide installieren. Die Installer sind nicht Authenticode-signiert. Native mpv-/Tauri-Abnahme bleibt erforderlich. Apple: kein nativer iOS-Installer vorhanden; JavaScript-Export und WebKit-Simulation ersetzen ihn nicht.

Für echte Geräte-Push-Zustellung fehlen weiterhin passende FCM/APNs- und Zielserver-Einrichtung sowie Zustellungsprüfung. In-App-Meldungen funktionieren ohne diesen optionalen Dienst. Cloud-Abgleich wurde mit isolierten Tests geprüft; das zugehörige produktive Supabase-Projekt war über die verfügbare Verbindung nicht eindeutig zugeordnet. Es wurde kein fremdes Projekt geändert.
