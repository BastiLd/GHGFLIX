# ============================================================================
# GHGFlix - Absturz-Log vom Fernseher holen
#
# NUR ASCII-Zeichen (Windows PowerShell 5.1 liest .ps1 in der ANSI-Codepage).
#
# Erledigt alles: adb besorgen, mit dem Fernseher koppeln, verbinden, Log
# aufzeichnen und die wichtigen Zeilen herausfiltern.
#
# Aufruf (PowerShell):
#   cd "$env:USERPROFILE\Documents\GHGFlix"
#   powershell -ExecutionPolicy Bypass -File scripts\tv-log-holen.ps1
# ============================================================================
param(
  [string]$TvIp   = "",
  [string]$Paket  = "com.bastild.ghgflix"
)

$ErrorActionPreference = "Stop"
$Werkzeuge = "$env:USERPROFILE\platform-tools"
$Adb       = Join-Path $Werkzeuge "adb.exe"
$Ausgabe   = "$env:USERPROFILE\Desktop\ghgflix-tv-log.txt"

function Schritt($t) { Write-Host ""; Write-Host "===> $t" -ForegroundColor Red }
function Hinweis($t) { Write-Host "     $t" -ForegroundColor Yellow }

# -- 1) adb besorgen ---------------------------------------------------------
Schritt "1/5  Android-Werkzeuge bereitstellen"
if (-not (Test-Path $Adb)) {
  Hinweis "Lade platform-tools von Google (einmalig, ca. 8 MB)..."
  Get-Process adb -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 500
  Invoke-WebRequest "https://dl.google.com/android/repository/platform-tools-latest-windows.zip" `
                    -OutFile "$env:TEMP\pt.zip"
  Expand-Archive "$env:TEMP\pt.zip" -DestinationPath $env:USERPROFILE -Force
}
if (-not (Test-Path $Adb)) { throw "adb.exe konnte nicht bereitgestellt werden." }
Write-Host "     $Adb"

# -- 2) TV-Adresse ------------------------------------------------------------
Schritt "2/5  Fernseher-Adresse"
if (-not $TvIp) {
  Write-Host "     Am Fernseher nachsehen: Einstellungen -> Netzwerk & Internet -> (dein WLAN)"
  $TvIp = Read-Host "IP-Adresse des Fernsehers (z. B. 192.168.68.55)"
}
$TvIp = $TvIp.Trim()
if ($TvIp -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw "Das sieht nicht nach einer IP-Adresse aus: $TvIp" }

# -- 3) Verbinden -------------------------------------------------------------
Schritt "3/5  Mit dem Fernseher verbinden"
Write-Host "     Vorbereitung am Fernseher (falls noch nicht geschehen):"
Write-Host "       a) Einstellungen -> System -> Info -> 7x auf 'Build' druecken"
Write-Host "       b) Einstellungen -> System -> Entwickleroptionen"
Write-Host "       c) 'Drahtloses Debugging' EINSCHALTEN"
Write-Host ""

& $Adb start-server | Out-Null
$verbunden = $false

# Versuch A: klassischer Port 5555 (klappt, wenn frueher schon 'adb tcpip' lief)
Write-Host "     Versuche direkte Verbindung auf Port 5555 ..."
$r = & $Adb connect "${TvIp}:5555" 2>&1
if ($r -match "connected to") { $verbunden = $true; Write-Host "     verbunden." -ForegroundColor Green }

# Versuch B: Kopplung mit Code (Android 11+, Normalfall bei Google TV)
if (-not $verbunden) {
  Write-Host "     Port 5555 ist zu - das ist bei Google TV normal." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "     Am Fernseher jetzt oeffnen:" -ForegroundColor Yellow
  Write-Host "       Entwickleroptionen -> Drahtloses Debugging" -ForegroundColor Yellow
  Write-Host "         -> 'Geraet mit Kopplungscode koppeln'" -ForegroundColor Yellow
  Write-Host "     Dort stehen eine IP MIT PORT und ein sechsstelliger Code."
  Write-Host "     Das Fenster am Fernseher offen lassen!"
  Write-Host ""
  $paarPort = Read-Host "Kopplungs-PORT (die Zahl NACH dem Doppelpunkt, z. B. 37129)"
  $code     = Read-Host "Sechsstelliger Kopplungscode"
  Write-Host "     koppele ..."
  $code | & $Adb pair "${TvIp}:$($paarPort.Trim())" | Write-Host

  Write-Host ""
  Write-Host "     Im Fenster 'Drahtloses Debugging' steht OBEN eine andere Portnummer."
  $verbPort = Read-Host "Verbindungs-PORT (die obere Zahl, z. B. 42871)"
  $r = & $Adb connect "${TvIp}:$($verbPort.Trim())" 2>&1
  Write-Host "     $r"
  if ($r -match "connected to") { $verbunden = $true }
}

if (-not $verbunden) {
  Write-Host ""
  Write-Host "Verbindung nicht zustande gekommen." -ForegroundColor Red
  Write-Host "Pruefe: TV und PC im GLEICHEN WLAN? 'Drahtloses Debugging' wirklich an?"
  Write-Host "Manche Gastnetze trennen Geraete voneinander - dann geht es nicht."
  exit 1
}
& $Adb devices | Write-Host

# -- 4) Log aufzeichnen -------------------------------------------------------
Schritt "4/5  Log aufzeichnen"
& $Adb logcat -c 2>&1 | Out-Null
Write-Host ""
Write-Host "     JETZT am Fernseher GHGFlix oeffnen (und abstuerzen lassen)." -ForegroundColor Green
Write-Host "     Danach hier Enter druecken."
Read-Host | Out-Null

"=== GHGFlix TV-Log, $(Get-Date) ===" | Out-File $Ausgabe -Encoding utf8
"--- Absturz-Puffer ---"              | Out-File $Ausgabe -Append -Encoding utf8
& $Adb logcat -d -b crash             | Out-File $Ausgabe -Append -Encoding utf8
"`n--- Fehler (letzte 400 Zeilen) ---" | Out-File $Ausgabe -Append -Encoding utf8
& $Adb logcat -d *:E | Select-Object -Last 400 | Out-File $Ausgabe -Append -Encoding utf8

# -- 5) Auswertung ------------------------------------------------------------
Schritt "5/5  Auswertung"
$inhalt  = Get-Content $Ausgabe -Raw
$treffer = Select-String -Path $Ausgabe -Pattern "FATAL EXCEPTION|AndroidRuntime|ReactNativeJS|$Paket" -SimpleMatch:$false |
           Select-Object -First 25

if ($treffer) {
  Write-Host ""
  Write-Host "Die wichtigsten Zeilen:" -ForegroundColor Green
  $treffer | ForEach-Object { Write-Host ("  " + $_.Line) }
} else {
  Hinweis "Keine offensichtlichen Fehlerzeilen gefunden - die ganze Datei ansehen."
}

Write-Host ""
Write-Host "Vollstaendiges Log: $Ausgabe" -ForegroundColor Green
Write-Host "Diese Datei bitte an Claude schicken - darin steht die genaue Ursache."
& $Adb disconnect | Out-Null
notepad $Ausgabe
