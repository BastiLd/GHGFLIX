# Supabase-Sync — die vollständige Anleitung

Diese Anleitung erklärt **jeden einzelnen Schritt**, damit dein Fortschritt
(gesehene Folgen, angefangene Filme, „Meine Liste“) zwischen PC, Handy,
Fernseher und Browser überall gleich ist.

---

## Teil 0: Was da eigentlich passiert (in einfachen Worten)

GHGFlix speichert deinen Fortschritt zunächst **nur auf dem Gerät**, auf dem du
schaust. Damit alle Geräte denselben Stand sehen, braucht es einen Ort, den alle
erreichen. Es gibt zwei solche Orte, und GHGFlix nutzt jetzt **beide**:

| Weg | Wer redet mit wem | Wofür |
|---|---|---|
| **A — Cloud** | Windows-App ⇄ Supabase | funktioniert auch, wenn der Server aus ist oder du unterwegs bist |
| **B — Server** | Windows-App ⇄ Docker-Server ⇄ Supabase | Handy/Fernseher hängen am Server, der Server hängt an der Cloud |

Damit sich beides nicht ins Gehege kommt, wird alles über **TMDb-Nummern**
verglichen (jeder Film und jede Folge hat eine weltweit eindeutige Nummer) und
bei Unterschieden gewinnt **immer der neuere Stand**. Es kann also nichts
verloren gehen und nichts doppelt gezählt werden.

### Was vorher kaputt war (und warum nichts ankam)

1. Die Windows-App hat **nur dann** hochgeladen, wenn du auf dem
   Profil-Bildschirm ausdrücklich ein **Cloud-Profil** angeklickt hast. Beim
   normalen Benutzen mit dem Standardprofil „Lokal“ passierte **gar nichts**.
2. Selbst wenn du auf ein Cloud-Profil umgeschaltet hast, blieb die Cloud leer:
   dein gesamter bisheriger Fortschritt lag intern unter dem Profil „Lokal“ —
   hochgeladen wurde aber nur, was unter der **neuen** Profil-Nummer stand, und
   das war schlicht nichts.

**Beides ist jetzt behoben.** Die App verknüpft dein lokales Profil einmalig
fest mit einem Cloud-Profil und gleicht danach **immer** ab: alle 60 Sekunden
und jedes Mal, wenn das Fenster wieder in den Vordergrund kommt.

---

## Teil 1: Supabase einrichten (einmalig, ca. 5 Minuten)

> Falls du das Projekt schon hast (**GHG FLIX**), springe direkt zu Schritt 1.4 —
> das Schema wurde erweitert und muss einmal neu eingespielt werden.

### 1.1 Konto und Projekt

