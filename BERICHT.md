# GHGFlix — Bericht: Server-Überholung, Erkennung, Vorschaubilder, Cloud-Sync

**Stand:** 31.07.2026 · **Versionen:** Desktop **1.0.0** · Server **2.3.1** · Handy **1.5.0**

---

## ⚠️ NACHTRAG 31.07. — vier Fehler aus dem ersten Test behoben

Du hast vier Dinge gemeldet, alle vier sind gefunden und behoben:

### 1. Das PowerShell-Skript ließ sich nicht starten

`Unerwartetes Token "}"` — Ursache: Ich hatte Umlaute und Gedankenstriche in der
`.ps1` verwendet. Windows PowerShell 5.1 liest `.ps1`-Dateien **nicht** als
UTF-8, sondern in der ANSI-Codepage; dadurch wurde `—` zu `â€"` und die
Klammerung zerbrach. Das Skript enthält jetzt **ausschließlich ASCII**.

### 2. „0 gesendet, 0 empfangen" — der eigentliche Grund

Das war **nicht** die Cloud, sondern ein Typkonflikt im Server:

- Die Weboberfläche (und damit Fernseher und Handy-Browser) benutzt dieselbe
  React-App wie der Desktop und schickt die Profil-ID **`"local"` als Text**.
- Der Server führt seine Profile aber als **Zahlen**.
- Folge: Der Fortschritt landete unter `profile_id = 'local'`; die Abfrage des
  Cloud-Abgleichs verbindet `progress` mit `profiles.id` (Zahl) → **kein
  Treffer → „0 gesendet"**.
- Umgekehrt landeten aus der Cloud geholte Daten unter der Zahl, während die
  Weboberfläche weiter `'local'` las → **„0 empfangen"**, und am Fernseher blieb
  alles leer.

Jetzt wird jede von außen kommende Profil-ID auf ein echtes Profil abgebildet,
und vorhandene Text-Einträge werden beim ersten Start einmalig umgezogen.
Zusätzlich verknüpft der Server sein Profil selbstständig mit dem Cloud-Profil
(vorher passierte das nur beim Herunterladen — wer nur über die Weboberfläche
schaute, sendete also nie etwas). **11 neue Tests** sichern das ab.

> **Wichtig:** Auf dem PC lief noch die **alte** Windows-App (Version 0.9.9),
> weil das Build-Skript ja abgestürzt ist. Deshalb kam auch von dort nichts an.
> Nach dem Neubauen (Schritt 5) funktioniert es.

### 3. Handy-App: „No such file or directory"

Das Studio hat das GHGFlix-Repo geklont — aber den Branch **`main`**. Dort gibt
es weder `mobile/` noch `server/`; dein gesamter Code liegt auf
`feature/zimaos-docker-server`. Deshalb schlug `cd .../mobile` fehl.

Das Studio kann jetzt einen **Branch** je App (`repoBranch`), GHGFlix ist darauf
eingestellt, und bestehende Installationen bekommen neue Einstellungen
automatisch nachgetragen (vorher wurden nur komplett neue Apps übernommen).

### 4. „OrG! (Come & Play)" mit Daredevil-Folgen darin

Gefunden: Ein Sammelordner einer Release-Seite — z. B. **`www.UIndex.org`** —
wurde als Serienordner behandelt. Nach dem Entfernen von „www" und „uindex"
blieb **„org"** übrig, und zu „org" findet TMDb tatsächlich die Serie
„OrG! (Come & Play)".

Drei Sicherungen dagegen:

1. Solche Sammelordner werden erkannt und **übersprungen** — die echte Serie
   steht eine Ebene tiefer.
