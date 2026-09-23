# GHGFlix — Bekannte Fehler & offene Punkte

**Stand: 23.09.2026, 22:15** · geprüft an der echten Bibliothek dieses PCs (13 Bibliotheken,
**1558 Dateien — alle 1558 in der App**) und am Code (Desktop-App v1.5.0, Branch `main`).
Nichts hier ist geschätzt — jede Zahl stammt aus einer Messung an Platte oder Datenbank.

| Zeichen | Bedeutung |
|---|---|
| 🔴 | **Fehler** — etwas funktioniert falsch |
| 🟠 | **Lücke** — Funktion fehlt oder ist nur halb da |
| 🟡 | **Leistung** — funktioniert, aber langsam |
| ⚪ | **Hinweis** — Aufräumen, Wartung, Entscheidung nötig |
| ✅ | **heute behoben** |

---

## Kurzüberblick

**Offen:**

| # | Punkt | Art | Wirkung |
|---|---|---|---|
| 1 | Server nutzt den TMDb-Schlüssel falsch | 🔴 | Server/Handy/TV findet mit dem v4-Schlüssel keine Poster |
| 2 | Server/Handy/TV kennen die neue Erkennung nicht | 🔴 | Browser/Handy zeigen andere, schlechtere Zuordnungen |
| 3 | 59 Filme doppelt auf der Platte | ⚪ | **808 GB** verzichtbar |
| 4 | „Bibliothek neu aufbauen" liest alle Auflösungen neu | 🟡 | ~23 Minuten bei ~1400 Dateien |

**Heute erledigt:** Laufwerksbuchstaben korrigiert (**124 Dateien, ~490 GB, jetzt in der App**),
sechs Programmfehler behoben und installiert, Falle im Build-Skript beseitigt, die Arbeit seit
August committet und auf GitHub gesichert. Details in Abschnitt 1.

---

## 1. Heute behoben (23.09.2026)

Installiert und an der echten Bibliothek nachgeprüft (43 Rust-Tests, TypeScript,
Server-Parser grün).