1. Auf [supabase.com](https://supabase.com) gehen → **Start your project** →
   mit E-Mail oder GitHub anmelden (kostenlos).
2. **New project** anklicken.
3. Ausfüllen:
   - **Name**: `GHG FLIX` (der Name ist egal)
   - **Database Password**: ein sicheres Passwort — **aufschreiben!** Du
     brauchst es zwar für GHGFlix nicht, aber ohne kommst du später nicht mehr
     an die Datenbank.
   - **Region**: `West EU (Ireland)` oder `Central EU (Frankfurt)` — je näher,
     desto schneller.
4. **Create new project** → jetzt 1–2 Minuten warten, bis oben „Project is
   healthy“ steht.

### 1.2 Die Tabellen anlegen

1. Links im Menü auf **SQL Editor** (Symbol: `>_`).
2. Oben auf **New query**.
3. Die Datei [`supabase/schema.sql`](../supabase/schema.sql) aus dem GHGFlix-Ordner
   öffnen, **den gesamten Inhalt** kopieren und in das große Feld einfügen.
4. Unten rechts auf den grünen Knopf **Run** (oder `Strg`+`Enter`).
5. Es muss `Success. No rows returned` erscheinen.

> Das Skript ist gefahrlos mehrfach ausführbar — es löscht keine vorhandenen
> Daten, sondern legt nur an, was noch fehlt.

Damit existieren vier Tabellen:

| Tabelle | Inhalt |
|---|---|
| `profiles` | deine Profile (wie die Netflix-Profile) |
| `watch_progress` | wo du in welchem Film/welcher Folge stehst |
| `watch_favorites` | „Meine Liste“ |
| `sync_devices` | welches Gerät zuletzt wann abgeglichen hat |

Alles ist mit **Row Level Security** abgesichert: Selbst wenn jemand deinen
öffentlichen Schlüssel hätte, sieht er **ohne deine Anmeldung keine einzige
Zeile**.

### 1.3 E-Mail-Bestätigung ausschalten (empfohlen, sonst nervt es)

1. Links **Authentication** → **Sign In / Providers** → **Email**.
2. **Confirm email** ausschalten → **Save**.

Ohne diesen Schritt musst du nach dem Registrieren erst einen Link in deiner
E-Mail anklicken, bevor die Anmeldung funktioniert.

### 1.4 Die beiden Schlüssel holen

Supabase hat **zwei verschiedene Schlüssel**. Sie werden ständig verwechselt —
deshalb hier ganz genau:

1. Links unten auf **Project Settings** (Zahnrad) → **API Keys**.

| Wo eintragen | Welcher Schlüssel | Erkennungsmerkmal |
|---|---|---|
| **Windows-App** → Einstellungen → Konto & Sync | **anon / public** | beginnt mit `eyJ…` oder `sb_publishable_…` |
| **Server-Weboberfläche** → Einstellungen → „Server-Sync mit Supabase“ | **service_role / secret** | beginnt mit `eyJ…` oder `sb_secret_…`, ist als „secret“ markiert |

Außerdem brauchst du die **Project URL** (steht unter *Project Settings → API*
oder *Data API*) — sie sieht so aus:

```
https://etgttnbcgbbzpudueavj.supabase.co
```

> ⚠️ **Der Service-Role-Key ist ein Generalschlüssel.** Er darf **nur** in deinen
> Docker-Server, niemals in die Handy-App, niemals in einen Browser und niemals
> in ein öffentliches GitHub-Repository.

---

## Teil 2: Windows-App verbinden

1. GHGFlix starten → **Einstellungen** (Zahnrad) → Reiter **Konto & Sync**.
2. **Project URL** eintragen (`https://….supabase.co`).
3. **Anon Key** eintragen (der `eyJ…`-Schlüssel, *nicht* der secret).
4. **Speichern**.
5. Auf **Anmelden** klicken.
6. Beim ersten Mal: Reiter **Registrieren** wählen, E-Mail + Passwort (min. 6
   Zeichen) eingeben → **Konto erstellen**. Danach ganz normal **Anmelden**.
7. Jetzt kommt die neue Nachfrage:

   > **„Bisherigen Fortschritt übernehmen?“ — Auf diesem PC sind *N*
   > gespeicherte Einträge. Sollen sie in dein Konto hochgeladen werden?“**

   → **Ja, hochladen** anklicken. Das ist der Schritt, der vorher fehlte.

8. Zurück in **Einstellungen → Konto & Sync** steht jetzt unten eine
   Statuszeile:

   ```
   ● Verbunden — letzter Abgleich 21:14:03 (147 gesendet, 0 empfangen)
   ```

   Grün = alles gut. Rot = es steht dort im Klartext, was schiefläuft.
   Der Knopf **Jetzt synchronisieren** erzwingt jederzeit einen Abgleich.

Ab jetzt läuft der Abgleich **automatisch**: alle 60 Sekunden und immer, wenn du
das Fenster wieder in den Vordergrund holst. Du musst **nichts** mehr anklicken
und **kein** Cloud-Profil mehr auswählen.

---

## Teil 3: Docker-Server verbinden (für Handy und Fernseher)

1. Im Browser `http://<server-ip>:8484` öffnen (z. B. `http://192.168.1.50:8484`).
2. **Einstellungen** (Zahnrad) → **Konto & Sync**.
3. Ganz oben der Abschnitt **„Server-Sync mit Supabase (Cloud-Relay)“**:
   - **Project URL**: dieselbe URL wie oben
   - **Service-Role-Key**: der **secret**-Schlüssel (nicht der anon!)
   - **Senden** und **Empfangen** beide angehakt lassen
4. **Speichern** → der erste Import startet sofort von selbst.
5. Die Statuszeile muss **„Verbunden“** zeigen.

Alternativ per docker-compose (Umgebungsvariablen):

```yaml
environment:
  SUPABASE_URL: "https://etgttnbcgbbzpudueavj.supabase.co"
  SUPABASE_SERVICE_KEY: "sb_secret_…"
```

---

## Teil 4: Prüfen, ob es wirklich funktioniert

### Prüfung 1 — in Supabase nachsehen (der ehrlichste Test)

1. Supabase öffnen → links **Table Editor** → Tabelle **watch_progress**.
2. Dort müssen jetzt **Zeilen stehen**. Vorher waren es genau **0** — das war
   der Beweis, dass nichts hochgeladen wurde.

Wenn die Tabelle nach einem Abgleich leer bleibt, siehe Teil 5.

### Prüfung 2 — zwei Geräte

1. Am PC eine Folge starten, ca. 2 Minuten schauen, zurück zur Übersicht.
2. Bis zu 60 Sekunden warten (oder in den Einstellungen **Jetzt
   synchronisieren** drücken).
3. Am Handy die App öffnen → die Folge muss unter **„Weiterschauen“** mit
   demselben Fortschrittsbalken auftauchen.

### Prüfung 3 — „Meine Liste“

Am PC ein Herz setzen → am Handy muss der Titel in „Meine Liste“ erscheinen.

---

## Teil 5: Wenn es nicht klappt

Die Statuszeile in den Einstellungen sagt dir im Klartext, was los ist. Die
häufigsten Fälle:

| Meldung / Symptom | Ursache | Lösung |
|---|---|---|
| „Abgleich noch nicht gestartet“ | nicht angemeldet | Einstellungen → Konto & Sync → **Anmelden** |
| `Invalid API key` | anon- und service-Key vertauscht | Windows-App braucht **anon**, Server braucht **service_role** |
| `relation "watch_favorites" does not exist` | altes Schema | `supabase/schema.sql` erneut im SQL-Editor ausführen |
| `new row violates row-level security policy` | Anmeldung abgelaufen | einmal ab- und wieder anmelden |
| `Failed to fetch` | falsche URL oder kein Internet | URL prüfen: muss mit `https://` beginnen und auf `.supabase.co` enden |
| Tabelle bleibt leer, kein Fehler | keine TMDb-Zuordnung | Nur Titel **mit** TMDb-Nummer werden abgeglichen. Einstellungen → TMDb-Schlüssel eintragen und neu scannen |
| Zwei Geräte zeigen Unterschiedliches | Abgleich noch nicht gelaufen | bis zu 60 s warten oder **Jetzt synchronisieren** drücken |

### Warum ein Titel manchmal nicht mitkommt

Der Abgleich läuft über die **TMDb-Nummer**. Ein Film, den GHGFlix keinem
TMDb-Eintrag zuordnen konnte (Anzeige ohne Poster), hat keine Nummer — und
kann deshalb auch nicht abgeglichen werden. Abhilfe: im Kontextmenü des Titels
**Identifizieren** wählen und den richtigen Treffer anklicken. Diese Zuordnung
wird gemerkt und überlebt sogar „Bibliothek neu aufbauen“.

---

## Teil 6: Fragen, die immer kommen

**Kostet Supabase etwas?**
Nein. Der kostenlose Tarif reicht für diesen Zweck bei Weitem — es werden nur
ein paar Kilobyte Text gespeichert, keine Videos.

**Sieht Supabase meine Filme?**
Nein. Übertragen werden nur Nummern und Sekundenstände (z. B. „TMDb 1399,
Staffel 1, Folge 2, bei 1234 Sekunden“). Keine Dateien, keine Dateinamen, keine
Videos.

**Was, wenn ich Supabase gar nicht will?**
Dann lass die Felder leer. Der Abgleich über den Docker-Server im eigenen
Netzwerk funktioniert völlig unabhängig davon.

**Kann ich alles zurücksetzen?**
Ja: Supabase → **Table Editor** → `watch_progress` → alle Zeilen löschen. Beim
nächsten Abgleich wird der Stand vom Gerät neu hochgeladen.

**Werden Daten gelöscht, wenn zwei Geräte unterschiedliche Stände haben?**
Nein. Es gewinnt immer der **neuere** Zeitstempel, und beide Seiten behalten
alles, was die andere nicht kennt.
