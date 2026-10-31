# Accounts und Profile ab 3.6.0

**Wo finde ich was?** Ab 3.6.1 öffnet das Profilbild **Account & Profile**. Dort stehen Profilbearbeitung (Bild, Kinderprofil, PIN), Account-Passwort und Abmeldung. Serveradresse und gemeinsames Passwort sind direkt im PC-Verbindungsformular erreichbar. [WebHafen-Felder und Updates ohne Deinstallation](WEBHAFEN_UND_UPDATES.md).

Reihenfolge auf Web, verbundenem Desktop, Handy und TV: Serveradresse → gemeinsames Server-Passwort → eigener Account → Profil. E-Mail/Passwort funktioniert ohne externen Anbieter. Die E-Mail ist zunächst nur der Anmeldename; es gibt keine Bestätigungs- oder Rücksetz-E-Mail. Ein Account-Passwort hat 10–128 Zeichen.

## Einmalige Einrichtung des Besitzers

1. Vor dem Serverupdate den bestehenden `/data`-Ordner einschließlich SQLite sichern. Die neue Version benötigt den Server 3.6.0 und aktuelle Clients. Alte Clients können private API-Aufrufe danach nicht mehr ohne Account ausführen.
2. Beim ersten Start entsteht `/data/account-setup-key` (bei anderem `DATA_DIR` dort). Den Inhalt nur am eigenen Server ablesen, beispielsweise mit `docker exec <Containername> cat /data/account-setup-key`.
3. Nach dem Server-Passwort „Ich bin der Serverbesitzer“ wählen, E-Mail, persönliches Passwort und diesen Schlüssel eingeben. Bereits regulär registriert? Unter „Profile“ → „Vorhandene Profile übernehmen“ denselben Schlüssel und das Account-Passwort verwenden.
4. Bestehende Profile behalten ihre IDs, Fortschritte, Favoriten und Bilder; bestehende Kanäle und Gruppen gehen an den Besitzer. Bei einer nachträglichen Übernahme bleiben neue Profile ebenfalls erhalten; doppelte Namen erhalten den Zusatz „(bisher …)“. Der Schlüssel wird nach erfolgreicher Übernahme gelöscht.

`GHGFLIX_ACCOUNT_SETUP_KEY` kann alternativ einen vorgegebenen Einrichtungsschlüssel setzen. Er berechtigt nur zur ersten Einrichtung; nach der Einrichtung aus der Konfiguration entfernen. Eine gewöhnliche Registrierung bekommt niemals die bisherigen Profile, auch wenn sie vor dem Besitzer erfolgt.

## Weitere Accounts, Profile und Kinder

- Wer das Server-Passwort kennt, darf einen eigenen leeren Account erstellen. Bei jeder neuen Registrierung wird es erneut abgefragt. Ein gespeicherter Serverzugang allein reicht dadurch nicht, um ein Kinderprofil durch einen neuen Erwachsenen-Account zu umgehen. `GHGFLIX_REGISTRATION=off` schaltet neue Registrierungen ab; die Besitzer-Einrichtung bleibt möglich.
- Pro Account bis zu zwölf Profile, eigene Namen und Bilder, Anlegen/Bearbeiten/Löschen mit dem persönlichen Account-Passwort. Bilder lassen sich in Web/Desktop und Handy zuschneiden. Auf dem TV führt ein QR-Code zur Profilverwaltung am Handy.
- Profile können eine optionale PIN aus genau sechs Ziffern erhalten. PIN und Passwort werden mit scrypt gehasht. Eine PIN wird bei der Auswahl dieses Profils geprüft.
- Kinderprofile haben eine Altersgrenze 0, 6, 12 oder 16. Unbekannte oder nicht eindeutig als FSK erkennbare Freigaben bleiben verborgen. Kanäle und externe Trailer bleiben im Kinderprofil verborgen. Die Sperre gilt auch für direkte API-, Stream-, Vorschau- und Untertitelaufrufe.
- Vom Kinderprofil zu einem ungeschützten Erwachsenenprofil oder einem Kinderprofil mit höherer Altersgrenze braucht es das Account-Passwort. Hat das Zielprofil eine PIN, muss diese eingegeben werden. Server- und Account-Passwörter sowie Erwachsenen-PINs gehören deshalb nur in die Hände der Erwachsenen.
- Die Mediathek ist serverweit gemeinsam; Profile, Fortschritte, Merkliste und Profilsperren gehören zum jeweiligen Account. Kanäle/Gruppen, Kanalbilder und Benachrichtigungen sind pro Account getrennt. Der bisherige Supabase-Abgleich bleibt auf die übernommenen Besitzer-Profile begrenzt.
- Das Account-Passwort lässt sich unter „Profile“ ändern. Andere Sitzungen und Push-Anmeldungen werden dabei widerrufen. Ein Account-Login läuft spätestens nach 30 Tagen ab und zusätzlich bei Widerruf des zugrunde liegenden Serverzugangs.

