# GHGFlix: Zugang, WebHafen und Updates

## Account und Profile

Ab 3.6.1 öffnet das Profilbild **Account & Profile**. Am PC ist es unten links, auf dem Handy oben rechts, am TV unten in der Seitenleiste. In den Einstellungen gibt es ebenfalls einen direkten Verweis.

- **Dein Account** zeigt deine angemeldete E-Mail. Dort stehen **Account-Passwort ändern** und **Account abmelden**. Nach der Abmeldung kannst du dich mit E-Mail/Passwort oder eingerichtetem Google-Zugang anmelden oder einen neuen Account erstellen.
- **Deine Profile → Bearbeiten** enthält Name, Bild, Kinderprofil/Altersgrenze und optionale sechsstellige PIN. Änderungen werden mit dem Account-Passwort bestätigt. Ein Profil kann dort auch gelöscht werden; das letzte Profil bleibt erhalten.
- Das Account-Passwort hat mindestens zehn Zeichen. Beim Ändern wird das neue Passwort zweimal eingegeben; andere Account-Sitzungen werden abgemeldet.
- Die Anzeige-Schaltfläche in Web/PC zeigt nur ein gerade eingetipptes Passwort. Gespeicherte Passwörter/PINs sind gehasht und nicht auslesbar.
- Der eigenständige lokale PC-Modus ist kein Server-Account. Unter **Account & Profile → Mit Server verbinden und anmelden** stehen Serveradresse und Server-Passwort direkt bereit. Lokale Daten bleiben erhalten.

Das **gemeinsame Server-Passwort** setzt der Besitzer in ZimaOS in den Umgebungsvariablen des bestehenden GHGFlix-Containers: `GHGFLIX_PASSWORD`. Dieses Passwort öffnet den Serverzugang; es ist nicht das persönliche Account-Passwort. Container nach einer Änderung mit derselben Datenablage neu erstellen/starten. Kein Passwort in GitHub oder in das WebHafen-API-Ziel schreiben.

Einmalige Besitzer-Einrichtung und optionales Google: [Accounts](ACCOUNTS.md). Der Besitzer-Schlüssel liegt nach dem Serverupdate im Container in `/data/account-setup-key`. Bereits bestehende Profile werden nur mit diesem Schlüssel übernommen.

## Die WebHafen-Felder aus dem Nutzerbericht

Ab 3.6.2 kann WebHafen die **fertig gebaute Website automatisch aus GitHub** laden. Erfolgreiche Prüfungen des Quellbranches `main` veröffentlichen ausschließlich die öffentlichen Website-Dateien im Branch `web`, Ordner `site`. WebHafen liefert diese Dateien aus und leitet `/api/` an den bestehenden GHGFlix-Server weiter. Persönliche Daten, Passwörter, Bibliothek und Filme werden nicht auf GitHub kopiert.

| Feld | Eintrag |
| --- | --- |
| Name | `GHGFLIX` |
| Typ | **Statisch — HTML/CSS/JS** |
| API-Ziel | `192.168.68.10:8484` |
| Port | **Automatisch (nächster freier)**; bei vorhandener Website den zugeteilten freien Port beibehalten |
| Website aktiv | Ein |
| Zusätzlich unter `/s/ghgflix/` | Aus; GHGFlix verwendet den eigenen Website-Port/die eigene Adresse mit `/api/` |
| Eigene Adresse | Bestehende von WebHafen erzeugte Tailscale-Adresse beibehalten; sonst leer lassen oder über **Create Domain using Tailscale** erzeugen |
| GitHub-Konto / Organisation | `BastiLd` |
| Repository | `GHGFLIX` |
| Branch | `web` |
| Website-Ordner im Repository | `site` |
| Dateien / Unterordner innerhalb des Website-Ordners | Leer lassen = gesamter Ordner `site` |
| GitHub-Token | Leer lassen; das Repository ist öffentlich |
| Automatisch nach Website-Updates suchen | **Ein** |
| Prüfintervall | **5 Minuten** (15 Minuten sind ebenfalls möglich) |
| Neue Website-Versionen automatisch installieren | **Ein** |

