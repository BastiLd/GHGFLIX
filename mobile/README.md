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
