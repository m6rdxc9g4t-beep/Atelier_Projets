<#
.SYNOPSIS
  Atelier Projets : installe l'application de bureau Windows pour l'utilisateur courant (docs/SUITE.md §9.1).

.DESCRIPTION
  Sans droits d'administrateur. Vérifie les prérequis (Git, Node.js 22.12 ou plus récent), fait la première mise à jour
  (npm ci depuis le lockfile, client Prisma, copie de la base puis migrations, compilation : desktop/prepare.cjs),
  crée le lanceur « Atelier Projets.exe » dans %LOCALAPPDATA%\Programs\Atelier_Projets (copie d'Electron qui lit le
  code dans ce dépôt), les raccourcis du menu Démarrer (dossier « Atelier ») et du Bureau, puis enregistre l'app dans
  HKCU\Software\Atelier\Apps\projets (Lanceur = raccourci du menu Démarrer, ouvert par les autres apps de la suite, §9.6).

  Ensuite, après un « git pull », relancer simplement l'application : elle se met à jour toute seule (§8).
  Relancer ce script répare l'installation (par exemple après un déplacement du dépôt) sans toucher aux données.
  Les données ne sont jamais touchées : base backend\prisma\dev.db (dans le dépôt, ignorée par git), sauvegardes,
  %APPDATA%\Atelier_Projets et journaux %LOCALAPPDATA%\Atelier_Projets\Logs.

.PARAMETER SansBureau
  Ne crée pas de raccourci sur le Bureau.

.PARAMETER Desinstaller
  Retire le lanceur, les raccourcis et l'enregistrement ; jamais les données.

.PARAMETER DossierMenuDemarrer
  Dossier « Programmes » du menu Démarrer (par défaut celui de l'utilisateur ; la CI en donne un temporaire).

.PARAMETER DossierBureau
  Dossier du Bureau (par défaut celui de l'utilisateur).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1 -Desinstaller
#>
[CmdletBinding()]
param(
  [switch]$SansBureau,
  [switch]$Desinstaller,
  [string]$DossierMenuDemarrer = '',
  [string]$DossierBureau = ''
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
# Accents corrects dans la console (PowerShell 5.1 comme 7).
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }

$Nom = 'Atelier Projets'
$Cle = 'projets'
$Exe = "$Nom.exe"
$Depot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$Programmes = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME 'AppData\Local' }
$Installation = Join-Path $Programmes 'Programs\Atelier_Projets'
$Lanceur = Join-Path $Installation $Exe
$Icone = Join-Path $Installation 'atelier-projets.ico'
$Registre = "HKCU:\Software\Atelier\Apps\$Cle"
# Dossiers de l'utilisateur (redirigés éventuellement par la stratégie de groupe) ; à défaut, emplacements standard.
if (-not $DossierMenuDemarrer) { $DossierMenuDemarrer = [Environment]::GetFolderPath('Programs') }
if (-not $DossierMenuDemarrer) { $DossierMenuDemarrer = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs' }
if (-not $DossierBureau) { $DossierBureau = [Environment]::GetFolderPath('Desktop') }
if (-not $DossierBureau) { $DossierBureau = Join-Path $HOME 'Desktop' }
$DossierAtelier = Join-Path $DossierMenuDemarrer 'Atelier'
$RaccourciMenu = Join-Path $DossierAtelier "$Nom.lnk"
$RaccourciBureau = Join-Path $DossierBureau "$Nom.lnk"

function Etape([string]$Texte) { Write-Host "-> $Texte" }
function Echec([string]$Texte) {
  Write-Host "X $Texte" -ForegroundColor Red
  exit 1
}

# Écrit un fichier texte en UTF-8 sans BOM (lu par Node / Electron).
function Ecrire-Texte([string]$Chemin, [string]$Contenu) {
  [System.IO.File]::WriteAllText($Chemin, $Contenu, (New-Object System.Text.UTF8Encoding $false))
}

# Arrête l'application installée si elle est ouverte (fermeture propre de la fenêtre d'abord).
function Arreter-Application {
  $ouvertes = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
      try { $_.Path -and $_.Path.StartsWith($Installation, [StringComparison]::OrdinalIgnoreCase) } catch { $false }
    })
  if ($ouvertes.Count -eq 0) { return }
  Etape "Fermeture d'$Nom..."
  foreach ($p in $ouvertes) { try { [void]$p.CloseMainWindow() } catch { } }
  Start-Sleep -Seconds 5
  foreach ($p in $ouvertes) { try { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force } } catch { } }
  Start-Sleep -Seconds 1
}

