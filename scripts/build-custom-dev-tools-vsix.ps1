param(
  [string]$Version = "0.5.2"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root "extension"
$dist = Join-Path $root "dist"
$packageRoot = Join-Path $dist "custom-dev-tools-theme-kit-vsix"
$extensionRoot = Join-Path $packageRoot "extension"
$vsixPath = Join-Path $dist "custom-dev-tools-theme-kit-$Version.vsix"
$zipPath = Join-Path $dist "custom-dev-tools-theme-kit-$Version.zip"

if (-not (Test-Path -LiteralPath $source)) {
  throw "extension 폴더를 찾을 수 없습니다: $source"
}

$resolvedRoot = [System.IO.Path]::GetFullPath($root)
$resolvedPackageRoot = [System.IO.Path]::GetFullPath($packageRoot)
if (-not $resolvedPackageRoot.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "패키징 출력 경로가 워크스페이스 밖입니다: $resolvedPackageRoot"
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path -LiteralPath $packageRoot) {
  Remove-Item -LiteralPath $packageRoot -Recurse -Force
}
if (Test-Path -LiteralPath $vsixPath) {
  Remove-Item -LiteralPath $vsixPath -Force
}
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Force -Path $extensionRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $source "extension.js") -Destination $extensionRoot -Force
Copy-Item -LiteralPath (Join-Path $source "package.json") -Destination $extensionRoot -Force
Copy-Item -LiteralPath (Join-Path $source "resources") -Destination $extensionRoot -Recurse -Force

$extensionPack = @(
  "alefragnani.bookmarks",
  "antfu.theme-vitesse",
  "catppuccin.catppuccin-vsc",
  "christian-kohler.path-intellisense",
  "dbaeumer.vscode-eslint",
  "dsznajder.es7-react-js-snippets",
  "eamodio.gitlens",
  "editorconfig.editorconfig",
  "esbenp.prettier-vscode",
  "formulahendry.auto-close-tag",
  "formulahendry.auto-rename-tag",
  "fwcd.kotlin",
  "gruntfuggly.todo-tree",
  "mhutchie.git-graph",
  "ms-azuretools.vscode-containers",
  "ms-azuretools.vscode-docker",
  "ms-ceintl.vscode-language-pack-ko",
  "ms-python.black-formatter",
  "ms-python.debugpy",
  "ms-python.isort",
  "ms-python.pylint",
  "ms-python.python",
  "ms-python.vscode-pylance",
  "ms-python.vscode-python-envs",
  "ms-toolsai.jupyter",
  "ms-toolsai.jupyter-keymap",
  "ms-toolsai.jupyter-renderers",
  "ms-toolsai.vscode-jupyter-cell-tags",
  "ms-toolsai.vscode-jupyter-slideshow",
  "ms-vscode.live-server",
  "ms-vsliveshare.vsliveshare",
  "oderwat.indent-rainbow",
  "pkief.material-icon-theme",
  "redhat.java",
  "redhat.vscode-yaml",
  "usernamehw.errorlens",
  "vmware.vscode-spring-boot",
  "vscjava.vscode-gradle",
  "vscjava.vscode-java-debug",
  "vscjava.vscode-java-dependency",
  "vscjava.vscode-java-pack",
  "vscjava.vscode-java-test",
  "vscjava.vscode-maven",
  "vscjava.vscode-spring-boot-dashboard",
  "wix.vscode-import-cost",
  "zhuangtongfa.material-theme"
)

$packageJsonPath = Join-Path $extensionRoot "package.json"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$packageJson = [System.IO.File]::ReadAllText($packageJsonPath, $utf8NoBom) | ConvertFrom-Json
$packageJson.version = $Version
$packageJson | Add-Member -NotePropertyName "extensionPack" -NotePropertyValue $extensionPack -Force
$packageJson | Add-Member -NotePropertyName "extensionKind" -NotePropertyValue @("ui") -Force
[System.IO.File]::WriteAllText($packageJsonPath, ($packageJson | ConvertTo-Json -Depth 100), $utf8NoBom)

$readme = @'
# Custom Dev Tools & Theme Kit

This VSIX packages a custom VS Code development environment for repeatable setup.

- Provides Java/Spring, Python, Docker, Database, Notification, and Theme views.
- Starts with no bundled background image. Users choose their own local image from the Theme view.
- The Design view uses official VS Code color customization settings.
- Marketplace extensions from the current setup are listed in `extensionPack` so they can be installed together on another machine.

Note: the full-window background image mod is split into the separate `Custom Workbench Background Mod` VSIX.
'@
[System.IO.File]::WriteAllText((Join-Path $extensionRoot "README.md"), $readme, $utf8NoBom)

$securityPath = Join-Path $root "SECURITY.md"
if (Test-Path -LiteralPath $securityPath) {
  Copy-Item -LiteralPath $securityPath -Destination (Join-Path $extensionRoot "SECURITY.md") -Force
}

$reviewPath = Join-Path $root "docs\SECURITY_AND_MEMORY_REVIEW.md"
if (Test-Path -LiteralPath $reviewPath) {
  New-Item -ItemType Directory -Force -Path (Join-Path $extensionRoot "docs") | Out-Null
  Copy-Item -LiteralPath $reviewPath -Destination (Join-Path $extensionRoot "docs\SECURITY_AND_MEMORY_REVIEW.md") -Force
}

function Escape-Xml([string]$value) {
  return [System.Security.SecurityElement]::Escape($value)
}

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="ko-KR" Id="$(Escape-Xml $packageJson.name)" Version="$(Escape-Xml $packageJson.version)" Publisher="$(Escape-Xml $packageJson.publisher)" />
    <DisplayName>$(Escape-Xml $packageJson.displayName)</DisplayName>
    <Description xml:space="preserve">$(Escape-Xml $packageJson.description)</Description>
    <Tags>Other</Tags>
    <Categories>Other</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="$(Escape-Xml $packageJson.engines.vscode)" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Code.Readme" Path="extension/README.md" Addressable="true" />
  </Assets>
</PackageManifest>
"@
[System.IO.File]::WriteAllText((Join-Path $packageRoot "extension.vsixmanifest"), $manifest, $utf8NoBom)

$contentTypes = @"
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="svg" ContentType="image/svg+xml" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="xml" ContentType="application/xml" />
  <Override PartName="/extension.vsixmanifest" ContentType="text/xml" />
  <Override PartName="/extension/package.json" ContentType="application/json" />
</Types>
"@
[System.IO.File]::WriteAllText((Join-Path $packageRoot "[Content_Types].xml"), $contentTypes, $utf8NoBom)

Compress-Archive -LiteralPath (Join-Path $packageRoot "extension"), (Join-Path $packageRoot "extension.vsixmanifest"), (Join-Path $packageRoot "[Content_Types].xml") -DestinationPath $zipPath -Force
Move-Item -LiteralPath $zipPath -Destination $vsixPath -Force

$result = [pscustomobject]@{
  Vsix = $vsixPath
  ExtensionRoot = $extensionRoot
  Version = $Version
  ExtensionPackCount = $extensionPack.Count
}

$result | ConvertTo-Json -Depth 10
