# ============================================================================
# GHGFlix - Windows-App komplett neu bauen
#
# WICHTIG: Diese Datei enthaelt bewusst NUR ASCII-Zeichen (keine Umlaute,
# keine Gedankenstriche). Windows PowerShell 5.1 liest .ps1-Dateien in der
# ANSI-Codepage - UTF-8-Sonderzeichen zerbrechen sonst das Skript
# ("Unerwartetes Token").
#
# Macht alles in einem Rutsch:
#   1. laufende GHGFlix-Instanzen beenden (sonst ist die .exe gesperrt)
#   2. alte Bau-Ergebnisse wegraeumen (dist/ + bundle/)
#   3. Abhaengigkeiten installieren
#   4. Pruefungen laufen lassen (TypeScript, Parser-Tests, Rust-Tests)
#   5. Installer + portable .exe bauen
#   6. Ordner mit dem fertigen Installer oeffnen
#
# Aufruf (PowerShell):
#   cd "$env:USERPROFILE\Documents\GHGFlix"
#   powershell -ExecutionPolicy Bypass -File scripts\rebuild-windows.ps1
#
# Nur bauen, ohne Pruefungen:  ... -File scripts\rebuild-windows.ps1 -Schnell
# ============================================================================
param(
  [switch]$Schnell,
  # Installiert den frischen Bau gleich mit und rettet dabei die
  # Taskleisten-Verknuepfung (siehe Schritt 7 am Ende der Datei).
  [switch]$Installieren
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
  Write-Host "     Nichts laeuft - gut."
}
Get-Process -Name "mpv" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Schritt "2/6  Alte Bau-Ergebnisse wegraeumen"
foreach ($pfad in @("dist", "src-tauri\target\release\bundle")) {
  if (Test-Path $pfad) {
    Remove-Item -Recurse -Force $pfad -ErrorAction SilentlyContinue
    Write-Host "     entfernt: $pfad"
  }
}

Schritt "3/6  Abhaengigkeiten installieren"
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install ist fehlgeschlagen." }

if (-not $Schnell) {
  Schritt "4/6  Pruefungen"

  Write-Host "     TypeScript ..."
  npx tsc --noEmit
  if ($LASTEXITCODE -ne 0) { throw "TypeScript meldet Fehler - Build abgebrochen." }

  Write-Host "     Parser-Tests (Erkennung) ..."
  node server\src\parser.js --test
  if ($LASTEXITCODE -ne 0) { throw "Parser-Tests fehlgeschlagen." }

  Write-Host "     Rust-Tests ..."
  Push-Location src-tauri
  cargo test --lib
  $rust = $LASTEXITCODE
  Pop-Location
  if ($rust -ne 0) { throw "Rust-Tests fehlgeschlagen." }

  Write-Host "     Versionen pruefen ..."
  $pkg   = (Get-Content package.json              | ConvertFrom-Json).version
  $tauri = (Get-Content src-tauri\tauri.conf.json | ConvertFrom-Json).version
  $cargo = (Select-String -Path src-tauri\Cargo.toml -Pattern '^version\s*=\s*"(.+)"').Matches[0].Groups[1].Value
  Write-Host "       package.json      $pkg"
  Write-Host "       tauri.conf.json   $tauri"
  Write-Host "       Cargo.toml        $cargo"
  # ABBRUCH statt nur Warnung: Weichen die drei Nummern voneinander ab,
  # baut Tauri zwar durch, aber der Installer meldet Windows eine andere
  # Fassung als die App selbst. Windows haelt die Installation dann teils
  # fuer unveraendert und laesst Startmenue- und Desktop-Verknuepfung auf
  # die ALTE Datei zeigen. Das faellt erst auf, wenn man sich wundert, warum
  # neue Funktionen fehlen - deshalb hier lieber gleich anhalten.
  if (($pkg -ne $tauri) -or ($pkg -ne $cargo)) {
    throw ("Die Versionsnummern stimmen nicht ueberein (package.json $pkg, " +
           "tauri.conf.json $tauri, Cargo.toml $cargo). Bitte in allen drei " +
           "Dateien dieselbe Nummer eintragen und erneut starten.")
  }
  Write-Host "       -> alle gleich, gut."
}
else {
  Schritt "4/6  Pruefungen uebersprungen (-Schnell)"
}

Schritt "5/6  Bauen (dauert beim ersten Mal einige Minuten)"
npm run tauri build
if ($LASTEXITCODE -ne 0) { throw "Der Build ist fehlgeschlagen - siehe Meldungen oben." }

Schritt "6/6  Fertig"
$bundle = Join-Path $root "src-tauri\target\release\bundle"
$exe    = Join-Path $root "src-tauri\target\release\ghgflix.exe"

