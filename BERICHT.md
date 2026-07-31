# GHGFlix — Bericht: Server-Überholung, Erkennung, Vorschaubilder, Cloud-Sync

**Stand:** 31.07.2026 · **Versionen:** Desktop **1.0.0** · Server **2.3.2** · Handy **1.9.0**

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

### 8c. Und DANN stürzte sie beim Öffnen ab — mein Fehler

Der Absturz kam **genau mit meiner TV-Erweiterung**. Vorher war die App
unsichtbar (also nie gestartet), danach sichtbar — und stürzte sofort ab.

Ursache: Meine Erweiterung trug ins Manifest
`android:banner="@drawable/tv_banner"` ein und kopierte das Bild parallel dazu
in die Android-Ressourcen. Kommt diese Datei beim Cloud-Build **nicht** an —
der `android`-Ordner wird beim Bauen komplett neu erzeugt — verweist das
Manifest auf eine Ressource, die es nicht gibt. Android bricht die App dann
**sofort beim Start** ab: kurz schwarz, zurück ins Menü. Exakt dein Symptom.

Behoben ab 1.6.0: Das Kachelbild ist jetzt schlicht das **App-Symbol**
(`@mipmap/ic_launcher`) — eine Ressource, die garantiert existiert. Die
Datei-Kopie ist komplett entfernt, damit diese Fehlerquelle gar nicht mehr
existieren kann. Optisch etwas schlichter, dafür kann es nicht mehr schiefgehen.

### 8c-2. Und es lag NICHT am Banner — jetzt wird abgesichert statt geraten

Auch mit dem Banner-Fix stürzte die App ab. Damit sind drei Vermutungen
widerlegt (neue Architektur, Banner-Ressource, Leanback-Eintrag). Statt weiter
zu raten, sind ab 1.7.0 zwei Dinge anders:

**1. Die riskanten Module werden abgesichert geladen.** `expo-video` und
`expo-keep-awake` bringen native Bestandteile mit. Schlägt so ein Modul beim
Start fehl, riss es bisher die **ganze App** mit — genau das Symptom „kurz
schwarz, zurück ins Menü". Jetzt startet die App auf jeden Fall; fehlt der
Video-Baustein, erscheint oben ein gelber Hinweis mit der genauen Meldung, und
beim Abspielen steht „Videowiedergabe nicht verfügbar" statt eines Absturzes.

Damit gilt: **Startet die App jetzt und zeigt einen gelben Hinweis — dann war
`expo-video` die Ursache, und wir sehen es schwarz auf weiß.** Startet sie
immer noch nicht, liegt es tiefer und wir brauchen das Systemlog.

**2. Ein Skript holt das Log.** `scripts\tv-log-holen.ps1` besorgt adb,
koppelt sich mit dem Fernseher (führt durch den Kopplungscode), zeichnet den
Absturz auf, filtert die wichtigen Zeilen heraus und legt die Datei auf dem
Desktop ab. Kein Herumhantieren mehr mit Pfaden und Ports.

### 8d. `adb connect` lief in eine Zeitüberschreitung

`cannot connect to …:5555 (10060)` — Port 5555 ist bei Google TV schlicht
**nicht offen**. Der einfache `adb connect` funktioniert nur, wenn der Port
vorher per USB freigeschaltet wurde. Android 11+ (also auch dein PeaQ) will
stattdessen eine **Kopplung mit sechsstelligem Code** über *Drahtloses
Debugging*. Beide Wege stehen jetzt Schritt für Schritt in
[`tv/README.md`](tv/README.md).

Ebenfalls ergänzt: `winget install Google.PlatformTools` scheitert regelmäßig
am Hash-Vergleich (Google tauscht das Paket öfter aus als der winget-Katalog
nachzieht) — der direkte Download von Google klappt dagegen immer.

### 8e. Upload gab „404 Nicht gefunden"

Richtig so: Der Upload-Endpunkt kam erst nach dem letzten Server-Update dazu,
auf ZimaOS lief noch die alte Fassung. Der Server ist jetzt **2.3.2**, und das
Skript prüft vorab, ob der Server Dateien überhaupt annehmen kann — statt einer
nichtssagenden 404 steht dann im Klartext, was zu tun ist.

### 8f. Der Fernseher kann kein adb über WLAN — Diagnose ohne PC

Deine Entwickleroptionen zeigen im Abschnitt DEBUGGING nur **USB-Debugging**,
kein „Drahtloses Debugging". Damit ist der adb-Weg für dieses Gerät zu. Und
ein TV lässt sich auch nicht per Kabel als USB-Gerät an den PC hängen — die
USB-Buchsen am Fernseher sind Anschlüsse FÜR Sticks, nicht umgekehrt.

Deshalb gibt es jetzt eine **Diagnose-Fassung der App**
(`mobile/App.diagnose.js`, Bau-Profil `diagnose`). Sie importiert am Anfang
nichts außer React Native und prüft die Zusatzmodule erst nach dem ersten Bild.
Auf dem Fernseher steht dann schwarz auf weiß:

- ob das Grundgerüst startet (siehst du Text → ja)
- Android-Version, Modell, Hermes
- welches Modul sich **nicht** laden lässt (grün OK / rot FEHLER)

