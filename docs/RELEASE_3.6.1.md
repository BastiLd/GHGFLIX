# GHGFlix 3.6.1 — Serverzugang und Account-Bedienung

**Veröffentlichungsstand:** Code auf `main`; die [GitHub-Prüfungen](https://github.com/BastiLd/GHGFLIX/actions/runs/41201592786) und die [Veröffentlichung des Server-Images](https://github.com/BastiLd/GHGFLIX/actions/runs/41201592841) sind erfolgreich. Die automatische Freigabeprüfung blockierte dagegen das Anlegen des GitHub-Releases mit „blocked by policy“, ohne nähere Begründung. Es wurde kein GitHub-Release/Tag 3.6.1 angelegt; die Installationsdateien werden lokal bereitgestellt. Die Grenzen der nativen Tests stehen unten.

Server-Image `3.6.1`, `latest` und Commit-Tag `f164799b7d4a0408d34d4c35f646c2ea3a42a065` wurden mit demselben Digest verifiziert: `sha256:fec274acd035af6ee86210db13572b2ccb7e717d216e5e78b0cc8707c3e41438`. Enthalten sind `linux/amd64` und `linux/arm64`.

## Änderung

Nach Eingabe einer Serveradresse führte ein alter Server direkt in den Fehlerbildschirm; dort fehlte die Passworteingabe. Der Nutzer musste die lokale Bibliothek öffnen und die Verbindung in den Einstellungen suchen. Der vorhandene LAN-Server meldete am 31.10.2026 bei read-only-Prüfung noch 2.8.0 ohne Account-Unterstützung.

Der PC-Einstieg enthält jetzt Adresse und Server-Passwort gemeinsam. Falsche Passwörter und nicht erreichbare/falsche Server werden erklärt. Bei älteren GHGFlix-Servern kann das gemeinsame Passwort geprüft werden; anschließend erklärt die App das erforderliche Serverupdate. Erst eine gültige Verbindung mit Account-Unterstützung speichert den Zugangstoken, kein Klartextpasswort. Neue PC-Einrichtungen bieten direkt Serververbindung oder die lokale Bibliothek an. Bestehende lokale Konfigurationen bleiben erhalten.

Das Profilbild führt auf allen Clients sichtbar zu **Account & Profile**. Der Bereich trennt Profilwahl/-bearbeitung von Account-E-Mail, Passwortänderung und Abmeldung. Bilder, Kinderfreigaben und sechsstellige PINs sind in der Profilbearbeitung erklärt. Die Passwortänderung verlangt eine Wiederholung; die Web-/PC-Eingaben lassen sich ein- und ausblenden. Gespeicherte Passwörter/PINs werden nicht offengelegt. Anmelde- und Profilseiten scrollen innerhalb des App-Fensters, auch bei geringer Bildschirmhöhe.

Einstellungen sind nach App, Mediathek/Server und erweiterten Optionen geordnet. Der veraltete Sync-Abschnitt mit separatem Anmelden/Speichern wurde durch dasselbe Verbindungsformular ersetzt. Vorhandene alternative Serveradressen bleiben in der gespeicherten Konfiguration erhalten; der einfache Verbindungsdialog wählt ausdrücklich die eingegebene feste Adresse. Account-Verwaltung ist direkt verlinkt. App-Downloads und Hinweise zum Update ohne vorherige Deinstallation sind auch in den Handy-/TV-Einstellungen erreichbar.

## Einrichtung

[WebHafen-Felder, Passwörter und Updates](WEBHAFEN_UND_UPDATES.md) beschreibt die konkreten Werte aus dem Nutzerbericht. WebHafen: **Weiterleitung**, API-Ziel **192.168.68.10:8484**, bestehende Tailscale-Adresse behalten, keine GitHub-Dateiübernahme. Zuerst den GHGFlix-Server aktualisieren, danach den persönlichen Besitzer-Account einrichten. Die Produktionsinstallation wurde nur über öffentliche Ping-/Startseiten gelesen, nicht verändert.

## Prüfung

- TypeScript und Produktionsbuild erfolgreich; Windows EXE/MSI erfolgreich gebaut. Bestehende Warnungen zu Bundlegröße, macOS-Bundlekennung und ungenutzter Rust-Funktion sind keine neuen Laufzeitfehler.
- 35 Root-Tests inklusive fünf Verbindungsregressionen erfolgreich: ungültige URLs/falscher Dienst ohne Passwortversand, alter Server, falsches Passwort, aktueller Server, Server ohne Passwort.
- Vollständige Server-Tests erfolgreich, einschließlich Accounts, Isolation, Migration, Google-Protokolltests, Kinderschutz, Profile und Medienrouten.
- Mobile-Tests einschließlich Schutz gegen native Textknoten erfolgreich; 35 Mobile-Komponententests erfolgreich.
- Account-Webtests: neun ausgeführte Szenarien über Desktop 1440×900, Handy 390×844 und TV-Browser 960×540 erfolgreich. Sechs doppelte plattformspezifische Fälle werden bewusst übersprungen. Zusätzliche Desktop-Nachprüfung deckt den ersten Verbindungsstart und Besitzer-Einstellungen ab. Passwortänderung mit ungleicher Wiederholung, anschließende Ab-/Anmeldung und scrollbare Profile geprüft.
- Tauri-Verbindung in einem Headless-Browser mit simuliertem nativen Transport und realem lokalem Account-Server geprüft. Kein nativer Windows-WebView-/Maus-Test.
- Handy-/TV-Komponenten gegen echten temporären HTTP-/SQLite-Server: beide Account-Flows erfolgreich, einschließlich Kinder/PIN, Einstellungen, Passwortwechsel und Abmeldung.
- Bestehende 16 Handy-/TV-Browsersimulationen erfolgreich (15 im Gesamtlauf, der nach Umbenennung angepasste TV-Fokustest einzeln nachgeprüft).
- iOS-JavaScript-Export erfolgreich. Kein nativer iOS-Build und kein iPhone-Test.

Testkorrekturen: Die neuen Sichtbarkeitsschaltflächen erfordern exakte Passwortfeld-Selektoren. Ein Test wechselte zur Einstellungsadresse, bevor die asynchrone Profilwahl ihre Navigation beendet hatte; er wartet jetzt auf den tatsächlichen Seitenwechsel. TV-Selektoren verwenden den neuen Namen Account & Profile. Keine dieser Testanpassungen umgeht eine fehlende Produktfunktion.

## Grenzen und Pakete

Die signierten Handy-/TV-APKs verwenden 3.6.1 / Versionscode 22 und dieselben Paketkennungen wie 3.6.0. Die lokalen Pakete umfassen außerdem Windows-EXE/MSI, Prüfsummen und Bauinformationen. Die APK-Signaturprüfung und Bauinformationen werden im lokalen `build-manifest.json` festgehalten. Kein veröffentlichter GitHub-Download für 3.6.1 behauptet.

Der geplante zusätzliche Start des eigenen fensterlosen Android-Emulators wurde von der automatischen Freigabeprüfung mit „blocked by policy“ abgelehnt. Er wurde nicht erneut über einen anderen Weg gestartet. Somit gibt es für diese APKs keine neue native Android-Ausführungs- oder Update-Abnahme. Die belegten nativen Tests von 3.6.0 ersetzen diese Prüfung nicht. Physisches Handy/TV, Windows-Installation und mpv bleiben Nutzerabnahme.

Keine NAS-Installation, keine Geräteinstallation und kein Google-OAuth-Livetest durchgeführt. Es wurde kein neues Expo-OTA-Update veröffentlicht; die APKs enthalten diesen Stand. Der vorhandene sporadische HLS-Befund (#1) bleibt unabhängig davon offen. Zugehöriger Bedienungsfehler: #37.