| | Fehler | Ursache |
|---|---|---|
| ✅ | **Extras-Reiter (Bloopers, Featurettes …) zeigte darunter die Folgen der zuletzt offenen Staffel**, und der Staffel-Reiter blieb rot markiert | Die Folgenliste wurde nur beim „Filme"-Reiter ausgeblendet, nicht bei Extras (`ShowDetail.tsx`) |
| ✅ | **The Mentalist `S07E12x13` (Doppelfolge) landete als Staffel 12, Folge 13** | Rückschritt aus dem August: eine Wortgrenze hinter der Folgennummer ließ `S07E12` vor dem `x` nicht greifen, dann wurde `12x13` als „Staffel×Folge" gelesen |
| ✅ | **„The Fantastic Four: First Steps" war als „…World Premiere" (die Premierenfeier) zugeordnet** | Rückschritt aus dem August: die Fortsetzungs-Prüfung wertete „Four" ≠ „4". Zahlwörter (one…twelve, eins…zwölf) gelten jetzt als Ziffer |
| ✅ | **Bonusmaterial in reinen Serien-Bibliotheken fiel stillschweigend weg** (33 Newsroom-Extras auf Z:) | Seit August wurde Bonusmaterial nur in „Serien & Filme"-Bibliotheken erfasst. Dazu wurde „Special Extras Season 1" weder als Bonusordner erkannt noch richtig nummeriert („Special" → Staffel 0) |
| ✅ | **Laufwerksbuchstaben vertauscht — 124 Dateien (~490 GB) fehlten** | `X:\SM-MOONDOOM` → `Z:\SM-MOONDOOM`, `Z:\Media\TV Shows` → `X:\Media\TV Shows`, toter Doppeleintrag `Z:\Media\Movies` entfernt. Vermutlich aus der Laptop-Einrichtung übernommen |
| ✅ | **Build-Skript meldete „installiert", obwohl die alte Version blieb** | Direkt nach dem Beenden war `ghgflix.exe` noch gesperrt; der Installer endet trotzdem mit Code 0. `rebuild-windows.ps1` wartet jetzt auf das Prozessende und prüft das Dateidatum (bis zu 3 Versuche) statt der Versionsnummer |

Die Mentalist-Folge und Fantastic Four wurden in der Datenbank **an Ort und Stelle**
korrigiert — an beiden hing Gesehen-Fortschritt (54 bzw. 104 Minuten), der erhalten
blieb. Ein normaler Scan hätte sie nicht repariert: bereits erkannte Dateien werden
bewusst nicht neu geraten.

---

## 2. Bibliothek & Daten

| | Punkt |
|---|---|
| ⚪ | **59 Filme liegen doppelt oder dreifach vor — 808 GB verzichtbar.** Die App fasst sie zu je einem Eintrag zusammen (Qualitätswahl beim Abspielen), der Platz ist aber belegt. Liste im Anhang. |
| ⚪ | `X:\Media\Movies\Nelly Video Abschied .MOV` ist ein Privatvideo und hat daher keinen TMDb-Treffer — richtig so. Ausblenden oder als eigenen Eintrag lassen? |
| ⚪ | Zwei Dateien „Avatar Aang: The Last Airbender (2026)" in `C:\Movies\Avengers\` (eine davon als `[LEAK]` benannt) — Zuordnung nie von dir bestätigt. |
| ⚪ | TMDb-Sprache bleibt Englisch (`en-US`) — so entschieden am 23.09. |
| ⚪ | `X:\Media\frigate` (Kameraaufnahmen) und `X:\Media\Music` sind nicht eingetragen — richtig so. |

---

## 3. Fehler & Lücken im Programm

| | Punkt | Details |
|---|---|---|
| 🔴 | **Server: TMDb-Schlüssel falsch übergeben** | `server/src/tmdb.js:44` schickt den Schlüssel als `api_key`. Ein v4-„Read Access Token" (der lange `eyJ…`-Schlüssel) wird so von TMDb abgelehnt → keine Poster/Infos. Genau dieser Fehler ließ im August alle 337 Filme der Desktop-App ohne Zuordnung. **Nicht nachprüfbar:** der Server (192.168.68.10) ist von diesem PC aus nicht erreichbar. |
| 🔴 | **Server/Handy/TV haben eine eigene, ältere Erkennung** | Der Server erkennt Dateien mit einem eigenen JavaScript-Parser. Nichts aus dem August ist dort drin: `x265`-Fehlerkennung als Folge, `S6-Ep-1`-Schreibweise, Bonusmaterial-Reiter, Bibliothekstyp „Serien & Filme", Titelvergleich mit Satzzeichen/Fortsetzungen, heutige Fixes. |
| 🟠 | Nicht erreichbare Bibliotheken werden nirgends gemeldet | Deshalb blieben die vertauschten Laufwerke wochenlang unbemerkt. Überspringen ist richtig (ein abgestecktes Laufwerk soll die Bibliothek nicht leeren), aber ein Hinweis „Ordner nicht gefunden" in Einstellungen → Bibliothek fehlt. |
| 🟠 | Doppelfolgen zählen nur als **erste** Folge | `S07E12x13` erscheint als Folge 12; Folge 13 fehlt in der Liste (gleiche Datei). |
| 🟠 | **Miraculous hat keinen „Filme"-Reiter** | Zugehörige Filme werden nur erkannt, wenn sie im Serienordner liegen (My Little Pony) oder mit dem *kompletten* Serientitel beginnen. Die besprochene Zuordnung über Franchise/TMDb ist nicht gebaut. |
| 🟠 | Notizen nur bei Bonusmaterial | Die Datenhaltung kann Notizen an jeder Datei; in der Folgen- und Filmliste fehlen die Bedienelemente. Umweg: Einstellungen → Bibliothek → „Zuordnung prüfen". |
| 🟠 | Bonusmaterial „Ändern" per Eingabefenster | Art wird als Freitext abgefragt (`blooper`, `deleted` …) — tippfehleranfällig. |
| 🟠 | Bonusmaterial ohne Gesehen-Stand | Läuft in einem eigenen mpv-Fenster, nicht im eingebauten Player — kein Fortschritt, kein Haken. |
| 🟠 | Bonusmaterial ohne zugehörige Serie wird nicht angezeigt | Z. B. Extras eines **Films** (`Film (2014)\Extras\Making of.mkv`). Bewusst: als „Film" eingeordnet bekäme so etwas wieder zufällige TMDb-Treffer („Gag Reel" → Kinofilm *Gag*). |
| 🟠 | Fehlerfang nur auf Film-/Serienseiten | Stürzt eine andere Seite ab (Einstellungen, Kanäle …), wird das Fenster weiterhin schwarz. |
| 🟠 | „Laufwerk automatisch erkennen" und „Ordner durchsuchen" kennen „Serien & Filme" nicht | Legen nur reine Film- oder Serienbibliotheken an. |
| 🟠 | Handentscheidungen, Notizen, Bonusmaterial werden nicht synchronisiert | Bleiben auf diesem PC (weder Supabase noch Server). |

