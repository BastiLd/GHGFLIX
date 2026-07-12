# GHGFlix Server auf ZimaOS installieren

Dein eigener Plex/Jellyfin-Ersatz mit der GHGFlix-Oberfläche — läuft als
Docker-Container auf dem ZimaBoard/ZimaCube und streamt an Browser, Handy
(Expo-App oder PWA) und synchronisiert mit der PC-App.

## 1. Installation (copy & paste)

1. ZimaOS öffnen → **App Store** → oben rechts **„+“** → **Install a customized app**
2. Auf **Import** (Docker Compose) klicken
3. Den kompletten Inhalt von [`docker-compose.yml`](docker-compose.yml) einfügen
4. **Install** drücken — nichts anpassen nötig. Es werden automatisch **alle
   Platten** read-only eingebunden (`/DATA`-Speicherpool + externe Platten
   unter `/media`).

Danach im Browser öffnen: **`http://<zimaboard-ip>:8484`**

### Bibliotheken einrichten (mehrere Ordner/Platten — ohne Docker-Bearbeiten)

Welche Ordner Serien und welche Filme sind, entscheidest du **in der
GHGFlix-Weboberfläche**, nicht im docker-compose:

- **Am einfachsten:** ⚙️ Einstellungen → Bibliotheken → **„✨ Automatisch
  erkennen“**. Das durchsucht **alle** eingebundenen Platten und schlägt
  gefundene Film-/Serienordner vor (mit erkanntem Typ) — Häkchen setzen,
  übernehmen, fertig.
- **Manuell:** **„+ Ordner hinzufügen“** öffnet einen Ordner-Browser. Oben
  wählst du zuerst die **Platte/das Laufwerk** (alle eingebundenen Platten
  erscheinen dort), navigierst in den Ordner und wählst **„📺 Als
  Serien-Ordner“** oder **„🎬 Als Film-Ordner“**. Beliebig oft, für jede
  Platte/jeden Ordner.

Der Server scannt automatisch im Hintergrund; Fortschritt siehst du direkt im
Bibliotheken-Panel. Ordner wieder entfernen (🗑) nimmt nur den Eintrag aus
GHGFlix raus — deine Dateien auf der Platte bleiben unangetastet.

### Alle Platten sind automatisch sichtbar

Das gesamte ZimaOS-Dateisystem ist read-only unter `/host` eingebunden
(`- /:/host:ro` in der Compose). Dadurch findest du im Ordner-Browser **jede**
Platte und **jeden** Ordner — egal wo ZimaOS sie einhängt (`/DATA`, `/media`,
SMB-Freigaben usw.), mit den **echten** Ordnernamen. Du musst keine Pfade
raten und keine Platten einzeln mounten.

- System-Ordner (`proc`, `sys`, App-Daten …) werden automatisch ausgeblendet.
- „Automatisch erkennen“ durchsucht das Ganze und erkennt Film-/Serienordner
  unabhängig vom Namen (`Movies`, `Filme`, `Series`, `Serien`, `TV Shows` …).

Beim ersten Start scannt der Server die Bibliothek. TMDb-Key (für Poster und
Beschreibungen — derselbe Key wie in der PC-App) entweder in der Compose-Datei
bei `TMDB_API_KEY` eintragen oder später in der Web-Oberfläche unter
**⚙️ Einstellungen → Bibliotheken**.

## 2. Zugriff von unterwegs

Der Server ist unter beliebig vielen Adressen gleichzeitig nutzbar — in der
Web-App und Handy-App trägst du alle unter **Einstellungen → Verbindungen**
ein, und im Modus **„Automatisch“** wird immer die erste erreichbare gewählt
(zuhause → lokale IP, unterwegs → Tailscale/Domain). Manuell geht auch.

### Weg A: Tailscale (empfohlen, kein Portfreigabe-Gefummel)
1. Tailscale-App aus dem ZimaOS App Store installieren und anmelden
2. Tailscale auch auf Handy/Laptop installieren (gleiches Konto)
3. Adresse eintragen: `http://<zimaboard-tailscale-name>:8484`
   (z.B. `http://zimaboard.tail1234.ts.net:8484`)

### Weg B: Eigene Domain
1. Portfreigabe im Router **oder** Reverse-Proxy (z.B. Nginx Proxy Manager aus
   dem ZimaOS App Store) mit HTTPS auf Port 8484