Ein Foto vom Bildschirm reicht zur Auswertung. Kein PC, kein adb.

Ebenfalls wichtig: Beim ersten Verbindungsversuch war **USB-Debugging noch
ausgeschaltet**. Manche Android-TVs öffnen Port 5555 erst, wenn es an ist —
ein erneuter Versuch kostet nichts und könnte den adb-Weg doch noch öffnen.

---

## ✅ NACHTRAG 4 — Der TV-Absturz ist gefunden

Das Systemlog vom Fernseher hat es in einer Zeile gezeigt:

```
FATAL EXCEPTION: mqt_native_modules
com.facebook.react.common.JavascriptException:
Error: Cannot find native module 'ExpoAsset'
```

### Was dahintersteckt

`expo-asset` lag in `node_modules/expo/node_modules/expo-asset` — also
**verschachtelt** unter dem expo-Paket statt auf oberster Ebene. Es stand nicht
in den Abhängigkeiten der App, sondern kam nur als Beiwerk von `expo` mit.

Expos Autolinking bindet den **nativen** Teil eines Moduls aber nur ein, wenn
es eine **direkte** Abhängigkeit ist. Ergebnis: Der JavaScript-Teil war da und
wollte beim Start `ExpoAsset` aufrufen — den nativen Gegenpart gab es in der
APK schlicht nicht. React Native bricht dann sofort ab: kurz schwarz, zurück
ins Menü.

**Warum es auf dem iPhone lief:** Expo Go bringt sämtliche Module fertig
vorinstalliert mit. Der Fehler kann dort gar nicht auftreten — er zeigt sich
ausschließlich in einem eigenen Build. Genau deshalb war er so schwer zu fassen.

### Die Reparatur

Vier Module sind jetzt **direkte** Abhängigkeiten, mit exakt den Versionen, die
Expo SDK 53 mitbringt:

| Modul | Version | wofür |
|---|---|---|
| `expo-asset` | ~11.1.7 | der eigentliche Übeltäter |
| `expo-file-system` | ~18.1.11 | wird von expo-asset gebraucht |
| `expo-constants` | ~17.1.8 | Geräte-Infos |
| `expo-font` | ~13.3.2 | hängt mit dran |

**Wichtig beim Bauen:** Erst `npm install` laufen lassen! Die Datei
`package-lock.json` liegt im Repo, und der Cloud-Build hält sich strikt daran.
Ohne aktualisierte Sperrdatei würde er die alte, kaputte Struktur erneut bauen.

### Was ich daraus mitnehme

Ich habe vier Runden lang geraten (neue Architektur, Banner-Ressource,
Modul-Absicherung, Leanback) — und alle vier lagen daneben. Das Log hat die
Sache in zwei Minuten geklärt. Bei einem Absturz, der vor dem ersten Bild
passiert, führt an den Systemlogs kein Weg vorbei; alles davor war verlorene
Zeit. Die Diagnose-Fassung und das Log-Skript bleiben im Projekt — beim
nächsten Mal steht die Ursache innerhalb von Minuten fest.

---

## NACHTRAG 5 — App startet, aber Verbindung und Bedienung

Nach dem ExpoAsset-Fix läuft die App am Fernseher. Zwei Punkte blieben:

### 10. „Nicht erreichbar — Network request failed"

Ab Android 9 blockiert das System unverschlüsseltes **http://** von sich aus.
Der GHGFlix-Server im eigenen Netz läuft aber genau so
(`http://192.168.68.10:8484`). Die App kam damit nie beim Server an und meldete
nur einen allgemeinen Netzwerkfehler.

`android.usesCleartextTraffic` stand zwar in der Konfiguration — es hängt aber
von der Plugin-Reihenfolge ab, ob es im fertigen Manifest landet. Ab 1.9.0
setzt die TV-Erweiterung `android:usesCleartextTraffic="true"` zusätzlich hart,
damit es garantiert drinsteht. Geprüft: Manifest enthält Leanback-Kategorie,
Kachelbild **und** die Cleartext-Freigabe.

### 11. Keine Markierung bei der Bedienung mit der Fernbedienung

Am Fernseher springt man mit den Pfeiltasten von Knopf zu Knopf — React Native
zeigt dabei von sich aus **keine** Markierung. Man sieht also nicht, ob man
gerade auf „Test" oder auf „X" steht. Praktisch unbedienbar.

Behoben: **24 Knöpfe und 5 Eingabefelder** haben jetzt eine Fokus-Anzeige —
dicker roter Rahmen und leicht getönter Hintergrund, sobald sie dran sind.
Auf dem Handy ändert sich nichts, dort gibt es keinen Tastaturfokus.

### 12. Expo Go am iPhone: SDK 53 gegen SDK 54

Der Studio-Log meldet „Project is incompatible with this version of Expo Go".
Expo Go im App Store gibt es immer nur in der neuesten Fassung (SDK 54), das
Projekt läuft auf SDK 53.

