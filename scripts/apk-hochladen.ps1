# ============================================================================
# GHGFlix - App-Datei (APK) auf den Server legen
#
# NUR ASCII-Zeichen (Windows PowerShell 5.1 liest .ps1 in der ANSI-Codepage).
#
# Sucht die zuletzt heruntergeladene GHGFlix-APK, meldet sich am Server an und
# legt sie dort ab. Danach kann der Fernseher sie unter
#   http://<server>:8484/apk
# herunterladen und installieren.
#
# Aufruf (PowerShell):
#   cd "$env:USERPROFILE\Documents\GHGFlix"
#   powershell -ExecutionPolicy Bypass -File scripts\apk-hochladen.ps1
#
# Mit eigenen Angaben:
#   ... -Server "http://192.168.68.10:8484" -Passwort "GHGFLIx" -Datei "C:\pfad\zur.apk"
# ============================================================================
param(
  [string]$Server   = "http://192.168.68.10:8484",
  [string]$Passwort = "",
  [string]$Datei    = ""
)

$ErrorActionPreference = "Stop"
$Server = $Server.TrimEnd("/")

function Schritt($t) { Write-Host ""; Write-Host "===> $t" -ForegroundColor Red }

# -- 1) APK finden -----------------------------------------------------------
Schritt "1/4  App-Datei suchen"
if (-not $Datei) {
  $orte = @(
    "$env:USERPROFILE\Downloads",
    "$env:USERPROFILE\Desktop",
    "$env:USERPROFILE\Documents\GHGFlix\mobile"
  )
  $treffer = Get-ChildItem -Path $orte -Filter *.apk -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending
  if (-not $treffer) {
    Write-Host ""
    Write-Host "Keine .apk gefunden." -ForegroundColor Yellow
    Write-Host "So kommst du an die Datei:"
    Write-Host "  1. Den Build-Link aus 'eas build' im Browser oeffnen"
    Write-Host "  2. Dort auf 'Download build' klicken"
    Write-Host "  3. Dieses Skript nochmal starten"
    exit 1
  }
  $Datei = $treffer[0].FullName
}
if (-not (Test-Path $Datei)) { throw "Datei nicht gefunden: $Datei" }
$info = Get-Item $Datei
Write-Host ("     " + $info.FullName)
Write-Host ("     " + [math]::Round($info.Length / 1MB, 1) + " MB, vom " + $info.LastWriteTime)

# -- 2) Server erreichbar? ---------------------------------------------------
Schritt "2/4  Server pruefen"
try {
  $ping = Invoke-RestMethod -Uri "$Server/api/ping" -TimeoutSec 8
} catch {
  throw "Server nicht erreichbar unter $Server - stimmt die Adresse? ($($_.Exception.Message))"
}
Write-Host ("     " + $ping.name + " Version " + $ping.version + " - erreichbar")
if (-not $ping.auth) {
  Write-Host ""
  Write-Host "Dieser Server hat KEIN Passwort gesetzt." -ForegroundColor Yellow
  Write-Host "Hochladen ist aus Sicherheitsgruenden nur mit Passwort moeglich."
  Write-Host "Entweder in ZimaOS GHGFLIX_PASSWORD setzen - oder die Datei von Hand ablegen unter:"
  Write-Host "  /DATA/AppData/ghgflix/data/apk/GHGFlix.apk"
  exit 1
}

# -- 3) Anmelden -------------------------------------------------------------
Schritt "3/4  Anmelden"
if (-not $Passwort) {
  $sicher   = Read-Host "Server-Passwort" -AsSecureString
  $Passwort = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sicher))
}
try {
  $login = Invoke-RestMethod -Uri "$Server/api/login" -Method Post `
             -ContentType "application/json" `
             -Body (@{ password = $Passwort } | ConvertTo-Json) -TimeoutSec 10
} catch {
  throw "Anmeldung fehlgeschlagen - falsches Passwort? ($($_.Exception.Message))"
}
if (-not $login.token) { throw "Server hat kein Zugangs-Token geliefert." }
Write-Host "     angemeldet"

# -- 4) Hochladen ------------------------------------------------------------
Schritt "4/4  Hochladen (kann bei grossen Dateien etwas dauern)"
$bytes = [System.IO.File]::ReadAllBytes($Datei)
try {
  $antwort = Invoke-RestMethod -Uri "$Server/api/apk?token=$($login.token)" -Method Post `
               -ContentType "application/octet-stream" -Body $bytes -TimeoutSec 600
} catch {
  throw "Hochladen fehlgeschlagen: $($_.Exception.Message)"
}

Write-Host ""
Write-Host ("Fertig - " + $antwort.sizeMb + " MB liegen jetzt auf dem Server.") -ForegroundColor Green
Write-Host ""
Write-Host "So geht es am Fernseher weiter:" -ForegroundColor Yellow
Write-Host "  1. Falls schon eine alte Fassung installiert ist:"
Write-Host "     Einstellungen -> Apps -> 'Alle Apps anzeigen' -> GHGFlix -> Deinstallieren"
Write-Host "  2. App 'Downloader' oeffnen und diese Adresse eintippen:"
Write-Host ("     " + $Server + "/apk") -ForegroundColor Green
Write-Host "  3. Go -> Installieren -> Oeffnen"
Write-Host ""
Write-Host "Zum Nachlesen im Browser: $Server/app"