1. Den GHGFlix-Server einmalig mindestens auf **3.6.2** aktualisieren; Datenablage und Konfiguration erhalten. Das stellt auch die neuen Proxy-Wege für TV-Kopplung und APK-Downloads bereit.
2. In WebHafen **Grundeinstellungen → Statisch**, API-Ziel wie oben, **Einstellungen speichern**.
3. Obige GitHub-Felder eintragen, **Verbindung speichern & prüfen**, danach **Änderungen ansehen**.
4. Das **erste Update einmal manuell übernehmen**; falls WebHafen nach dem Ersetzen seiner Platzhalter-Datei fragt, die angezeigte Vorschau prüfen und bestätigen. Erst nach dieser Erstübernahme installiert WebHafen weitere Versionen automatisch.
5. Im Status muss eine installierte GitHub-Revision erscheinen. Website öffnen und `/api/ping` prüfen. Danach werden neue erfolgreiche Builds innerhalb des gewählten Intervalls übernommen. Bei lokalen Dateikonflikten hält WebHafen an und zeigt den Fehler; seine Rücksicherung bleibt nutzbar.

`main` enthält Quellcode und wird nicht direkt als Website importiert. Der Branch `web` enthält die lauffähige Ausgabe einschließlich `index.html`, Assets und `build-info.json`. Ein geöffneter Browser zeigt bei einem neuen Build einen Updatehinweis; **Website neu laden** übernimmt ihn ohne Abmeldung. Laufende Wiedergabe wird nicht automatisch unterbrochen.

**Server-Updates sind getrennt:** GitHub baut nach erfolgreichen Prüfungen zusätzlich `ghcr.io/bastild/ghgflix-server:latest`. WebHafens Datei-Updater startet keinen Docker-Container neu. Deshalb aktualisiert die Einstellung automatisch die Website, nicht den Serverdienst auf dem NAS. Falls eine zukünftige Website eine neuere API benötigt, wird das als notwendiges Serverupdate angezeigt.

Der Server ist im LAN direkt unter `http://192.168.68.10:8484/` erreichbar. Read-only-Prüfung am 31.10.2026 vor diesem Patch: HTTP 200, `/api/ping` meldet **2.8.0**, Passwortschutz an und noch keine Account-Fähigkeit. Dieser Stand muss zuerst aktualisiert werden. Der WebHafen-Proxy wird durch bloßes Ändern des API-Ziels keinen alten Server aktualisieren.

Tailscale bleibt privat: Die erzeugte Adresse funktioniert für berechtigte Geräte im Tailnet bzw. für freigegebene Nutzer mit Tailscale. Sie wird dadurch nicht automatisch eine öffentliche Internetseite. Eine konkrete Tailscale-Adresse ist aus den Screenshots nicht ablesbar; keine Adresse erfinden. Nach Einrichtung dieselbe HTTPS-Adresse auch als Serveradresse in PC/Handy/TV verwenden. Für Google muss die konfigurierte HTTPS-Callback-Adresse erreichbar sein; siehe Accounts-Anleitung.

## Aktualisieren ohne vorherige Deinstallation

### Server / Website auf ZimaOS

1. Bestehende GHGFlix-Datenablage sichern. Container-Konfiguration, Bibliotheks-/Daten-Volumes und vorhandene Passwörter/Schlüssel beibehalten; keinen leeren neuen Datenordner zuweisen.
2. In den Einstellungen der vorhandenen GHGFlix-App das Image auf `ghcr.io/bastild/ghgflix-server:3.6.2` stellen und das neue Image laden/den Container damit neu erstellen lassen. Das genaue ZimaOS-Menü hängt von der installierten Version ab. Ein bloßer Neustart des alten Containers lädt kein neues Image.
3. `http://192.168.68.10:8484/api/ping` aufrufen: Version **3.6.2** und `accounts: true` müssen sichtbar sein. Erst dann ist der Server tatsächlich aktualisiert.
4. Website neu laden, Server-Passwort eingeben und den Besitzer-Account mit dem Einrichtungsschlüssel anlegen. Danach WebHafen-Weiterleitung testen.

