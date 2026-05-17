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

## 2026-05-17 00:43 KST

Request:

- Fix the bug where the custom notification tab stopped synchronizing with VS Code's native notification center.
- Continue recording commands and implementation steps.

Commands run:

- `Get-Date -Format 'yyyy-MM-dd HH:mm:ss K'`
- `rg -n "NotificationProvider|NotificationDomBridge|installNotificationBridge|enableNotificationDomBridge|notifications|notificationDetail|showInformationMessage|withProgress|diagnostic" extension/extension.js extension/package.json README.md SECURITY.md docs -S`
- `git status --short`
- `Get-Content -LiteralPath 'docs/WORKLOG.md' -Encoding UTF8 | Select-Object -Last 80`
- `Get-Content` slices for the notification provider, bridge, activation, and configuration sections.
- `rg -n "notificationBridge|notifications-sync|CUSTOM|NOTIFICATION|fetch\(|127\.0\.0\.1|customDevToolsThemeKit\.enableNotificationDomBridge|enableNotificationDomBridge" extension extensions scripts README.md SECURITY.md docs -S`
- Read the current VS Code user `settings.json` for `customDevToolsThemeKit`, notification bridge, color customization, and locale keys.
- Read `SECURITY.md` and `docs/SECURITY_AND_MEMORY_REVIEW.md` notification bridge notes.
- Checked the installed VS Code `workbench.html` for notification sync script markers and found only the background CSS patch block.
- `node --check extension/extension.js`
- `node --check extensions/workbench-background-mod/extension.js`
- `git diff -- extension/extension.js extensions/workbench-background-mod/extension.js extension/package.json extensions/workbench-background-mod/package.json scripts/build-custom-dev-tools-vsix.ps1 scripts/build-workbench-background-mod-vsix.ps1 SECURITY.md docs/SECURITY_AND_MEMORY_REVIEW.md docs/WORKLOG.md`
- `powershell -ExecutionPolicy Bypass -File .\scripts\build-custom-dev-tools-vsix.ps1 -Version 0.5.2`
- `powershell -ExecutionPolicy Bypass -File .\scripts\build-workbench-background-mod-vsix.ps1 -Version 0.1.3`
- Installed `dist/custom-dev-tools-theme-kit-0.5.2.vsix` and `dist/custom-workbench-background-mod-0.1.3.vsix` into VS Code with `code.cmd --install-extension ... --force`.
- `git diff --check`
- Re-ran `node --check extension/extension.js`
- Re-ran `node --check extensions/workbench-background-mod/extension.js`
- `git status --short`
- `git diff --stat`
- `Get-Content -LiteralPath 'docs/WORKLOG.md' -Encoding UTF8 | Select-Object -Last 70`
- Staged notification sync changes with `git add SECURITY.md docs/SECURITY_AND_MEMORY_REVIEW.md docs/WORKLOG.md extension/extension.js extension/package.json extensions/workbench-background-mod/extension.js extensions/workbench-background-mod/package.json scripts/build-custom-dev-tools-vsix.ps1 scripts/build-workbench-background-mod-vsix.ps1`.
- Committed with `git commit -m "fix native notification sync"`.

Installed versions after packaging:

- `custom-dev-tools.custom-dev-tools-theme-kit@0.5.2`
- `custom-dev-tools.custom-workbench-background-mod@0.1.3`

Initial findings:

- The notification bridge was gated by `customDevToolsThemeKit.enableNotificationDomBridge === true`, while the packaged default was `false`.
- `installNotificationBridge(...)` patched `showInformationMessage`, `showWarningMessage`, and `showErrorMessage`, but it did not call `record(...)` after the native VS Code notification was shown, so API notifications could still fail to appear in the custom tab.
- The installed `workbench.html` contained the background mod CSS block but no native notification-center DOM sync script.

Implementation steps:

- Changed the main extension so API-level VS Code notifications are always captured by the custom notification provider without requiring the localhost DOM bridge.
- Kept the DOM bridge setting as the native notification-center sync switch, but changed its default to enabled because the notification tab feature depends on it.
- Updated native DOM sync handling so `dom:` notification snapshots can remove stale native notification entries from the custom tab.
- Added a background-mod injected script that observes VS Code notification DOM nodes, sends `/notifications-sync` snapshots to the local bridge, and handles queued dismiss actions.
- Updated the security notes to describe the local-only notification bridge default and the opt-out setting.
- Bumped source versions to `custom-dev-tools-theme-kit` `0.5.2` and `custom-workbench-background-mod` `0.1.3`.

## 2026-05-17 23:38 KST

Request:

- 1. 색상 조절이 VS Code 전반에 걸쳐 적용되지 않는 버그 수정.
- 2. 배경 제거 시 색상도 리셋되는 버그 수정 — 배경 이미지와 색상 설정이 완전히 독립적으로 동작해야 함.
- 3. 알림센터 번역 방향이 단방향(항상 한국어)이던 버그 수정 — 원문이 한국어면 영어로, 영어면 한국어로 상호 번역.
- 4. 탐색기 + 자바/스프링 패널의 기본 레이아웃을 초기화하는 명령 추가.
- 5. 코드 편집기에서 Java `main()` 위에 ▶ 실행 / 🐛 디버그 / ⏹ 중지 CodeLens 버튼 추가.
- worklog.md를 먼저 확인하고 같은 오류가 반복되지 않도록 기록 유지.

Root cause analysis:

- Issue 1 & 2: `buildOfficialColorCustomizations`가 `editor.background`, `panel.background`, `sideBar.background`, `sideBarSectionHeader.background`, `terminal.background`, `titleBar.*Background`를 알파(투명도 포함) hex로 설정해왔음. 배경 모드 CSS가 없으면 알파 색상이 다른 배경에 합성되어 시각적으로 달라 보이고, 배경 제거 시 색상도 리셋되는 것처럼 보임. 해결책: 모든 zone background를 불투명(solid) hex로 변경.
- Issue 1 (secondary): `NotificationDetailWebviewProvider.wrapHtml()`의 `--bg`, `--surface`, `--surface-strong`, `--border`, `--accent`, `--text`, `--muted`가 하드코딩되어 색상 변경에 반응하지 않았음.
- Issue 2 (background mod): `html{background:#0a0811}`, `body::before{background-color:#0a0811}`, `.part.banner{background:#0a0811}` 가 하드코딩되어 배경 모드 비활성 시 색상 변경이 반영되지 않았음.
- Issue 3: `translate()` 메서드가 `item.translated = item.translatedText !== item.original`로 계산하여 한국어 원문→영어 번역 시 `translated`가 false로 남음. `getHtml()`의 `activeText`가 "원문" 탭에서 `englishText`를 보여주고 "번역" 탭에서 `translatedText`(한국어)를 보여줘 방향이 역전되어 있었음. `getNotificationDetailChildren()`의 `activeText`도 `translatedText`만 사용하여 동일 오류.
- Issue 4: 기본 레이아웃 초기화 명령이 없었음.
- Issue 5: `JavaRunCodeLensProvider`가 없었음. 사이드바 트리뷰의 실행/중지는 작동하지만 편집기 CodeLens가 없어서 편집기에서 실행 중인 프로세스를 종료할 수 없었음.

Implementation steps:

- `buildOfficialColorCustomizations`: `alphaHexForTheme(base0, 0.78)` → `base0`, `alphaHexForTheme(base2, 0.722)` → `base2`, `alphaHexForTheme(base3, 0.722)` → `base3`, terminal/titleBar 배경도 alpha 제거.
- `wrapHtml()` CSS: `--bg` → `var(--vscode-sideBar-background, …)`, `--surface` → `var(--vscode-notifications-background, …)`, `--surface-strong` → `var(--vscode-editor-background, …)`, `--border` → `var(--vscode-panel-border, …)`, `--accent` → `var(--vscode-focusBorder, …)`, `--text` → `var(--vscode-foreground, …)`, `--muted` → `var(--vscode-descriptionForeground, …)`.
- 배경 모드 CSS: `html/body::before/banner` background를 `var(--vscode-editor-background, #0a0811)` 사용.
- `translate()`: `isOriginalKorean = /[가-힣]/.test(item.original)` 추가. early return을 Korean→English, English→Korean 방향에 맞게 수정. `item.translated` / `item.message` 를 방향별로 올바른 번역 텍스트로 계산.
- `showTranslation()`: `crossLangText`로 유효 번역 여부 확인.
- `getNotificationDetailChildren()`: `crossLangText = isOrigKorean ? item.englishText : item.translatedText`. "번역" 탭에 `crossLangText`, "원문" 탭에 `item.original`.
- `getNotificationListLabel()`: `crossLang` 존재 시 해당 텍스트 표시.
- `getHtml()`: `activeText = isTranslated ? (crossLangText || item.original) : item.original`. `translationStatus`도 `crossLangText` 기준으로 수정.
- `RuntimeController.refreshAll()`: `this.javaCodeLensProvider?.refresh()` 추가.
- `JavaRunCodeLensProvider` 클래스 추가: `provideCodeLenses(document)`에서 Java 파일의 `public static void main` 라인을 찾아 실행 중이면 "⏹ 중지", 아니면 "▶ 실행 | 🐛 디버그" CodeLens 표시. node ID는 트리뷰와 동일한 포맷 `${kind}:${relative(root, filePath)}:${className}.main` 사용.
- `activate()`: `javaCodeLensProvider` 인스턴스화, `controller.javaCodeLensProvider = javaCodeLensProvider`, `registerCodeLensProvider({ language: "java" }, ...)` 등록. `runFromEditor` / `stopFromEditor` / `debugFromEditor` / `applyDefaultLayout` 명령 등록.
- `package.json`: 4개 명령 추가, `activationEvents` 4개 추가, 버전 `0.5.5` → `0.5.6`.
- 배경 모드 `package.json`: 버전 `0.1.5` → `0.1.6`.

Anti-regression notes (same-bug prevention):

- zone background에 alpha hex(`alphaHexForTheme`)를 쓰면 배경 모드 on/off에 따라 색상이 달라 보임 → zone background는 항상 solid hex. background mod CSS에서 투명처리는 해당 영역에만 적용.
- 번역 방향 결정은 항상 `isOriginalKorean = /[가-힣]/.test(item.original)`로 시작. KO→EN은 `item.englishText`, EN→KO는 `item.translatedText`. 두 필드를 혼용하지 말 것.
- CodeLens node ID는 `getJavaSpringNodes()`의 `${kind}:${relative(root, filePath)}:${className}.main` 포맷과 완전히 일치해야 `isRunning(nodeId)`가 작동함.

Validation commands run:

- `node --check extension/extension.js`
- `node --check extensions/workbench-background-mod/extension.js`

Installed versions after packaging:

- `custom-dev-tools.custom-dev-tools-theme-kit@0.5.6`
- `custom-dev-tools.custom-workbench-background-mod@0.1.6`

## 2026-05-18 KST

Request (screenshots provided):

- 1. (screenshot-1) 편집기 CodeLens에 우리 확장의 "▶ 실행 | 🐛 디버그" 위에 Java 확장의 네이티브 "Run | Debug"가 중복 표시됨 → 네이티브 제거.
- 2. (screenshot-2) 알림 전문 "번역" 탭이 여전히 한국어 원문을 그대로 표시 — KO→EN 번역 불가 케이스.
- 3. (screenshot-3) 커스텀 배경 이미지가 코드 편집기 영역이 비어있을 때만 보이고, 파일을 열면 배경이 사라짐.
- 4. (screenshot-4) 파일이 열린 편집기 영역 배경이 불투명(solid) — 배경 이미지가 반투명하게 보여야 함.

Screenshot descriptions:

