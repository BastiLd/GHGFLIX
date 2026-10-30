# Geräte-Push

Web Push ist optional und standardmäßig aus. In-App-Meldungen bleiben erhalten.
Unter Kanäle -> Gruppe -> Benachrichtigungen auf diesem Gerät kann der Nutzer
Push aktivieren oder wieder deaktivieren. Die Glocke je Kanal wird beachtet.

## Einrichtung

- Server-Abhängigkeiten installieren: `npm ci --prefix server`. Das Dockerfile erledigt dies im Image.
- `PUSH_CONTACT=mailto:admin@eigene-domain.example` (eigene gültige Kontaktadresse) oder eine eigene HTTPS-Kontaktseite als Server-Umgebungsvariable setzen.
- Die Web-App über HTTPS öffnen. Browser muss Service Worker, PushManager und Notifications unterstützen. Auf iOS/iPadOS kann die installierte Web-App erforderlich sein. Native Tauri-/Expo-Apps werden durch diesen Web-Push-Weg nicht angebunden; die Expo-App besitzt den unten beschriebenen eigenen Weg. Viele TV-Browser unterstützen Push nicht.
- Erst beim Einschalten wird die Berechtigung angefragt. Ohne Berechtigung/Serverkonfiguration gibt es eine sichtbare Meldung.

Der Server erzeugt VAPID-Schlüssel einmalig und speichert sie getrennt von öffentlichen Einstellungen in SQLite (`push_keys`). Geräteanmeldungen liegen in `push_devices`; Datenvolume beim Update erhalten. Schlüssel/Anmeldungen sind Teil einer vollständigen Datenbanksicherung. Es gibt keine automatische Anmeldung und keinen zusätzlichen Drittanbieter-Account in der Anwendung.

Zugestellt wird bei neuen Beiträgen durch den periodischen und manuellen Abruf. Meldungen enthalten nur die Anzahl, keine privaten Titel. Ein Klick führt nach `/#/kanaele`. Der Worker speichert keine Medien/API-Antworten zwischen. Push-Endpunkte sind auf unterstützte HTTPS-Push-Anbieter begrenzt. Abgelaufene Anmeldungen (404/410) werden entfernt. Andere Zustellfehler werden ohne Endpunkt-/Schlüsselinhalt geloggt; es besteht keine Zustellgarantie und keine persistente Retry-Queue.

Verifiziert: Registrierung/Opt-in, stabile Schlüssel, Endpunktprüfung, Kanalpräferenzen, Transportaufruf und Entfernung abgelaufener Geräte mit lokalem Test und simuliertem Versand. Eine echte Provider-/Gerätezustellung wurde noch nicht durchgeführt.

Grundlagen: https://github.com/web-push-libs/web-push und https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe

## Wiederherstellen einer Geräteanmeldung

Die Anzeige vergleicht den lokalen Browserstatus mit dem Servereintrag und dem aktuellen öffentlichen VAPID-Schlüssel. Nach Datenbank-/Schlüsselwechsel oder abgelaufener Anmeldung wird eine Erneuerung angeboten. Sie wird erst nach einem ausdrücklichen Einschalt-Klick durchgeführt. Ein Serverausfall zeigt einen unbekannten Status mit erneutem Prüfversuch. Beim Ausschalten wird zuerst die Serveranmeldung entfernt; scheitert danach das Aufräumen im Browser, meldet die Oberfläche diesen Unterschied.