Der Studio-Knopf „SDK 54 setzen" wirkt dabei **nur im Container-Klon** — und
der wird bei jedem Start per `git reset --hard` zurückgesetzt (genau die
Reparatur aus Nachtrag 3). Deshalb ändert sich dauerhaft nichts.

Ein echter Umstieg tauscht React Native (0.79 → 0.81) und den Videoplayer
(expo-video 2.2 → 3.0) aus. Entscheidung: **erst den Fernseher fertigstellen**,
dann in Ruhe umsteigen. Für den TV wird Expo Go ohnehin nicht gebraucht — dort
läuft die fertige APK.

### 13. Studio-Logs ließen sich nicht kopieren

Das Log-Fenster aktualisiert sich alle 1,5 Sekunden und scrollt dabei weg —
Markieren war praktisch unmöglich. Es hat jetzt drei Knöpfe:
**Alles kopieren**, **Als Datei speichern** und **Aktualisierung pausieren**.

---

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

---

## Nachtrag 12 — Handy und Fernseher sehen jetzt aus wie die Desktop-App (App 2.0.0)

### Was beanstandet war

> „AM HANDY UND TV SIND NUR SERIEN UND FILME SO ALS LISTEN DA, ES SOLL ABER SO SEIN
> WIE IN PLEX, JELLYFIN UND DIESER DESKTOP APP."
>
> „Die Auswahl ist nur bei Textfeldern. Bei Filmen, Testen, X, Suche usw. ist es
> immer noch nicht [zu sehen]."

Beides ist behoben. Der zweite Punkt war die interessantere Nuss.

---

### Teil 1 — Der Startbildschirm

Vorher bestand er aus vier Elementen: Suchfeld, „Weiterschauen", „Serien",
„Filme". Die Desktop-App zeigt dagegen ein großes Kopfbild und acht Reihen.
Der Handy-Startbildschirm ist jetzt genauso aufgebaut:

| Bereich | Inhalt | Herkunft |
|---|---|---|
| **Kopfbild** | Großes Hintergrundbild, Titel, Bewertung, Kurzbeschreibung, „Ansehen" | die 8 neuesten Titel mit Hintergrundbild, Wechsel alle 12 s |
| Weiterschauen | breite Karten mit Fortschrittsbalken und Restzeit | `/api/continue` |
| Neu hinzugefügt | die 20 zuletzt eingelesenen Titel | `added_at` |
| Meine Liste | Favoriten | `/api/favorites` |
| Serien / Filme | vollständige Sammlung | `/api/library` |
| Top bewertet | alles ab Bewertung 7, absteigend | `rating` |
| Zuletzt gesehen | Verlauf | `/api/history` |
| Genre-Reihen | die fünf häufigsten Genres mit je mindestens 3 Titeln | `genres` |

Die Kacheln zeigen zusätzlich ein rotes **NEU**-Abzeichen (Titel jünger als
14 Tage), die Bewertung als ★-Wert und bei angefangenen Titeln einen
Fortschrittsbalken.

**Ohne zusätzliche Abhängigkeit.** Der weiche Übergang unter dem Kopfbild
entsteht aus sechs gestapelten Streifen zunehmender Deckkraft statt aus
`expo-linear-gradient`. Nach der Geschichte mit `expo-asset` (Nachtrag 9) gilt:
jedes native Modul, das nicht da ist, kann beim Start auch nicht fehlen.

---

### Teil 2 — Warum der Auswahlrahmen nur bei Textfeldern kam

Diesmal wurde **nachgesehen statt geraten** — die Lehre aus Nachtrag 9.

**Die Ursache.** In React Native 0.79 löst Android das Ereignis `topFocus`
ausschließlich im Textfeld-Manager aus:

```
node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/
    views/textinput/ReactTextInputManager.java     <- einzige Fundstelle
    views/view/ReactViewManager.kt                 <- kein Fokus-Ereignis
```

Die Props `onFocus`/`onBlur` einer `<View>` oder `<Pressable>` existieren zwar
in der Typdefinition, werden auf Android aber **nie aufgerufen**. Genau das war
zu sehen: Textfelder markiert, Knöpfe nicht.

**Die Lösung — ohne Fork.** React Native bringt eine kaum bekannte
Fernseh-Unterstützung mit. `ReactRootView` reicht Fernbedienungstasten *und
Fokuswechsel* als geräteweites Ereignis `onHWKeyEvent` an JavaScript weiter:

```
ReactAndroid/src/main/java/com/facebook/react/ReactAndroidHWInputDeviceHelper.java
    eventType : "focus" | "blur"
                "select" | "up" | "down" | "left" | "right"
                "playPause" | "rewind" | "fastForward" | "next" | "previous"
    tag       : native View-Nummer — dieselbe Zahl, die findNodeHandle() liefert
```

Jeder Knopf meldet beim Einhängen seine View-Nummer an eine zentrale Liste an.
Nennt das Ereignis genau diese Nummer, zeigt er den Rahmen. Damit ist der
Wechsel auf den Fork `react-native-tvos` **nicht nötig** — kein Risiko für die
Handy-Fassung, keine native Änderung, keine neue Abhängigkeit.

