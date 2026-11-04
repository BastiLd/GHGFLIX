# GHGFlix über F-Droid installieren und aktualisieren

Repository-URL:

```text
https://bastild.github.io/GHGFLIX/fdroid/repo?fingerprint=EE36538C170E4D826AF962FE1211F86731370D62B85387E128FAFAA14B92B5C3
```

In F-Droid unter **Einstellungen → Paketquellen → Hinzufügen** eintragen und den Fingerabdruck vergleichen. Danach die Paketquellen aktualisieren. Handy und TV sind getrennte Apps. Ein Android-Update benötigt eine höhere `versionCode` und denselben APK-Signierer; der Index behält die ursprünglichen APK-Signaturen bei.

## Was automatisch passiert

`.github/workflows/fdroid.yml` läuft auf `main`, täglich und auf manuellen Aufruf. Veröffentlichte/bearbeitete Releases fordern einen Lauf auf `main` an. Tags und Pull Requests erhalten keine Index-Signing-Secrets. PRs führen nur die Prüfungen ohne Secrets aus.

Die Pipeline importiert die letzten zwei passenden stabilen APK-Releases. Zusätzlich können fertige signierte APKs unter `fdroid/repo/` eingecheckt werden. Paketkennungen und SHA-256-Zertifikate müssen in `fdroid/repository.json` freigegeben sein. Abweichende, beschädigte oder Debug-APKs und unterschiedliche APK-Bytes mit derselben `versionCode` werden abgewiesen. Pro App bleiben die zwei höchsten Versionscodes im veröffentlichten Index.

Der Signierjob hat nur Lesezugriff aufs GitHub-Repository. Er erzeugt den Index mit den offiziellen **fdroidserver 2.4.5**-Werkzeugen und prüft anschließend Signatur, Fingerabdruck und APK-Hashes. Auch ein absichtlich veränderter Index und ein falscher Fingerabdruck müssen abgewiesen werden. Der getrennte Veröffentlichungsjob erhält Schreibzugriff, aber keine Signierschlüssel.

**Abweichung zur angefragten Action:** `f-droid/action-setup` ist unter dieser GitHub-Adresse nicht öffentlich verfügbar (404, geprüft am 04.11.2026). Es wird keine gleichnamige fremde oder ungeprüfte Ersatz-Action ausgeführt. Die offiziellen Servertools werden direkt aus festgelegten PyPI-Paketen mit vollständigen SHA-256-Hashes installiert. GitHub-Actions sind auf konkrete Commit-SHAs festgelegt.

## Einmalige GitHub-Einstellungen und Secrets

1. **Settings → Environments → `fdroid-signing`:** Deployment branches auf **Selected branches and tags**, ausschließlich den Branch `main` erlauben. Keine Tag-Freigabe. Damit bleiben Signierschlüssel auch bei einem manuellen Lauf von anderen Branches gesperrt.
2. Dort unter **Environment secrets** zwei Werte einrichten:

   | Secret | Inhalt |
   | --- | --- |
   | `FDROID_KEYSTORE_BASE64` | Base64 der dauerhaften verschlüsselten PKCS#12-Datei `index.p12`, als eine Zeile |
   | `FDROID_KEYSTORE_PASSWORD` | Das starke Passwort dieser Datei; wird auch für den Schlüssel verwendet |

   Alias und öffentlicher Fingerabdruck stehen in `fdroid/repository.json`. Kein privater Schlüssel wird eingecheckt, als Workflow-Artefakt hochgeladen oder nach `gh-pages` kopiert. Ein fehlendes/falsches Secret führt zum Abbruch; die Pipeline erzeugt niemals automatisch einen neuen Schlüssel.

