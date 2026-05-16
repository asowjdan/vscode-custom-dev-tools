param(
  [string]$Version = "0.1.3"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root "extensions\workbench-background-mod"
$dist = Join-Path $root "dist"
$packageRoot = Join-Path $dist "custom-workbench-background-mod-vsix"
$extensionRoot = Join-Path $packageRoot "extension"
$vsixPath = Join-Path $dist "custom-workbench-background-mod-$Version.vsix"
$zipPath = Join-Path $dist "custom-workbench-background-mod-$Version.zip"

if (-not (Test-Path -LiteralPath $source)) {
  throw "background mod extension 폴더를 찾을 수 없습니다: $source"
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
Copy-Item -LiteralPath (Join-Path $source "README.md") -Destination $extensionRoot -Force
Copy-Item -LiteralPath (Join-Path $source "resources") -Destination $extensionRoot -Recurse -Force

$packageJsonPath = Join-Path $extensionRoot "package.json"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$packageJson = [System.IO.File]::ReadAllText($packageJsonPath, $utf8NoBom) | ConvertFrom-Json
$packageJson.version = $Version
$packageJson | Add-Member -NotePropertyName "extensionKind" -NotePropertyValue @("ui") -Force
[System.IO.File]::WriteAllText($packageJsonPath, ($packageJson | ConvertTo-Json -Depth 100), $utf8NoBom)

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

[pscustomobject]@{
  Vsix = $vsixPath
  ExtensionRoot = $extensionRoot
  Version = $Version
} | ConvertTo-Json -Depth 10
