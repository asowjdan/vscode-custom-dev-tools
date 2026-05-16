# Worklog

## 2026-05-16 23:49 KST

Request:

- Fix the color reset display bug where the color shown after removing managed settings does not match the actual VS Code default state.
- Fix the background-only mode bug where the code editor becomes opaque when color settings are removed.
- Fix the Korean UI setup not being fully applied.
- Record commands and implementation steps going forward to guard against context loss.

Commands run:

- `Get-Date -Format 'yyyy-MM-dd HH:mm:ss K'`
- `git status --short`
- `rg -n "DEFAULT_THEME|clearColor|ColorSettingsProvider|applyOfficialThemeColors|patchWorkbenchBackground|body::before|monaco-editor|language-pack|configureLocale|locale|ms-ceintl|argv" extension extensions scripts README.md SECURITY.md docs -S`

Initial findings:

- Main extension color clear path stores `DEFAULT_THEME.color` after removing managed `workbench.colorCustomizations`, so the UI shows a synthetic purple preset even though VS Code has returned to its own theme defaults.
- Background mod only makes the editor surface transparent when its CSS block is present, but if the main extension's managed transparent editor colors were cleared, the official theme can make editor backgrounds opaque again.
- Korean UI currently opens the locale picker and includes the Korean language pack in the extension pack, but it does not actively set VS Code's persisted locale file.

Follow-up commands run:

- `Get-Content` slices for `extension/extension.js`, `extensions/workbench-background-mod/extension.js`, `extension/package.json`, and build scripts.
- `rg -n "configureKoreanLanguage|promptKoreanUiSetup|vscode-language-pack-ko|workbench.action.configureLocale|locale|argv|activate\(" extension/extension.js extension/package.json -S`
- `rg -n "THEME_STATE_KEY|customDevTools\.theme|customDevTools\.runtime|customDevToolsThemeKit|asowj|ASOWJ|Custom Dev Tools" extension extensions README.md SECURITY.md docs -S`

Implementation steps:

- Changed the main extension's color state so an empty color means "no managed color preset" instead of falling back to a bundled purple default.
- Updated the color settings webview to show a VS Code default-color preview only as a preview, while clearly labeling that the extension-managed color setting has been removed.
- Updated `clearColor` to persist `color: ""` after removing managed `workbench.colorCustomizations`.
- Expanded the background mod CSS patch so the workbench background image still shows through editor, sidebar, panel, tab, and notification layers even when the main extension's color customization settings are removed.
- Added startup reconciliation to the background mod so an existing image setting is rewritten with the latest CSS block after the extension is updated.
- Reworked the Korean UI command so it writes VS Code's persisted `argv.json` locale to `ko` and keeps the locale picker as a fallback.
- Bumped source versions to `custom-dev-tools-theme-kit` `0.5.1` and `custom-workbench-background-mod` `0.1.2`.

Validation and packaging commands:

- `node --check extension/extension.js`
- `node --check extensions/workbench-background-mod/extension.js`
- `git diff -- extension/extension.js extensions/workbench-background-mod/extension.js extension/package.json extensions/workbench-background-mod/package.json scripts/build-custom-dev-tools-vsix.ps1 scripts/build-workbench-background-mod-vsix.ps1 docs/WORKLOG.md`
- `powershell -ExecutionPolicy Bypass -File .\scripts\build-custom-dev-tools-vsix.ps1 -Version 0.5.1`
- `powershell -ExecutionPolicy Bypass -File .\scripts\build-workbench-background-mod-vsix.ps1 -Version 0.1.1`
- Installed `dist/custom-dev-tools-theme-kit-0.5.1.vsix` and `dist/custom-workbench-background-mod-0.1.1.vsix` into VS Code with `code.cmd --install-extension ... --force`.
- `node --check extensions/workbench-background-mod/extension.js`
- `powershell -ExecutionPolicy Bypass -File .\scripts\build-workbench-background-mod-vsix.ps1 -Version 0.1.2`
- Installed `dist/custom-workbench-background-mod-0.1.2.vsix` into VS Code with `code.cmd --install-extension ... --force`.
- `git status --short`
- `Get-ChildItem -LiteralPath 'dist' -Filter '*.vsix' | Sort-Object Name | Select-Object Name,Length,LastWriteTime`
- `git diff --check`
- Re-ran `node --check extension/extension.js`
- Re-ran `node --check extensions/workbench-background-mod/extension.js`
- `git diff --stat`
- `git status --short`
- `Get-Content -LiteralPath 'docs/WORKLOG.md' -Encoding UTF8 | Select-Object -Last 80`
- Final pre-commit `git diff --check`
- Final pre-commit `git status --short`
- Attempted `git add ...; git commit -m "fix theme reset and background locale sync"` in the sandbox; it failed because the sandbox could not create `.git/index.lock`.
- Re-ran `git add ...` with approved elevated filesystem access.
- Ran `git commit -m "fix theme reset and background locale sync"` with approved elevated filesystem access.

Installed versions after validation:

- `custom-dev-tools.custom-dev-tools-theme-kit@0.5.1`
- `custom-dev-tools.custom-workbench-background-mod@0.1.2`