2. Bleibt kein brauchbarer Titel übrig, zählt der **Dateiname**
   (`Daredevil.Born.Again.S02E06…` → „Daredevil Born Again").
3. Bereits gespeicherte Müll-Schlüssel werden beim nächsten Scan **entfernt**,
   damit die Fehlzuordnung nicht zurückkommt.

> **Damit die falsche Serie verschwindet, muss einmal neu eingelesen werden** —
> siehe Schritt 8 unten. Dein Gesehen-Stand geht dabei nicht verloren.

---

## ⚠️ NACHTRAG 2 — Handy-App-Absturz, Player und Poster-Ränder

### 5. Handy-App stürzte beim Abspielen ab

`NativeSharedObjectNotFoundException` in `App.js:702`. Ursache: expo-video gibt
das native Player-Objekt frei, sobald der Bildschirm verlassen wird. Der
Speicher-Timer griff im Aufräum-Teil aber noch einmal auf `player.currentTime`
zu — und genau dann existierte das Objekt nicht mehr.

Behoben: Position und Dauer werden jetzt fortlaufend in Zwischenspeichern
mitgeschrieben (gefüttert vom `timeUpdate`-Ereignis). Gespeichert wird
**ausschließlich** daraus, das native Objekt wird nach dem Verlassen nie mehr
angefasst. Zusätzlich läuft jeder direkte Zugriff über eine Schutzfunktion,
und ein Marker stoppt alle Zugriffe, sobald der Bildschirm zu ist.

### 6. Der Handy-Player war zu dürftig

Vorher gab es nur drei Knöpfe und sonst nichts — keine Zeitleiste, keine
Zeitanzeige, kein Hinweis beim Laden. Jetzt:

- **Fortschrittsleiste zum Ziehen** — antippen oder wischen zum Spulen, mit
  rotem Griff
- **Zeitanzeige** links (gelaufen) und rechts (Restzeit)
- **Ladeanzeige**, solange das Video puffert (vorher schwarzes Bild ohne
  jede Rückmeldung — man wusste nicht, ob es hängt)
- **Anzeige „Direkt" / „Umgewandelt"**, damit erkennbar ist, ob der Server
  gerade rechnen muss
- Bedienelemente **blenden sich nach 4 Sekunden aus** und kommen bei Tippen
  zurück
- Deutlich sichtbarer Abspiel-/Pause-Knopf in Rot, „Nächste Folge" beschriftet

### 7. Schwarze Ränder beim Poster

Der Rahmen auf der Detailseite hatte **fest 2:3**, das Bild lag mit
„einpassen" darin — ein selbst gewähltes Poster mit anderem Seitenverhältnis
bekam dadurch Balken oben und unten.

Jetzt misst die App das echte Seitenverhältnis des geladenen Bildes und setzt
den Rahmen darauf: **keine Balken, und abgeschnitten wird auch nichts.** Die
Breite bleibt fest, damit das Layout ruhig steht; die Höhe folgt dem Bild
(sanft begrenzt, damit ein extrem breites Banner die Seite nicht sprengt).

---

## ⚠️ NACHTRAG 3 — „installiert, aber nicht da" am Fernseher

### 8. Die App war unsichtbar, nicht fehlgeschlagen

Symptom: Download klappt, „Installieren" drücken, kurz schwarz, zurück — und
nichts ist zu finden. Beim zweiten Versuch fragt Android nach einem „Update".

**Genau dieses „Update" war der Beweis: Die App WAR installiert.** Sie wurde nur
nicht angezeigt.

Der Startbildschirm von Android TV / Google TV zeigt ausschließlich Apps mit

```xml
<category android:name="android.intent.category.LEANBACK_LAUNCHER" />
```

Eine normale Handy-App hat nur `LAUNCHER` — und ist damit auf dem Fernseher
unsichtbar. Behoben durch eine kleine Erweiterung beim App-Bau
(`mobile/plugins/withAndroidTv.js`), die dem Manifest hinzufügt:

1. **LEANBACK_LAUNCHER** an der Haupt-Activity → App erscheint im TV-Menü
2. **`uses-feature`** für Leanback und Touchscreen jeweils „nicht erforderlich"
   → Android hält die App auf einem Gerät ohne Touchscreen für zulässig
3. **Kachelbild** (320×180, rotes GHGFlix-Banner) → manche Launcher zeigen
   Apps ohne Banner gar nicht erst an

Die Erweiterung ist gegen ein echtes Manifest getestet: Leanback wird ergänzt,
die normale Handy-Kategorie bleibt erhalten, und mehrfaches Ausführen erzeugt
keine Doppel-Einträge.

**Wichtig:** Vorher am TV unter *Einstellungen → Apps → Alle Apps anzeigen* die
alte, unsichtbare GHGFlix-Installation **deinstallieren** — dann die neue
Version 1.5.0 installieren.

### 8b. App startet am TV und stürzt sofort ab

Die App ist jetzt sichtbar, bricht beim Öffnen aber ab (kurz schwarz, zurück
ins Menü). Zwei Maßnahmen:

**Ursache-Verdacht behoben:** Expo SDK 53 schaltet die **neue
React-Native-Architektur** (Fabric) standardmäßig ein. Auf günstigen
Android-TV-Geräten ist das eine bekannte Absturzquelle beim Start. Die
bewährte Architektur ist in SDK 53 voll unterstützt — ab Version 1.5.0 ist
sie deshalb bewusst abgeschaltet (`newArchEnabled: false`).

**Und damit du es künftig selbst siehst:** Am Fernseher gibt es keine
Entwicklerkonsole — ein Absturz ist einfach ein schwarzer Bildschirm. GHGFlix
fängt Fehler jetzt ab, **speichert sie** und zeigt sie beim nächsten Start als
rotes Banner mit Meldung und Fehlerspur. Kein PC nötig.

Greift beides nicht (Absturz noch vor dem Start der Oberfläche), steht in
[`tv/README.md`](tv/README.md) eine Schritt-für-Schritt-Anleitung, wie du per
`adb` über WLAN die echten Systemlogs vom Fernseher holst — mit allen Befehlen
zum Kopieren.

### 9. Studio-Klon scheiterte an eigenen Bau-Dateien

```
error: Your local changes to the following files would be overwritten by checkout:
        mobile/app.json
error: The following untracked working tree files would be overwritten:
        mobile/package-lock.json
```

Der Bau-Ordner im Studio ist ein reiner Arbeits-Klon — trotzdem entstehen dort
beim Bauen Dateien (`package-lock.json`), und EAS ändert `app.json`. Ein
normales `checkout` scheitert daran.

Jetzt wird hart auf den Server-Stand zurückgesetzt und aufgeräumt. Wichtig:
`git clean -fd` fasst per `.gitignore` ausgeschlossene Ordner **nicht** an —
`node_modules` bleibt also erhalten und es gibt keinen unnötigen Neu-Install.
Nachgestellt und geprüft: Der alte Befehl bricht mit genau deiner Meldung ab,
der neue läuft durch.

---

> Der vorherige Bericht zur Masterplan-Umsetzung (16.07.2026) steht in
> [`PLAN_STATUS.md`](PLAN_STATUS.md).

---

## Kurzfassung

Drei Dinge waren kaputt, alle drei sind behoben:

1. **Supabase-Sync ging gar nicht.** Ich habe in deinem Projekt nachgesehen:
   in `watch_progress` standen **0 Zeilen** — obwohl du angemeldet warst. Es
   waren **zwei** Fehler, nicht einer. Beide sind gefunden und behoben.
2. **Die Erkennung im Docker-Server war deutlich schwächer als am Desktop.**
   Der Server hatte eine stark vereinfachte Nachbildung. Jetzt läuft dort die
   komplette Desktop-Logik plus die Ordner-Konventionen von Plex und Jellyfin.
3. **Die Vorschaubilder auf der Zeitleiste** (wenn du mit der Maus drüberfährst)
   waren im Browser bei gesetztem Passwort komplett unsichtbar, langsam und im
   falschen Seitenverhältnis. Jetzt gibt es einen vorgenerierten Bilderstreifen
   wie bei Plex — die Vorschau erscheint ohne jede Verzögerung.

Dazu kamen rund 40 weitere Korrekturen, davon 13 aus einer unabhängigen
Code-Prüfung, die ich nach dem Umbau habe laufen lassen.

---

## Teil 1: Der Supabase-Sync — was wirklich los war

### Fehler 1: Der Abgleich lief fast nie

Die App synchronisierte **nur**, wenn du auf dem Profil-Bildschirm ausdrücklich
ein **Cloud-Profil** angeklickt hast. Beim normalen Benutzen mit dem
Standardprofil „Lokal“ stieg die Funktion sofort wieder aus:

```ts
if (!c || profileId === "local") return;   // ← genau hier war Schluss
```

### Fehler 2: Auch mit Cloud-Profil kam nichts an

Das ist der Grund, warum es auch nach deiner Anmeldung nicht funktioniert hat.
Dein **gesamter bisheriger Fortschritt** liegt in der lokalen Datenbank unter
der Profil-Nummer `local`. Hochgeladen wurde aber nur das, was unter der
**neuen** Cloud-Profil-Nummer stand — und das war leer. Die App hat also
fleißig „nichts“ synchronisiert und dabei keinen Fehler gemeldet.

### Was jetzt anders ist

- Dein lokales Profil wird **einmalig fest mit einem Cloud-Profil verknüpft**.
  Die Verknüpfung wird gespeichert und überlebt Neustarts.
- Danach wird **immer** abgeglichen — egal welches Profil gewählt ist:
  alle 60 Sekunden, beim App-Start, beim Zurückholen des Fensters und bei
  wiederhergestellter Internetverbindung.
- Beim ersten Login fragt die App: **„Auf diesem PC sind N Einträge gefunden —
  in die Cloud übernehmen?“** (wie von dir gewünscht mit Nachfrage, nicht
  heimlich).
- **„Meine Liste“** wird jetzt mit synchronisiert (war vorher gar nicht dabei).
- In den Einstellungen steht eine **Statuszeile im Klartext**:
  `● Verbunden — letzter Abgleich 21:14 (147 gesendet, 0 empfangen)` oder
  eben die konkrete Fehlermeldung. Vorher gab es dafür **keine Anzeige** —
  ein stiller Fehler war von „läuft alles“ nicht zu unterscheiden.
- Zusätzlich ein Knopf **„Jetzt synchronisieren“**.
- Wie von dir gewählt läuft **beides parallel**: direkt in die Cloud **und**
  über den Docker-Server.

### Deine Cloud-Datenbank habe ich erweitert

Im Projekt **GHG FLIX** neu angelegt (deine vorhandenen Daten blieben unberührt):

| Neu | Wofür |
|---|---|
| `watch_favorites` | „Meine Liste“ auf allen Geräten |
| `sync_devices` | welches Gerät zuletzt wann abgeglichen hat |
| 4 Indizes | spürbar schnellere Abfragen |

Alles mit denselben Sicherheitsregeln (Row Level Security) wie bisher — nur du
siehst deine Daten. Ich habe die Struktur direkt in deinem Projekt getestet
(Test-Zeilen geschrieben, geprüft, danach wieder gelöscht — die Tabellen sind
jetzt wieder bei 0).

**Die vollständige Schritt-für-Schritt-Anleitung steht in
[`docs/SUPABASE.md`](docs/SUPABASE.md)** — inklusive der Erklärung, welcher der
beiden Schlüssel wohin gehört (das ist die häufigste Fehlerquelle).

---

## Teil 2: Die Erkennung — jetzt 1:1 wie am Desktop

Der Server hatte eine 76-zeilige Nachbildung der 319-zeiligen Desktop-Logik.
Konkrete Folgen davon:

| Vorher im Server | Jetzt |
|---|---|
| „Marvel's Daredevil Season 1“ und „… Season 2“ wurden zu **zwei getrennten Serien** | eine Serie, beide Staffeln drin |
| Suchte nur **eine Ebene tief** — Filme in Unterordnern fehlten | rekursiv bis 8 Ebenen |
| Nahm blind das **erste** TMDb-Suchergebnis | Treffer-Bewertung nach Titel, Jahr und Folgenzahl |
| `sample.mkv` und `-trailer.mkv` landeten als echte Titel in der Bibliothek | werden übersprungen |
| Gemerkte Zuordnungen hingen am **Ordnerpfad** — nach Umbenennen weg | hängen am stabilen Namens-Schlüssel |
| Mehrteiler `S01E01-E02` wurde als E01 gelesen | als E01–E02 erkannt |
| „Specials“ wurden nicht als Staffel 0 erkannt | werden erkannt |
| Verschieben einer Staffel auf eine andere Serie wurde beim nächsten Scan **rückgängig gemacht** | wird gemerkt und wieder angewandt |
| Zwei Qualitäten derselben Folge = **zwei Folgen** in der Liste | eine Folge mit zwei Dateiversionen |
| Ein ins Leere zeigender Docker-Mount **löschte die ganze Bibliothek** | wird erkannt, Einträge bleiben erhalten |

Zusätzlich die Plex-/Jellyfin-Konventionen: Provider-Tags im Ordnernamen
(`Firefly (2002) [tmdbid-1437]`), `.nfo`-Dateien, `Extras`-Ordner werden
ignoriert, `www.SeitenName.org - `-Präfixe fliegen raus.

**Belegt durch Tests:** 38 Parser-Tests und 20 Scanner-Tests, die eine echte
Beispiel-Bibliothek auf der Festplatte anlegen und den Scanner darüberlaufen
lassen. Beide laufen ab jetzt bei jedem Push automatisch mit.

---

## Teil 3: Vorschaubilder auf der Zeitleiste

Das war dein Punkt „die Vorschaubilder, wenn ich mit der Maus drüberfahre“.

**Der Hauptfehler:** Der Server gab die Bild-Adresse **ohne Zugangs-Token**
zurück. Ein `<img>`-Tag kann keine Kopfzeilen mitschicken — sobald ein
Server-Passwort gesetzt war, antwortete der Server mit „nicht angemeldet“ und
die Vorschau blieb **dauerhaft leer**.

Weiter behoben:

- **Bilderstreifen wie bei Plex** („Trickplay“): Beim Abspielen wird im
  Hintergrund **ein einziges** großes Bild mit allen Vorschaupositionen erzeugt.
  Der Browser lädt es einmal — danach kostet jede Mausbewegung null Netzwerk und
  die Vorschau springt **sofort** mit. Auch am Handy und am Fernseher.
- **Die eingestellte Größe wirkt jetzt wirklich.** Vorher wurde das Bild immer
  mit 320 Pixeln erzeugt und in der Anzeige hochskaliert (= unscharf). Jetzt
  wird es in der gewählten Größe erzeugt, inklusive Berücksichtigung von
  4K-Bildschirmen. Zwei neue Stufen: „Sehr groß“ und „Riesig“.
- **Die Höhe folgt dem echten Seitenverhältnis** des Videos. Vorher war die
  Kachel starr 16:9 — bei 4:3-Material und Cinemascope war das Bild beschnitten.
- **Bremse gegen Überlastung:** höchstens 2 gleichzeitige ffmpeg-Aufrufe,
  Zeitlimit pro Aufruf, Cache-Obergrenze (Standard 512 MB, vorher unbegrenzt).
- **Sicherheitslücke geschlossen:** Die Vorschau-Adresse nahm vorher **jeden**
  Dateipfad entgegen. Jetzt werden nur Dateien akzeptiert, die tatsächlich in
  der Bibliothek stehen.

### Und die anderen Bilder (Poster + Hintergrund)

- Poster und Hintergründe kommen jetzt aus den **Detaildaten** von TMDb statt
  aus dem Suchtreffer, und in **höherer Auflösung** (Poster w500 statt w342,
  Hintergrund passend zur Bildschirmbreite bis „original“).
- **Lokale Bilder gewinnen**, wie bei Plex und Jellyfin: `poster.jpg`,
  `folder.jpg`, `cover.jpg`, `fanart.jpg`, `banner.jpg`, `logo.png`,
  `season01-poster.jpg` und `<Dateiname>-thumb.jpg` werden gefunden und
  bevorzugt. Löschst du so eine Datei wieder, fällt die Anzeige sauber auf das
  TMDb-Bild zurück.
- **Fehlende Folgenbilder werden erzeugt:** Hat TMDb kein Standbild, schneidet
  ffmpeg automatisch eines bei 25 % der Laufzeit heraus und behält es dauerhaft.
  Keine leeren Kacheln mehr.
- Handy-App und TV-Browser bekommen diese Bilder ebenfalls (sie hingen vorher
  an einer älteren Schnittstelle, die die neuen Bilder nicht mitgeliefert hat).

---

## Teil 4: Was die unabhängige Code-Prüfung gefunden hat

Nach dem Umbau habe ich den kompletten Server-Code von einem zweiten Durchgang
gegenprüfen lassen. 13 echte Fehler kamen zurück, alle behoben — die drei
wichtigsten:

1. **Nachträglich hinzugefügte 4K-Fassungen wurden nie erkannt.** Eine
   Abbruchbedingung stand an der falschen Stelle, dadurch war die ganze
   Mehrfach-Qualitäten-Funktion im Dauerbetrieb wirkungslos.
2. **Erzeugte Folgenbilder wurden vom Cache-Aufräumer wieder gelöscht** — und
   weil die Datenbank sich merkte „schon erzeugt“, kamen sie nie wieder. Sie
   liegen jetzt in einem eigenen, geschützten Ordner.
3. **Ein leerer Docker-Mount hätte die komplette Bibliothek gelöscht.** Zeigt
   ein Bind-Mount auf einen Host-Pfad, den es nicht gibt, entsteht im Container
   ein leerer Ordner — vorher hätte ein einziger Scan alles verworfen. Jetzt
   wird das erkannt und die Einträge bleiben erhalten. Dafür gibt es einen
   eigenen Test.

Ebenfalls behoben: Abstürze durch unbehandelte Hintergrundfehler, ein
Datenbankfehler beim Zusammenführen zweier Serien, die Ordner-Durchsuchung
akzeptierte beliebige Systempfade (`/etc`), und Hash-Kollisionen bei den
Vorschaubildern (eine Datei konnte das Bild einer anderen zeigen).

---

## Teil 5: Was DU jetzt tun musst

Alle Befehle sind für **PowerShell** und zum Kopieren gedacht. Rechtsklick auf
den Start-Knopf → **Terminal** bzw. **Windows PowerShell**.

### Schritt 1 — Änderungen ansehen

Alle 34 geänderten Dateien sind bereits **vorgemerkt** (`git add` ist erledigt),
aber noch **nicht committet** — der Commit muss von Windows aus laufen.

```powershell
cd "$env:USERPROFILE\Documents\GHGFlix"
git status
```

Wenn du dir die Änderungen im Detail ansehen willst:

```powershell
cd "$env:USERPROFILE\Documents\GHGFlix"
git diff --cached --stat
```

### Schritt 2 — Committen und veröffentlichen (löst den Docker-Build aus)

Falls Git meckert, dass ein anderer Prozess läuft, zuerst die stehengebliebene
Sperrdatei entfernen:

```powershell
cd "$env:USERPROFILE\Documents\GHGFlix"
Remove-Item -Force .git\index.lock -ErrorAction SilentlyContinue
```

Dann committen und hochladen:

```powershell
cd "$env:USERPROFILE\Documents\GHGFlix"
git add -A
git commit -m "Server-Ueberholung: Erkennung 1:1 wie Desktop, Vorschaubilder, Supabase-Sync repariert"
git push origin feature/zimaos-docker-server
```

Danach baut GitHub automatisch das neue Server-Image. Der Fortschritt ist hier
zu sehen: `https://github.com/BastiLd/GHGFLIX/actions` — dauert etwa 5–10
Minuten (es werden zwei Architekturen gebaut).

### Schritt 3 — ZimaOS aktualisieren

**Die Version, die du brauchst: `2.3.1`**

Das Image heißt:

```
ghcr.io/bastild/ghgflix-server:2.3.1
```

Zwei Wege:

**A) Einfach (empfohlen):** ZimaOS → App Store → GHGFlix → **Update**.
Das zieht `:latest`, was nach dem Build identisch zu `2.3.0` ist.