Die Veröffentlichung eines Images auf GitHub installiert es nicht automatisch auf dem NAS. In dieser Änderung wird der laufende Nutzer-Server nicht verändert.

### Windows

Die Version **3.6.2 mit Updater einmal über die vorhandene Installation installieren**. Vorher GHGFlix schließen; denselben Installationsweg wie bisher benutzen (EXE oder MSI), nicht vorher deinstallieren oder App-Daten löschen. Danach: **Einstellungen → Allgemein → Über GHGFlix & Updates → Auf Updates prüfen → Herunterladen & aktualisieren**. Auch persönliche Accounts haben diese Updatefunktionen in ihren Einstellungen.

Bei aktivierter automatischer Prüfung wird nach dem Anmelden und während der Nutzung regelmäßig geprüft. Installation/Neustart erfolgen erst nach dem Klick; Player und Mini-Player müssen vorher geschlossen werden. Der Updater prüft signierte Pakete und verwendet für MSI-/EXE-Installationen den passenden Installer. Eine nicht erreichbare Updatequelle wird als Fehler angezeigt, nicht als „aktuell“.

Die automatische Installation benötigt eine veröffentlichte GitHub-Version mit `latest.json` und passenden signierten Installern. Der Workflow **Build signed Windows update** erzeugt diese beim Veröffentlichen eines Releases; manuelles Starten erzeugt zunächst nur herunterladbare Workflow-Artefakte und keinen Release. Ein vorhandener alter Release ohne `latest.json` ist noch keine funktionierende Updatequelle. Details und Schlüsselverwaltung: [Updater](UPDATER.md).

### Android-Handy und Android TV

`GHGFlix-Mobile-3.6.1.apk` für die Handy-App bzw. `GHGFlix-TV-3.6.1.apk` für die TV-App öffnen und **Aktualisieren** bestätigen. Nicht deinstallieren; nicht zwischen Handy- und TV-Paket wechseln. Updates benötigen dieselbe Paketkennung/Signatur und einen höheren Versionscode. Die offiziellen 3.6.1-Pakete verwenden Code 22; 3.6.0 verwendete 21. Bei einer alten selbstgebauten APK mit anderer Signatur zuerst die Daten sichern und den Installationsweg klären.

Die Apps enthalten Expo Updates: veröffentlichte, zur installierten nativen Version passende Oberflächenkorrekturen können beim Start heruntergeladen und bei einem weiteren Neustart verwendet werden. Das gilt nur, wenn tatsächlich ein passendes Update im Gerätekanal veröffentlicht wurde; neue native Funktionen benötigen weiterhin eine APK. Der alte Server-APK-Button liefert ausschließlich die Handy-App und wird für die TV-App nicht verwendet. Die neuen Einstellungen verlinken zusätzlich die aktuellen Downloads.

Grundlagen: [Android: Bedingungen für App-Updates](https://developer.android.com/google/play/app-updates), [Expo: Update-Download und Start](https://docs.expo.dev/eas-update/download-updates/).

### Browser / iPhone-Web-App

Nach dem automatischen WebHafen-Dateiupdate **Website neu laden** bzw. die Web-App schließen und öffnen. Keine APK und keine erneute Installation nötig. Bei direktem Zugriff auf den NAS-Port wird die im Serverimage enthaltene Website verwendet; dort erfolgt ihr Update weiterhin mit dem Container. Diese Aussage betrifft die Web-App; ein nativer iOS-Build wurde hier nicht veröffentlicht.
