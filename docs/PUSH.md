# Geräte-Push

Web Push ist optional und standardmäßig aus. In-App-Meldungen bleiben erhalten.
Unter Kanäle -> Gruppe -> Benachrichtigungen auf diesem Gerät kann der Nutzer
Push aktivieren oder wieder deaktivieren. Die Glocke je Kanal wird beachtet.

## Einrichtung

- Server-Abhängigkeiten installieren: `npm ci --prefix server`. Das Dockerfile erledigt dies im Image.
- `PUSH_CONTACT=mailto:admin@eigene-domain.example` (eigene gültige Kontaktadresse) oder eine eigene HTTPS-Kontaktseite als Server-Umgebungsvariable setzen.
- Die Web-App über HTTPS öffnen. Browser muss Service Worker, PushManager und Notifications unterstützen. Auf iOS/iPadOS kann die installierte Web-App erforderlich sein. Native Tauri-/Expo-Apps werden durch diesen Web-Push-Weg nicht angebunden; viele TV-Browser unterstützen Push nicht. Die Oberfläche erklärt diese Einschränkung.
- Erst beim Einschalten wird die Berechtigung angefragt. Ohne Berechtigung/Serverkonfiguration gibt es eine sichtbare Meldung.

Der Server erzeugt VAPID-Schlüssel einmalig und speichert sie getrennt von öffentlichen Einstellungen in SQLite (`push_keys`). Geräteanmeldungen liegen in `push_devices`; Datenvolume beim Update erhalten. Schlüssel/Anmeldungen sind Teil einer vollständigen Datenbanksicherung. Es gibt keine automatische Anmeldung und keinen zusätzlichen Drittanbieter-Account in der Anwendung.

Zugestellt wird bei neuen Beiträgen durch den periodischen und manuellen Abruf. Meldungen enthalten nur die Anzahl, keine privaten Titel. Ein Klick führt nach `/#/kanaele`. Der Worker speichert keine Medien/API-Antworten zwischen. Push-Endpunkte sind auf unterstützte HTTPS-Push-Anbieter begrenzt. Abgelaufene Anmeldungen (404/410) werden entfernt. Andere Zustellfehler werden ohne Endpunkt-/Schlüsselinhalt geloggt; es besteht keine Zustellgarantie und keine persistente Retry-Queue.

Verifiziert: Registrierung/Opt-in, stabile Schlüssel, Endpunktprüfung, Kanalpräferenzen, Transportaufruf und Entfernung abgelaufener Geräte mit lokalem Test und simuliertem Versand. Eine echte Provider-/Gerätezustellung wurde noch nicht durchgeführt.

Grundlagen: https://github.com/web-push-libs/web-push und https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe
