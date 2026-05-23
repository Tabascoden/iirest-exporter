[CmdletBinding()]
param(
  [ValidateSet("chrome", "yandex")]
  [string]$Browser = "chrome"
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

$targets = @{
  chrome = @{
    BuildScript = "build"
    CrxName = $null
    InstallerName = "Install iiRest Exporter.hta"
    OutputDir = "chrome-mv3"
    PackCrx = $false
    ReleaseName = "iiRest Exporter"
    TemplateName = "user-installer-template.hta"
    WorkDir = "_iirest-exporter"
  }
  yandex = @{
    BuildScript = "build:yandex"
    CrxName = "iiRest Exporter Yandex.crx"
    InstallerName = "Install iiRest Exporter Yandex.hta"
    OutputDir = "yandex-mv3"
    PackCrx = $true
    ReleaseName = "iiRest Exporter Yandex"
    TemplateName = "yandex-installer-template.hta"
    WorkDir = "_iirest-exporter-yandex"
  }
}

function Resolve-FirstExistingPath {
  param([string[]]$Candidates)

  foreach ($candidate in $Candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  return $null
}

function Find-ExtensionPackBrowser {
  $programFilesX86 = [Environment]::GetFolderPath("ProgramFilesX86")
  $localAppData = [Environment]::GetFolderPath("LocalApplicationData")
  $candidates = @(
    (Get-Command chrome.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source),
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path $programFilesX86 "Google\Chrome\Application\chrome.exe"),
    (Join-Path $localAppData "Google\Chrome\Application\chrome.exe"),
    (Get-Command browser.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source),
    (Join-Path $env:ProgramFiles "Yandex\YandexBrowser\Application\browser.exe"),
    (Join-Path $programFilesX86 "Yandex\YandexBrowser\Application\browser.exe"),
    (Join-Path $localAppData "Yandex\YandexBrowser\Application\browser.exe")
  )

  return Resolve-FirstExistingPath $candidates
}

function New-CrxPackage {
  param(
    [string]$ExtensionPath,
    [string]$CrxDestination
  )

  $packBrowser = Find-ExtensionPackBrowser
  if (-not $packBrowser) {
    throw "Chrome or Yandex Browser was not found. Cannot create CRX package."
  }

  $packedCrx = "$ExtensionPath.crx"
  $packedPem = "$ExtensionPath.pem"
  Remove-Item -LiteralPath $packedCrx, $packedPem -Force -ErrorAction SilentlyContinue

  $packProfile = Join-Path ([IO.Path]::GetTempPath()) ("iirest-extension-pack-" + [guid]::NewGuid().ToString("N"))
  & $packBrowser --user-data-dir="$packProfile" --no-first-run --disable-gpu --pack-extension="$ExtensionPath"
  if ($LASTEXITCODE -ne 0) {
    throw "CRX packaging failed with exit code $LASTEXITCODE"
  }

  $deadline = (Get-Date).AddSeconds(30)
  $lastLength = -1
  $stableChecks = 0
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $packedCrx) {
      $length = (Get-Item -LiteralPath $packedCrx).Length
      if ($length -gt 0 -and $length -eq $lastLength) {
        $stableChecks++
        if ($stableChecks -ge 2) {
          break
        }
      } else {
        $stableChecks = 0
        $lastLength = $length
      }
    }

    Start-Sleep -Milliseconds 250
  }

  if (-not (Test-Path -LiteralPath $packedCrx)) {
    throw "CRX package was not created at $packedCrx"
  }

  Move-Item -LiteralPath $packedCrx -Destination $CrxDestination -Force
  Remove-Item -LiteralPath $packedPem -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $packProfile -Recurse -Force -ErrorAction SilentlyContinue
}

$target = $targets[$Browser]
$releaseName = $target.ReleaseName

$wxtOutput = Join-Path $projectRoot (Join-Path ".output" $target.OutputDir)
$releaseRoot = Join-Path $projectRoot "FOR_USER"
$packageRoot = Join-Path $releaseRoot $releaseName
$workRoot = Join-Path $packageRoot $target.WorkDir
$extensionRoot = Join-Path $workRoot "extension"
$templatePath = Join-Path $PSScriptRoot $target.TemplateName

Write-Host "Building $Browser extension..."
npm run $target.BuildScript
if ($LASTEXITCODE -ne 0) {
  throw "Build failed for $Browser"
}

$manifestPath = Join-Path $wxtOutput "manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Build output was not found at $wxtOutput"
}

if (-not (Test-Path -LiteralPath $templatePath)) {
  throw "Installer template was not found at $templatePath"
}

Get-ChildItem -LiteralPath $releaseRoot -Filter "$releaseName-*" -Force -ErrorAction SilentlyContinue |
  Remove-Item -Recurse -Force

if (Test-Path -LiteralPath $packageRoot) {
  Remove-Item -LiteralPath $packageRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $extensionRoot -Force | Out-Null
Copy-Item -Path (Join-Path $wxtOutput "*") -Destination $extensionRoot -Recurse -Force

if ($target.PackCrx) {
  $crxPath = Join-Path $packageRoot $target.CrxName
  Write-Host "Packaging CRX3..."
  New-CrxPackage -ExtensionPath $extensionRoot -CrxDestination $crxPath
}

$installerTemplate = Get-Content -LiteralPath $templatePath -Raw -Encoding UTF8
Set-Content -LiteralPath (Join-Path $packageRoot $target.InstallerName) -Value $installerTemplate -Encoding UTF8

$workItem = Get-Item -LiteralPath $workRoot -Force
$workItem.Attributes = $workItem.Attributes -bor [System.IO.FileAttributes]::Hidden

Get-ChildItem -LiteralPath $releaseRoot -Filter "$releaseName-*.zip" -File -ErrorAction SilentlyContinue |
  Remove-Item -Force

Write-Host ""
Write-Host "User folder: $packageRoot"
Write-Host ""
Write-Host "Visible root file: $($target.InstallerName)"
Write-Host "Extension path:    $extensionRoot"