# Supprime un dossier en réessayant (fichiers momentanément verrouillés par l'antivirus ou l'indexation).
function Supprimer-Dossier([string]$Dossier) {
  for ($i = 1; $i -le 10; $i++) {
    if (-not (Test-Path -LiteralPath $Dossier)) { return }
    try {
      Remove-Item -LiteralPath $Dossier -Recurse -Force
      return
    } catch {
      if ($i -eq 10) { throw }
      Start-Sleep -Milliseconds (300 * $i)
    }
  }
}

function Creer-Raccourci([string]$Chemin) {
  $dossier = Split-Path -Parent $Chemin
  if (-not (Test-Path -LiteralPath $dossier)) { New-Item -ItemType Directory -Path $dossier -Force | Out-Null }
  $shell = New-Object -ComObject WScript.Shell
  $raccourci = $shell.CreateShortcut($Chemin)
  $raccourci.TargetPath = $Lanceur
  $raccourci.WorkingDirectory = $Installation
  $raccourci.IconLocation = "$Icone,0"
  $raccourci.Description = "$Nom : gestion de projets locale (Suite Atelier)"
  $raccourci.Save()
}

# --- Désinstallation (jamais les données) --------------------------------------------------------------------------

if ($Desinstaller) {
  Arreter-Application
  foreach ($r in @($RaccourciMenu, $RaccourciBureau)) {
    if (Test-Path -LiteralPath $r) { Remove-Item -LiteralPath $r -Force; Etape "Raccourci retiré : $r" }
  }
  if ((Test-Path -LiteralPath $DossierAtelier) -and -not (Get-ChildItem -LiteralPath $DossierAtelier -Force | Select-Object -First 1)) {
    Remove-Item -LiteralPath $DossierAtelier -Force
  }
  if (Test-Path -LiteralPath $Registre) { Remove-Item -LiteralPath $Registre -Recurse -Force; Etape "Enregistrement retiré : $Registre" }
  if (Test-Path -LiteralPath $Installation) { Supprimer-Dossier $Installation; Etape "Lanceur retiré : $Installation" }
  Write-Host "OK $Nom est désinstallé. Données conservées : $(Join-Path $Depot 'backend\prisma'), %APPDATA%\Atelier_Projets, %LOCALAPPDATA%\Atelier_Projets\Logs." -ForegroundColor Green
  exit 0
}

# --- Prérequis ------------------------------------------------------------------------------------------------------

Write-Host "$Nom : installation pour $env:USERNAME (dépôt $Depot)"
$manque = @()
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  $manque += 'Git : winget install --id Git.Git -e'
}
$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) {
  $manque += 'Node.js 24 (avec npm) : winget install --id OpenJS.NodeJS.LTS -e'
} else {
  $version = (& node --version).Trim()
  $ok = $false
  if ($version -match '^v(\d+)\.(\d+)\.') {
    $majeure = [int]$Matches[1]; $mineure = [int]$Matches[2]
    $ok = $majeure -gt 22 -or ($majeure -eq 22 -and $mineure -ge 12)
  }
  if (-not $ok) { $manque += "Node.js 22.12 ou plus récent (trouvé : $version) : winget install --id OpenJS.NodeJS.LTS -e" }
}
if ($manque.Count -gt 0) {
  Write-Host 'X Prérequis manquants (à installer, puis rouvrir PowerShell et relancer ce script) :' -ForegroundColor Red
  foreach ($m in $manque) { Write-Host "  - $m" }
  exit 1
}
$build = [Environment]::OSVersion.Version.Build
if ($build -lt 19044) { Write-Host "! Windows 10 21H2 (build 19044) ou plus récent est conseillé (build $build)." -ForegroundColor Yellow }

# --- Première mise à jour : npm ci, Prisma, sauvegarde et migrations, compilation ------------------------------------

Arreter-Application
Etape 'Mise à jour du dépôt (npm ci, base, compilation : quelques minutes la première fois)...'
Push-Location -LiteralPath $Depot
try {
  & node (Join-Path $Depot 'desktop\prepare.cjs')
  if ($LASTEXITCODE -ne 0) { Echec 'La mise à jour a échoué (détail ci-dessus et dans %LOCALAPPDATA%\Atelier_Projets\Logs\mise-a-jour.log).' }
} finally {
  Pop-Location
}

# --- Lanceur : copie d'Electron (survit à npm ci) qui lit le code dans le dépôt ---------------------------------------