**Wichtig für später:** Das setzt die bewährte Architektur voraus
(`newArchEnabled: false`, in `app.json` ohnehin schon so gesetzt). Unter Fabric
gibt es `ReactRootView` nicht mehr. Beim späteren Umstieg auf SDK 54 mit neuer
Architektur muss dieser Block neu bewertet werden — dann wäre
`@react-native-tvos/config-tv` der Weg.

**Kein Springen beim Fokussieren.** Die Kacheln tragen den Rahmen von Anfang an,
nur in `transparent`. Fokussiert wechselt lediglich die Farbe, dazu kommt
`scale: 1.07`. Würde die Rahmenbreite erst beim Fokussieren entstehen, würde die
ganze Reihe verrutschen.

---

### Teil 3 — Die Fernbedienung bedient jetzt den Player

Aus demselben Ereignis fällt die Tastenbelegung mit ab:

| Taste | Wirkung |
|---|---|
| ⏯ Wiedergabe/Pause | anhalten / fortsetzen |
| ⏩ Vorlauf | 30 s vor |
| ⏪ Rücklauf | 10 s zurück |
| ▶▶ Nächster Titel | nächste Folge |
| ⏹ Stopp | Wiedergabe verlassen |
| ◀ ▶ Richtung | springt, solange die Bedienleiste aus ist |
| jede andere | holt die Bedienleiste zurück |

Die mittlere Taste ist **bewusst nicht belegt**: Ist ein Knopf ausgewählt, hat
Android den Druck bereits an ihn weitergereicht — eine zweite Reaktion würde
doppelt auslösen.

---

### Teil 4 — Detailseiten

Über dem Hintergrundbild lag pauschal `opacity: 0.55`, was flau wirkte und unten
hart abschnitt. Jetzt bleibt das Bild oben kräftig und läuft nach unten in den
Hintergrund aus — dieselbe Technik wie beim Kopfbild.

---

### Neuer Test: `mobile/test/laden.test.mjs`

```powershell
cd "$env:USERPROFILE\Documents\GHGFlix\mobile"
node test\laden.test.mjs
```

Der Test lädt `App.js` wirklich, mit Attrappen für alles Native. Er findet
fehlende Importe, Zugriffe auf noch nicht Definiertes und Tippfehler auf
Modulebene — also **genau die Fehlerklasse, die zum Absturz aus Nachtrag 9
geführt hat**, und zwar ohne Gerät und ohne Cloud-Build. Ein Durchlauf dauert
unter einer Sekunde; ein Cloud-Build dauert eine Viertelstunde.

### Geprüft

| Prüfung | Ergebnis |
|---|---|
| Ladetest `App.js` | kein Fehler auf Modulebene |
| Fokus-Verteilung (8 Fälle, gegen die echte Java-Ereignisfolge) | bestanden |
| Reihen-Logik (6 Fälle, gegen echte Datenbankstruktur) | bestanden |
| Stile: 59 benutzt, 57 definiert, keine fehlend, keine ungenutzt | sauber |
| Layout-Rechnung Kachel mit/ohne Fokus | 132 px = 132 px, kein Springen |
| Server-Tests (Parser, Scanner, Profile) | alle bestanden |

---

## Nachtrag 13 — Handy und Fernseher komplett neu gebaut (App 3.0.0)

### Die Rückmeldung, um die es ging

> „Der Rahmen ist bei mehr, aber immer noch nicht überall — z. B. bei Filmen
> und Serien. Und im Videoplayer.
> Beim Videoplayer kann ich ihn überhaupt nicht steuern. Es ist ganz schwer,
> in diese Oberfläche reinzukommen, und dann kann man nichts machen.
> Ich hab immer noch nicht links diese Tabs wie am PC mit Startseite, Filme,
> Serien, Einstellungen.
> Ich kann diese URL nicht noch mal über die TV-Fernbedienung eingeben.
> Es soll bitte wirklich eins zu eins ausschauen wie in der Desktop-App und
> Plex und Jellyfin."

Alle fünf Punkte sind erledigt. Der Reihe nach — und warum es beim ersten
Versuch nur halb geklappt hat.

---

### Warum der Rahmen bei Postern fehlte, obwohl er bei Knöpfen kam

Der erste Versuch (Nachtrag 12) hat Androids **eigenen** View-Fokus benutzt
und nur die Markierung selbst gezeichnet. Bei einzelnen Knöpfen ging das gut.
Bei Postern nicht — und der Grund ist grundsätzlicher Natur:

Androids Fokus-Suche arbeitet **geometrisch**. Sie sucht die nächste
fokussierbare View in Richtung des Tastendrucks, anhand von
Bildschirmkoordinaten. In waagerechten Listen werden Kacheln aber recycelt,
liegen teils außerhalb des sichtbaren Bereichs oder überlappen sich mit
Verläufen. Damit wird die Suche unvorhersehbar: mal springt sie über eine
Reihe hinweg, mal gar nicht, mal in ein unsichtbares Element. Über einem
formatfüllenden Video — dem Player — findet sie oft überhaupt keinen Weg zur
Bedienleiste. Genau das war zu beobachten.

