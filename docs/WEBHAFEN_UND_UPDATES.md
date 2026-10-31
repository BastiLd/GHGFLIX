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

GHGFlix liefert Website, Bilder und Video-Streams über seinen eigenen laufenden Server aus. WebHafen leitet den gesamten Website-Port an diesen Dienst weiter.

| Feld | Eintrag |
| --- | --- |
| Name | `GHGFLIX` |
| Typ | **Weiterleitung — ganzer Port geht an eine andere Anwendung** |
| API-Ziel | `192.168.68.10:8484` |
| Port | **Automatisch (nächster freier)**; bei vorhandener Website den zugeteilten freien Port beibehalten |
| Website aktiv | Ein |
| Zusätzlich unter `/s/ghgflix/` | Aus; dieser Alias ist nur für statische Websites |
| Eigene Adresse | Bestehende von WebHafen erzeugte Tailscale-Adresse beibehalten; sonst leer lassen oder über **Create Domain using Tailscale** erzeugen |
| GitHub · Website-Updates | Nicht verknüpfen; Konto, Repository, Website-Ordner, Dateiauswahl und Token bleiben leer. Der Branch `main` allein bewirkt nichts. |
| Automatisch nach Website-Updates suchen | Für diese Weiterleitung nicht benötigt; aus |
| Neue Website-Versionen automatisch installieren | Aus |

Bei einer schon angelegten statischen Website die **Grundeinstellungen** auf Weiterleitung und obiges API-Ziel ändern, dann **Einstellungen speichern**. Keine Website-Dateien hochladen und keinen Quellcode-Ordner als fertige Website auswählen. Die GitHub-Dateiübernahme baut keine GHGFlix-App und aktualisiert keinen laufenden Container.

Der Server ist im LAN direkt unter `http://192.168.68.10:8484/` erreichbar. Read-only-Prüfung am 31.10.2026 vor diesem Patch: HTTP 200, `/api/ping` meldet **2.8.0**, Passwortschutz an und noch keine Account-Fähigkeit. Dieser Stand muss zuerst aktualisiert werden. Der WebHafen-Proxy wird durch bloßes Ändern des API-Ziels keinen alten Server aktualisieren.

Tailscale bleibt privat: Die erzeugte Adresse funktioniert für berechtigte Geräte im Tailnet bzw. für freigegebene Nutzer mit Tailscale. Sie wird dadurch nicht automatisch eine öffentliche Internetseite. Eine konkrete Tailscale-Adresse ist aus den Screenshots nicht ablesbar; keine Adresse erfinden. Nach Einrichtung dieselbe HTTPS-Adresse auch als Serveradresse in PC/Handy/TV verwenden. Für Google muss die konfigurierte HTTPS-Callback-Adresse erreichbar sein; siehe Accounts-Anleitung.

## Aktualisieren ohne vorherige Deinstallation

### Server / Website auf ZimaOS

1. Bestehende GHGFlix-Datenablage sichern. Container-Konfiguration, Bibliotheks-/Daten-Volumes und vorhandene Passwörter/Schlüssel beibehalten; keinen leeren neuen Datenordner zuweisen.
2. In den Einstellungen der vorhandenen GHGFlix-App das Image auf `ghcr.io/bastild/ghgflix-server:3.6.1` stellen und das neue Image laden/den Container damit neu erstellen lassen. Das genaue ZimaOS-Menü hängt von der installierten Version ab. Ein bloßer Neustart des alten Containers lädt kein neues Image.
3. `http://192.168.68.10:8484/api/ping` aufrufen: Version **3.6.1** und `accounts: true` müssen sichtbar sein. Erst dann ist der Server tatsächlich aktualisiert.
4. Website neu laden, Server-Passwort eingeben und den Besitzer-Account mit dem Einrichtungsschlüssel anlegen. Danach WebHafen-Weiterleitung testen.

Die Veröffentlichung eines Images auf GitHub installiert es nicht automatisch auf dem NAS. In dieser Änderung wird der laufende Nutzer-Server nicht verändert.

### Windows

Die neue `GHGFlix_3.6.1_x64-setup.exe` aus den Releases ausführen und über die vorhandene Installation installieren. Vorher GHGFlix schließen. Möglichst denselben Installationsweg wie bisher benutzen (EXE oder MSI). Nicht vorher deinstallieren oder die App-Daten löschen. Unter **Einstellungen → Allgemein → Über GHGFlix & Updates** findest du Update-Prüfung und **Aktuelle Downloads öffnen**. Ein vollautomatischer Windows-Updater ist derzeit nicht eingebaut.

### Android-Handy und Android TV

`GHGFlix-Mobile-3.6.1.apk` für die Handy-App bzw. `GHGFlix-TV-3.6.1.apk` für die TV-App öffnen und **Aktualisieren** bestätigen. Nicht deinstallieren; nicht zwischen Handy- und TV-Paket wechseln. Updates benötigen dieselbe Paketkennung/Signatur und einen höheren Versionscode. Die offiziellen 3.6.1-Pakete verwenden Code 22; 3.6.0 verwendete 21. Bei einer alten selbstgebauten APK mit anderer Signatur zuerst die Daten sichern und den Installationsweg klären.

Die Apps enthalten Expo Updates: veröffentlichte, zur installierten nativen Version passende Oberflächenkorrekturen können beim Start heruntergeladen und bei einem weiteren Neustart verwendet werden. Das gilt nur, wenn tatsächlich ein passendes Update im Gerätekanal veröffentlicht wurde; neue native Funktionen benötigen weiterhin eine APK. Der alte Server-APK-Button liefert ausschließlich die Handy-App und wird für die TV-App nicht verwendet. Die neuen Einstellungen verlinken zusätzlich die aktuellen Downloads.

Grundlagen: [Android: Bedingungen für App-Updates](https://developer.android.com/google/play/app-updates), [Expo: Update-Download und Start](https://docs.expo.dev/eas-update/download-updates/).

### Browser / iPhone-Web-App

Nach dem Serverupdate die Seite neu laden bzw. die Web-App schließen und öffnen. Keine APK und keine erneute Installation nötig. Diese Aussage betrifft die Web-App; ein nativer iOS-Build wurde hier nicht veröffentlicht.
