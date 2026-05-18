$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

$packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$version = $packageJson.version
$releaseName = "PriceParse-$version"

$wxtOutput = Join-Path $projectRoot ".output\chrome-mv3"
$releaseRoot = Join-Path $projectRoot ".output\user-release"
$packageRoot = Join-Path $releaseRoot $releaseName
$workRoot = Join-Path $packageRoot "_priceparse"
$extensionRoot = Join-Path $workRoot "extension"
$zipPath = Join-Path $releaseRoot "$releaseName.zip"

Write-Host "Building extension..."
npm run build

$manifestPath = Join-Path $wxtOutput "manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Build output was not found at $wxtOutput"
}

if (Test-Path -LiteralPath $packageRoot) {
  Remove-Item -LiteralPath $packageRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $extensionRoot -Force | Out-Null
Copy-Item -Path (Join-Path $wxtOutput "*") -Destination $extensionRoot -Recurse -Force

$installer = @'
@echo off
setlocal

set "EXT_DIR=%~dp0_priceparse\extension"

if not exist "%EXT_DIR%\manifest.json" (
  echo PriceParse extension files were not found.
  echo.
  echo Extract the whole ZIP archive to a normal folder first,
  echo then run install.cmd from the extracted folder.
  echo.
  pause
  exit /b 1
)

echo %EXT_DIR%| clip

set "CHROME_URL=chrome://extensions"
set "CHROME_EXE="

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if defined CHROME_EXE (
  start "" "%CHROME_EXE%" "%CHROME_URL%"
) else (
  start "" "%CHROME_URL%"
)

echo PriceParse extension path copied to clipboard:
echo %EXT_DIR%
echo.
echo In the opened Chrome Extensions page:
echo 1. Enable Developer mode.
echo 2. Click Load unpacked.
echo 3. Paste the copied folder path and select it.
echo.
pause
'@

Set-Content -LiteralPath (Join-Path $packageRoot "install.cmd") -Value $installer -Encoding ASCII

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $packageRoot "*") -DestinationPath $zipPath -Force

Write-Host ""
Write-Host "User release folder: $packageRoot"
Write-Host "User release ZIP:    $zipPath"
Write-Host ""
Write-Host "ZIP root contains install.cmd and the _priceparse working folder."
