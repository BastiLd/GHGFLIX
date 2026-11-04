# GHGFlix 3.7.0 – Player, Touch-Gesten und eigene Untertitel

Die neue Fassung erweitert die Player-Bedienung auf Handy, TV, Browser/PWA und Windows. Alle Pakete verwenden Version **3.7.0**; Android verwendet **Versionscode 24**, iOS-Baumetadaten Buildnummer 24. Die nativen Laufzeiten bleiben getrennt als `mobile-4` und `tv-4`.

## Änderungen

- Ein Tipp auf das freie Videobild blendet die Bedienung ein oder aus.
- Doppeltippen links/rechts spult standardmäßig 10 Sekunden. Weitere schnelle Tipps addieren Sprünge.
- Halten spielt vorübergehend mit 2×; Loslassen, Abbruch und App-Wechsel stellen das normale Tempo wieder her.
- Links senkrecht wischen verändert die Helligkeit, rechts die Lautstärke. Doppeltipp, Halten und beide Wischgesten sind einzeln abschaltbar; Sprungweite und Halte-Tempo lassen sich einstellen.
- Android/iOS bieten bei verfügbarem Modul App- oder System-Medienlautstärke an. Standard bleibt **Nur GHGFlix**. Native Helligkeit wird beim Verlassen bzw. Hintergrundwechsel wiederhergestellt. Browser/Windows dunkeln das Bild im Player ab.
- Die Zeitleiste lässt sich ziehen und zeigt Zeit und vorhandene Server-Vorschaubilder. Erst Loslassen spult; ein Abbruch verwirft die Vorschauposition. Eine Pause bleibt erhalten.
- Vorherige/nächste Folgen funktionieren über Staffelgrenzen. Browser/Windows können außerdem im bisherigen Film-Queue-Verlauf zurückgehen, ohne die Warteschlange doppelt zu verbrauchen.
- Eigene Untertitel mit Größe 50–300 %, freien Text-/Hintergrund-/Randfarben, getrennten Deckkräften, Schriftfamilie, Fettschrift, Kontur/Schatten, Position und Zeitversatz. Vorschau, validierte Eingaben, Zurücksetzen und Speicherung sind direkt im Player und in den Einstellungen vorhanden.
- Behoben: ungewolltes Weiterlaufen beim Spulen nach dem Videoende, falscher Ladefehler durch vertauschte native Ereignisse und verlorener Tastaturfokus nach Schließen der mobilen Web-Optionen.
- Der Docker-Build enthält jetzt auch den von Web und nativen Clients gemeinsam verwendeten Player-Code.

Es werden ausschließlich die eigenen GHGFlix-Untertitelwerte verwendet. Vorhandene Einstellungen werden übernommen. [Bedienung und Details](PLAYER_TOUCH_UND_UNTERTITEL.md).

## Pakete und Updates

Die [Release-Downloads](https://github.com/BastiLd/GHGFLIX/releases/tag/v3.7.0) umfassen getrennte Handy-/TV-APKs, Windows-EXE und MSI, Windows-Update-Signaturen/Manifest, Prüfsummen und Bauinformationen. GitHub bietet zusätzlich die Quellarchive des Tags an.

Die veröffentlichten Android-Pakete verwenden je Produkt denselben Signierschlüssel wie der öffentliche Release 3.6.0. Paketkennungen bleiben `com.bastild.ghgflix` und `com.bastild.ghgflix.tv`. Lokal erzeugte `-local.apk`-Testpakete haben dagegen eine andere Testsignatur. Ein Signaturfehler darf nicht durch Löschen einer bestehenden Installation mit Nutzerdaten umgangen werden.

Die neuen nativen Module benötigen eine neue APK bzw. einen nativen App-Build; ein JavaScript-OTA-Update einer älteren APK genügt nicht. Die Windows-Update-Signaturen werden mit dem bereits eingebetteten öffentlichen Schlüssel geprüft. Die kryptografische Update-Signatur ist keine Windows-Authenticode-Zertifizierung.

Serverimage: `ghcr.io/bastild/ghgflix-server:3.7.0` sowie `latest`; die Veröffentlichung baut für amd64 und arm64. Website-Ausgabe: Branch `web`, Ordner `site`. Quellrevision, Artefakt-Hashes, Signierzertifikate und tatsächlich erfolgreiche Workflows werden im Release-`build-manifest.json` festgehalten.

Ein veröffentlichter Server-/Website-Build ist keine Bestätigung, dass ein bestehender NAS-Container bereits aktualisiert wurde. Datenvolume, Ports und Zugangsdaten müssen bei einem späteren Containerwechsel erhalten bleiben.

## Prüfung und bekannte Grenzen

Die Player-Änderungen wurden mit Unit-, Komponenten-, Browser-/TV-Bedienungs- und echten lokalen HTTP/SQLite/ffmpeg-Integrationstests geprüft. Acht native Android-Prüfungen im eigenen Android-35-Emulator decken Gesten, pausiertes Spulen, Lautstärke/Helligkeit, Staffelwechsel und eigene Untertitel nach Kaltstart ab. Die detaillierten Nachweise und Grenzen stehen im [QA-Bericht](reports/PLAYER_QUALITY_2026-11-02.md); dieser beschreibt die damaligen Testbuilds mit Versionscode 23. Der neue Versionscode 24 wird für diesen Release neu gebaut und separat signiert/geprüft.

Physisches Android-Handy, echtes Android-TV-Gerät, vollständiger Screenreader-Durchlauf, Langzeitprofiling sowie native iOS-/Windows-mpv-Geräteabnahme bleiben offen. Ein erfolgreicher Installer-Build oder eine Signaturprüfung ersetzt keine Gerätebedienung. Für iOS wird kein IPA behauptet; dafür fehlen ein signierter Apple-Build und die Geräteabnahme.

Bilduntertitel können nicht beliebig umgefärbt werden. Eigene mpv-Stile können die vorgegebene ASS-Gestaltung verändern. Safari/WebKit-Darstellung ist durch Chromium-Tests nicht abgedeckt. Bestehende Einschränkungen bei realer Push-Providerzustellung und der separat dokumentierte sporadische HLS-Befund werden durch diesen Release nicht als behoben erklärt.