**Die Lösung: die App bestimmt den Fokus selbst.** Das machen Netflix, Plex
und Jellyfin auf Fernsehern genauso. Der neue Fokus-Kern rechnet nicht mit
Koordinaten, sondern mit einem **logischen Raster**: jedes auswählbare Element
meldet Bereich, Zeile und Spalte an. Die Richtungstasten bewegen sich dann
durch dieses Raster.

```
Bereich "nav"      Bereich "inhalt"
┌──────────┐       Zeile 0  [ Ansehen ] [ Mehr Infos ]
│ Start    │       Zeile 1  [▣][▣][▣][▣][▣][▣][▣][▣]   Weiterschauen
│ Filme    │  ←→   Zeile 2  [▣][▣][▣][▣][▣][▣][▣][▣]   Neu hinzugefügt
│ Serien   │       Zeile 3  [▣][▣][▣][▣][▣][▣][▣][▣]   Meine Liste
│ …        │       …
└──────────┘
```

Drei Vorteile, die den Ausschlag gaben:

1. **Vorhersehbar.** Kein „warum springt er jetzt dorthin?"
2. **Ohne Gerät prüfbar.** Der Kern kennt weder React noch einen Bildschirm —
   43 Tests laufen in Millisekunden statt in einer Viertelstunde Cloud-Build.
3. **Schnell.** Kein Ausmessen von Views bei jedem Tastendruck.

Damit Androids Fokus-Suche nicht mehr dazwischenfunkt, sind alle Kacheln und
Knöpfe jetzt `focusable={false}`. Ein einziges unsichtbares Textfeld — der
**Anker** — hält den Android-Fokus fest, damit die Tasten überhaupt ankommen
(`ReactRootView.dispatchKeyEvent` läuft nur an, wenn irgendwo Fokus liegt).
Angenehmer Nebeneffekt: Weil nichts sonst fokussierbar ist, löst Android bei
OK auch keinen zweiten Klick mehr aus — keine doppelte Auslösung. Tippen am
Handy funktioniert unverändert, denn `focusable` betrifft nur das Steuerkreuz.

**Das Spalten-Gedächtnis** ist der Feinschliff, den man erst merkt, wenn er
fehlt: Wer in „Serien" bis zur siebten Kachel navigiert, eine Reihe runter
geht und wieder hoch, landet wieder auf der siebten — nicht auf der ersten.

---

### Der Videoplayer

Er benutzt jetzt dasselbe Fokus-System, mit einem festen Raster:

```
Zeile 0   ├──────────── Fortschrittsbalken ────────────┤
Zeile 1   [ ⏪10 ] [ ⏸ ] [ ⏩30 ] [ ⏭ Nächste ] [ 1× ] [ ℹ ]
```

← → **auf dem Balken** springen im Video statt den Fokus zu verschieben —
dafür kann ein Element im Kern die Richtungstasten für sich behalten
(`aufRichtung`). ↑ ↓ wechseln zwischen Balken und Knöpfen.

Zusätzlich wirken die Medientasten der Fernbedienung **immer**, auch bei
ausgeblendeter Leiste: ⏯ Pause, ⏪ 10 Sek, ⏩ 30 Sek, ⏭ nächste Folge,
⏹ beenden, ℹ Infos. Ist die Leiste aus, holt jede andere Taste sie zurück —
dafür reicht der Fokus unverbrauchte Tasten an den Bildschirm weiter.

Neu sind außerdem Geschwindigkeit (0,75× bis 2×) und eine Infoanzeige mit
Auflösung, Codec und Laufzeit.

**Bewusst beibehalten** wurde die Absicherung gegen
`NativeSharedObjectNotFoundException` (Position und Dauer laufen über Refs,
jeder Zugriff über `safe()`) und der **Rückfall auf Umwandeln**, wenn die
Direktwiedergabe scheitert. Ohne den bliebe bei DTS-Ton oder HEVC auf
schwächeren Geräten nur ein schwarzes Bild.

---

### Die Seitenleiste

Die Einträge sind exakt die der Desktop-App (`Layout.tsx`, Liste `NAV`):
**Start · Filme · Serien · Meine Liste · Suche · Einstellungen**, mit Zählern
hinter Filme und Serien und dem Profil-Knopf unten.

Im Ruhezustand ist sie schmal und zeigt nur Symbole; sobald die Auswahl
hineinwandert, fährt sie aus und zeigt die Beschriftungen. Genau wie bei Plex
und Jellyfin — und aus gutem Grund: Symbole allein sind aus drei Metern nicht
eindeutig, eine dauerhaft breite Leiste kostet aber ein Sechstel des Bildes.

Dazu kommen die Seiten, die vorher fehlten: **Filme** und **Serien** als
Raster über die ganze Sammlung, **Meine Liste**, eine eigene **Suche** und
**Einstellungen** mit Serverangaben, Profil und einer Übersicht der
Fernbedienungstasten.

---

### Keine URL mehr eintippen

Der berechtigte Einwand war: „http://192.168.68.157:8484" über eine
Bildschirmtastatur mit dem Steuerkreuz zu tippen, ist eine Zumutung.

