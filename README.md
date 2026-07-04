# GHGFlix 🎬

Eine lokale Netflix-/Plex-/Jellyfin-artige Media-App. Wähle deine Film- und
Serienordner, GHGFlix erkennt automatisch per **TMDb** Filme, Serien, Staffeln
und Folgen, zeigt sie schön gruppiert an und spielt mit **mpv** praktisch jedes
Format ab. Login + Profile + Fortschritt werden optional über **Supabase**
PC-übergreifend synchronisiert.

Design: GHGFlix Rot/Schwarz im ZickZack-Stil.

---

## Tech-Stack

- **Tauri 2** (Rust) + **React 18 / TypeScript / Vite**
- **mpv** (eingebettet via `tauri-plugin-mpv`) – spielt MKV/HEVC/DTS … alles
- **SQLite** (lokale Bibliothek & Fortschritt) · **TMDb** (Metadaten)
- **Supabase** (optional: Auth, Profile, Sync) · **Tailwind CSS**

---

## Voraussetzungen (einmalig)

```powershell
winget install Rustlang.Rustup
winget install OpenJS.NodeJS.LTS
winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install shinchiro.mpv    # Video-Player (muss im PATH sein)
```

> Nach der mpv-Installation liegt die EXE meist unter `C:\Program Files\MPV Player\`.
> Dieser Ordner muss im **PATH** sein (sonst startet die Wiedergabe nicht). Alternativ
> kannst du den mpv-Pfad in den GHGFlix-Einstellungen direkt eintragen.

## Starten (Entwicklung)

```bash
npm install
npm run tauri dev
```

## Bauen (Release-EXE)

```bash
npm run tauri build
```

---

## Erste Schritte in der App

1. **Einstellungen → Bibliotheken**: Film- und/oder Serienordner hinzufügen.
2. **Einstellungen → TMDb**: kostenlosen API-Key von
   [themoviedb.org](https://www.themoviedb.org/settings/api) (v3 auth) eintragen.
3. **Jetzt scannen** klicken → GHGFlix liest die Ordner ein und lädt Metadaten.
4. Falsch erkannt? Auf einer Kachel/Folge das **3-Punkte-Menü → Identifizieren**
   öffnen, Titel suchen bzw. Staffel/Folge korrigieren.

### Ordnerstruktur (Empfehlung wie Plex/Jellyfin)

```
Serien/
  Breaking Bad (2008)/
    Season 01/
      Breaking Bad S01E01.mkv
      Breaking Bad S01E02.mkv
Filme/
  Inception (2010).mkv
```

Erkannt werden u. a. `S01E02`, `1x02`, `Staffel 1/Folge 2`, `Season 01`-Ordner
sowie `Titel (Jahr)` bei Filmen.

---

## Sync & Profile (optional, kostenlos)

1. Lege ein kostenloses Projekt auf [supabase.com](https://supabase.com) an.
2. Führe `supabase/schema.sql` im **SQL-Editor** deines Projekts aus.
3. Trage **Project URL** + **anon key** (Settings → API) in GHGFlix unter
   *Einstellungen → Konto & Sync* ein.
4. **Anmelden**, ein **Profil** wählen → Fortschritt wird hochgeladen und auf
   jedem PC, auf dem du dich anmeldest, fortgesetzt.

> Synchronisiert werden nur **Konto, Profile und Fortschritt** – nicht die
> Videodateien. Die Filme/Serien müssen auf jedem PC lokal vorliegen; die
> Zuordnung erfolgt über die TMDb-ID + Staffel/Folge.

---

## Projektstruktur

```
src/               React-Frontend (pages/, components/, lib/)
src-tauri/src/     Rust-Backend
  scanner.rs       Ordner scannen
  parser.rs        Dateinamen → Serie/Staffel/Folge/Film
  tmdb.rs          TMDb-Client
  db.rs            SQLite
  watcher.rs       Auto-Watcher (neue Dateien)
  commands.rs      an das Frontend exponierte Befehle
supabase/schema.sql  Datenbank-Schema für Sync
```
