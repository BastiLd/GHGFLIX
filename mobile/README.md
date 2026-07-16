# GHGFlix Handy-App (Expo Go)

Native App für den GHGFlix-Server (ZimaOS) — Bibliothek, Staffeln, nativer
Videoplayer, Fortschritts-Sync und automatischer Wechsel zwischen
Lokal/Domain/Tailscale.

## Starten (mit Expo Go)

1. **Expo Go** aus dem App Store / Play Store aufs Handy laden
2. Auf dem PC (einmalig `Node.js` installiert):
   ```
   cd mobile
   npm install
   npx expo start
   ```
3. Den QR-Code mit dem Handy scannen (Android: in Expo Go, iPhone: Kamera)
4. In der App die Server-Adresse(n) eintragen, z.B.:
   - `http://192.168.1.50:8484` (Zuhause — als erste eintragen!)
   - `http://zimaboard.tail1234.ts.net:8484` (Tailscale)
   - `https://flix.meinedomain.de` (Domain)

Bei **„Automatisch wechseln“** nimmt die App immer die erste Adresse, die
antwortet — zuhause also die schnelle lokale IP, unterwegs Tailscale/Domain,
ohne dass du etwas umstellen musst. Manuell geht über den Schalter.

> Tipp: Handy und PC müssen beim Expo-Start im gleichen WLAN sein.
> Alternative ohne Expo: einfach `http://<server-ip>:8484` im Handy-Browser
> öffnen und „Zum Startbildschirm hinzufügen“ — die Web-App ist voll
> handy-tauglich (PWA).

## Funktionen in der App

- **Weiterschauen / Meine Liste** auf der Startseite (Herz ♥ auf jeder
  Detailseite fügt hinzu/entfernt — synchron mit Desktop & Web)
- **Gesehen-Status:** Folge in der Liste **gedrückt halten** = als
  gesehen/ungesehen markieren; bei Filmen gibt es einen eigenen Button
- Fortschritt wird automatisch alle 10 s an den Server gemeldet —
  alle anderen Geräte sehen ihn beim nächsten Abruf
- Server-Adressen dürfen ohne `http://` eingetippt werden — wird ergänzt

## Eigene APK bauen (ohne Play Store, auch für Fire TV/Android TV)

Einmalig: kostenloses Konto auf https://expo.dev, dann:

```
cd mobile
npm install
npx eas-cli build --platform android --profile preview
```

Beim ersten Mal legt `eas` die Build-Konfiguration an (`eas.json`,
Profil `preview` → APK statt AAB wählen). Der Build läuft in der
Expo-Cloud; am Ende gibt es einen Download-Link zur fertigen `GHGFlix.apk`.
Installation siehe `../tv/README.md` (gleiche APK läuft auf Handy und TV).

## Sicherheitshinweis (MOB-033)

`usesCleartextTraffic`/`NSAllowsArbitraryLoads` sind bewusst offen: Der
Server läuft im Heimnetz unter einer **nicht vorhersagbaren LAN-IP ohne
HTTPS** (`http://192.168.x.x:8484`) — mit strikter Transport-Security wäre
keine Verbindung möglich. Schutz kommt stattdessen vom Server-Passwort
(`GHGFLIX_PASSWORD`) und davon, dass der Server nur im LAN/Tailscale
erreichbar ist. Bei Zugriff über eine öffentliche Domain immer HTTPS
(Reverse Proxy) verwenden.