---

## 4. Leistung

| | Punkt | Messung / Ursache | Idee |
|---|---|---|---|
| 🟡 | **„Bibliothek neu aufbauen" liest alle Auflösungen neu** | Anzeige zuletzt: „noch ~23 Min" für ~1400 Dateien (4 ffprobe gleichzeitig). Breite/Höhe hängen an den Bibliothekszeilen und verschwinden beim Neuaufbau mit. | Zwischenspeicher nach Pfad + Größe + Änderungszeit |
| 🟡 | TMDb-Abgleich läuft nacheinander | Ein Titel nach dem anderen, je Titel mehrere Anfragen — der erste Scan einer großen Bibliothek dauert Minuten. | 4–6 Anfragen parallel |
| 🟡 | „Serien & Filme"-Bibliotheken werden zweimal durchlaufen | Einmal für Folgen, einmal für Filme — auf Netzlaufwerken spürbar. | ein Durchlauf, beide Entscheidungen |
| 🟡 | Oberfläche als ein 830-KB-Paket | Vite-Warnung beim Bauen → langsamerer App-Start. | Seiten nachladen (Code-Splitting) |
| 🟡 | Zuordnungs-Fenster: eine Datenbankabfrage je Datei | ~1500 Einzelabfragen für die Notizen. | eine Abfrage mit Join |

---

## 5. Wartung & Risiken

| | Punkt |
|---|---|
| ✅ | Alle Änderungen seit August (Erkennung, Bonusmaterial, Zuordnungs-Fenster, Notizen, Fehlerfang, heutige Fixes) sind am 23.09. auf `main` committet und nach GitHub gepusht. **Auf dem Laptop** muss einmal `git pull` laufen. |
| ⚪ | `npm audit`: **2 hohe Warnungen in Laufzeit-Paketen** (react-router-dom), weitere in Build-Werkzeugen (esbuild, postcss, nanoid, browserslist). |
| ⚪ | `mobile/test/oberflaeche.test.mjs` hängt (>200 s) — bekannt seit 01.08., liegt am Testaufbau. |
| ⚪ | Compiler-Warnung: `db::season_file_paths` wird nicht benutzt. |
| ⚪ | `PLAN_STATUS.md` / `UEBERGABE.md` teilweise veraltet: Laptop-Pfade, „`main` hängt bei v0.9.6" stimmt nicht mehr. |

## 6. Offen aus `PLAN_STATUS.md` — nur am echten Gerät prüfbar

- Manuelle Ende-zu-Ende-Tests Sync (Desktop ↔ Server ↔ Supabase) — S-013/014/033
- Spul-Testmatrix mit Referenzclip — AV-04/24/30
- TV-Kompatibilitätsliste, native Android-TV-App — TV-048, TV-001…055
- EAS-Bau, OTA-Auslieferung, iPhone-Wiedergabe über HLS
- `GHGFLIX_PASSWORD` prüfen/setzen — SEC-001

