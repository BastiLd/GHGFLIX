# GHGFlix 3.6.0 — Accounts und geschützte Profile

Stand: 31.10.2026. Separater Worktree `ghgflix-accounts/Main`, Branch `codex/accounts-profiles`, Grundlage des veröffentlichten 3.5.0-Stands `fb0a563`. Der ursprüngliche Arbeitsordner wurde nicht verändert. Kein Zugriff auf Maus oder Tastatur des Nutzercomputers; native Prüfungen laufen ausschließlich im eigenen fensterlosen Emulator.

## Verhalten

Nach Serveradresse und gemeinsamem Server-Passwort folgt die persönliche Anmeldung. E-Mail/Passwort funktioniert ohne externen Anbieter; Google ist optional über den eigenen Server-OAuth-Client verfügbar. Accounts haben eigene Profile, Profilbilder, Fortschritte, Merklisten, Kanäle und Benachrichtigungsanmeldungen. Die Mediathek ist gemeinsam. Profiländerungen erfordern das Account-Passwort; Profile können eine sechsstellige PIN bekommen. Kinderprofile filtern serverseitig nach 0/6/12/16, einschließlich direkter Streaming- und Vorschauzugriffe. Unbekannte Freigaben, Kanäle und externe Trailer bleiben verborgen.

Vorhandene Profile, Bilder, Fortschritte, Listen, Gruppen und Anzeigeeinstellungen werden bei der einmaligen Besitzer-Einrichtung erhalten. Der Einrichtungsschlüssel verhindert, dass der erste beliebige Besucher die bisherigen Daten bekommt. Die Übernahme funktioniert auch nach einer regulären Registrierung und mit gleichen Profilnamen. Andere Accounts haben keinen Zugriff auf diese Daten. Der alte Supabase-Abgleich bleibt auf die Besitzer-Profile begrenzt.

**Vor Verwendung Server und Clients aktualisieren und den vorhandenen Datenordner sichern/behalten.** [ACCOUNTS.md](ACCOUNTS.md) beschreibt Besitzer-Schlüssel, Google-Einrichtung und Passwort-Wiederherstellung direkt am Server. Es gibt keine automatischen Bestätigungs- oder Rücksetz-E-Mails.

## Nachweise

| Prüfung | Ergebnis und Grenze |
|---|---|
| Server | Vollständige bestehende Suite bestanden; neue HTTP-Prüfung mit 26 abgewiesenen Zugriffsversuchen, Konto-/Profiltrennung, Kinderfiltern, PIN, Löschung, Logout und Passwortwechsel. Migration einer tatsächlich vorher gespeicherten alten SQLite-Profilstruktur, Fortschritt, Cloud-ID und Profilbild erhalten; nachträgliche Besitzer-Übernahme, Namenskollisionen, Kanalzusammenführung und Host-Passwortreset geprüft |
| Isolation | Gleichzeitige Requests mit getrennten Kanälen/Anzeigeeinstellungen; Web-/Expo-Push-Geräte, fremdes Abmelden, Gerätewechsel während einer laufenden Zustellung und alte Empfangsbestätigungen geprüft. Supabase-Test schließt fremde Profile und Wiederanlage gelöschter Profile aus |
| Google | RSA-Signaturen und Ansprüche, State/Proof-Bindung, PKCE, einmaliger Callback, explizite Passwortbestätigung bei gleicher E-Mail, neue Registrierung mit erneutem Server-Passwort und Wiederholungsabwehr getestet. Google-Netzwerk nachgebildet; keine echte Google-Anmeldung behauptet |
| Web/Desktop-Oberfläche | Account-Ablauf gegen echten HTTP-/SQLite-Testserver in 1440×900, 390×844 und 960×540 bestanden: Registrierung, Kinderprofil, falsches/richtiges Passwort, PIN, Bildauswahl/Zuschnitt, Löschen, Abmelden. Zusätzlich Besitzer-Übernahme und Löschen alter Anzeigeeinstellungen beim Accountwechsel einmal in Desktop-Größe geprüft |
| Gemeinsame Handy-/TV-Komponenten | Zwei Account-Abläufe gegen echten Testserver in der Browser-Simulation bestanden; bestehende 16 Bedienungsprüfungen bestanden. Die neue native Textknotenprüfung verhindert den im Emulator gefundenen Profil-Editor-Absturz |
| Player/Kanäle | 30 Unit-Tests einschließlich Desktop-Serverrouting; 35 Mobile-/Kanaltests; 15 bisherige Web-Player-/Kanalprüfungen bestanden. Die vollständige Mobile-Suite bestanden |
| Echte lokale Medienpipeline | HTTP, SQLite, FFprobe/FFmpeg und erzeugte 90-s-Clips: Direkt-MP4, HLS und fragmentiertes MP4 parallel; je zwei Vollbild-/Mini-Zyklen und acht Pause-/Seek-/Resume-Runden über 65–66 s. Dauer, dekodierte Frames, echtes 176×100-JPEG-Vorschaubild und getrennt gespeicherte Positionen geprüft. Ein vorheriger intermittierender Stillstand ist unten ausdrücklich dokumentiert |
| Windows | Produktionsbuild von EXE/MSI erfolgreich; Verbindungslokalität, Account-Header, Vorschauadresse und Übergabe des geschützten Streams an mpv zusätzlich als Routingregression geprüft. Keine Installation oder native Windows-Bedienung durchgeführt |
| Android | Getrennte signierte Mobile-/TV-Pakete, 3.6.0 / versionCode 21; Paketkennungen, vier ABIs und Signaturen geprüft. Nativer Mobile-Test im eigenen Android-35-Tablet-Emulator: gespeicherte Anmeldung nach Upgrade, Kinderprofil erstellen, Android-Fotoauswahl/Zuschnitt, PIN setzen, falsche PIN ablehnen, richtige PIN öffnen, Kinder-/Erwachsenenmediathek, geschütztes Video mit dekodiertem Testbild, Logout. Das ist kein physisches Handy und kein Android-TV-System |
| iOS | JavaScript-Export erfolgreich. Kein nativer iOS-Build oder echtes iPhone/iPad geprüft |

