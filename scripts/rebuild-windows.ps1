# ============================================================================
# GHGFlix — Windows-App komplett neu bauen
#
# Macht alles in einem Rutsch:
#   1. laufende GHGFlix-Instanzen beenden (sonst ist die .exe gesperrt)
#   2. alte Bau-Ergebnisse wegräumen (dist/ + bundle/)
#   3. Abhängigkeiten installieren
#   4. Prüfungen laufen lassen (TypeScript, Parser-Tests, Rust-Tests)
#   5. Installer + portable .exe bauen
#   6. Ordner mit dem fertigen Installer öffnen
#
# Aufruf (PowerShell):
#   cd "$env:USERPROFILE\Documents\GHGFlix"
#   powershell -ExecutionPolicy Bypass -File scripts\rebuild-windows.ps1
#
# Nur bauen, ohne Prüfungen:   ... -File scripts\rebuild-windows.ps1 -Schnell
# ============================================================================
param(
  [switch]$Schnell
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Schritt($text) {
  Write-Host ""
  Write-Host "===> $text" -ForegroundColor Red
}

Schritt "1/6  Laufende GHGFlix-Fenster beenden"
$prozesse = Get-Process -Name "ghgflix", "GHGFlix" -ErrorAction SilentlyContinue
if ($prozesse) {
  $prozesse | Stop-Process -Force
  Start-Sleep -Seconds 2
  Write-Host "     $($prozesse.Count) Prozess(e) beendet."
} else {
  Write-Host "     Nichts läuft — gut."
}
# mpv kann die Wiedergabe blockieren und hängt manchmal nach
Get-Process -Name "mpv" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Schritt "2/6  Alte Bau-Ergebnisse wegräumen"
foreach ($pfad in @("dist", "src-tauri\target\release\bundle")) {
  if (Test-Path $pfad) {
    Remove-Item -Recurse -Force $pfad -ErrorAction SilentlyContinue
    Write-Host "     entfernt: $pfad"
  }
}

Schritt "3/6  Abhängigkeiten installieren"
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install ist fehlgeschlagen." }

if (-not $Schnell) {
  Schritt "4/6  Prüfungen"

  Write-Host "     TypeScript ..."
  npx tsc --noEmit
  if ($LASTEXITCODE -ne 0) { throw "TypeScript meldet Fehler — Build abgebrochen." }

  Write-Host "     Parser-Tests (Erkennung) ..."
  node server\src\parser.js --test
  if ($LASTEXITCODE -ne 0) { throw "Parser-Tests fehlgeschlagen." }

  Write-Host "     Rust-Tests ..."
  Push-Location src-tauri
  cargo test --lib
  $rust = $LASTEXITCODE
  Pop-Location
  if ($rust -ne 0) { throw "Rust-Tests fehlgeschlagen." }

  Write-Host "     Versionen prüfen ..."
  $pkg    = (Get-Content package.json                | ConvertFrom-Json).version
  $tauri  = (Get-Content src-tauri\tauri.conf.json   | ConvertFrom-Json).version
  $cargo  = (Select-String -Path src-tauri\Cargo.toml -Pattern '^version\s*=\s*"(.+)"').Matches[0].Groups[1].Value
  Write-Host "       package.json      $pkg"
  Write-Host "       tauri.conf.json   $tauri"
  Write-Host "       Cargo.toml        $cargo"
  if ($pkg -ne $tauri -or $pkg -ne $cargo) {
    Write-Warning "Die Versionsnummern stimmen nicht überein! Windows aktualisiert die Installation sonst evtl. nicht sauber."
  }
} else {
  Schritt "4/6  Prüfungen übersprungen (-Schnell)"
}

Schritt "5/6  Bauen (dauert beim ersten Mal einige Minuten)"
npm run tauri build
if ($LASTEXITCODE -ne 0) { throw "Der Build ist fehlgeschlagen — siehe Meldungen oben." }

Schritt "6/6  Fertig"
$bundle = Join-Path $root "src-tauri\target\release\bundle"
$exe    = Join-Path $root "src-tauri\target\release\ghgflix.exe"

Get-ChildItem -Path $bundle -Recurse -Include *.exe, *.msi -ErrorAction SilentlyContinue |
  ForEach-Object { Write-Host ("     Installer:  " + $_.FullName) -ForegroundColor Green }
if (Test-Path $exe) { Write-Host ("     Portable:   " + $exe) -ForegroundColor Green }

Write-Host ""
Write-Host "So geht es weiter:" -ForegroundColor Yellow
Write-Host "  * Den Installer (.exe im Ordner 'nsis') ausführen — er ersetzt die alte"
Write-Host "    Version und aktualisiert Startmenü- und Desktop-Verknüpfung automatisch."
Write-Host "  * Deine Bibliothek, Einstellungen und der Gesehen-Stand bleiben erhalten"
Write-Host "    (sie liegen in $env:APPDATA\com.ghgflix.app, nicht im Programmordner)."
Write-Host ""

if (Test-Path $bundle) { explorer $bundle }
