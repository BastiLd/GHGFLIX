# ============================================================================
# GHGFlix - App direkt auf den Fernseher installieren (ohne "Downloader")
#
# NUR ASCII-Zeichen (Windows PowerShell 5.1 liest .ps1 in der ANSI-Codepage).
#
# WARUM ES DIESES SKRIPT GIBT
# Der Weg ueber die "Downloader"-App am Fernseher hat zwei Schwaechen: Er kann
# den Download stillschweigend abbrechen (die Datei ist dann unvollstaendig und
# Android meldet nur "Problem beim Parsen des Pakets"), und er nennt bei einem
# Fehler nie den echten Grund.
#
# Dieses Skript schiebt die Datei ueber das Netzwerk direkt auf den Fernseher.
# Es prueft die Datei vorher, sieht sofort ob sie vollstaendig ist und gibt bei
# einem Fehler die KLARTEXT-Meldung von Android aus - z. B.:
#   INSTALL_FAILED_UPDATE_INCOMPATIBLE  -> andere Signatur, erst deinstallieren
#   INSTALL_FAILED_VERSION_DOWNGRADE    -> versionCode ist kleiner als installiert
#   INSTALL_PARSE_FAILED_*              -> Datei wirklich beschaedigt
#
# EINMALIG AM FERNSEHER VORBEREITEN
#   1. Einstellungen -> System -> Info -> 7x auf "Build" tippen
#      (Entwickleroptionen werden freigeschaltet)
#   2. Einstellungen -> System -> Entwickleroptionen -> "USB-Debugging" EIN
#      und, falls vorhanden, "ADB-Debugging"/"Netzwerk-Debugging" EIN
#   3. Beim ersten Verbinden fragt der Fernseher "USB-Debugging zulassen?"
#      -> "Immer von diesem Computer zulassen" ankreuzen und bestaetigen
#
# ADMINRECHTE: NICHT noetig.
#
# AUFRUF (PowerShell, normales Fenster):
#   cd "$env:USERPROFILE\Documents\GHGFlix"
#   powershell -ExecutionPolicy Bypass -File scripts\tv-installieren.ps1
#
# Mit eigenen Angaben:
#   ... -TvIp "192.168.68.55" -Datei "C:\pfad\zur.apk"
# ============================================================================
param(
  [string]$TvIp   = "",
  [string]$Datei  = "",
  [string]$Server = "http://192.168.68.10:8484"
)

$ErrorActionPreference = "Stop"
function Schritt($t) { Write-Host ""; Write-Host "===> $t" -ForegroundColor Red }
function Info($t)    { Write-Host "     $t" }
function Warn($t)    { Write-Host "     $t" -ForegroundColor Yellow }
function Gut($t)     { Write-Host "     $t" -ForegroundColor Green }

# ---------------------------------------------------------------------------
# adb aufrufen, ohne dass PowerShell aussteigt
#
# STOLPERSTELLE: adb schreibt auch voellig harmlose Hinweise nach stderr -
# etwa "error: no such device", wenn man eine gar nicht bestehende Verbindung
# trennt. Windows PowerShell macht daraus zusammen mit $ErrorActionPreference
# = "Stop" einen ABBRUCH des ganzen Skripts. Genau daran ist der erste
# Versuch gescheitert, obwohl nichts kaputt war.
#
# Deshalb laufen ALLE adb-Aufrufe durch diese Funktion: sie faengt die
# Ausgabe ein, gibt sie als Text zurueck und laesst das Skript weiterlaufen.
# ---------------------------------------------------------------------------
function Invoke-Adb {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Argumente)
  $vorher = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $roh = & $script:AdbExe @Argumente 2>&1
    return (($roh | ForEach-Object { $_.ToString() }) -join "`n").Trim()
  } catch {
    return "FEHLER: $($_.Exception.Message)"
  } finally {
    $ErrorActionPreference = $vorher
  }
}

# ---------------------------------------------------------------------------
# 1) adb besorgen
# ---------------------------------------------------------------------------
Schritt "1/5  Werkzeug (adb) suchen"

