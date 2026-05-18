$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

$packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$version = $packageJson.version
$releaseName = "PriceParse-$version"

$wxtOutput = Join-Path $projectRoot ".output\chrome-mv3"
$releaseRoot = Join-Path $projectRoot "FOR_USER"
$packageRoot = Join-Path $releaseRoot $releaseName
$workRoot = Join-Path $packageRoot "_priceparse"
$extensionRoot = Join-Path $workRoot "extension"
$templatePath = Join-Path $PSScriptRoot "user-installer-template.hta"

Write-Host "Building extension..."
npm run build

$manifestPath = Join-Path $wxtOutput "manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Build output was not found at $wxtOutput"
}

if (-not (Test-Path -LiteralPath $templatePath)) {
  throw "Installer template was not found at $templatePath"
}

if (Test-Path -LiteralPath $packageRoot) {
  Remove-Item -LiteralPath $packageRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $extensionRoot -Force | Out-Null
Copy-Item -Path (Join-Path $wxtOutput "*") -Destination $extensionRoot -Recurse -Force

$installerTemplate = Get-Content -LiteralPath $templatePath -Raw -Encoding UTF8
$installer = $installerTemplate.Replace("__PRICEPARSE_VERSION__", $version)
Set-Content -LiteralPath (Join-Path $packageRoot "Install PriceParse.hta") -Value $installer -Encoding UTF8

$workItem = Get-Item -LiteralPath $workRoot -Force
$workItem.Attributes = $workItem.Attributes -bor [System.IO.FileAttributes]::Hidden

Get-ChildItem -LiteralPath $releaseRoot -Filter "PriceParse-*.zip" -File -ErrorAction SilentlyContinue |
  Remove-Item -Force

Write-Host ""
Write-Host "User folder: $packageRoot"
Write-Host ""
Write-Host "Visible root file: Install PriceParse.hta"
Write-Host "Extension path:    $extensionRoot"
