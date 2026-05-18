$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

$packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$version = $packageJson.version
$releaseName = "PriceParse-$version"

$wxtOutput = Join-Path $projectRoot ".output\chrome-mv3"
$releaseRoot = Join-Path $projectRoot ".output\user-release"
$packageRoot = Join-Path $releaseRoot $releaseName
$payloadRoot = Join-Path $releaseRoot "$releaseName-payload"
$payloadZipPath = Join-Path $releaseRoot "$releaseName-extension.zip"
$zipPath = Join-Path $releaseRoot "$releaseName.zip"
$easyReleaseRoot = Join-Path $projectRoot "FOR_USER"
$easyZipPath = Join-Path $easyReleaseRoot "$releaseName.zip"
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

foreach ($path in @($packageRoot, $payloadRoot)) {
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
  }
}

foreach ($path in @($payloadZipPath, $zipPath, $easyZipPath)) {
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Force
  }
}

New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null

Copy-Item -Path (Join-Path $wxtOutput "*") -Destination $payloadRoot -Recurse -Force
Compress-Archive -Path (Join-Path $payloadRoot "*") -DestinationPath $payloadZipPath -Force

$payloadBase64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($payloadZipPath))
$installerTemplate = Get-Content -LiteralPath $templatePath -Raw -Encoding UTF8
$installer = $installerTemplate.
  Replace("__PRICEPARSE_VERSION__", $version).
  Replace("__EXTENSION_PAYLOAD_BASE64__", $payloadBase64)

Set-Content -LiteralPath (Join-Path $packageRoot "Install PriceParse.hta") -Value $installer -Encoding UTF8
Compress-Archive -Path (Join-Path $packageRoot "*") -DestinationPath $zipPath -Force

New-Item -ItemType Directory -Path $easyReleaseRoot -Force | Out-Null
Copy-Item -LiteralPath $zipPath -Destination $easyZipPath -Force

Write-Host ""
Write-Host "User release folder: $packageRoot"
Write-Host "User release ZIP:    $zipPath"
Write-Host "Easy user ZIP:       $easyZipPath"
Write-Host ""
Write-Host "ZIP root contains only Install PriceParse.hta."