$AdbKandidaten = @(
  "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
  "$env:ProgramFiles\Android\platform-tools\adb.exe",
  "${env:ProgramFiles(x86)}\Android\platform-tools\adb.exe",
  "$env:USERPROFILE\Documents\GHGFlix\werkzeuge\platform-tools\adb.exe"
)
$AdbExe = $null
$imPfad = Get-Command adb -ErrorAction SilentlyContinue
if ($imPfad) { $AdbExe = $imPfad.Source }
if (-not $AdbExe) { $AdbExe = $AdbKandidaten | Where-Object { Test-Path $_ } | Select-Object -First 1 }

if (-not $AdbExe) {
  Warn "adb ist nicht vorhanden - es wird einmalig heruntergeladen (ca. 6 MB, von Google)."
  $Ziel = Join-Path $PSScriptRoot "..\werkzeuge"
  New-Item -ItemType Directory -Force -Path $Ziel | Out-Null
  $Zip = Join-Path $Ziel "platform-tools.zip"
  try {
    # Offizielle Adresse von Google, keine Anmeldung noetig
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri "https://dl.google.com/android/repository/platform-tools-latest-windows.zip" `
                      -OutFile $Zip -UseBasicParsing -TimeoutSec 300
    Expand-Archive -Path $Zip -DestinationPath $Ziel -Force
    Remove-Item $Zip -Force -ErrorAction SilentlyContinue
    $AdbExe = Join-Path $Ziel "platform-tools\adb.exe"
  } catch {
    Write-Host ""
    Write-Host "Der Download hat nicht geklappt: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Du kannst die Datei auch von Hand holen:"
    Write-Host "  https://developer.android.com/tools/releases/platform-tools"
    Write-Host "und den Inhalt nach folgendem Ordner entpacken:"
    Write-Host "  $Ziel\platform-tools\"
    exit 1
  }
}
if (-not (Test-Path $AdbExe)) { throw "adb konnte nicht bereitgestellt werden." }
Info $AdbExe

# ---------------------------------------------------------------------------
# 2) APK finden und pruefen
# ---------------------------------------------------------------------------
Schritt "2/5  App-Datei suchen und pruefen"

if (-not $Datei) {
  $orte = @("$env:USERPROFILE\Downloads", "$env:USERPROFILE\Desktop")
  $treffer = Get-ChildItem -Path $orte -Filter *.apk -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending
  if ($treffer) { $Datei = $treffer[0].FullName }
}
if (-not $Datei -or -not (Test-Path $Datei)) {
  Warn "Keine .apk gefunden - hole sie vom Server."
  $Datei = Join-Path $env:TEMP "GHGFlix-vom-server.apk"
  try {
    Invoke-WebRequest -Uri "$($Server.TrimEnd('/'))/apk" -OutFile $Datei -UseBasicParsing -TimeoutSec 900
  } catch {
    throw "Konnte die Datei weder lokal finden noch vom Server holen ($($_.Exception.Message))."
  }
}
$info = Get-Item $Datei
Info ("{0}  ({1:N1} MB)" -f $info.FullName, ($info.Length / 1MB))

# WARNUNG BEI ALTER DATEI - genau hier ist am 01.08. eine Stunde verlorengegangen:
# Der EAS-Bau war fertig, aber NICHT heruntergeladen. Im Downloads-Ordner lag
# noch eine alte APK, die hier brav gefunden und installiert wurde. Danach lief
# auf dem Fernseher wieder 2.0.0, obwohl gerade 3.3.0 gebaut worden war.
# Ein Blick auf das Datum haette das sofort gezeigt.
$alterStunden = [math]::Round(((Get-Date) - $info.LastWriteTime).TotalHours, 1)
if ($alterStunden -gt 2) {
  Warn ("Diese Datei ist $alterStunden Stunden alt (vom " + $info.LastWriteTime.ToString("dd.MM.yyyy HH:mm") + ").")
  Write-Host "     Hast du den NEUEN Bau von expo.dev schon heruntergeladen?" -ForegroundColor Yellow
  Write-Host "     Die fertige Datei holst du dir so:" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "       cd $PSScriptRoot\..\mobile" -ForegroundColor Green
  Write-Host "       npx eas-cli build:list --platform android --limit 1" -ForegroundColor Green
  Write-Host ""
  Write-Host "     Die dort genannte Adresse im Browser oeffnen - oder das Skript mit"
  Write-Host "     -Datei `"C:\pfad\zur\neuen.apk`" starten."
  Write-Host ""
} else {
  Info ("Datei ist frisch (vom " + $info.LastWriteTime.ToString("dd.MM.yyyy HH:mm") + ")")
}

# Ist die Datei ueberhaupt ein vollstaendiges ZIP? Genau daran scheitert der
# Downloader-Weg still: eine halb geladene Datei faengt zwar mit "PK" an, hat
# am Ende aber kein Inhaltsverzeichnis - Android sagt dann nur "Problem beim
# Parsen des Pakets".
$fs = [System.IO.File]::OpenRead($Datei)
try {
  $kopf = New-Object byte[] 2
  $null = $fs.Read($kopf, 0, 2)
  $istZip = ($kopf[0] -eq 0x50 -and $kopf[1] -eq 0x4B)

  $len = [int][Math]::Min(66000, $fs.Length)
  $fs.Seek(-$len, [System.IO.SeekOrigin]::End) | Out-Null
  $ende = New-Object byte[] $len
  $null = $fs.Read($ende, 0, $len)
  $hatEnde = $false
  for ($i = $ende.Length - 22; $i -ge 0; $i--) {
    if ($ende[$i] -eq 0x50 -and $ende[$i+1] -eq 0x4B -and $ende[$i+2] -eq 0x05 -and $ende[$i+3] -eq 0x06) { $hatEnde = $true; break }
  }
} finally { $fs.Close() }

if (-not $istZip -or -not $hatEnde) {
  Write-Host ""
  Write-Host "Diese Datei ist UNVOLLSTAENDIG oder beschaedigt." -ForegroundColor Red
  Write-Host "Genau das loest am Fernseher 'Problem beim Parsen des Pakets' aus."
  Write-Host "Bitte neu herunterladen und noch einmal versuchen."
  exit 1
}
Gut "Datei ist vollstaendig (ZIP-Anfang und -Ende vorhanden)"
$hash = (Get-FileHash -Path $Datei -Algorithm SHA256).Hash.ToLower()
Info "SHA-256: $($hash.Substring(0,32))..."

# ---------------------------------------------------------------------------
# 3) Fernseher finden
# ---------------------------------------------------------------------------
Schritt "3/5  Fernseher suchen"

if (-not $TvIp) {
  Write-Host ""
  Write-Host "  Die IP-Adresse deines Fernsehers steht dort unter:"
  Write-Host "    Einstellungen -> Netzwerk und Internet -> (dein WLAN) -> IP-Adresse"
  Write-Host ""
  $TvIp = Read-Host "  IP-Adresse des Fernsehers"
}
$TvIp = $TvIp.Trim()
if ($TvIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw "Das sieht nicht nach einer IP-Adresse aus: $TvIp" }

$null = Invoke-Adb disconnect "$TvIp`:5555"   # darf fehlschlagen, wenn nichts offen ist

# Beim ersten Mal antwortet der Fernseher oft erst nach ein, zwei Anlaeufen -
# der ADB-Dienst dort wird teilweise erst durch den Verbindungsversuch selbst
# gestartet. Deshalb bis zu drei Versuche statt sofort aufzugeben.
$verbunden = $false
foreach ($versuch in 1..3) {
  $verbinde = Invoke-Adb connect "$TvIp`:5555"
  Info $verbinde
  if ($verbinde -match "connected to") { $verbunden = $true; break }
  if ($versuch -lt 3) {
    Info "  ... noch einmal (Versuch $($versuch + 1) von 3)"
    Start-Sleep -Seconds 2
    $null = Invoke-Adb "kill-server"
    Start-Sleep -Seconds 1
  }
}

if (-not $verbunden) {
  Write-Host ""
  Write-Host "Der Fernseher nimmt keine Netzwerkverbindung an." -ForegroundColor Red
  Write-Host ""
  Write-Host "Das liegt fast immer daran, dass 'USB-Debugging' allein NICHT reicht:" -ForegroundColor Yellow
  Write-Host "Viele Google-TV-Geraete oeffnen den Netzwerkzugang erst mit einem"
  Write-Host "ZWEITEN Schalter. Schau in Einstellungen -> System -> Entwickleroptionen"
  Write-Host "nach einem Eintrag, der so oder aehnlich heisst:"
  Write-Host "    'ADB-Debugging'            'Netzwerk-Debugging'"
  Write-Host "    'Drahtloses Debugging'     'Wireless debugging'"
  Write-Host "    'ADB ueber Netzwerk'       'Remote debugging'"
  Write-Host "und schalte ihn EIN. Danach dieses Skript noch einmal starten."
  Write-Host ""
  Write-Host "Findest du keinen solchen Schalter, geht es trotzdem - siehe" -ForegroundColor Yellow
  Write-Host "'Weg B' unten in dieser Datei bzw. in tv/README.md."
  exit 1
}

# Der Fernseher fragt beim ersten Mal nach einer Bestaetigung. Bis die gegeben
# ist, meldet adb "unauthorized" - darauf wird hier ausdruecklich hingewiesen,
# sonst sucht man den Fehler an der falschen Stelle.
$geraete = Invoke-Adb devices
if ($geraete -match "unauthorized") {
  Write-Host ""
  Write-Host "Der Fernseher wartet auf deine Bestaetigung." -ForegroundColor Yellow
  Write-Host "Schau auf den Fernsehbildschirm: dort steht 'USB-Debugging zulassen?'"
  Write-Host "  -> 'Immer von diesem Computer zulassen' ankreuzen -> OK"
  Write-Host "Danach dieses Skript einfach noch einmal starten."
  exit 1
}
Gut "verbunden"

# ---------------------------------------------------------------------------
# 4) Installieren
# ---------------------------------------------------------------------------
Schritt "4/5  Installieren (dauert bei 60 MB etwa eine Minute)"

$text = Invoke-Adb -s "$TvIp`:5555" install -r "$Datei"
Write-Host $text

if ($text -match "Success") {
  Gut "Installation erfolgreich"
} elseif ($text -match "INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match") {
  Write-Host ""
  Write-Host "Die schon installierte Fassung wurde mit einem ANDEREN Schluessel" -ForegroundColor Yellow
  Write-Host "unterschrieben. Android laesst das Ueberschreiben dann nicht zu."
  Write-Host "Loesung - alte Fassung entfernen und neu installieren:"
  Write-Host ""
  Write-Host "  `"$AdbExe`" -s $TvIp`:5555 uninstall com.bastild.ghgflix" -ForegroundColor Green
  Write-Host ""
  Write-Host "Danach dieses Skript noch einmal starten."
  Write-Host "Deine Bibliothek und Fortschritte liegen auf dem Server - es geht nichts verloren."
  exit 1
} elseif ($text -match "INSTALL_FAILED_INSUFFICIENT_STORAGE") {
  # Am 01.08. gemessen: 4 GB /data, davon 168 MB frei - Android blockiert dann
  # jede Installation. 390 MB steckten allein in App-Caches. Die gibt Android
  # bei Platzmangel ohnehin selbst frei; das hier stoesst es nur bewusst an.
  # Nichts davon geht verloren, Caches bauen sich von allein wieder auf.
  Write-Host ""
  Warn "Auf dem Fernseher ist zu wenig Platz."
  $frei = Invoke-Adb -s "$TvIp`:5555" shell "df -h /data"
  Write-Host $frei
  Write-Host "     Ich lasse Android die App-Zwischenspeicher freigeben (nichts wird geloescht) ..."
  Invoke-Adb -s "$TvIp`:5555" shell "pm trim-caches 1500M" | Out-Null
  Start-Sleep -Seconds 8
  Write-Host (Invoke-Adb -s "$TvIp`:5555" shell "df -h /data")
  Write-Host "     Zweiter Versuch ..."
  $text = Invoke-Adb -s "$TvIp`:5555" install -r "$Datei"
  Write-Host $text
  if ($text -match "Success") {
    Gut "Installation erfolgreich (nach Freigabe der Zwischenspeicher)"
  } else {
    Write-Host ""
    Write-Host "Reicht immer noch nicht. Am Fernseher unter" -ForegroundColor Yellow
    Write-Host "  Einstellungen -> Apps -> Speicher" -ForegroundColor Yellow
    Write-Host "eine grosse App deinstallieren, die du nicht brauchst."
    Write-Host "Was installiert ist, zeigt dir:"
    Write-Host ""
    Write-Host "  `"$AdbExe`" -s $TvIp`:5555 shell pm list packages -3" -ForegroundColor Green
    Write-Host ""
    exit 1
  }
} elseif ($text -match "INSTALL_FAILED_VERSION_DOWNGRADE") {
  Write-Host ""
  Write-Host "Die Datei hat eine KLEINERE Versionsnummer als die installierte." -ForegroundColor Yellow
  Write-Host "In mobile/app.json muss 'versionCode' groesser sein als bisher."
  exit 1
} elseif ($text -match "INSTALL_PARSE_FAILED") {
  Write-Host ""
  Write-Host "Android kann die Datei nicht lesen - sie ist wirklich beschaedigt." -ForegroundColor Red
  Write-Host "Bitte den Bau bei expo.dev neu herunterladen."
  exit 1
} else {
  Write-Host ""
  Write-Host "Unerwartete Antwort - die Meldung oben nennt den Grund." -ForegroundColor Yellow
  exit 1
}

# ---------------------------------------------------------------------------
# 5) Starten
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Welche Fassung liegt jetzt WIRKLICH auf dem Fernseher?
#
# WARUM DAS WICHTIG IST: Die Versionsnummer, die der Server zu einer APK
# anzeigt, stammt aus mobile/app.json zum Zeitpunkt des Hochladens - NICHT aus
# der Datei selbst. Passt beides nicht zusammen (etwa weil eine aeltere APK
# hochgeladen wurde), behauptet der Server eine Fassung, die gar nicht in der
# Datei steckt. Genau so ist eine 2.0.0 auf dem Fernseher gelandet, die als
# "3.1.0" gefuehrt wurde - und niemand verstand, warum Funktionen fehlten.
# Deshalb wird hier NACH der Installation am Geraet selbst nachgesehen.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# FUER WELCHEN BENUTZER ist die App installiert?
#
# DAS HAT AM 01.08. EINEN HALBEN TAG GEKOSTET: Der Fernseher hatte zwei
# Benutzer - 0 ("Eigentuemer", der laufende) und 10 ("new_user"). "adb install"
# meldete "Success", legte die App aber nur bei Benutzer 10 ab. Ergebnis:
#   - dumpsys nennt brav eine Versionsnummer  -> sieht installiert aus
#   - pm path liefert nichts, die Start-Aktivitaet ist nicht aufloesbar
#   - im Menue des Fernsehers taucht nichts auf
# Genau daher kam der Widerspruch im alten Bericht ("ist nicht installiert"
# gegen "dumpsys zeigt 2.0.0"). Deshalb wird das hier geprueft und behoben.
# ---------------------------------------------------------------------------
$pfad = Invoke-Adb -s "$TvIp`:5555" shell pm path --user 0 com.bastild.ghgflix
if ($pfad -notmatch "package:") {
  Warn "Die App ist noch nicht fuer den aktiven Benutzer (0) freigegeben."
  Write-Host "     Das passiert, wenn der Fernseher mehrere Benutzerprofile hat."
  Write-Host "     Ich schalte sie frei ..."
  Invoke-Adb -s "$TvIp`:5555" shell cmd package install-existing --user 0 com.bastild.ghgflix | Out-Null
  $pfad = Invoke-Adb -s "$TvIp`:5555" shell pm path --user 0 com.bastild.ghgflix
  if ($pfad -match "package:") {
    Gut "Fuer Benutzer 0 freigegeben"
  } else {
    Write-Host ""
    Write-Host "Das hat nicht geklappt. Vorhandene Benutzerprofile:" -ForegroundColor Yellow
    Write-Host (Invoke-Adb -s "$TvIp`:5555" shell pm list users)
    Write-Host "Dann bitte gezielt installieren:"
    Write-Host ""
    Write-Host "  `"$AdbExe`" -s $TvIp`:5555 install -r --user 0 `"$Datei`"" -ForegroundColor Green
    Write-Host ""
    exit 1
  }
}

$dump = Invoke-Adb -s "$TvIp`:5555" shell dumpsys package com.bastild.ghgflix
$vName = ([regex]::Match($dump, "versionName=([^\s]+)")).Groups[1].Value
$vCode = ([regex]::Match($dump, "versionCode=(\d+)")).Groups[1].Value
if ($vName) {
  Write-Host ""
  Gut "Auf dem Fernseher laeuft jetzt: Version $vName (versionCode $vCode)"
  try {
    $srv = Invoke-RestMethod -Uri "$($Server.TrimEnd('/'))/api/apk/status" -TimeoutSec 10
    if ($srv.version -and $srv.version -ne $vName) {
      Write-Host ""
      Warn "Hinweis: Der Server fuehrt diese Datei als Version $($srv.version),"
      Warn "in der APK steht aber $vName. Die Angabe auf dem Server kommt aus"
      Warn "app.json und kann daneben liegen - es gilt, was hier steht."
    }
  } catch { /* Server nicht erreichbar - nicht schlimm */ }
}

Schritt "5/5  App auf dem Fernseher starten"

# ACHTUNG, HIER STAND EINMAL "monkey":
#   adb shell monkey -p com.bastild.ghgflix -c android.intent.category.LAUNCHER 1
# Das sieht nach "starte diese App" aus, ist aber das Werkzeug fuer ZUFAELLIGE
# Eingaben. Findet es zur angegebenen App keine passende Start-Aktivitaet,
# erzeugt es irgendein Ereignis - und oeffnet dann eine voellig fremde App.
# Genau das ist passiert: einmal ging Netflix auf, beim naechsten Mal Spotify.
#
# Richtig ist, die Start-Aktivitaet zu erfragen und GENAU die zu starten.
$ziel = Invoke-Adb -s "$TvIp`:5555" shell cmd package resolve-activity --brief com.bastild.ghgflix
$aktivitaet = ($ziel -split "`n" | Where-Object { $_ -match "^com\.bastild\.ghgflix/" } | Select-Object -Last 1)

if ($aktivitaet) {
  $start = Invoke-Adb -s "$TvIp`:5555" shell am start -n $aktivitaet.Trim()
  if ($start -match "Error|Exception") {
    Warn "Automatischer Start nicht moeglich - bitte am Fernseher selbst oeffnen."
    Info $start
  } else {
    Gut "GHGFlix laeuft jetzt auf dem Fernseher."
  }
} else {
  Warn "Start-Aktivitaet nicht gefunden - bitte GHGFlix am Fernseher selbst oeffnen."
  Info "(Die Installation selbst hat geklappt.)"
}
Write-Host ""
Write-Host "Ab jetzt brauchst du das nur noch selten:" -ForegroundColor Yellow
Write-Host "Reine Anzeige-Aenderungen kommen ueber die Luft (OTA) in die App -"
Write-Host "dafuer genuegt am PC:  npx eas-cli update --branch preview"
Write-Host ""
$null = Invoke-Adb disconnect "$TvIp`:5555"