# Binaire d'Electron téléchargé à la demande s'il manque (comme scripts/macos/install-desktop.sh).
Push-Location -LiteralPath $Depot
try { & node -e "require('electron')" | Out-Null } finally { Pop-Location }
$electron = Join-Path $Depot 'node_modules\electron\dist'
if (-not (Test-Path -LiteralPath (Join-Path $electron 'electron.exe'))) {
  Echec "Electron introuvable ($electron). Essayer : Remove-Item -Recurse node_modules\electron, puis relancer ce script."
}
Etape "Création du lanceur : $Lanceur"
Supprimer-Dossier $Installation
New-Item -ItemType Directory -Path $Installation -Force | Out-Null
Copy-Item -Path (Join-Path $electron '*') -Destination $Installation -Recurse -Force
Rename-Item -LiteralPath (Join-Path $Installation 'electron.exe') -NewName $Exe
$ressources = Join-Path $Installation 'resources'
$defaut = Join-Path $ressources 'default_app.asar'
if (Test-Path -LiteralPath $defaut) { Remove-Item -LiteralPath $defaut -Force }
$app = Join-Path $ressources 'app'
New-Item -ItemType Directory -Path $app -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $Depot 'scripts\windows\atelier-projets.ico') -Destination $Icone -Force

$versionApp = (Get-Content -LiteralPath (Join-Path $Depot 'desktop\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$paquet = [ordered]@{ name = 'atelier-projets'; productName = $Nom; version = $versionApp; main = 'main.cjs'; private = $true }
Ecrire-Texte (Join-Path $app 'package.json') (($paquet | ConvertTo-Json) + "`n")
# Chemin du dépôt en chaîne JSON (= littéral JavaScript valide, espaces et accents compris).
$depotJs = ConvertTo-Json $Depot
$lanceurJs = @"
// Lanceur généré par scripts/windows/install.ps1 (ne pas modifier : relancer le script).
'use strict'
process.env.ATELIER_REPO = $depotJs
const fs = require('node:fs')
const path = require('node:path')
const entry = path.join(process.env.ATELIER_REPO, 'desktop', 'main.cjs')
if (fs.existsSync(entry)) {
  require(entry)
} else {
  const { app, dialog } = require('electron')
  app.whenReady().then(() => {
    dialog.showErrorBox('Atelier Projets', 'Dépôt introuvable : ' + process.env.ATELIER_REPO + '\n\nDepuis le dépôt (déplacé ?), relancer : powershell -ExecutionPolicy Bypass -File scripts\\windows\\install.ps1')
    app.exit(2)
  })
}
"@
Ecrire-Texte (Join-Path $app 'main.cjs') ($lanceurJs -replace "`r`n", "`n")

# --- Raccourcis --------------------------------------------------------------------------------------------------------

Etape "Raccourci du menu Démarrer : $RaccourciMenu"
Creer-Raccourci $RaccourciMenu
if ($SansBureau) {
  if (Test-Path -LiteralPath $RaccourciBureau) { Remove-Item -LiteralPath $RaccourciBureau -Force }
} else {
  Etape "Raccourci du Bureau : $RaccourciBureau"
  Creer-Raccourci $RaccourciBureau
}

# --- Vérification du lanceur (mise à jour seule : rien à refaire) -----------------------------------------------------

Etape 'Vérification du lanceur...'
$verif = Start-Process -FilePath $Lanceur -ArgumentList '--mise-a-jour-seulement' -Wait -PassThru
if ($verif.ExitCode -ne 0) {
  Echec "Le lanceur a échoué (code $($verif.ExitCode)) : voir %LOCALAPPDATA%\Atelier_Projets\Logs\app.log et mise-a-jour.log."
}

# --- Enregistrement pour les autres apps de la suite (§9.4) -------------------------------------------------------------

Etape "Enregistrement : $Registre"
New-Item -Path $Registre -Force | Out-Null
# Lanceur = raccourci du menu Démarrer (icône, cible) : les autres apps l'ouvrent par explorer.exe (docs/SUITE.md §9.6).
Set-ItemProperty -LiteralPath $Registre -Name 'Lanceur' -Value $RaccourciMenu
Set-ItemProperty -LiteralPath $Registre -Name 'Nom' -Value $Nom
Set-ItemProperty -LiteralPath $Registre -Name 'Depot' -Value $Depot

Write-Host "OK $Nom est installé." -ForegroundColor Green
Write-Host "  Ouvrir : menu Démarrer > Atelier > $Nom"
Write-Host '  Mettre à jour : git pull dans le dépôt, puis relancer l''application (elle se met à jour toute seule).'
Write-Host "  Journaux : $(Join-Path $Programmes 'Atelier_Projets\Logs')"
Write-Host '  Désinstaller : powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1 -Desinstaller'