Die finale TV-APK wurde ebenfalls auf dem eigenen Android-35-Tablet-Emulator bei 960×540 gestartet: Server-Passwort, Registrierung eines zweiten Accounts, nur dessen eigenes Standardprofil, Auswahl mit D-Pad/OK, Logout, Anmeldung mit dem Handy-Account, dessen Bild/Kinderprofil/PIN, Kinderwahl mit D-Pad und Öffnen des Erwachsenenprofils mit PIN bestanden. Die native Fernbedienung wurde über Emulator-Tasten simuliert; eine echte TV-Fernbedienung und ein Android-TV-Betriebssystem sind damit nicht abgenommen.

Die Server-/Browserprüfungen verwenden ausschließlich eigene Testdaten. Signaturen/Providerantworten in OAuth- und Push-Tests sind isolierte Testdaten. Die Tests belegen weder produktive Cloud-Anbindung noch reale Push-Zustellung, mehrstündige UHD-Wiedergabe oder NAS-Kapazität. Logs und Emulatorbilder liegen im ignorierten `test-results` des Worktrees; reproduzierbare Tests liegen im Repository.

## Build-Herkunft und bekannte Grenzen

Windows-Anwendungsstand: `f9511e7`. Finale Mobile-APK: `ef3ec73`; finale TV-APK: `397dbc9` (identischer Mobile-/TV-Anwendungscode, danach nur serverseitige Erhaltung von Anzeigeeinstellungen). Die früheren Android-Kandidaten mit versionCode 20 werden nicht veröffentlicht. Der native Profil-Editor-Absturz aus Kandidat 20 wurde in [Issue #36](https://github.com/BastiLd/GHGFLIX/issues/36) erfasst und mit Build 21 nachgeprüft.

Im ersten belasteten Parallel-Wiedergabetest blieb Chromium-HLS nach Pause/Sprung/Fortsetzen bei 25.11 s stehen. HLS einzeln und der anschließende parallele Nachtest mit allen drei Wegen liefen durch. Die Ursache ist nicht belegt; der Befund bleibt mit Ablauf und zusätzlicher Zustandsdiagnose in [Issue #1](https://github.com/BastiLd/GHGFLIX/issues/1#issuecomment-6542637871) offen. Er wird nicht als behoben ausgegeben.

Echte Windows-, Handy-, Android-TV- und TV-Browser-Abnahme sowie Google-OAuth-Einrichtung/Live-Anmeldung bleiben erforderlich. [DEVICE_ACCEPTANCE.md](DEVICE_ACCEPTANCE.md) und [ACCOUNTS.md](ACCOUNTS.md) enthalten die Schritte. Optionale echte Push-Zustellung bleibt [Issue #30](https://github.com/BastiLd/GHGFLIX/issues/30). Veröffentlichung der Pakete/des Images bedeutet keine Installation auf dem NAS oder einem Nutzergerät.