**Die App sucht den Server jetzt selbst.** Im Heimnetz haben alle Geräte
dieselben ersten drei Zahlen, es sind also nur 254 Adressen zu prüfen; ein
`/api/ping` dauert im eigenen Netz wenige Millisekunden. Der Ablauf:

1. Antwortet eine **bereits bekannte** Adresse? → fertig in unter einer Sekunde
2. Sonst deren **Netz** durchsuchen — der Server ist meist noch da, nur unter
   neuer Nummer
3. Sonst die im Heimgebrauch üblichen Netze (Fritzbox, Telekom, Google Nest,
   Speedport …)

Erkannt wird der Server daran, dass `/api/ping` mit `app: "ghgflix-server"`
antwortet — eine Verwechslung mit einem Drucker oder Router ist ausgeschlossen
(zwei Tests decken genau das ab).

**Warum nicht `expo-network`?** Damit ließe sich die eigene IP direkt abfragen.
Das wäre aber ein weiteres natives Modul — und genau so eines (`expo-asset`)
hat die Fernseh-App wochenlang beim Start abstürzen lassen, weil es nur
mittelbar installiert war. Der Weg ohne kommt zum selben Ergebnis.

Die Eingabe von Hand bleibt als Rückfalltür: am Handy oft schneller, und für
einen Server außerhalb des Heimnetzes der einzige Weg.

---

### Aufbau

Aus einer Datei mit 1650 Zeilen sind neun übersichtliche geworden:

| Datei | Inhalt | Zeilen |
|---|---|---|
| `src/fokus-kern.js` | Auswahl-Logik, ohne React, voll testbar | ~290 |
| `src/fokus.js` | Verbindung mit React Native, Anker, Tasten | ~300 |
| `src/stile.js` | Farben und Maße aus der Desktop-App | ~250 |
| `src/bausteine.js` | Kacheln, Reihen, Kopfbild, Dialoge | ~330 |
| `src/seitenleiste.js` | die Navigation links | ~120 |
| `src/seiten.js` | alle Seiten | ~600 |
| `src/player.js` | Wiedergabe | ~400 |
| `src/netzsuche.js` | Serversuche im Heimnetz | ~170 |
| `src/verbindung.js` | erster Bildschirm | ~240 |

Die Maße skalieren über einen einzigen Schalter: Ab 900 Punkten Bildschirm-
breite — also auf praktisch jedem Fernseher — werden Kacheln, Schriften und
Abstände größer. Ein Satz Stile bedient damit Handy und Fernseher.

---

### Getestet — 117 Prüfungen, alle bestanden

```powershell
cd "$env:USERPROFILE\Documents\GHGFlix\mobile"
node test\fokus.test.mjs         # 43  Auswahl-Logik
node test\netzsuche.test.mjs     # 20  Serversuche (mit echtem Testserver)
node test\laden.test.mjs         # 20  alle Module laden, Exporte vollständig
node test\oberflaeche.test.mjs   # 34  echtes Rendern + Fernbedienung
```

Der letzte ist der aussagekräftigste: Er **rendert die Oberfläche wirklich**
und drückt danach die Tasten der Fernbedienung. Damit ist belegt, was am Gerät
nicht ging:

| Prüfung | Ergebnis |
|---|---|
| Poster-Kacheln melden sich beim Fokus an | 7 Reihen, jede Kachel eigene Spalte |
| Startbildschirm-Zeilen lückenlos | 0 – 8, keine Lücke |
| Seitenleiste erreichen und verlassen | ← hinein, → heraus |
| OK löst wirklich aus | `titel:Dune`, `nav:movies` |
| Player-Bedienleiste erreichbar | Balken + 6 Knöpfe + Zurück |
| ← → auf dem Balken springt statt Fokus zu bewegen | bestätigt |
| Filme-Raster mit 23 Titeln | 23 auswählbar, 4 Zeilen, Spalten eindeutig |
| Leere Bibliothek / Titel ohne Bild | stürzt nicht ab |

Weil `react-test-renderer` nicht nachinstallierbar ist (Paketquelle gesperrt),
liegt in `test/mini-renderer.mjs` ein kleiner eigener Renderer: er ruft die
Komponenten auf, bedient die benutzten Hooks und läuft durch den Elementbaum.
Layout und Bilder kann er nicht — dafür gibt es das Gerät. Für Logik reicht er.

**Eine Falle, die dabei auffiel:** `node --check` prüft Dateien mit
`import`/`export` als ES-Modul und meldet **JSX-Fehler nicht**. Eine Datei
voller kaputtem JSX kommt dort als „in Ordnung" durch. Nur echtes Übersetzen
und Laden gibt Sicherheit — deshalb der Ladetest.

Die Servertests (Parser, Scanner, Profile) laufen unverändert durch; alle 14
Endpunkte, die die neue App benutzt, wurden gegen `server/src/index.js`
gegengeprüft.

---

## Nachtrag 14 — Ton, Untertitel, Einstellungen, QR-Kopplung, Selbst-Update
### (App 3.1.0 · Server 2.4.0)

### Vier Wünsche, vier Antworten

