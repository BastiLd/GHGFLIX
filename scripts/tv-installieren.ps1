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
# 1) adb besorgen
# ---------------------------------------------------------------------------
Schritt "1/5  Werkzeug (adb) suchen"

$AdbKandidaten = @(
  "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
  "$env:ProgramFiles\Android\platform-tools\adb.exe",
  "${env:ProgramFiles(x86)}\Android\platform-tools\adb.exe",
  "$env:USERPROFILE\Documents\GHGFlix\werkzeuge\platform-tools\adb.exe"
)
$Adb = $null
$imPfad = Get-Command adb -ErrorAction SilentlyContinue
if ($imPfad) { $Adb = $imPfad.Source }
if (-not $Adb) { $Adb = $AdbKandidaten | Where-Object { Test-Path $_ } | Select-Object -First 1 }

if (-not $Adb) {
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
    $Adb = Join-Path $Ziel "platform-tools\adb.exe"
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
if (-not (Test-Path $Adb)) { throw "adb konnte nicht bereitgestellt werden." }
Info $Adb

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

& $Adb disconnect "$TvIp`:5555" 2>&1 | Out-Null
$verbinde = & $Adb connect "$TvIp`:5555" 2>&1
Info $verbinde
if ($verbinde -notmatch "connected") {
  Write-Host ""
  Write-Host "Verbindung nicht moeglich." -ForegroundColor Red
  Write-Host "Bitte am Fernseher pruefen:"
  Write-Host "  - Einstellungen -> System -> Info -> 7x auf 'Build' tippen"
  Write-Host "  - Einstellungen -> System -> Entwickleroptionen -> 'USB-Debugging' EIN"
  Write-Host "  - Fernseher und PC muessen im GLEICHEN WLAN sein"
  exit 1
}

# Der Fernseher fragt beim ersten Mal nach einer Bestaetigung. Bis die gegeben
# ist, meldet adb "unauthorized" - darauf wird hier ausdruecklich hingewiesen,
# sonst sucht man den Fehler an der falschen Stelle.
$geraete = & $Adb devices 2>&1
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

$ausgabe = & $Adb -s "$TvIp`:5555" install -r "$Datei" 2>&1
$text = ($ausgabe | Out-String).Trim()
Write-Host $text

if ($text -match "Success") {
  Gut "Installation erfolgreich"
} elseif ($text -match "INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match") {
  Write-Host ""
  Write-Host "Die schon installierte Fassung wurde mit einem ANDEREN Schluessel" -ForegroundColor Yellow
  Write-Host "unterschrieben. Android laesst das Ueberschreiben dann nicht zu."
  Write-Host "Loesung - alte Fassung entfernen und neu installieren:"
  Write-Host ""
  Write-Host "  `"$Adb`" -s $TvIp`:5555 uninstall com.bastild.ghgflix" -ForegroundColor Green
  Write-Host ""
  Write-Host "Danach dieses Skript noch einmal starten."
  Write-Host "Deine Bibliothek und Fortschritte liegen auf dem Server - es geht nichts verloren."
  exit 1
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
Schritt "5/5  App auf dem Fernseher starten"
& $Adb -s "$TvIp`:5555" shell monkey -p com.bastild.ghgflix -c android.intent.category.LAUNCHER 1 2>&1 | Out-Null
Gut "GHGFlix sollte jetzt auf dem Fernseher laufen."
Write-Host ""
Write-Host "Ab jetzt brauchst du das nur noch selten:" -ForegroundColor Yellow
Write-Host "Reine Anzeige-Aenderungen kommen ueber die Luft (OTA) in die App -"
Write-Host "dafuer genuegt am PC:  npx eas-cli update --branch preview"
Write-Host ""
& $Adb disconnect "$TvIp`:5555" 2>&1 | Out-Null
