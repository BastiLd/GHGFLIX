# Player: Touch und Untertitel

Die Handy-Apps sowie Browser/PWA und Windows auf Touchscreens bieten dieselben Grundgesten. Maus, Tastatur und TV-Fernbedienung behalten ihre Bedienung.

| Aktion auf dem freien Videobild | Verhalten |
| --- | --- |
| Einmal tippen | Bedienung ein- oder ausblenden |
| Links/rechts doppeltippen | Zurück/vor, standardmäßig 10 Sekunden; weitere schnelle Tipps addieren Sprünge |
| Gedrückt halten | Vorübergehend 2×; Loslassen, Abbruch oder App-Wechsel stellt das normale Tempo wieder her |
| Links senkrecht wischen | Helligkeit |
| Rechts senkrecht wischen | Lautstärke |

Unter **Optionen → Touch-Gesten** lassen sich Doppeltipp, Halten und beide Wischgesten einzeln abschalten. Sprungweite und Halte-Tempo sind veränderbar. Android/iOS bieten zusätzlich **Nur GHGFlix** (Standard) oder **System-Medienlautstärke** an, wenn das native Modul verfügbar ist. Browser und Windows regeln ihren Player. Die Hardwaretasten funktionieren weiterhin.

Die Handy-Helligkeit gilt während der Wiedergabe und wird beim Verlassen oder Wechsel in den Hintergrund wiederhergestellt. Android verwendet einen Fensterwert und fordert keine Änderung der globalen Helligkeit an. Browser und Windows dunkeln das Bild innerhalb des Players ab.

Die Zeitleiste kann gezogen werden. Zeit und vorhandene Vorschaubilder folgen dem Finger; erst Loslassen bestätigt den Sprung. Ein abgebrochener Ziehvorgang übernimmt die Vorschauposition nicht. Ohne fertige oder erreichbare Vorschaubilder bleibt die Zeitvorschau verfügbar. Im Browser bricht Escape das Ziehen ab. Ein pausiertes Video bleibt beim Spulen pausiert, auch nach dem natürlichen Videoende.

Vorherige und nächste Folge funktionieren über Staffelgrenzen. Bei Browser/Windows können auch zuvor abgespielte Filme aus der Warteschlange wieder aufgerufen werden. Der Verlauf bleibt im Arbeitsspeicher und wird nach Profil getrennt; er ist keine zusätzliche cloudweite Merkliste. Ein einzelner Film ohne Wiedergabefolge hat keinen künstlichen Vorgänger.

Unter **Sprache & Untertitel → Darstellung** und in den Einstellungen stehen dieselben eigenen GHGFlix-Werte zur Verfügung:

- Schriftgröße 50–300 %, freie Schrift-/Hintergrund-/Randfarbe als `#RRGGBB` und getrennte Deckkräfte.
- Sans Serif, Serif oder Monospace, Fettschrift, Kontur/Schatten/ohne Rand und Randstärke.
- Abstand zum unteren Rand und Zeitversatz von −30 bis +30 Sekunden.
- Live-Vorschau, unmittelbare Übernahme, dauerhafte Speicherung auf diesem Gerät und Zurücksetzen.

Die Geräteeinstellungen für Untertitel werden entsprechend der gewählten Anforderung nicht übernommen. Bestehende GHGFlix-Werte werden beim ersten Laden übernommen. Bilduntertitel lassen sich nicht umfärben; mpv wendet den eigenen Stil auf Textuntertitel einschließlich ASS an, wodurch eine vorgegebene ASS-Gestaltung verändert werden kann.

Für Helligkeit und optionale Systemlautstärke sind neue native Builds nötig. Die getrennten Laufzeiten heißen jetzt `mobile-4` und `tv-4`, Android verwendet Versionscode 23. Alte APKs erhalten diese nativen Module nicht durch ein JavaScript-OTA-Update. Lokale Test-APKs sind mit dem lokalen Testschlüssel signiert; eine bestehende Installation darf nur mit passender Signatur aktualisiert werden. Nicht zur Umgehung eines Signaturfehlers deinstallieren.
