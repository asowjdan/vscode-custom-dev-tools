# 두 VSIX와 extensionPack 마켓플레이스 확장을 모두 설치합니다.
# 사용법:
#   .\scripts\install-extensions.ps1                  # VSIX + 마켓플레이스 전체 설치
#   .\scripts\install-extensions.ps1 -SkipMarketplace # VSIX 두 개만 설치
param(
  [switch]$SkipMarketplace
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"

if (-not (Test-Path -LiteralPath $dist)) {
  throw "dist 폴더가 없습니다. 먼저 빌드 스크립트를 실행하세요."
}

$mainVsix = Get-ChildItem -LiteralPath $dist -Filter "custom-dev-tools-theme-kit-*.vsix" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
$bgVsix = Get-ChildItem -LiteralPath $dist -Filter "custom-workbench-background-mod-*.vsix" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $mainVsix) {
  throw "custom-dev-tools-theme-kit VSIX를 찾을 수 없습니다. build-custom-dev-tools-vsix.ps1을 먼저 실행하세요."
}
if (-not $bgVsix) {
  throw "custom-workbench-background-mod VSIX를 찾을 수 없습니다. build-workbench-background-mod-vsix.ps1을 먼저 실행하세요."
}

Write-Host "설치 중: $($mainVsix.Name)"
code --install-extension $mainVsix.FullName --force

Write-Host "설치 중: $($bgVsix.Name)"
code --install-extension $bgVsix.FullName --force

if (-not $SkipMarketplace) {
  $extensions = @(
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

  Write-Host "`n마켓플레이스 확장 설치 중 ($($extensions.Count)개)..."
  foreach ($ext in $extensions) {
    Write-Host "  설치 중: $ext"
    code --install-extension $ext --force
  }
}

Write-Host "`n설치 완료. VS Code를 재시작하면 모든 설정이 적용됩니다."