---

## Anhang: Doppelte Filme

Sortiert nach verzichtbarem Platz (alle Fassungen außer der größten).
Viele Doppel entstehen, weil `Y:\SM3-MOONDOOM`, `W:\TO-MOONDOOM` und `Z:\SM-MOONDOOM`
Kopien derselben Dateien enthalten, die auch auf C:/D:/G: liegen. Entscheidung (19.08.):
nur auflisten, nichts löschen.

| Film | Fassungen | Orte (Größe) | verzichtbar |
|---|---|---|---|
| Project Hail Mary | 3 | C: (29.7 GB) · Y: (29.7 GB) · C: (6.8 GB) | 36.5 GB |
| Now You See Me 2 | 3 | D: (59.7 GB) · D: (22.3 GB) · D: (13.3 GB) | 35.6 GB |
| F1 | 2 | D: (29.0 GB) · Y: (29.0 GB) | 29.0 GB |
| Spider-Man: No Way Home | 2 | D: (25.9 GB) · Z: (25.9 GB) | 25.9 GB |
| Thunderbolts* | 2 | G: (25.8 GB) · Z: (25.8 GB) | 25.8 GB |
| Batman v Superman: Dawn of Justice | 2 | D: (25.5 GB) · Y: (25.5 GB) | 25.5 GB |
| Spider-Man: Across the Spider-Verse | 2 | G: (25.5 GB) · Z: (25.5 GB) | 25.5 GB |
| Hidden Figures | 2 | G: (25.4 GB) · W: (25.4 GB) | 25.4 GB |
| The Dark Knight Rises | 2 | D: (25.3 GB) · Z: (25.3 GB) | 25.3 GB |
| Top Gun: Maverick | 2 | G: (24.6 GB) · Y: (24.6 GB) | 24.6 GB |
| Doctor Strange in the Multiverse of Madness | 2 | D: (23.6 GB) · Z: (23.6 GB) | 23.6 GB |
| Batman Begins | 2 | D: (23.3 GB) · Z: (23.3 GB) | 23.3 GB |
| Hacksaw Ridge | 3 | G: (18.4 GB) · Y: (18.4 GB) · G: (4.1 GB) | 22.5 GB |
| Black Panther: Wakanda Forever | 2 | G: (22.2 GB) · W: (22.2 GB) | 22.2 GB |
| Iron Man 3 | 2 | G: (21.7 GB) · W: (21.7 GB) | 21.7 GB |
| The Fantastic 4: First Steps | 2 | G: (21.2 GB) · Y: (21.2 GB) | 21.2 GB |
| Iron Man 2 | 2 | D: (21.1 GB) · Z: (21.1 GB) | 21.1 GB |
| Spider-Man: Homecoming | 2 | D: (20.8 GB) · Z: (20.8 GB) | 20.8 GB |
| Venom: The Last Dance | 2 | D: (20.4 GB) · Y: (20.4 GB) | 20.4 GB |
| Zootopia 2 | 2 | G: (20.3 GB) · Z: (20.3 GB) | 20.3 GB |
| Karate Kid: Legends | 2 | D: (19.7 GB) · Y: (19.7 GB) | 19.7 GB |
| Spider-Man: Far From Home | 2 | D: (19.6 GB) · Z: (19.6 GB) | 19.6 GB |
| Extraction 2 | 2 | G: (18.4 GB) · Z: (18.4 GB) | 18.4 GB |
| Frozen | 2 | G: (17.7 GB) · W: (17.7 GB) | 17.7 GB |
| Kung Fu Panda 4 | 2 | C: (17.1 GB) · Y: (17.1 GB) | 17.1 GB |
| Ballerina | 2 | D: (16.4 GB) · G: (16.4 GB) | 16.4 GB |
| Avengers: Infinity War | 2 | D: (15.4 GB) · Z: (15.4 GB) | 15.4 GB |
| Iron Man | 2 | G: (14.4 GB) · W: (14.4 GB) | 14.4 GB |
| YES DAY | 2 | D: (12.1 GB) · Z: (12.1 GB) | 12.1 GB |
| Puss in Boots: The Last Wish | 2 | G: (11.9 GB) · Y: (11.9 GB) | 11.9 GB |
| Zack Snyder's Justice League | 2 | D: (11.6 GB) · Y: (11.6 GB) | 11.6 GB |
| Extraction | 2 | G: (11.0 GB) · Z: (11.0 GB) | 11.0 GB |
| Ratatouille | 2 | G: (22.1 GB) · C: (10.2 GB) | 10.2 GB |
| Doctor Strange | 2 | D: (9.4 GB) · Z: (9.4 GB) | 9.4 GB |
| The Dark Knight | 2 | D: (8.1 GB) · Z: (8.1 GB) | 8.1 GB |
| Shazam! | 2 | D: (7.8 GB) · Y: (7.8 GB) | 7.8 GB |
| Captain America: Civil War | 2 | D: (7.4 GB) · Z: (7.4 GB) | 7.4 GB |
| Spider-Man 2 | 2 | D: (6.6 GB) · Y: (6.6 GB) | 6.6 GB |
| Johnny English Strikes Again | 2 | D: (6.5 GB) · Y: (6.5 GB) | 6.5 GB |
| Black Panther | 3 | C: (32.1 GB) · G: (3.2 GB) · W: (3.2 GB) | 6.4 GB |
| Shazam! Fury of the Gods | 2 | D: (6.2 GB) · Y: (6.2 GB) | 6.2 GB |
| Black Adam | 2 | D: (6.0 GB) · Y: (6.0 GB) | 6.0 GB |
| Avengers: Endgame | 2 | D: (5.7 GB) · Z: (5.7 GB) | 5.7 GB |
| Ghosted | 2 | D: (5.6 GB) · Y: (5.6 GB) | 5.6 GB |
| Five Nights at Freddy's | 2 | C: (5.2 GB) · Z: (5.2 GB) | 5.2 GB |
| Superman | 2 | G: (4.6 GB) · Y: (4.6 GB) | 4.6 GB |
| Interstellar | 2 | D: (4.5 GB) · Y: (4.5 GB) | 4.5 GB |
| Frozen II | 2 | C: (3.7 GB) · Z: (3.7 GB) | 3.7 GB |
| Avatar Aang: The Last Airbender | 3 | C: (3.4 GB) · C: (1.4 GB) · Z: (1.4 GB) | 2.8 GB |
| The Green Mile | 2 | D: (2.7 GB) · Y: (2.7 GB) | 2.7 GB |
| Johnny English | 3 | D: (1.8 GB) · Y: (1.8 GB) · D: (0.7 GB) | 2.5 GB |
| Spider-Man 3 | 2 | D: (2.2 GB) · Y: (2.2 GB) | 2.2 GB |
| Spider-Man | 2 | D: (2.0 GB) · Y: (2.0 GB) | 2.0 GB |
| Megamind | 2 | D: (1.9 GB) · Y: (1.9 GB) | 1.9 GB |
| Sonic the Hedgehog 3 | 2 | D: (1.9 GB) · Y: (1.9 GB) | 1.9 GB |
| Big Hero 6 | 2 | D: (1.8 GB) · Y: (1.8 GB) | 1.8 GB |
| Five Nights at Freddy's 2 | 2 | Y: (1.6 GB) · Z: (1.6 GB) | 1.6 GB |
| Johnny English Reborn | 2 | D: (1.6 GB) · Y: (1.6 GB) | 1.6 GB |
| The Social Network | 2 | D: (1.3 GB) · Y: (1.3 GB) | 1.3 GB |
| **Summe** | | | **808 GB** |
