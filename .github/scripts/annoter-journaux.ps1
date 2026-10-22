# CI (échec) : recopie l'essentiel des journaux en annotations d'erreur, lisibles par l'API GitHub
# (check-runs/<id>/annotations) même quand les journaux complets ne sont pas téléchargeables.
param([string[]]$Fichiers)

$annotations = 0
foreach ($motif in $Fichiers) {
  foreach ($fichier in @(Get-ChildItem -Path $motif -File -ErrorAction SilentlyContinue)) {
    $lignes = @(Get-Content -LiteralPath $fichier.FullName -Encoding UTF8 -ErrorAction SilentlyContinue)
    if ($lignes.Count -eq 0) { continue }
    $marquees = @($lignes | Select-String -Pattern 'not ok|✖|✘|Error|ERR!|failed|échou|Exception|throw|code [1-9]' | Select-Object -First 60 | ForEach-Object { $_.Line })
    $texte = "== $($fichier.Name) ==`n" + (($marquees + '...' + ($lignes | Select-Object -Last 60)) -join "`n")
    if ($texte.Length -gt 6000) { $texte = $texte.Substring($texte.Length - 6000) }
    $texte = $texte.Replace('%', '%25').Replace("`r", '').Replace("`n", '%0A')
    Write-Output "::error title=$($fichier.Name)::$texte"
    $annotations++
    if ($annotations -ge 9) { return }
  }
}