**B) Fest auf die Version:** In deiner docker-compose die Zeile

```yaml
image: ghcr.io/bastild/ghgflix-server:latest
```

ersetzen durch

```yaml
image: ghcr.io/bastild/ghgflix-server:2.3.1
```

und die App neu importieren.

**Prüfen, ob die neue Version wirklich läuft** — im Browser aufrufen:

```
http://<server-ip>:8484/api/ping
```

Dort muss `"version":"2.3.1"` stehen. Steht dort noch `2.2.0` oder `2.3.0`, hat das Update
nicht gegriffen (dann in ZimaOS/Portainer das Image neu ziehen und den Container
neu erstellen — deine Daten in `/DATA/AppData/ghgflix/data` bleiben erhalten).

### Schritt 4 — Supabase: **Du musst dort NICHTS machen** ✅

Zur Sicherheit ausdrücklich: **Nein, du musst nichts kopieren und nirgends
einfügen.** Ich habe die neuen Tabellen (`watch_favorites`, `sync_devices`)
und die Indizes bereits direkt in deinem Projekt **GHG FLIX** angelegt und
danach mit Testzeilen geprüft.

Auch dein **vorhandenes Konto bleibt**: Du meldest dich einfach wie gewohnt mit
`bastian.klaus2010@gmail.com` an. Dein bestehendes Profil („tests") wird
automatisch mit deinem lokalen Profil verknüpft — kein neues Konto, kein neues
Profil nötig.

Die Datei `supabase/schema.sql` brauchst du nur, wenn du **irgendwann ein ganz
neues Supabase-Projekt** aufsetzt. Vollständige Anleitung für diesen Fall:
[`docs/SUPABASE.md`](docs/SUPABASE.md).

### Schritt 5 — Windows-App komplett neu bauen

Dafür gibt es jetzt **ein Skript**, das alles erledigt: laufende GHGFlix-Fenster
beenden (sonst ist die .exe gesperrt), alte Bau-Ergebnisse löschen, Pakete
installieren, alle Prüfungen laufen lassen, bauen und am Ende den Ordner mit
dem Installer öffnen.

```powershell
cd "$env:USERPROFILE\Documents\GHGFlix"
powershell -ExecutionPolicy Bypass -File scripts\rebuild-windows.ps1
```

Ohne Prüfungen (schneller):

```powershell
cd "$env:USERPROFILE\Documents\GHGFlix"
powershell -ExecutionPolicy Bypass -File scripts\rebuild-windows.ps1 -Schnell
```

Dann den Installer aus dem Ordner `nsis` ausführen. **Verknüpfungen im
Startmenü und auf dem Desktop werden automatisch mit aktualisiert** — der
Installer erkennt die alte Version (gleiche Kennung `com.ghgflix.app`) und
ersetzt sie sauber.

**Deine Daten bleiben erhalten.** Bibliothek, Einstellungen, Gesehen-Stand und
Favoriten liegen nicht im Programmordner, sondern hier:

```powershell
explorer "$env:APPDATA\com.ghgflix.app"
```

Von Hand geht es natürlich auch:

```powershell
cd "$env:USERPROFILE\Documents\GHGFlix"
npm install
npm run tauri build
explorer "$env:USERPROFILE\Documents\GHGFlix\src-tauri\target\release\bundle"
```

Nur schnell testen, ohne zu bauen:

```powershell
cd "$env:USERPROFILE\Documents\GHGFlix"
npm run tauri dev
```

Einzelne Prüfungen, falls beim Bauen etwas klemmt:

```powershell
cd "$env:USERPROFILE\Documents\GHGFlix"
npx tsc --noEmit
node server\src\parser.js --test
cd "$env:USERPROFILE\Documents\GHGFlix\server"
node test\scan.test.mjs
cd "$env:USERPROFILE\Documents\GHGFlix\src-tauri"
cargo test --lib
```

### Schritt 6 — Den Sync einmal scharf schalten

1. GHGFlix starten → **Einstellungen → Konto & Sync** → **Anmelden**
   (E-Mail `bastian.klaus2010@gmail.com`).
2. Bei der Frage **„Bisherigen Fortschritt übernehmen?“** → **Ja, hochladen**.
3. In den Einstellungen muss die Statuszeile grün werden:
   `● Verbunden — letzter Abgleich …`
4. **Gegenprobe:** Supabase öffnen → **Table Editor** → `watch_progress`.
   Dort müssen jetzt Zeilen stehen. Vorher waren es **0** — genau das war der
   Beweis für den Fehler.

### Schritt 7 — Handy-App neu bauen (optional, Version 1.2.0)

```powershell
cd "$env:USERPROFILE\Documents\GHGFlix\mobile"
npm install
npx eas-cli build --platform android --profile preview
```

### Schritt 8 — Bibliothek einmal neu einlesen (wegen „OrG!")

Nötig, damit die falsch zugeordnete Serie verschwindet. Die Erkennung ist
repariert, aber bereits eingelesene Dateien werden beim normalen Scan bewusst
nicht neu zugeordnet (sonst wären deine manuellen Korrekturen jedes Mal weg).

**Der sanfte Weg zuerst** — reicht meistens und ist ohne jedes Risiko:

1. In GHGFlix die Serie **OrG! (Come & Play)** öffnen
2. **Staffel → andere Serie** klicken
3. „Daredevil Born Again" suchen und auswählen

Das wird gemerkt und überlebt jeden weiteren Scan.

**Der gründliche Weg**, falls mehrere Serien betroffen sind:

Einstellungen → **Bibliothek** → **Bibliothek neu aufbauen**. Der Index wird
verworfen und komplett neu erkannt. **Dein Gesehen-Stand bleibt erhalten** — er
wird vorher in TMDb-Koordinaten gesichert und danach automatisch wieder
zugeordnet. Bei 608 Folgen dauert das einige Minuten.

### Schritt 9 — Prüfen, dass der Abgleich jetzt wirklich läuft

1. Am PC (neu gebaute App) oder im Browser eine Folge ~2 Minuten anschauen
2. Einstellungen → Konto & Sync → **Jetzt synchronisieren**
3. In Supabase nachsehen: **Table Editor → `watch_progress`**

Dort müssen jetzt Zeilen stehen. Vorher waren es 0 — bei Geräten
(`sync_devices`) stand dagegen schon 1, das heißt: die Verbindung stand, es gab
nur nichts zu senden. Genau das ist mit dem Profil-Fix behoben.

---

## Teil 5b: App auf Handy und Fernseher (neu dazugekommen)

### Die Antwort auf „ist das Docker-Ding für Websites und Apps da?"

**Ja — aber es war ein anderes**, als ich zuerst vermutet hatte: das
**VetNow Studio** (`vetnow-app`, läuft auf Port 3000). Das ist der Container,
der Web-Apps baut und Expo/Metro für Expo Go startet. GHGFlix war dort **nicht**
eingetragen — jetzt schon.

Neu im Studio, Gruppe **🎬 GHGFlix**:

| Karte | Was sie macht |
|---|---|
| **Handy-/TV-App (Expo Go)** | „Start" drücken → QR-Code scannen → App läuft. Klont das GHGFlix-Repo beim Start **automatisch** und zieht bei jedem Start die neueste Fassung. Port 8044. |
| **Server-Oberfläche öffnen** | Abkürzung zur laufenden GHGFlix-Bibliothek auf Port 8484 |

Der Knopf **„APK bauen"** auf der Expo-Karte funktioniert jetzt auch — dafür
habe ich `mobile/eas.json` angelegt (die Datei hat gefehlt, deshalb kam vorher
eine Fehlermeldung).

> **Beim allerersten Start:** Expo Go unterstützt immer nur die neueste
> SDK-Version. GHGFlix liegt noch auf SDK 53, VetNow/Avocado auf 54. Falls Expo
> Go meckert: auf der Karte einmal **„SDK 54 setzen"** drücken — das ist Expos
> eigener Aktualisierungsweg und erledigt alle Versionen automatisch.

Zusätzlich habe ich im Studio einen Fehler behoben: Apps aus **fremden Repos**
wurden beim „Start" nicht geklont (man musste vorher manuell „Klonen" drücken,
und ein Repo-Update kam nie an). Jetzt passiert beides automatisch.

