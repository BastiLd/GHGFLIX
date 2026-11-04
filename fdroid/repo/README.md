# Signierte APKs

Hier können fertig signierte APKs eingecheckt werden. Der Workflow prüft Paketkennung und Signierzertifikat gegen `fdroid/repository.json` und veröffentlicht sie mit dem F-Droid-Index.

Zusätzlich importiert er automatisch die letzten zwei passenden stabilen GitHub-Releases. Deshalb müssen die vorhandenen großen Release-APKs nicht nochmals in `main` gespeichert werden. Im veröffentlichten Branch `gh-pages` liegen die tatsächlichen APK-Dateien unter `fdroid/repo/`.

Private Schlüssel, Passwörter und lokale Test-APKs gehören nicht in diesen Ordner. Die APKs werden vom Workflow nicht neu signiert.