> „Ton, Untertitel, alles soll gehen! Und alles im Player, Einstellungen und
>  alles rein! QR-Code wäre gut, weil dann muss ich die Infos nicht per
>  Fernseher eingeben. Können wir das Updaten auch leichter machen — ohne
>  dass ich schon wieder die URL eingeben muss im Downloader?"

---

### 1 · Ton- und Untertitelspuren

**Am Server.** `ffprobe` liest jetzt alle Spuren einer Datei aus und der
Server merkt sie sich (neue Spalte `tracks`), damit das nicht bei jedem
Abspielen erneut laufen muss. Aufbereitet wird gleich mit:

| Rohdaten von ffprobe | was die App zeigt |
|---|---|
| `language=ger, title=Kommentar, channels=6` | **Deutsch · Kommentar · 5.1 · AC3** |
| `language=eng, disposition.forced=1` | **Englisch · erzwungen** |

Untertiteldateien **neben dem Video** werden ebenfalls gefunden — das ist
gängige Praxis und Plex wie Jellyfin machen es genauso:

```
Film.mkv
Film.de.srt              → Deutsch · Datei
Film.eng.srt             → Englisch · Datei
Film.de.forced.srt       → Deutsch · erzwungen · Datei
Subs/3_German.srt        → auch der Unterordner wird durchsucht
```

**Warum Untertitel nicht eingebrannt werden.** ffmpeg könnte sie ins Bild
rendern. Das erzwingt aber eine Neukodierung des Videos (Last auf dem NAS),
jedes Umschalten dauert Sekunden, und Größe und Farbe wären festgelegt. Der
Server liefert sie stattdessen als **WebVTT-Text**, die App zeichnet sie
selbst: sofortiges Umschalten, praktisch keine Last — und einstellbar.

Ausnahme sind **Bild-Untertitel** (PGS von Blu-ray, VOBSUB von DVD). Die
enthalten Grafiken statt Text. Sie werden erkannt und gar nicht erst
angeboten, mit einem erklärenden Hinweis — besser als eine leere Anzeige.

**Umschalten im Player:**

| Fall | Weg |
|---|---|
| Ton, Direktwiedergabe | expo-video schaltet die eingebettete Spur um — ohne Aussetzer |
| Ton, beim Umwandeln | Server bekommt `&a=<Nummer>`, Strom wird an derselben Stelle neu aufgebaut |
| Untertitel | immer als Text vom Server, sofort umschaltbar |

---

### 2 · Alles im Player einstellbar

Die Bedienleiste hat jetzt neben ⏪ ⏯ ⏩ ⏭ auch **Ton**, **Untertitel**,
**Tempo**, **Bildanpassung** und **Info**. Dazu eine vollständige
Einstellungsseite:

**Wiedergabe** — Sprungweite vor und zurück (je einzeln), Geschwindigkeit,
nächste Folge automatisch, Bildanpassung (Einpassen / Füllen / Verzerren),
ab wann fortgesetzt wird.