- screenshot-1: HelloProcess.java, line 7 위에 CodeLens 두 줄: 위에 "▶ 실행 | 🐛 디버그" (커스텀), 아래에 "Run | Debug" (Java 확장 네이티브).
- screenshot-2: 알림 센터 패널. 알림 원문: "배경 이미지를 적용했습니다. VS Code를 다시 로드하세요." (한국어). "원문" 탭 활성화, 알림 전문 영역에 동일 한국어 텍스트 표시. "번역 준비됨" 상태인데 클릭 시 번역탭도 한국어.
- screenshot-3: 배경 모드 설정 패널이 왼쪽 사이드바에 열린 상태. 오른쪽 메인 에디터 영역이 비어있어 애니메이션 캐릭터 배경 이미지가 전면에 표시됨.
- screenshot-4: CreateUserRequest.java 파일 열린 상태. 에디터 배경이 완전 불투명한 다크 색상 — 배경 이미지 전혀 보이지 않음.

Root cause analysis:

- Issue 1: `vscjava.vscode-java-debug` 확장이 `java.debug.settings.enableRunDebugCodeLens` 설정이 기본값 true일 때 main() 위에 자체 Run/Debug CodeLens를 추가. 우리 CodeLens와 중복.
- Issue 2: `reverseTranslateDiagnosticText()`가 Java 컴파일러 진단 패턴만 처리하고 일반 VS Code 알림 문구(한국어)에는 매칭 규칙이 없어 원본 한국어를 그대로 반환. `item.englishText = english || item.original`이라 Korean이 그대로 저장됨.
- Issue 3 & 4: 전 세션에서 `editor.background`를 solid hex로 변경(Issue 1&2 수정 목적)한 결과, background mod CSS의 `.editor-container{background:var(--vscode-editor-background)}`가 불투명 컬러를 사용하게 되어 `body::before` 배경 이미지가 가려짐. 사이드바/패널도 동일 문제.

Implementation steps:

- Fix 1: `activate()` 시작부에 `vscode.workspace.getConfiguration("java.debug.settings").update("enableRunDebugCodeLens", false, Global)` 추가. 이미 false면 스킵.
- Fix 2: `reverseTranslateDiagnosticText()`에 VS Code 알림 문구 직접 규칙 20개 이상 추가 (배경 mod 알림, 색상 설정 알림, 실행/중지 알림, 연결 테스트 알림 등). word-level 매핑에 UI 용어 추가. 번역 불가 시 `null` 반환(이전엔 원본 반환). `translate()`에서 `english = null`이면 `item.englishText = ""`로 설정. `getHtml()` `translationStatus`에 "번역할 수 없는 내용입니다." 케이스 추가.
- Fix 3 & 4: `patchWorkbenchBackground()`에서 `workbench.colorCustomizations`를 읽어 `editor.background`, `sideBar.background`, `panel.background`의 solid hex를 alpha 0.78/0.72/0.78의 rgba로 변환. CSS 패치에 `var(--vscode-*)` 대신 계산된 rgba 값 직접 삽입. 색상 변경 후 배경 재적용 필요 (패치 시점에 값이 고정됨 — limitation).

Anti-regression notes:

- 배경 mod CSS의 `.editor-container` 배경을 `var(--vscode-editor-background)` CSS 변수로 두면, color extension이 solid 색을 지정할 때 배경이 가려짐. 반드시 패치 시점에 rgba로 계산해서 하드코딩.
- `reverseTranslateDiagnosticText` null 반환 → `translate()`에서 `item.englishText = ""` (빈 문자열, 원본으로 fallback 금지). `crossLangText` 비어있을 때 UI에 "번역할 수 없는 내용입니다." 표시.
- Java CodeLens 설정 비활성화는 `GlobalValue !== false` 조건으로 한 번만 실행 (매 activate마다 설정 쓰기 방지).

Installed versions after packaging:

- `custom-dev-tools.custom-dev-tools-theme-kit@0.5.7`
- `custom-dev-tools.custom-workbench-background-mod@0.1.7`