### Der GHGFlix-Server verteilt die App jetzt selbst

Neu im Server (Version 2.3.0):

| Adresse | Was da kommt |
|---|---|
| `http://<server-ip>:8484/app` | **Installationsseite** — zeigt deine Adresse groß an, erklärt Handy, Fernseher und PWA, und sagt, ob schon eine App-Datei da ist |
| `http://<server-ip>:8484/apk` | die App-Datei direkt zum Herunterladen |

Beide sind **ohne Anmeldung** erreichbar — das muss so sein, weil die
„Downloader"-App am Fernseher kein Login-Formular anzeigen kann.

Die APK legst du **einmal** hier ab, dann überlebt sie jedes Server-Update:

```
/DATA/AppData/ghgflix/data/apk/GHGFlix.apk
```

### Wie kommt die App auf deinen PeaQ Smart Google TV?

**Kurz: ohne USB-Stick, über die App „Downloader".** Google TV ist Android TV,
also geht Sideload problemlos.

1. Am TV: **Einstellungen → System → Info** → 7-mal auf **Build** drücken
2. Play Store → **Downloader** (blaues Symbol, von AFTVnews) installieren
3. **Einstellungen → Apps → Sicherheit & Einschränkungen → Unbekannte Quellen**
   → **Downloader** einschalten