2. Adresse eintragen: `https://flix.deinedomain.de`
3. **Wichtig:** In den Server-Einstellungen ein Passwort setzen
   (`GHGFLIX_PASSWORD` oder Web-UI → Einstellungen → Server)!

## App-Icon in ZimaOS

Für das **„Icon URL“**-Feld beim Installieren in ZimaOS die Adresse des
**Servers selbst** verwenden (funktioniert zuverlässig, weil der Server das
SVG mit dem richtigen Bildtyp ausliefert):

```
http://<zimaboard-ip>:8484/icon.svg
```

(z. B. `http://192.168.68.10:8484/icon.svg`)

> Ein `raw.githubusercontent.com`-Link funktioniert hier **nicht** — GitHub
> liefert SVGs als reinen Text aus, dann zeigt ZimaOS kein Bild.

## 3. Handy

- **PWA (sofort):** `http://<ip>:8484` im Handy-Browser öffnen → „Zum
  Startbildschirm hinzufügen“. Sieht aus wie eine App, spielt Videos ab,
  merkt sich den Fortschritt und wechselt die Server-Adresse automatisch.
- **Expo-App (nativ):** siehe [`../mobile/README.md`](../mobile/README.md)

## 4. Synchronisierung

- **Server = Quelle:** Fortschritt, Profile und „Weiterschauen“ liegen in
  SQLite im `ghgflix-data`-Volume. Alle Geräte, die sich mit dem Server
  verbinden, sind automatisch synchron.
- **PC-App:** In der GHGFlix-Windows-App unter *Einstellungen → GHGFlix-Server*
  die Server-Adresse eintragen und Sync aktivieren — der Fortschritt gleicht
  sich automatisch in beide Richtungen ab (auch die Staffel-/Folgen-Position).
- **Supabase (optional):** Unter *⚙️ Einstellungen → Supabase-Sync* URL +
  Service-Role-Key eintragen. „Senden“ und „Empfangen“ sind **einzeln**
  schaltbar, und mit **„Alles aus Supabase importieren“** holst du deine
  bestehenden Cloud-Daten einmalig komplett auf den Server.

## 5. Transcoding

Dateien, die der Browser direkt abspielen kann (MP4/H.264), werden 1:1
gestreamt (Direct Play, keine CPU-Last). Alles andere (MKV, HEVC/x265, …)
wandelt ffmpeg live in H.264/AAC um — auf schwachen Boards ggf. in den
Einstellungen des Players eine niedrigere Qualität wählen.

## 6. Updates (ohne Neuinstallation)

Du musst **nicht** neu installieren. Neue Version so einspielen — die Daten
(Bibliotheken, Gesehen-Stand) bleiben im `/DATA/AppData/ghgflix/data`-Ordner
erhalten:

- **ZimaOS App Store:** bei der GHGFlix-App auf **Update** / *Check for
  updates* — ZimaOS zieht das neue `latest`-Image und startet den Container neu.
- **Portainer / Docker:** Image neu ziehen und Container neu erstellen:
  `docker compose pull && docker compose up -d`.

Welche Version läuft, steht unten in **⚙️ Einstellungen** (bzw. unter
`http://<ip>:8484/api/ping`). Passt die Version nicht zur neuesten, wurde das
Image noch nicht neu gezogen.

## Alle Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `8484` | HTTP-Port |
| `BROWSE_ROOTS` | `/media,/DATA,/mnt` | Welche Mountpunkte der Ordner-Browser + Auto-Erkennung durchsuchen |
| `SHOWS_DIRS` / `MOVIES_DIRS` | – | Nur für den allerersten Start (zero-config): wird beim ersten Hochfahren einmalig als Bibliothek übernommen, falls der Pfad existiert. Danach verwaltest du alles in **Einstellungen → Bibliotheken**. |
| `DATA_DIR` | `/data` | Datenbank + Bild-Cache |
| `TMDB_API_KEY` | – | TMDb-Key für Metadaten |
| `TMDB_LANG` | `de-DE` | Sprache der Metadaten |
| `GHGFLIX_PASSWORD` | – | Login-Passwort (leer = offen) |
| `SCAN_INTERVAL_SEC` | `1800` | Automatischer Rescan |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | – | Cloud-Sync (optional) |
