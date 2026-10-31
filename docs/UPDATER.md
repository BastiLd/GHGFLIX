# GitHub-Updates ab 3.6.2

## Website für WebHafen

`main` → erfolgreicher Workflow **Checks** → **Publish website for WebHafen** → Branch `web`, Ordner `site` → WebHafen prüft und installiert automatisch. Die [Einrichtungstabelle](WEBHAFEN_UND_UPDATES.md) enthält alle Felder.

Es werden nur gebaute öffentliche Dateien exportiert; Datenbanken, Schlüssel, Umgebungsdateien, Source Maps und symbolische Links werden abgewiesen. Der Build enthält seine Quellrevision. Eine veraltete CI-Ausführung überschreibt keine neuere `main`-Revision. Das erste WebHafen-Update muss einmal übernommen werden; anschließend gelten die eingeschalteten automatischen Updates und WebHafens Konfliktschutz.

Die Website prüft `build-info.json` ohne HTTP-Cache und zeigt Website und API-Version getrennt. Der Server-Mindeststand wird vor einem angebotenen Neuladen geprüft. Bei einem Fehler wird keine Aktualität behauptet. Es gibt keinen automatischen Neustart während einer Wiedergabe. Das Serverimage erhält dieselbe Quellrevision; ein NAS-Containerupdate bleibt ein eigener Vorgang.

## Windows

Tauri Updater mit verpflichtender Signaturprüfung, Downloadfortschritt und Neustart nach erfolgreicher Installation. MSI/NSIS bleiben über getrennte Manifestziele erhalten. Die erste Updater-Version muss einmal über die vorhandene App installiert werden. Danach genügt der Updateknopf in der App.

Quelle: `https://github.com/BastiLd/GHGFLIX/releases/latest/download/latest.json`. Es gibt keinen unsignierten Installationsfallback. Ein fehlendes Manifest, ein unterbrochener Download oder eine ungültige Signatur erzeugen einen sichtbaren Fehler. Hintergrundprüfungen sind abschaltbar; installiert wird nur durch den Nutzer.

Der Workflow **Build signed Windows update** kann manuell gestartet werden. Dann liefert er EXE, MSI, Signaturen und Manifest als Workflow-Artefakt. Beim Ereignis `release.published` ergänzt er einen bereits veröffentlichten stabilen Release desselben Versions-Tags; er erstellt keinen Release selbst. Version und Tag müssen übereinstimmen. Die Signaturen werden zusätzlich mit dem eingebetteten öffentlichen Schlüssel geprüft, einschließlich absichtlich veränderter Bytes, ohne Installer auszuführen.

GitHub Actions benötigt `TAURI_SIGNING_PRIVATE_KEY` (eingerichtet) und gegebenenfalls `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Der öffentliche Schlüssel steht in `src-tauri/tauri.conf.json`. Die lokale private Schlüsseldatei liegt außerhalb des Repositorys unter `%USERPROFILE%\.codex\ghgflix-signing\updater.key`, mit Zugriff nur für den Nutzer und SYSTEM. Diese Datei privat sichern und nicht löschen oder neu erzeugen: bestehende Installationen vertrauen dem zugehörigen öffentlichen Schlüssel. Keine Schlüssel in Releases, Issues oder Website-Ordner kopieren.

Lokales signiertes Bauen: `TAURI_SIGNING_PRIVATE_KEY` auf die Schlüsseldatei setzen und `npm run tauri build -- --bundles nsis,msi` ausführen. `scripts/rebuild-windows.ps1` erzeugt ohne gesetzten Schlüssel einen normalen lokalen Installer ohne Update-Signatur. Dieser ist kein veröffentlichbares automatisches Update.

## Grenzen

- Die Website-Veröffentlichung ist kein NAS-Containerupdate.
- Windows benötigt einen tatsächlich veröffentlichten signierten Release als Updatequelle; ein erfolgreicher lokaler Build allein reicht nicht.
- Android/TV behalten ihren vorhandenen APK-/Expo-Updateweg. Dieser Windows-Updater ändert keine nativen Android-Bestandteile.
- Browser-Simulation, Signaturprüfung und Build sind keine Prüfung einer echten Windows-Installation oder eines Nutzergeräts.

Technische Grundlage: [Tauri Updater – signierte Pakete und Update-Manifest](https://v2.tauri.app/plugin/updater/).