4. Downloader öffnen → `http://192.168.68.10:8484/apk` eintippen → **Go**
5. **Installieren** → **Öffnen** → Server-Adresse `192.168.68.10:8484` eintragen

USB-Stick geht auch (FAT32 + Datei-Manager wie X-plore), ist aber umständlicher.
Und ganz ohne Installation: Browser am TV → `http://<server-ip>:8484/?tv=1`.

**Die vollständige Anleitung mit allen Stolpersteinen steht in
[`tv/README.md`](tv/README.md).**

---

## Teil 6: Neue Einstellungen im docker-compose

Alle optional — die Standardwerte passen für eine ZimaBoard:

```yaml
TRICKPLAY: "on"            # Bilderstreifen für die Zeitleiste (off = aus)
TRICKPLAY_INTERVAL: "10"   # Sekunden zwischen zwei Vorschaubildern
TRICKPLAY_WIDTH: "240"     # Breite eines Vorschaubildes in Pixeln
THUMB_CACHE_MB: "512"      # Obergrenze für den Bild-Zwischenspeicher
THUMB_CONCURRENCY: "2"     # gleichzeitige ffmpeg-Aufrufe (schwaches NAS: 1)
MIN_VIDEO_MB: "1"          # kleinere Dateien gelten als Reste
```