Get-ChildItem -Path $bundle -Recurse -Include *.exe, *.msi -ErrorAction SilentlyContinue |
  ForEach-Object { Write-Host ("     Installer:  " + $_.FullName) -ForegroundColor Green }
if (Test-Path $exe) { Write-Host ("     Portable:   " + $exe) -ForegroundColor Green }

# ---------------------------------------------------------------------------
# 7) Optional: gleich installieren - und die Taskleiste retten
#
# WARUM DAS HIER STEHT (gemessen am 01.08.2026):
# Der NSIS-Installer entfernt beim Ersetzen der alten Fassung die angeheftete
# TASKLEISTEN-Verknuepfung. Startmenue und Desktop legt er neu an, die
# Taskleiste NICHT - dort ist das Symbol danach einfach weg.
#
# Und es laesst sich auch nicht per Programm wieder anheften: Windows hat das
# Verb "An Taskleiste anheften" seit Windows 10 gesperrt (nachgeprueft - die
# Verbenliste einer .exe kennt nur noch "An Start anheften"). Was bleibt: die
# .lnk-Datei vorher sichern und sofort nach der Installation zurueckschreiben,
# BEVOR der Explorer das Fehlen bemerkt und den Platz aus der Registrierung
# wirft. Klappt auch das nicht, sagt das Skript klar, dass ein Rechtsklick
# noetig ist - statt es stillschweigend kaputt zu lassen.
# ---------------------------------------------------------------------------
if ($Installieren) {
  Schritt "7/7  Installieren"

  $tbOrdner = Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
  $tbDatei  = Join-Path $tbOrdner "GHGFlix.lnk"
  $warAngeheftet = Test-Path $tbDatei
  if ($warAngeheftet) { Write-Host "     Taskleisten-Verknuepfung gefunden - wird nachher zurueckgeholt." }

  $setup = Get-ChildItem -Path (Join-Path $bundle "nsis") -Filter "*-setup.exe" -ErrorAction SilentlyContinue |
           Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $setup) { throw "Kein Installer im Ordner 'nsis' gefunden." }

  Get-Process -Name "ghgflix", "GHGFlix" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Write-Host "     $($setup.Name) laeuft (still) ..."
  $p = Start-Process -FilePath $setup.FullName -ArgumentList "/S" -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "Der Installer endete mit Code $($p.ExitCode)." }

  $ziel = Join-Path $env:LOCALAPPDATA "GHGFlix\ghgflix.exe"
  if (Test-Path $ziel) {
    Write-Host ("     Installiert: Version " + (Get-Item $ziel).VersionInfo.FileVersion) -ForegroundColor Green
  } else {
    Write-Host "     WARNUNG: $ziel nicht gefunden." -ForegroundColor Yellow
  }

  if ($warAngeheftet -and -not (Test-Path $tbDatei) -and (Test-Path $ziel)) {
    New-Item -ItemType Directory -Force -Path $tbOrdner | Out-Null
    $sh  = New-Object -ComObject WScript.Shell
    $lnk = $sh.CreateShortcut($tbDatei)
    $lnk.TargetPath       = $ziel
    $lnk.WorkingDirectory = Split-Path $ziel
    $lnk.IconLocation     = "$ziel,0"
    $lnk.Description      = "GHGFlix"
    $lnk.Save()
    Write-Host "     Taskleisten-Verknuepfung zurueckgeschrieben." -ForegroundColor Green
    Write-Host "     Ist das Symbol trotzdem weg, hat der Explorer den Platz schon"
    Write-Host "     freigegeben - dann einmal Rechtsklick auf GHGFlix im Startmenue"
    Write-Host "     und 'An Taskleiste anheften'. Windows laesst das nur von Hand zu."
  }

  Write-Host ""
  Write-Host "Fertig. Bibliothek, Einstellungen und Gesehen-Stand sind unberuehrt" -ForegroundColor Green
  Write-Host "(sie liegen in $env:APPDATA\com.ghgflix.app)." -ForegroundColor Green
  Write-Host ""
  exit 0
}

Write-Host ""
Write-Host "So geht es weiter:" -ForegroundColor Yellow
Write-Host "  * Den Installer (.exe im Ordner 'nsis') ausfuehren - er ersetzt die alte"
Write-Host "    Version und aktualisiert Startmenue- und Desktop-Verknuepfung automatisch."
Write-Host "  * ACHTUNG: die angeheftete TASKLEISTEN-Verknuepfung entfernt er dabei."
Write-Host "    Mit '-Installieren' erledigt dieses Skript das Zurueckholen selbst."
Write-Host "  * Deine Bibliothek, Einstellungen und der Gesehen-Stand bleiben erhalten"
Write-Host "    (sie liegen in $env:APPDATA\com.ghgflix.app, nicht im Programmordner)."
Write-Host ""

if (Test-Path $bundle) { explorer $bundle }
