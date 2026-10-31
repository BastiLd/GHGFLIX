# Besitzer-Einrichtung und Account-Buttons – 3.6.3

Behebt [Issue #39](https://github.com/BastiLd/GHGFLIX/issues/39): In 3.6.2 sprang „Ich bin der Serverbesitzer“ nach wenigen Sekunden zur Anmeldung zurück. Der Bibliotheks-Poller lief bereits vor der persönlichen Anmeldung; seine 401-Antwort setzte das Formular zurück. Die bisherige schnelle Account-Testfolge deckte diese Wartezeit nicht ab.

Die Bibliotheksabfrage beginnt jetzt nach der Profilauswahl und benötigt eine persönliche Sitzung. Abfragen laufen nicht parallel und haben ein Zeitlimit. Antworten einer früheren Server-/Account-Verbindung dürfen die neue Sitzung nicht zurücksetzen. Tatsächlich abgelaufene Sitzungen werden weiterhin abgemeldet.

„Neuen Account erstellen“, „Ich bin der Serverbesitzer“, „Zur Anmeldung“ und die Formularbestätigung haben erkennbare Flächen und Rahmen, einen kleinen Schatten, Druckeffekt, gleitenden Pfeil und eine kurze Klickwelle. Tastaturfokus, Touchflächen, deaktivierte Zustände und reduzierte Bewegung werden berücksichtigt.

## Prüfung

- Der neue Browser-Test reproduzierte den Rücksprung auf 3.6.2, bevor der Produktcode geändert wurde.
- 49 Frontend-Tests bestanden, einschließlich Poller ohne Account, langsamer/verspäteter Antworten und Sitzungsablauf.
- Sechs neue Browser-Prüfungen bestanden: Desktop 1440×900, Handy 390×844, TV 960×540, jeweils mit echter eigener temporärer Serverdatenbank. Mehrere Poll-Intervalle im Formular abgewartet; Eingaben erhalten; ungültiger Schlüssel, erfolgreiche Besitzeranlage, Profilauswahl und serverseitiger Sitzungsentzug geprüft. Reduzierte Bewegung separat geprüft.
- Bestehende Account-Browser-Suite: neun bestanden, sechs bewusste Wiederholungsausschlüsse. Einschließlich Kinderprofil/PIN/Bild, Accountwechsel, Passwortänderung und Desktop-Verbindungssimulation.
- TypeScript und produktiver Web-Build bestanden. Ansichten per Screenshot kontrolliert.
- Die neuen Browser-Prüfungen laufen künftig in GitHub Checks vor der Veröffentlichung von Website und Server-Image.

Diese Nachweise sind Browser-/Transport-Simulationen. Es wurde keine App auf einem echten Handy, TV oder Windows-Desktop installiert oder bedient. Keine Änderung an produktiven Accounts oder NAS-Daten.

## In ZimaOS übernehmen

In der bestehenden GHGFlix-App nach erfolgreicher Image-Veröffentlichung `ghcr.io/bastild/ghgflix-server:3.6.3` laden und den Container damit neu erstellen. Vorhandene Umgebungsvariablen und `/DATA/AppData/ghgflix/data:/data` beibehalten. Danach muss `/api/ping` Version `3.6.3` melden; die Website neu laden. Für den Webzugang ist keine Neuinstallation auf PC oder Handy nötig.

Die WebHafen-Website wird weiterhin aus Branch `web`, Ordner `site` veröffentlicht. Bei direktem Zugriff auf ZimaOS kommt die Website aus dem Server-Image. Eine neue native APK oder ein Windows-Installer gehört nicht zu diesem Web-/Server-Fix.