Der Bilderstreifen wird beim **ersten Abspielen** einer Datei im Hintergrund
erzeugt (immer nur einer gleichzeitig, damit das NAS nicht einbricht). Bei einem
45-Minuten-Film dauert das auf einer ZimaBoard einige Minuten — danach ist die
Vorschau für diese Datei für immer sofort da.

---

## Teil 7: Bewusst offen geblieben

- **Lokale Bilddateien in der Windows-App.** Der Server nutzt jetzt
  `poster.jpg` & Co. Für die Windows-App müsste dafür der Rust-Teil geändert
  werden — das konnte ich hier nicht kompilieren und testen, und ungetesteten
  Rust-Code auszuliefern hätte den Desktop-Build gefährdet. Über den Server
  (Browser/Handy/TV) funktioniert es vollständig.
- **Native Android-TV-App** — unverändert der größte offene Punkt aus dem alten
  Plan (braucht echte Geräte zum Testen). Der TV-Browser-Modus läuft.
- **Zwei gleichnamige Serienordner in verschiedenen Bibliotheken** (z. B.
  deutsche und englische Fassung) werden zu einer Serie zusammengefasst — so
  verhält sich die Windows-App auch. Bei gleicher Auflösung gewinnt die zuerst
  eingelesene Datei, es wechselt also nichts von selbst.

---

## Anhang: Geänderte Dateien

**Server:** `parser.js` (neu geschrieben), `scanner.js` (neu geschrieben),
`tmdb.js` (neu geschrieben), `artwork.js` (neu), `thumbs.js` (neu), `db.js`,
`invoke.js`, `index.js`, `stream.js`, `supabase.js`, `test/scan.test.mjs` (neu)

**Windows-App / Weboberfläche:** `lib/supabase.ts` (neu geschrieben),
`lib/img.ts`, `lib/api.ts`, `components/Scrubber.tsx`, `pages/Player.tsx`,
`pages/Login.tsx`, `pages/Profiles.tsx`, `pages/Settings.tsx`, `main.tsx`

**Sonstiges:** `supabase/schema.sql`, `docs/SUPABASE.md` (neu),
`docker-compose.yml`, beide GitHub-Workflows, alle Versionsnummern