Technische Grundlage der Schlüsselbindung: [PushSubscription.options](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription/options) und [Push API](https://w3c.github.io/push-api/index.html). Validiert mit sieben UI-Komponententests und Server-Datenbanktests; weiterhin keine echte Providerzustellung.

## Native In-App-Meldungen

Die Expo-App zeigt neue Beiträge im Kanalbereich und als ungelesene Anzahl in der Navigation. Bei aktiver App wird der Server alle 60 Sekunden abgefragt, nach Bearbeitungen zusätzlich aktualisiert. Hintergrundzustand, Serverwechsel und veraltete Antworten werden berücksichtigt. Das ist kein Geräte-Push: es gibt dadurch keine Zustellung bei geschlossener App und keine Betriebssystem-Berechtigungsanfrage. Die Kanal-Glocke wird für die vorhandene Server-Push-Präferenz gespeichert; sie aktiviert keine native Push-Anbindung.

## Native Geräte-Push für Android und iOS

Die native App bietet unter Kanäle einen zusätzlichen Geräte-Opt-in. Beim Start/Öffnen dieser Ansicht werden weder Berechtigung noch Push-Token angefragt. Erst „Geräte-Push einschalten“ fragt nach der OS-Berechtigung und registriert das Gerät. Eine aktivierte Kanal-Glocke allein reicht nicht aus. Unterstützt sind entsprechend konfigurierte Android-/iOS-App-Builds; Android TV und die Tauri-Desktop-App haben keine native Push-Anbindung. Dort bleiben In-App-Meldungen bzw. die unterstützte HTTPS-Web-App verfügbar.

### Einrichtung durch den Betreiber

1. FCM-v1-Zugang für Android bzw. APNs-Zugang für iOS beim verwendeten EAS-Projekt einrichten. Aktuelle Projekt-ID aus `mobile/app.json`: `b14ed30d-3ecc-4465-ac79-7988b90ab0d8`. Die Zugangsdaten gehören in die Provider-/EAS-Konfiguration, nicht ins Repository oder in den Chat.
2. Android: `GOOGLE_SERVICES_JSON` als Pfad zur passenden Firebase-App-Konfiguration setzen (lokaler Dateipfad oder EAS-Datei-Umgebungsvariable). `mobile/app.config.js` übernimmt diesen Pfad als `android.googleServicesFile`. Android-Paket und iOS-Bundle-ID sind `com.bastild.ghgflix`. Ohne entsprechende Konfiguration kann die App gebaut werden, aber keine erfolgreiche Geräteanmeldung behaupten.
3. Neuen nativen Build erstellen: `expo-notifications` erfordert **runtimeVersion 3**, Android **versionCode 17**. Ein JavaScript-OTA-Update an runtimeVersion 2 reicht nicht. iOS benötigt einen passenden signierten nativen Build.
4. Am Server `EXPO_PUSH_ENABLED=1` und `EXPO_PUSH_PROJECT_ID` auf dieselbe EAS-Projekt-ID setzen. Wenn Expo-Push-Zugriffsschutz verwendet wird, zusätzlich `EXPO_PUSH_ACCESS_TOKEN` als Servergeheimnis konfigurieren. Diese Werte werden nicht automatisch aus einer anderen Umgebung übernommen oder produktiv aktiviert. Web-Push mit `PUSH_CONTACT` kann unabhängig davon betrieben werden.
5. Auf einem unterstützten Gerät bewusst einschalten. Die OS-App-Berechtigung und auf Android der Kanal „Neue Kanalbeiträge“ müssen aktiviert sein. Die Oberfläche zeigt eine gesperrte Berechtigung, fehlende Einrichtung oder fehlgeschlagene Tokenabfrage und bietet Abmelden, Erneuern und erneute Statusprüfung.

Grundlagen: [Expo-Push-Einrichtung](https://docs.expo.dev/push-notifications/push-notifications-setup/), [Zustellung und Zustellbelege](https://docs.expo.dev/push-notifications/sending-notifications/). Die verwendeten Client-Aufrufe wurden zusätzlich gegen die installierten `expo-notifications`-0.32.17-Typen geprüft.

### Zustellung und Datenbestand

Der Server speichert Geräte getrennt in `native_push_devices` und ausstehende Belege in `native_push_receipts`. Bestehende Bibliothek, Gruppen, Fortschritte und Web-Push-Anmeldungen bleiben erhalten. Pro Server sind höchstens 100 Geräte registriert; Token-Erneuerung ersetzt alte Einträge atomar. Eine verlorene Registrierungsantwort lässt lokal die nötigen Token zum Prüfen und Abmelden erhalten. Bei fehlgeschlagener Server-Abmeldung wird die lokale Anmeldung nicht verworfen.

Neue Beiträge gehen nur für aktivierte Kanäle an registrierte Geräte. An Expo werden Geräte-Token, die Anzahl neuer Beiträge und eine interne Server-ID übertragen, keine Film-/Beitragstitel, Zugangsschlüssel oder Serveradresse. Ein Benachrichtigungsklick öffnet die Kanäle ausschließlich beim dazugehörigen aktuell verbundenen Server. Im Vordergrund bleibt die In-App-Anzeige maßgeblich.

Ein angenommenes Expo-Ticket ist noch keine bestätigte Geräteanzeige. Ausstehende Belege werden alle fünf Minuten abgefragt, frühestens 15 Minuten nach dem Versand; nach 24 Stunden werden alte Belege entfernt. `DeviceNotRegistered` entfernt die ungültige Anmeldung. Netzwerk-/Providerfehler geben keine falsche Zustellbestätigung. Es gibt keine persistente Versand-Wiederholungsqueue und keine Zustellgarantie.

Verifiziert werden Konfiguration/Opt-in, gesperrte Berechtigungen, Tokenwechsel, verlorene Antworten, Kanalpräferenzen, Belege und abgelaufene Geräte mit Tests und ersetztem Providertransport. **Echte Expo-/FCM-/APNs-Zustellung ist noch nicht abgenommen; lokale Builds ohne Providerdaten sind dafür kein Nachweis.**