**Untertitel** — beim Start einschalten, bevorzugte Sprache, Schriftgröße
(sechs Stufen bis „Riesig"), Schriftfarbe, Hintergrundkasten, schwarze
Kontur, Höhe über dem Rand, Zeitversatz von −3 bis +3 Sekunden für den Fall,
dass sie zu früh oder zu spät kommen.

**Bedienung** — wie lange die Bedienleiste stehen bleibt (auch „Nie"), ob
beim Start nach Updates gesehen wird.

Jede Einstellung trägt ihre Erklärung direkt darunter. Beim Abspielen wird
die passende Ton- und Untertitelspur automatisch nach den Vorlieben gewählt —
gewünschte Sprache, sonst die als Standard markierte, sonst die erste.
`ger`, `de` und `deu` gelten dabei als dieselbe Sprache.

---

### 3 · QR-Kopplung — kein Passwort mehr am Fernseher

Den Server findet die App seit 3.0.0 selbst. Was fehlte, war das Passwort.

```
1. Fernseher fordert einen Code an        POST /api/pair/start   →  K7M2QX
2. Fernseher zeigt ihn als QR-Code        http://server/koppeln?code=K7M2QX
3. Handy scannt, öffnet die Seite, gibt dort das Passwort ein
4. Fernseher fragt nach und bekommt sein Token    /api/pair/check
```

Der Code besteht aus sechs Zeichen eines Alphabets **ohne verwechselbare
Zeichen** (kein 0/O, kein 1/I/L, kein 2/Z, 5/S, 8/B) — aus zwei Metern
eindeutig ablesbar. Er gilt zehn Minuten, lässt sich genau einmal einlösen
und wird danach gelöscht. Wer ihn errät, braucht immer noch das Passwort: Die
Kopplung ersetzt keine Sicherheit, sie verlagert nur die Eingabe aufs Handy.

Die Seite, die das Handy öffnet, ist bewusst schlichtes HTML **ohne
JavaScript** — sie muss auf jedem Handy-Browser sofort funktionieren.

**Der QR-Code ist selbst geschrieben** (`mobile/src/qr.js`, nach
ISO/IEC 18004, Byte-Modus, Fehlerkorrektur M, Versionen 1–10). Die üblichen
Pakete bringen `react-native-svg` mit, also ein weiteres natives Modul — und
genau so eines hat die Fernseh-App wochenlang beim Start abstürzen lassen.
Ein QR-Code ist am Ende ein Schwarz-Weiß-Raster; das lässt sich aus
Rechtecken zeichnen, die React Native ohnehin kann.

> **Ein Fehler, den nur der Test gefunden hat.** Im Erzeugerpolynom für die
> Reed-Solomon-Fehlerkorrektur waren zwei Anteile vertauscht. Das Ergebnis
> sah völlig normal aus, der Text ließ sich sogar zurücklesen — nur die
> Fehlerkorrekturbytes waren Unsinn, und ein echtes Lesegerät hätte den Code
> verweigert. Sichtbar wurde es erst dadurch, dass der Test die
> **Reed-Solomon-Syndrome** nachrechnet: Bei korrekter Kodierung müssen sie
> alle null sein. Ohne diese Prüfung wäre der Fehler erst am Fernseher
> aufgefallen — als „das Handy erkennt nichts", ohne jeden Hinweis auf die
> Ursache.

---

### 4 · Updates ohne URL-Tippen

Die App kennt ihren Server. Sie fragt beim Start nach, ob dort eine neuere
Fassung liegt, und zeigt in den Einstellungen einen Knopf. Ein Druck startet
den Download — niemand tippt mehr eine Adresse.

Damit der Vergleich möglich ist, schickt `apk-hochladen.ps1` die
Versionsnummer aus `mobile/app.json` mit; der Server legt sie neben der Datei
ab und meldet sie unter `/api/apk/status`.

Verglichen wird **zahlenweise**, nicht als Text: `3.10.0` ist neuer als
`3.9.0` — ein Textvergleich käme hier zum falschen Ergebnis, weil „9" nach
„1" kommt. Genau daran scheitern Selbst-Updates in der Praxis am häufigsten,
deshalb prüfen das fünf eigene Tests.

Ist `expo-intent-launcher` vorhanden, wird die Installation direkt
angestoßen; fehlt es, übernimmt Android den Download wie bei einem
angetippten Link. Beide Wege kommen ohne Tipparbeit aus.

---

### Neue Tests — 220 in der App, 73 im Server

```powershell
cd "$env:USERPROFILE\Documents\GHGFlix\mobile"
node test\fokus.test.mjs          # 43  Auswahl mit der Fernbedienung
node test\untertitel.test.mjs     # 39  WebVTT lesen und anzeigen
node test\qr.test.mjs             # 33  QR-Code, mit Rücklesen
node test\update.test.mjs         # 23  Versionsvergleich
node test\netzsuche.test.mjs      # 20  Serversuche mit echtem Testserver
node test\laden.test.mjs          # 28  alle Module laden
node test\oberflaeche.test.mjs    # 34  echtes Rendern + Fernbedienung
```

```powershell
cd "$env:USERPROFILE\Documents\GHGFlix\server"
node test\spuren.test.mjs         # 41  Ton/Untertitel, mit echter Videodatei
node test\koppeln.test.mjs        # 32  Kopplung, Ablauf und Fehlerfälle
node test\scan.test.mjs           #     Bibliothekssuche
node test\profile.test.mjs        #     Profile und Cloud-Abgleich
node src\parser.js --test         #     Titelerkennung
```

Zwei davon prüfen mit **echten Dateien** statt mit Attrappen:

- `spuren.test.mjs` baut per ffmpeg eine Videodatei mit zwei Tonspuren
  (deutsch mit Titel, englisch) und zwei Untertitelspuren, lässt den Server
  sie erkennen, holt eine eingebettete Spur als WebVTT heraus und prüft den
  Inhalt.
- `netzsuche.test.mjs` startet einen echten HTTP-Server und lässt die Suche
  ihn finden — samt der Gegenprobe, dass fremde Geräte (ein Drucker, eine
  Fritzbox) **nicht** fälschlich für den GHGFlix-Server gehalten werden.

Die Untertitel-Anzeige wurde auch auf Geschwindigkeit geprüft: 14 400
Abfragen über einen zweistündigen Film mit 1800 Untertiteln brauchen 11 ms.
Möglich macht das eine halbierende Suche mit gemerkter Fundstelle statt eines
Durchlaufs über alle Blöcke.

### Nachtrag zu einem selbstverschuldeten Fehler

Beim Schreiben der Einstellungen ist ein deutsches Anführungszeichen nicht
geschlossen worden (`„Füllen"` statt `„Füllen“`), wodurch eine Zeichenkette
mitten im Text endete. Der Ladetest hat es sofort gemeldet — genau dafür ist
er da. Alle Dateien wurden daraufhin durchgesehen und die Paare korrigiert.

### Versionen

| Teil | Version | Grund |
|---|---|---|
| **Server** | **2.4.0** | neue Endpunkte: Spuren, Untertitel, Kopplung |
| App | 3.1.0 | Ton, Untertitel, Einstellungen, QR, Selbst-Update |

**Der Server muss diesmal aktualisiert werden** — in ZimaOS auf `2.4.0`
stellen. Ohne ihn gibt es keine Spuren und keine Kopplung.
