# GHGFlix 🎬⚡

Deine **lokale Netflix-Alternative** für Windows — im roten ZickZack-Look. GHGFlix scannt deine Film-
und Serienordner, holt Poster, Beschreibungen, Altersfreigaben und Episodendaten von TMDb und spielt
alles butterweich über den eingebauten mpv-Player ab.

![Tauri 2](https://img.shields.io/badge/Tauri-2-blue) ![React 19](https://img.shields.io/badge/React-19-61dafb) ![Rust](https://img.shields.io/badge/Rust-stable-orange)

## ✨ Highlights

- **Bibliothek wie bei Netflix**: Reihen, großes Titelbild, Weiterschauen, Meine Liste, Genre-Reihen, „Neu hinzugefügt", „Top bewertet", „Zuletzt gesehen"
- **Mini-Player wie YouTube**: Zurück-Knopf im Player → Video läuft klein unten rechts weiter, während du stöberst
- **Warteschlange**: Filme, einzelne Folgen oder ganze (Rest-)Staffeln als *ein* Eintrag vormerken
- **mpv-Wiedergabe**: Hardware-Dekodierung, Kapitel, Untertitel, Audiospuren, Geschwindigkeit, Screenshots, Bild-im-Bild
- **Intro überspringen**: per Kapitel, Audio-Erkennung, oder einfach selbst markieren (Rechtsklick im Player)
- **Schlau beim Erkennen**: TMDb-Auto-Zuordnung (nur Buchstaben, Release-Müll stört nicht), dauerhafte manuelle Zuordnungen, fortlaufende Folgen-Zuordnung („diese Datei ist S01E01, der Rest folgt automatisch")
- **Nichts geht verloren**: Gesehen-Stand & Favoriten überleben sogar „Bibliothek neu aufbauen" (Verknüpfung über Dateipfad *und* TMDb), wöchentliches Auto-Backup, Export/Import als JSON
- **Alles einstellbar**: ~60 Einstellungen — Kartengröße, Animationen, Startseiten-Reihen, Scroll-Verhalten, Kindersicherung (FSK), Akzentfarbe, Maskottchen u.v.m.
- **Optional**: Supabase-Sync des Fortschritts zwischen mehreren PCs
- **GHGFlix Server (ZimaOS/Docker)**: dieselbe Oberfläche 1:1 im Browser & am Handy — der Server streamt (Direct Play oder Live-Transcode), PC-App/Handy/Browser teilen sich automatisch den Stand. Siehe [`server/README-ZimaOS.md`](server/README-ZimaOS.md)

## 🚀 Installation (Nutzer)

1. **GHGFlix installieren**: den neuesten Installer aus den [Releases](https://github.com/BastiLd/GHGFLIX/releases) laden
   (`GHGFlix_x.y.z_x64-setup.exe`) und ausführen — oder die portable `ghgflix.exe` direkt starten.
2. **mpv installieren** (Wiedergabe): `winget install mpv` — GHGFlix findet es automatisch.
3. **ffmpeg installieren** (Vorschau, Qualitäts-Erkennung, Intro-Erkennung): `winget install ffmpeg`.
4. GHGFlix starten → **Einstellungen → Bibliothek** → Ordner/Laufwerk automatisch erkennen lassen.
5. **Einstellungen → TMDb** → kostenlosen API-Key von [themoviedb.org](https://www.themoviedb.org/settings/api) eintragen (für Poster & Infos).
6. Scan abwarten — fertig. 🎉

> Werkzeug-Probleme? **Einstellungen → Werkzeuge** zeigt den Live-Status von mpv/ffmpeg/ffprobe und
> repariert verschobene Pfade mit einem Klick.

## 🛠️ Selbst bauen (Entwickler)

Voraussetzungen: [Node.js LTS](https://nodejs.org), [Rust (MSVC)](https://rustup.rs), VS 2022 C++ Build Tools, mpv, ffmpeg.

```bash
git clone https://github.com/BastiLd/GHGFLIX.git
cd GHGFLIX
npm install

# Entwicklung (Hot-Reload)
npm run tauri dev

# Release-Build → src-tauri/target/release/ghgflix.exe + Installer unter …/bundle/
npm run tauri build
```

Tests: `cd src-tauri && cargo test` · Typprüfung: `npx tsc --noEmit`

## 🧱 Technik

| Schicht | Stack |
|---|---|
| Desktop-Shell | Tauri 2 (Rust) |
| UI | React 19 + TypeScript + Tailwind v4 + zustand + TanStack Query |
| Wiedergabe | mpv via `tauri-plugin-mpv` (rendert hinter dem transparenten WebView) |
| Daten | SQLite (rusqlite, gebündelt) im App-Data-Ordner |
| Metadaten | TMDb (API-Key des Nutzers, Sprache wählbar) |
| Sync (optional) | Supabase (`supabase/schema.sql` einspielen) |

## ⌨️ Wichtige Tastenkürzel (Player)

Leertaste Pause · ←/→ bzw. J/L spulen · 0–9 Prozentsprung · M stumm · C Untertitel · F Vollbild ·
P Bild-im-Bild · S Screenshot · N nächste Folge · [ ] Geschwindigkeit · . , Einzelbild · A Bildformat ·
Bild↑/↓ Kapitel — vollständige Liste unter **Einstellungen → Tastenkürzel**.

## 📄 Lizenz

MIT — siehe [LICENSE](LICENSE).
