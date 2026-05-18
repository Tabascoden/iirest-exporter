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
$easyReleaseRoot = Join-Path $projectRoot "FOR_USER"
$easyZipPath = Join-Path $easyReleaseRoot "$releaseName.zip"

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
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="x-ua-compatible" content="IE=11">
  <title>PriceParse Installer</title>
  <hta:application
    id="PriceParseInstaller"
    applicationname="PriceParse Installer"
    border="thin"
    caption="yes"
    maximizebutton="no"
    minimizebutton="yes"
    scroll="no"
    singleinstance="yes"
    sysmenu="yes"
    windowstate="normal"
  />
  <style>
    html,
    body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #f4f1ea;
      color: #1f2933;
      font-family: "Segoe UI", Tahoma, sans-serif;
      font-size: 14px;
    }

    .shell {
      padding: 28px;
    }

    .badge {
      display: inline-block;
      padding: 5px 9px;
      border: 1px solid #c8d4ce;
      background: #e8efe9;
      color: #23523f;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
    }

    h1 {
      margin: 16px 0 8px;
      color: #162029;
      font-size: 30px;
      font-weight: 700;
      line-height: 1.15;
    }

    .lead {
      margin: 0 0 20px;
      color: #4f5d66;
      font-size: 15px;
      line-height: 1.45;
    }

    .panel {
      margin: 18px 0;
      padding: 18px;
      border: 1px solid #d8d2c6;
      background: #fffaf1;
    }

    .step {
      margin: 0 0 11px;
      line-height: 1.4;
    }

    .step strong {
      color: #162029;
    }

    .path {
      box-sizing: border-box;
      width: 100%;
      margin-top: 8px;
      padding: 10px 11px;
      border: 1px solid #c8d4ce;
      background: #ffffff;
      color: #26323a;
      font-family: Consolas, "Courier New", monospace;
      font-size: 12px;
    }

    .actions {
      margin-top: 18px;
    }

    button {
      min-width: 176px;
      margin-right: 8px;
      padding: 11px 14px;
      border: 1px solid #2f6f55;
      background: #2f6f55;
      color: #ffffff;
      font-family: "Segoe UI", Tahoma, sans-serif;
      font-size: 14px;
      font-weight: 700;
      cursor: hand;
    }

    button.secondary {
      border-color: #b8c5bf;
      background: #ffffff;
      color: #2f4d41;
    }

    button:disabled {
      border-color: #a7adb2;
      background: #a7adb2;
      color: #ffffff;
      cursor: default;
    }

    .status {
      min-height: 20px;
      margin-top: 16px;
      color: #2f6f55;
      font-weight: 700;
      line-height: 1.35;
    }

    .status.error {
      color: #b42318;
    }
  </style>
  <script language="javascript">
    function getShell() {
      return new ActiveXObject("WScript.Shell");
    }

    function getFileSystem() {
      return new ActiveXObject("Scripting.FileSystemObject");
    }

    function getInstallerFolder() {
      var path = document.location.pathname;
      if (path.charAt(0) === "/") {
        path = path.substring(1);
      }
      path = path.replace(/\//g, "\\");
      try {
        path = decodeURIComponent(path);
      } catch (error) {
        path = unescape(path);
      }
      return path.substring(0, path.lastIndexOf("\\") + 1);
    }

    function getExtensionPath() {
      return getInstallerFolder() + "_priceparse\\extension";
    }

    function setStatus(message, isError) {
      var status = document.getElementById("status");
      status.className = isError ? "status error" : "status";
      status.innerHTML = message;
    }

    function copyPath() {
      var path = getExtensionPath();
      var pathInput = document.getElementById("extensionPath");
      pathInput.value = path;
      pathInput.select();

      try {
        window.clipboardData.setData("Text", path);
        setStatus("Путь к расширению скопирован. Теперь выберите его в Chrome.", false);
        return true;
      } catch (error) {
        setStatus("Не удалось скопировать путь автоматически. Выделите поле с путем и нажмите Ctrl+C.", true);
        return false;
      }
    }

    function openChromeExtensions() {
      var shell = getShell();
      var files = getFileSystem();
      var candidates = [
        shell.ExpandEnvironmentStrings("%ProgramFiles%") + "\\Google\\Chrome\\Application\\chrome.exe",
        shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") + "\\Google\\Chrome\\Application\\chrome.exe",
        shell.ExpandEnvironmentStrings("%LocalAppData%") + "\\Google\\Chrome\\Application\\chrome.exe"
      ];

      for (var i = 0; i < candidates.length; i++) {
        if (files.FileExists(candidates[i])) {
          shell.Run("\"" + candidates[i] + "\" chrome://extensions", 1, false);
          return;
        }
      }

      shell.Run("chrome://extensions", 1, false);
    }

    function startInstall() {
      var files = getFileSystem();
      var manifestPath = getExtensionPath() + "\\manifest.json";
      if (!files.FileExists(manifestPath)) {
        setStatus("Файлы расширения не найдены. Сначала распакуйте весь ZIP-архив в обычную папку.", true);
        return;
      }

      copyPath();
      openChromeExtensions();
    }

    function init() {
      window.resizeTo(610, 610);
      var path = getExtensionPath();
      document.getElementById("extensionPath").value = path;

      var files = getFileSystem();
      if (!files.FileExists(path + "\\manifest.json")) {
        document.getElementById("installButton").disabled = true;
        setStatus("Файлы расширения не найдены. Распакуйте ZIP полностью и запустите этот файл из распакованной папки.", true);
      }
    }
  </script>
</head>
<body onload="init()">
  <div class="shell">
    <div class="badge">Chrome extension</div>
    <h1>Установка PriceParse</h1>
    <p class="lead">Окно откроет страницу расширений Chrome и подготовит путь к папке, которую нужно выбрать.</p>

    <div class="panel">
      <p class="step"><strong>1.</strong> Нажмите кнопку ниже.</p>
      <p class="step"><strong>2.</strong> В Chrome включите режим разработчика.</p>
      <p class="step"><strong>3.</strong> Нажмите <strong>Загрузить распакованное расширение</strong> и вставьте подготовленный путь.</p>
      <input id="extensionPath" class="path" type="text" readonly>
    </div>

    <div class="actions">
      <button id="installButton" onclick="startInstall()">Открыть установку</button>
      <button class="secondary" onclick="copyPath()">Скопировать путь</button>
    </div>

    <div id="status" class="status"></div>
  </div>
</body>
</html>
'@

Set-Content -LiteralPath (Join-Path $packageRoot "Install PriceParse.hta") -Value $installer -Encoding UTF8

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $packageRoot "*") -DestinationPath $zipPath -Force

New-Item -ItemType Directory -Path $easyReleaseRoot -Force | Out-Null
Copy-Item -LiteralPath $zipPath -Destination $easyZipPath -Force

Write-Host ""
Write-Host "User release folder: $packageRoot"
Write-Host "User release ZIP:    $zipPath"
Write-Host "Easy user ZIP:       $easyZipPath"
Write-Host ""
Write-Host "ZIP root contains Install PriceParse.hta and the _priceparse working folder."