## Google optional aktivieren

In der Google Cloud Console einen OAuth-Client vom Typ **Webanwendung** anlegen. Als autorisierte Weiterleitungs-URI exakt die erreichbare HTTPS-Adresse `https://<dein-server>/api/accounts/google/callback` eintragen. Google verlangt je nach Veröffentlichung des OAuth-Projekts Testnutzer bzw. die Freigabe des Einwilligungsbildschirms. Die HTTPS-Adresse muss für das Gerät erreichbar sein, auf dem Google geöffnet wird; sie kann über das eigene VPN erreichbar sein.

Nur am Server setzen:

```text
GOOGLE_CLIENT_ID=<OAuth-Client-ID>
GOOGLE_CLIENT_SECRET=<OAuth-Client-Secret>
GOOGLE_REDIRECT_URI=https://<dein-server>/api/accounts/google/callback
```

Danach Server neu starten. Ohne vollständige Konfiguration zeigt die App den Einrichtungsstatus; sie bietet keine funktionslose Google-Anmeldung an. Web/Desktop/Handy öffnen Google außerhalb der App; der TV zeigt einen QR-Code. Anschließend in der ursprünglichen App die Anmeldung abschließen. Der Vorgang verfällt nach zehn Minuten bzw. bei einem Serverneustart.

Ein neues Google-Konto erhält einmalig ein persönliches Account-Passwort für Profilverwaltung/Kindersicherung und benötigt das Server-Passwort zur Registrierung. Bei gleicher E-Mail wie ein vorhandener Account muss zuerst dessen persönliches Passwort bestätigt werden. Eine gleiche E-Mail allein verknüpft keine Accounts. OAuth-Code, PKCE, State, Nonce, Signatur, Aussteller, Zielclient und bestätigte E-Mail werden geprüft. Grundlage: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

## Passwort vergessen

Der Serverbesitzer kann ein Account-Passwort ausschließlich direkt im Container zurücksetzen:

```sh
docker exec -it <Containername> node /app/src/account-admin.js reset-password <E-Mail>
```

Das neue Passwort verdeckt eingeben. Der Befehl widerruft die Account-Sitzungen und Geräte-Push-Anmeldungen. Er ist nicht über HTTP erreichbar und gibt das Passwort nicht aus. Automatisierung kann das Passwort über stdin zuführen; keine Passwörter in Kommandozeilenargumente oder Skripte schreiben.

## Desktop und bestehende lokale Daten

Ein mit dem Server verbundener Desktop verwendet dessen Mediathek und die ausgewählten Account-Profile direkt; mpv spielt den geschützten Serverstream. Der frühere globale Fortschrittsabgleich läuft dabei nicht mehr. Bestehende lokale Desktop-Daten werden weder gelöscht noch automatisch einem fremden Account zugeordnet. Der eigenständige lokale Desktop-Modus bleibt verfügbar. Bei einer unerreichbaren Serveradresse kann die Adresse direkt am Anmeldebildschirm geändert oder die lokale Bibliothek geöffnet werden.