3. Der erste erfolgreiche Signierlauf legt den Branch `gh-pages` an. Danach **Settings → Pages → Build and deployment → Deploy from a branch → `gh-pages` → `/ (root)`** auswählen und HTTPS verwenden. Anschließend den Veröffentlichungsjob bzw. den gesamten F-Droid-Workflow erneut starten.
4. Kein zusätzlicher PAT/Deploy-Key nötig. Der Veröffentlichungsjob nutzt den kurzlebigen `GITHUB_TOKEN` mit `contents: write` und `pages: write`, ausschließlich für den eigenen Branch `gh-pages` und die Pages-Build-Anforderung. Globale Workflow-Schreibrechte werden dafür nicht erweitert. Ein Push mit `GITHUB_TOKEN` startet Pages nicht automatisch; deshalb fordert die Pipeline den Pages-Build ausdrücklich über die GitHub-API an.

Der Branch `gh-pages` ist ausschließlich generierte Ausgabe dieses Publishers. Fremde/manuelle Inhalte oder ein abweichender Publisher-Fingerabdruck führen zum Abbruch. Es wird normal fortgeschrieben, ohne Force-Push. `main`, `web` und bestehende App-Dateien werden durch den Publisher nicht verändert.

## Dauerhaften Schlüssel sichern

Der neue **Repository-Index-Schlüssel ist unabhängig von beiden APK-Schlüsseln**. Eine verschlüsselte lokale Kopie mit zugehörigen Zugangsdaten liegt bei der Einrichtung unter:

```text
%USERPROFILE%\.codex\ghgflix-signing\fdroid\
```

Der Ordner ist unter Windows auf den Benutzer und SYSTEM beschränkt. **Jetzt zusätzlich ein verschlüsseltes Offline-Backup von `index.p12` und dem Passwort anlegen.** GitHub-Secrets lassen sich später nicht im Klartext herunterladen. Passwort oder Schlüssel nicht in Chat, Issue, Git oder Release-Dateien kopieren. Bei einer Neuinstallation denselben Schlüssel wiederverwenden; ein anderer Schlüssel ändert den Fingerabdruck und wird von bestehenden Clients nicht als dasselbe Repository akzeptiert.

`fdroid/repo-signing-cert.pem` enthält ausschließlich das öffentliche Zertifikat und darf veröffentlicht werden. Die APK-Signierzertifikate bleiben die bisherigen öffentlichen Release-Zertifikate von Handy und TV.

## Neue Apps und Wartung

- Weitere Apps benötigen eine ausdrückliche Paket-/Zertifikatsfreigabe in `fdroid/repository.json` und eine Metadatendatei unter `fdroid/metadata/`. Neue Signierschlüssel nicht still austauschen.
- Neue GHGFlix-Releases behalten die Dateinamen `GHGFlix-Mobile-X.Y.Z.apk` / `GHGFlix-TV-X.Y.Z.apk` und erhöhen `versionCode`. Der Workflow baut oder signiert Apps nicht selbst.
- Die signierten Metadaten haben 14 Tage Gültigkeit. Der tägliche Lauf erneuert sie. Falls GitHub den Zeitplan deaktiviert, den Workflow wieder aktivieren/manuell ausführen; veraltete Metadaten werden bewusst nicht als frisch ausgegeben.
- Paketversionen und Hashes nur bewusst in `fdroid/requirements*.txt` sowie `fdroid/build-requirements*.txt` aktualisieren und den echten Signier-/Client-Protokolltest erneut ausführen. Ein Datenbank-Abgleich bekannter Sicherheitsmeldungen ersetzt keine Garantie gegen unbekannte Schwachstellen.

Dies ist ein eigenes F-Droid-kompatibles Binär-Repository; es ist keine Aufnahme in den zentralen Katalog von f-droid.org. Die bisherigen App-/Gerätetestgrenzen bleiben unverändert.

Offizielle Grundlagen: [F-Droid-Repository einrichten](https://f-droid.org/docs/Setup_an_F-Droid_App_Repo/), [Servertools installieren](https://f-droid.org/docs/Installing_the_Server_and_Repo_Tools/), [GitHub-Pages-Quelle](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site), [Pages-Build-API](https://docs.github.com/en/rest/pages/pages#request-a-github-pages-build).
