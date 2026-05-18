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

## 2026-05-18 (cont.) KST

Request:

- 색상 테마를 변경한 후 배경을 다시 적용해야 반투명 효과가 업데이트되는 문제. CSS 변수로 live 업데이트 가능한지 확인 → 가능하다고 판단, 구현 착수.

Root cause analysis:

- 이전 세션(Fix 3&4)에서 `patchWorkbenchBackground()`가 `colorCustomizations`를 읽어 rgba를 하드코딩 방식으로 패치에 삽입. 색상 변경 후 재적용 없이는 새 색상이 반영되지 않는 구조적 한계.
- VS Code는 `workbench.colorCustomizations` 변경 시 `document.documentElement` style 속성에 `--vscode-editor-background`, `--vscode-sideBar-background`, `--vscode-panel-background` CSS 변수를 live로 업데이트함.
- `MutationObserver`로 `documentElement` style 변경을 감지, `getComputedStyle`로 최신 hex 값을 읽어 rgba로 변환한 뒤 `--cust-editor-alpha`, `--cust-sidebar-alpha`, `--cust-panel-alpha` CSS custom properties로 업데이트하면 패치된 CSS가 자동으로 새 색상을 반영.

Implementation steps:

- `buildBgAlphaScript()` 함수 신규 추가 (`buildNotificationSyncScript()` 직전):
  - `h2rgba(hex, a)`: 6자리 hex → `rgba(r,g,b,a)` 변환. 유효하지 않으면 null.
  - `upd()`: `getComputedStyle(documentElement)`에서 `--vscode-editor-background`(alpha 0.78), `--vscode-sideBar-background`(0.72), `--vscode-panel-background`(0.78) 읽어 `--cust-*-alpha` 설정.
  - 초기 실행 `upd()`, `MutationObserver`로 `documentElement style` 감시, `document.body class` 감시(fallback).
  - 중복 실행 방지: `window.__customBgAlphaSync` 플래그.
- CSS 패치의 `.editor-container`, `.sidebar`, `.panel` 배경을 `var(--cust-editor-alpha, ${editorBg})` 형태로 변경. fallback은 패치 시점의 rgba 값. script가 live 값으로 즉시 덮어씀.
- `patchWorkbenchBackground()` 패치 배열에 `...buildBgAlphaScript()` 추가.

Anti-regression notes:

- `buildBgAlphaScript()`는 반드시 `buildNotificationSyncScript()` 앞에 정의되어야 `patchWorkbenchBackground()`에서 참조 가능. 새 함수 추가 시 참조 전에 정의되었는지 확인.
- `--vscode-panel-background`는 VS Code CSS에서 `--vscode-panel-background`가 아닌 다른 이름일 수 있음. 실제 DOM 확인 필요 시 개발자 도구로 검증.

Validation commands run:

- `node --check extensions/workbench-background-mod/extension.js`
- `node --check extension/extension.js`
- `npx.cmd @vscode/vsce package --no-dependencies` (both extensions)
- `code --install-extension ... --force` (both extensions)

Installed versions after packaging:

- `custom-dev-tools.custom-dev-tools-theme-kit@0.5.8`
- `custom-dev-tools.custom-workbench-background-mod@0.1.8`

## 2026-05-18 (cont.2) KST

Request:

- 네이티브 Run|Debug CodeLens 제거를 Java에 한정하지 않고, 실행 가능한 모든 파일(Python 포함)에 적용.

Implementation steps:

- `JavaRunCodeLensProvider` → `RunnableCodeLensProvider` 로 클래스 이름 변경.
- `provideCodeLenses(document)`를 언어별 내부 메서드로 분리: `_javaLenses()`, `_pythonLenses()`.
  - Java: 기존 로직 유지 (`public static void main` 감지, node ID `spring|java:rel:ClassName.main`).
  - Python: `if __name__ == "__main__":` 라인 또는 파일 상단(line 0)에 CodeLens 표시. node ID는 `getPythonNodes()`와 동일한 포맷 `python:rel:basename.py::__main__` / `::top-level`.
- `debugFromEditor` 명령에 세 번째 인자 `runKind` 추가.
  - `runKind === "python"`: `debugpy` 타입, `program: filePath`로 디버그 세션 시작.
  - 기본(Java/Spring): 기존 `type: "java"` 로직 유지.
- `activate()`: `python.testing.codelensEnabled = false` 전역 설정 추가 (Python 네이티브 테스트 CodeLens 제거).
- `vscode.languages.registerCodeLensProvider({ language: "python" }, runnableCodeLensProvider)` 추가.
- `controller.javaCodeLensProvider` → `controller.runnableCodeLensProvider` 참조 변경 (`refreshAll()` 포함).

Anti-regression notes:

- Python CodeLens node ID는 반드시 `getPythonNodes()`의 ID 포맷과 일치해야 `isRunning(nodeId)`가 올바르게 동작. `text.includes("__main__")` 조건과 `::__main__` / `::top-level` suffix 포맷 유지.
- `debugFromEditor`의 `runKind` 인자는 세 번째 위치이므로 Java/Spring CodeLens arguments도 `[filePath, className, "java"]`로 명시. 이전 버전(인자 2개)과 혼용 금지.

Validation commands run:

- `node --check extension/extension.js`
- `npx.cmd vsce package --no-dependencies`
- `code --install-extension ... --force`

Installed versions after packaging:

- `custom-dev-tools.custom-dev-tools-theme-kit@0.5.9`

## 2026-05-18 (cont.3) KST

Request:

- 배경색상 조절 후 VS Code 리로드 없이 반투명 효과가 즉시 반영되어야 함. 현재 리로드가 필요한 이유 분석 및 수정.

Root cause analysis:

- `buildBgAlphaScript()`의 `upd()` 함수에 **무한 루프 버그**가 있었음.
  1. VS Code 색상 변경 → `documentElement.style`에 `--vscode-editor-background` 등 설정
  2. MutationObserver(attributeFilter:['style']) 발화 → `upd()` 호출
  3. `upd()`가 `--cust-editor-alpha` 등을 `documentElement.style`에 설정
  4. 이 setProperty() 자체가 style 어트리뷰트를 변경 → MutationObserver 재발화 → `upd()` 재호출
  5. 이 루프가 반복되어 브라우저가 MutationObserver 콜백을 스로틀 또는 중단
  6. 이후 VS Code의 실제 색상 변경 이벤트가 더 이상 감지되지 않아 리로드 필요
- 추가로 VS Code가 CSS 변수를 `document.body` 또는 `<head>` 내 `<style>` 주입으로 업데이트할 경우 `documentElement` style 감시만으로는 놓칠 수 있었음.

Implementation steps:

- `buildBgAlphaScript()`에 `_lv` 추적 변수 추가.
- `upd()` 시작부에 `--vscode-editor-background`, `--vscode-sideBar-background`, `--vscode-panel-background` 세 값의 조합 키(`key = ev+'|'+sv+'|'+pv`)를 계산.
- `key === _lv`이면 즉시 return — 값이 바뀐 경우에만 `setProperty()` 실행 → 무한 루프 차단.
- `getComputedStyle`을 `document.body||document.documentElement`로 변경 (VS Code가 어느 요소에 CSS 변수를 설정하든 대응).
- `_obs.observe(document.body, ...)` 추가로 body style 변경도 감지.
- `new MutationObserver(upd).observe(document.head, {childList:true,subtree:true})` 추가 (`<style>` 태그 주입 방식 대응).
- `setInterval(upd, 800)` 추가 — MutationObserver가 어떤 이유로든 발화하지 않아도 최대 800ms 내에 색상 변경이 반영되는 폴링 백업.

Anti-regression notes (CRITICAL):

- **`buildBgAlphaScript()`에서 `document.documentElement.style.setProperty()`를 호출하는 모든 함수는 반드시 "이전 값과 비교해 변경이 없으면 return" 가드를 두어야 한다.** `setProperty()`가 MutationObserver(style 감시)를 재발화시키기 때문. 가드 없이 setProperty를 사용하면 무한 루프.
- 이 패턴을 수정할 때 `_lv` 등 추적 변수 제거 금지. 이 가드가 없으면 색상 변경 후 리로드 필요 문제가 즉시 재발함.
- `setInterval` 폴링 제거 금지 — 폴링은 MutationObserver 실패 시 안전망.

Validation commands run:

- `node --check extensions/workbench-background-mod/extension.js`
- `npx.cmd vsce package --no-dependencies`
- `code --install-extension ... --force`

Installed versions after packaging:

- `custom-dev-tools.custom-workbench-background-mod@0.1.10`

## 2026-05-18 (cont.4) KST

Request:

- "색상 설정 제거" 클릭 시 성공 메시지가 나오지만 일부 색상 설정이 settings.json에 남아있는 버그 수정.

Root cause analysis:

- **원인 1 (주원인): config 스코프 오염.**
  `applyOfficialThemeColors()`가 `vscode.workspace.getConfiguration().get("workbench.colorCustomizations")`를 사용해 **글로벌+워크스페이스 합산(merged)** 값을 읽은 뒤, 이 값 전체를 `ConfigurationTarget.Global`로 썼음. 그 결과 워크스페이스 레벨에 있던 colorCustomizations 키들이 글로벌 settings.json에 복제됨. 이후 `clearOfficialThemeColors()`는 `MANAGED_COLOR_KEYS` 목록에 없는 오염 키들을 삭제하지 못해 색상 설정이 남음.
  
- **원인 2: 정적 키 목록 유지 부담.**
  `MANAGED_COLOR_KEYS` 배열이 `buildOfficialColorCustomizations()`와 별도로 관리되어, 어느 한쪽이 변경될 때 동기화 누락이 발생할 수 있는 구조.

- **원인 3: 워크스페이스 스코프 미처리.**
  `clearOfficialThemeColors()`가 Global 스코프만 정리하고, Workspace 스코프에 누출된 관리 키는 건드리지 않았음.

Implementation steps:

- `applyOfficialThemeColors()`:
  - `vscode.workspace.getConfiguration("workbench").inspect("colorCustomizations")?.globalValue`로 **글로벌 전용** 값만 읽도록 변경.
  - Global에 쓸 때도 `wbCfg.update("colorCustomizations", next, ConfigurationTarget.Global)` 형식으로 통일.

- `clearOfficialThemeColors()`:
  - 관리 키 집합을 `new Set([...MANAGED_COLOR_KEYS, ...Object.keys(buildOfficialColorCustomizations("#000000"))])` 로 동적 합산 → 정적 목록과 현재 함수 출력 모두 커버 (버전 차이로 누락된 키도 삭제).
  - `inspect.globalValue`에서 관리 키 삭제 → Global 업데이트.
  - `inspect.workspaceValue`에서도 관리 키 삭제 → Workspace 업데이트 (오염 키 정리). 워크스페이스가 없거나 실패해도 `.then(undefined, () => {})` 로 무시.
  - 빈 객체가 되는 경우 `undefined`로 업데이트해서 설정 항목 자체를 제거.

Anti-regression notes (CRITICAL):

- **`applyOfficialThemeColors()`는 반드시 `inspect().globalValue`로 Global 전용 값을 읽어야 한다.** `config.get()`은 합산값을 반환하므로 워크스페이스 키를 오염시킴. 이 패턴을 재도입하면 동일 버그 즉시 재발.
- `clearOfficialThemeColors()`에서 관리 키 집합은 `MANAGED_COLOR_KEYS`만으로 구성 금지 — `buildOfficialColorCustomizations()`의 키가 추가될 때 자동 동기화가 되지 않아 누락 발생. 반드시 양쪽 합산(`Set union`) 사용.
- Global뿐 아니라 Workspace 스코프도 정리해야 함. 워크스페이스 정리 실패는 무시해도 되지만 시도 자체는 해야 함.

Validation commands run:

- `node --check extension/extension.js`
- `npx.cmd vsce package --no-dependencies`
- `code --install-extension ... --force`

Installed versions after packaging:

- `custom-dev-tools.custom-dev-tools-theme-kit@0.5.10`

## 2026-05-18 (cont.5) KST

Request:

- 배경색상 변경 후 반투명 배경들이 VS Code 재시작 없이는 반영되지 않는 버그 재발. buildBgAlphaScript() 의 추가 버그 수정.

Root cause analysis (3가지 독립 버그):

**버그 1 (주원인): 스크립트가 `<head>`에 주입되어 `<body>` 파싱 전에 실행됨.**
- `patchWorkbenchBackground()`는 `html.replace("</head>", patch + "\n</head>")` 로 패치를 `</head>` 직전에 삽입.
- 스크립트는 `<head>` 파싱 중에 즉시 실행 → 이 시점에 `document.body === null`.
- 이전 코드의 `"try{_obs.observe(document.body,...);}catch(_){}"` 는 `null.observe()` TypeError를 catch로 무음 삼킴 → **body MutationObserver가 영구적으로 미설정**.
- 결과: VS Code가 body에 CSS 변수를 설정해도 감지 불가 → 재시작 후에야 반영.

**버그 2: CSS 변수를 잘못된 요소에서 읽음.**
- `const root = document.body || document.documentElement;` → 스크립트 실행 시점에 body가 null이므로 documentElement에서만 읽음.
- VS Code는 CSS 변수를 `.monaco-workbench` 또는 `body`에 설정할 수 있음. documentElement에 없으면 항상 빈 문자열 반환.
- `getVar()` 함수로 `.monaco-workbench` → `body` → `documentElement` 순서로 시도, 첫 번째 유효값 사용.

**버그 3: head MutationObserver에 `characterData:true` 누락.**
- VS Code가 기존 `<style>` 태그의 텍스트 내용을 교체할 때(textContent 변경), 이는 childList 변경이 아닌 characterData 변경임.
- `{childList:true,subtree:true}` 만으로는 감지 불가. `characterData:true` 추가로 해결.

**공통 추가 버그: 빈 상태 캐싱 문제.**
- 스크립트 실행 시점에 CSS 변수가 모두 비어있으면 `key='||'`를 `_lv`에 저장.
- 이후 VS Code가 CSS 변수를 설정해도 `key` 값이 변했기 때문에 업데이트 되지만, 혹시 VS Code가 다시 변경할 경우 `_lv` 초기화가 안되어 있어 미감지 가능성.
- `if(!ev&&!sv&&!pv)return;` 가드로 빈 상태를 캐싱하지 않도록 수정.

Implementation steps:

- `buildBgAlphaScript()` 전면 재작성:
  1. `getVar(n)` 함수 추가: `.monaco-workbench`, `body`, `documentElement` 순서로 CSS 변수를 시도해 첫 번째 유효값 반환.
  2. `if(!ev&&!sv&&!pv)return;` 가드 추가: VS Code 초기화 전 빈 상태를 `_lv`에 캐싱하지 않음.
  3. `init()` 함수로 DOM 설정 코드를 분리.
  4. `DOMContentLoaded` 이벤트 이후에 `init()` 호출: `document.readyState==='loading'`이면 `addEventListener('DOMContentLoaded', init)`, 아니면 즉시 호출.
  5. `init()` 내부에서 `document.body` null 체크 후 옵저버 등록.
  6. head 옵저버에 `characterData:true` 추가.
  7. `setInterval(upd, 800)` 유지 (안전망).

Anti-regression notes (CRITICAL):

- **`buildBgAlphaScript()` 는 `<head>` 에 주입되므로 `document.body`가 null임을 항상 전제해야 한다.** 즉각 DOM 접근 금지. 반드시 `DOMContentLoaded` 이벤트 이후에 DOM 기반 코드를 실행할 것. 이를 위반하면 body 옵저버가 영구 미설정되어 재시작 필요 버그 재발.
- `getVar()` 없이 특정 요소(`document.body` 등) 하나에서만 CSS 변수를 읽으면, VS Code가 다른 요소에 변수를 설정한 경우 항상 빈 문자열을 반환. 반드시 복수 요소를 순서대로 시도할 것.
- head 옵저버에서 `characterData:true` 제거 금지 — VS Code의 `<style>` 태그 내용 업데이트를 감지 못함.
- `if(!ev&&!sv&&!pv)return;` 가드 제거 금지 — 빈 상태를 캐싱하면 VS Code 초기화 이후의 첫 변경이 감지되지 않을 수 있음.
- 이 4가지 조건을 모두 만족해야 "배경색 변경 → 재시작 없이 즉시 반영" 동작이 보장됨.

Validation commands run:

- `node --check extensions/workbench-background-mod/extension.js`
- `npx.cmd vsce package --no-dependencies`
- `code --install-extension ... --force`

Installed versions after packaging:

- `custom-dev-tools.custom-workbench-background-mod@0.1.11`

## 2026-05-18 (cont.6) KST

Request:

- 우측하단 알림센터(notification center)를 닫으면 좌측 알림 목록에서 알림이 사라지는 버그 수정.

Root cause analysis (2가지 독립 버그):

**버그 1 (주원인): 알림센터 닫힘 후 toast가 다른 key로 재등록되어 기존 항목이 삭제됨.**
- `buildNotificationSyncScript()` 의 `notificationRoots()`는 `.notifications-center .notification-list-item` 와 `.notifications-toasts .notification-toast` 양쪽을 모두 스캔.
- 알림센터가 닫히면 center 내 list-item은 사라지고, VS Code가 같은 알림을 toast로 다시 띄울 수 있음.
- toast의 DOM 구조(`.notification-toast-message`)와 center list-item의 DOM 구조(`.notification-list-item-message`, `.notification-list-item-source`)가 달라 **같은 알림이 다른 key**(`dom:TYPE:HASH(source:msg)`)를 생성.
- `syncFromNotifications()` 서버 측 조건 `if (activeDomKeys.size > 0 || ...)`:
  `activeDomKeys`에 toast 기반 key가 있으면 조건이 참이 되어 filter 블록에 진입, center list-item 기반 key가 없으므로 해당 항목이 삭제됨.
- **결론**: `centerOpen === false` 일 때는 toast 존재 여부와 무관하게 dom: 항목을 절대 삭제하면 안 됨.

**버그 2: `isCenterOpen()`이 실제 표시 여부가 아닌 DOM 존재 여부만 확인.**
- `!!document.querySelector('.notifications-center')` 는 VS Code가 해당 요소를 DOM에 유지하면서 CSS로 숨길 경우 `true`를 반환.
- 숨겨진 채 `isCenterOpen()=true`, `notificationRoots()=[]` 이면 서버에 `{notifications:[], centerOpen:true}` 전송 → 서버가 모든 dom: 항목을 삭제.
- `offsetWidth>0 && offsetHeight>0` 체크로 실제 레이아웃상 가시 여부를 확인.

Implementation steps:

- `extension/extension.js` — `syncFromNotifications()` 조건 수정:
  - 기존: `if (activeDomKeys.size > 0 || (normalizedNotifications.length === 0 && centerOpen))`
  - 수정: `if (centerOpen && (activeDomKeys.size > 0 || normalizedNotifications.length === 0))`
  - 의미: dom: 항목 filter/삭제는 **centerOpen이 true일 때만** 수행. centerOpen=false면 toast가 있어도 기존 항목 보존.

- `extensions/workbench-background-mod/extension.js` — `isCenterOpen()` 수정:
  - 기존: `return !!document.querySelector('.notifications-center');`
  - 수정: `const el=document.querySelector('.notifications-center'); if(!el)return false; return el.offsetWidth>0&&el.offsetHeight>0;`
  - `offsetHeight/Width > 0`: CSS로 숨겨진(display:none) 요소를 열려있지 않은 것으로 올바르게 판단.

Anti-regression notes (CRITICAL):

- **`syncFromNotifications()`에서 dom: 항목 삭제 조건은 반드시 `centerOpen` 을 외부 AND로 감싸야 한다.** `centerOpen` 없이 `activeDomKeys.size > 0` 만으로 filter 진입을 허용하면, 알림센터 닫힘 직후 toast가 잠깐 나타나는 시점에 기존 항목이 즉시 삭제됨.
- **toast와 center list-item은 같은 알림이라도 DOM 구조가 달라 key가 다를 수 있다.** toast-based snapshot으로 center-based 항목을 정리하는 것은 구조적으로 불가. 알림센터가 열려있는 상태의 스냅샷만이 권위 있는 "현재 알림 목록"임.
- `isCenterOpen()`에서 `offsetHeight` 체크 제거 금지 — 제거하면 VS Code가 center 요소를 DOM에 유지하면서 CSS로 숨기는 경우 오탐 발생.

Validation commands run:

- `node --check extension/extension.js`
- `node --check extensions/workbench-background-mod/extension.js`
- `npx.cmd @vscode/vsce package --no-dependencies` (both extensions)
- `code --install-extension ... --force` (both extensions)

Installed versions after packaging:

- `custom-dev-tools.custom-dev-tools-theme-kit@0.5.11`
- `custom-dev-tools.custom-workbench-background-mod@0.1.12`

## 2026-05-18 (cont.7) KST

Request:

- 0.1.12 / 0.5.11 설치 후에도 좌측 알림 목록에 아무것도 나타나지 않음. 우측하단 알림을 기반으로 좌측에 목록이 유지되고, 알림 자체가 닫힐 때만 좌측에서도 제거되어야 함.

Root cause analysis (2가지 추가 버그, cont.6 수정 이후 발견):

**버그 1 (주원인): `sync()`가 POST 실패 여부와 무관하게 `lastSnapshot`을 즉시 업데이트.**
- 기존 코드: `lastSnapshot=snapshot; post('/notifications-sync',...)` — POST를 await 없이 호출, `lastSnapshot`이 POST 결과와 무관하게 동기적으로 설정됨.
- VS Code 시작 직후 main extension의 HTTP 서버가 아직 준비되지 않은 상태에서 첫 sync가 실행되면 POST가 실패 (`post()` returns false).
- `lastSnapshot`이 이미 현재 스냅샷으로 설정되어 있어 setInterval의 다음 tick에서 `snapshot===lastSnapshot`이 되어 재시도 없이 return.
- 결과: 서버가 준비될 즈음에는 알림 DOM이 변하지 않으므로 MutationObserver도 발화 안함 → 알림이 영원히 좌측 패널에 표시되지 않음.

**버그 2: `dom:` 키에 source 포함으로 인해 toast ↔ center 표현 간 키 불일치.**
- 기존 키: `'dom:'+type+':'+hash(source+':'+message)` — toast에서 source가 비어있는 경우 키가 달라짐.
- 같은 알림이 toast일 때 key=`dom:info:HASH_A`, center list-item일 때 key=`dom:info:HASH_B` (source 차이).
- center가 닫힌 후 toast가 재등장할 때 `HASH_A`와 `HASH_B`가 달라 중복 항목 추가 또는 불필요한 purge 발생.
- 수정: `const key='dom:'+hash(message)` — source와 type을 키에서 제외, message만으로 해시. toast/center 양쪽에서 동일 키 보장. source와 type은 entry의 별도 필드로 여전히 전송/저장됨.

Implementation steps:

- `extensions/workbench-background-mod/extension.js` — `buildNotificationSyncScript()` 수정:
  1. `let activePort=0,lastSnapshot='',syncTimer=0,_syncing=false;` — `_syncing` 동시 실행 방지 플래그 추가.
  2. `collectEntries()` 키 생성: `'dom:'+type+':'+hash(source+':'+message)` → `'dom:'+hash(message)`.
  3. `sync()` async로 변경:
     ```
     async function sync(){
       if(_syncing)return;
       const notifications=collect();
       const co=isCenterOpen();
       const snapshot=JSON.stringify({n:notifications,c:co});
       if(snapshot===lastSnapshot)return;
       _syncing=true;
       const ok=await post('/notifications-sync',{notifications,centerOpen:co});
       _syncing=false;
       if(ok)lastSnapshot=snapshot; // ← POST 성공 시에만 업데이트
     }
     ```

Anti-regression notes (CRITICAL):

- **`sync()`에서 `lastSnapshot`은 반드시 `post()` 성공 후에만 업데이트해야 한다.** 선행 업데이트(즉시 동기 설정)는 POST 실패 시 재시도를 영구 차단. 이를 위반하면 서버 준비 전 첫 toast가 영원히 누락됨.
- **`dom:` 키는 message만으로 해시해야 한다.** source를 포함하면 toast와 center list-item이 다른 키를 생성해 중복 항목 발생 및 purge 오동작. source는 entry의 별도 필드로 유지.
- `_syncing` 플래그 제거 금지 — 동시 실행 방지. 제거 시 MutationObserver와 setInterval이 동시에 실행될 때 race condition 발생 가능.
- cont.6의 server-side fix(`centerOpen &&` 조건)와 `isCenterOpen()` offsetHeight 체크는 여전히 유효하며 제거 금지.

Validation commands run:

- `node --check extensions/workbench-background-mod/extension.js`
- `npx.cmd @vscode/vsce package --no-dependencies`
- `code --install-extension ... --force`

Installed versions after packaging:

- `custom-dev-tools.custom-workbench-background-mod@0.1.13`

## 2026-05-18 (cont.8) KST

Request:

- 좌측 사이드바의 트리/목록 항목(오브젝트) 영역이 불투명하게 보여 배경 이미지와 조화롭지 못함. 항목이 있는 영역도 반투명으로 보이되, 빈 영역과 약간의 차이가 있도록 해달라.
- 이 작업부터 모든 작업을 로그에 남길 것.

Root cause analysis:

- `.part.sidebar`(및 `.part.auxiliarybar`)에 `background: var(--cust-sidebar-alpha)` 반투명 배경이 적용되어 있으나, 내부 컨테이너(`composite.viewlet`, `pane-body`, `monaco-list`, `monaco-list-rows`)가 VS Code의 자체 CSS에서 `background: var(--vscode-sideBar-background)` (solid)로 재지정함.
- 결과: 외부 `.part.sidebar` 반투명 배경이 내부 컨테이너에 의해 가려져 tree/list 항목 영역이 불투명하게 표시됨.
- 각 `.monaco-list-row`의 기본 배경도 solid이므로 개별 항목 수준에서도 불투명.

Implementation steps:

- `patchWorkbenchBackground()` CSS 패치 배열에 5개 규칙 추가 (`notifications` 규칙 직후, `</style>` 직전):
  1. **내부 컨테이너 투명화**: `.composite.viewlet`, `.composite.viewlet>.content`, `.pane-body`, `.monaco-list`, `.monaco-list-rows` (sidebar + auxiliarybar) → `background: transparent!important`. 외부 `.part.sidebar`의 반투명 배경이 그대로 보임.
  2. **섹션 헤더 미세 강조**: `.pane-header` → `background: rgba(255,255,255,0.08)!important`. 빈 영역 대비 미세하게 밝아 섹션 구분 유지.
  3. **목록 행 미세 오버레이**: `.monaco-list-row` → `background: rgba(255,255,255,0.05)!important`. 빈 사이드바 공간 대비 약 5% 밝음 — 항목 있는 영역이 구분되되 배경 이미지가 비침.
  4. **선택/포커스 상태 유지**: `.monaco-list-row.selected`, `.monaco-list-row.focused` → `var(--vscode-list-activeSelectionBackground)`. VS Code 기본 강조색 유지.
  5. **호버 상태 유지**: `.monaco-list:hover .monaco-list-row:hover` → `var(--vscode-list-hoverBackground)`. 호버 피드백 유지.

Anti-regression notes:

- **내부 컨테이너에 `transparent` 적용 시 반드시 외부 `.part.sidebar`에 반투명 배경이 선행 적용되어 있어야 한다.** `patchWorkbenchBackground()`가 실행된 상태가 아니라면(배경 이미지 미적용 상태) 이 규칙들은 사이드바 전체를 완전 투명하게 만들 수 있음.
- `.monaco-list-row` 기본 배경(`rgba(255,255,255,0.05)`)은 specificity (0,2,0)인 선택/호버 규칙보다 낮아 선택/호버 상태에서 정상 재정의됨. specificity 동등 이상의 새 규칙 추가 시 선택/호버 규칙 뒤에 위치시킬 것.
- `composite.viewlet`, `pane-body`, `monaco-list-rows`를 투명화하면 이 요소들의 별도 border/outline이 있다면 배경 없이 표시될 수 있음 — 이는 의도된 동작.

Validation commands run:

- `node --check extensions/workbench-background-mod/extension.js`
- `npx.cmd @vscode/vsce package --no-dependencies`
- `code --install-extension ... --force`

Installed versions after packaging:

- `custom-dev-tools.custom-workbench-background-mod@0.1.14`

## 2026-05-18 (cont.9) KST

Request:

- cont.8에서 적용한 목록 행/헤더 오버레이 방향 수정: 항목 있는 영역이 빈 영역보다 밝게 보였는데, 반대로 더 어둡게(darker) 보여 구분되게 변경.

Implementation steps:

- `.pane-header` 배경: `rgba(255,255,255,0.08)` → `rgba(0,0,0,0.22)` (dark overlay).
- `.monaco-list-row` 배경: `rgba(255,255,255,0.05)` → `rgba(0,0,0,0.18)` (dark overlay).
- 빈 사이드바 공간은 외부 반투명 배경만 보이고, 항목/헤더 영역은 그 위에 검정 오버레이가 올라가 더 어두워짐.

Anti-regression notes:

- 오버레이 방향(white vs black)을 바꿀 때는 선택/호버 규칙의 VS Code 변수(`--vscode-list-activeSelectionBackground`, `--vscode-list-hoverBackground`)는 그대로 유지. 이들은 대부분 theme에서 이미 반투명 rgba이므로 방향 전환 영향 없음.

Installed versions after packaging:

- `custom-dev-tools.custom-workbench-background-mod@0.1.15`

## 2026-05-18 (cont.11) KST

Request:

- 두 확장의 설명(description)에 제작자 이름 "asowjdan" 추가. 확장명(displayName/name)은 변경하지 않음.

Implementation steps:

- `extension/package.json` description 끝에 `" Made by asowjdan."` 추가.
- `extensions/workbench-background-mod/package.json` description 끝에 동일 문구 추가.

Installed versions after packaging:

- `custom-dev-tools.custom-dev-tools-theme-kit@0.5.12`
- `custom-dev-tools.custom-workbench-background-mod@0.1.16`

## 2026-05-18 (cont.10) KST

Request:

- testproject 워크스페이스의 기존 코드를 기반으로 테스트 코드 작성. VS Code 테스트 탭 동작 확인 목적.

Scope:

- `C:\Users\asowj\OneDrive\바탕 화면\testproject`

Created files:

**Spring Boot (JUnit 5 + MockMvc)**
- `springboot-demo/src/test/java/com/example/testproject/UserControllerTest.java` — 16개 테스트
  - `@DirtiesContext(BEFORE_CLASS)` + `@TestMethodOrder` 로 in-memory store 격리
  - 흐름: 빈 목록 → 사용자 생성 3명 → 전체/필터 조회 → 단건 조회 → 수정 → 삭제 → 잘못된 ID 4xx
- `springboot-demo/src/test/java/com/example/testproject/HeartbeatControllerTest.java` — 6개 테스트
  - GET `/` / GET `/api/status` 응답 필드, ISO-8601 time 포맷, tick 연속 증가, 두 엔드포인트 카운터 공유 검증
- `springboot-demo/pom.xml` — `spring-boot-starter-test` (scope=test) 의존성 추가

**Python (pytest)**
- `python/tests/__init__.py` — 패키지 마커
- `python/tests/test_data_utils.py` — 20개 테스트 (TestChunk 10개, TestFlatten 10개)
- `python/tests/test_batch_runner.py` — 8개 테스트 (`time.sleep` mock 처리로 즉시 실행)
- `python/pytest.ini` — `testpaths=tests`, `pythonpath=.` 설정

**VS Code 설정**
- `.vscode/settings.json` — `python.testing.pytestEnabled`, `pytestArgs`, `cwd`, `java.test.config.workingDirectory` 추가

Test results (validated):

- Python: 28 passed in 0.10s
- Java: 22 passed (HeartbeatControllerTest 6 + UserControllerTest 16), BUILD SUCCESS

Anti-regression notes:

- `UserControllerTest`는 `@DirtiesContext(BEFORE_CLASS)` 가 반드시 있어야 한다. 없으면 다른 테스트 클래스의 컨텍스트를 재사용해 store에 데이터가 남아 `@Order(1)` 빈 목록 검증이 실패.
- `python/pytest.ini`의 `pythonpath = .`이 없으면 `from utils.data_utils import chunk` import 경로를 찾지 못함.
- `batch_runner` 테스트는 `@patch("runners.batch_runner.time.sleep")`으로 mock 처리 필수. mock 없이 실행하면 count=5 기준 2.5s/테스트 소요.

## 2026-05-18 (cont.12) KST

Request:

- 두 확장의 설명을 한글로 먼저 작성하고 그 아래에 영어로 작성. 확장 세부 정보 페이지에 표시되도록 README.md 업데이트.

Scope:

- `extension/README.md` — Custom Dev Tools & Theme Kit
- `extensions/workbench-background-mod/README.md` — Custom Workbench Background Mod

Implementation steps:

- `extension/README.md`: 이미 이전 세션에서 Korean + English 이중 언어 형식으로 신규 생성 완료 (cont.11에서 `package.json` description과 함께 처리).
  - 한국어 섹션: 제작자 헤더, 주요 기능 6개(자바/스프링, 파이썬, 도커, 데이터베이스, 알림 센터, 커스텀 디자인), 사용 방법, 주의 사항.
  - 영어 섹션: Features, How to Use, Notes.
  - 하단 `*Made by asowjdan*` footer.

- `extensions/workbench-background-mod/README.md`: 기존 영문 전용 내용을 Korean + English 이중 언어 형식으로 전면 교체.
  - 한국어 섹션: 주요 기능 5개(배경 이미지 적용, 위치·크기 조절, 반투명 영역, 배경 제거, 색상 변경 즉시 반영), 사용 방법, 주의 사항.
  - 영어 섹션: Features, How to Use, Notes (기존 Behavior/Safety Notes 내용 통합 + 최신 기능 반영).
  - 하단 `*Made by asowjdan*` footer.

- 두 `package.json`의 `version` 필드 bump: `0.5.12` → `0.5.13`, `0.1.16` → `0.1.17`.

Installed versions after packaging:

- `custom-dev-tools.custom-dev-tools-theme-kit@0.5.13`
- `custom-dev-tools.custom-workbench-background-mod@0.1.17`

## 2026-05-18 (cont.13) KST

Request:

- 자바/파이썬 코드 미실행 상태에서 VS Code가 1362 MB를 사용 중. 기능은 유지하되 메모리 사용량을 줄여달라.

Root cause analysis (4가지 독립 원인):

**원인 1 (렌더러 프로세스 — 최대 원인): 알림 동기화 MutationObserver 범위 과다**
- `buildNotificationSyncScript()` 의 MutationObserver가 `document.body` 전체를 `{childList:true,subtree:true,characterData:true,attributes:true}` 로 감시.
- `characterData:true` + `attributes:true` + `subtree:true` 조합은 VS Code 편집기의 모든 키 입력(characterData), 커서 이동(aria-* 속성), 인텔리센스 팝업, 호버 등 초당 수천 번의 DOM 이벤트에 반응.
- 콜백마다 `clearTimeout` + `setTimeout` (250ms 디바운스) 쌍을 생성 → V8 마이크로 GC 폭주.
- 실제로 필요한 것은 알림 요소 추가/제거(`childList`) 뿐. characterData/attributes 감시는 불필요.

**원인 2 (렌더러 프로세스): setInterval 주기 과소**
- `setInterval(upd, 800)` (색상 업데이트) — 75회/분, MutationObserver가 live 업데이트를 담당하므로 폴링은 안전망으로만 필요.
- `setInterval(sync, 1500)` (알림 동기화) — 40회/분.
- `pollActions` 1000ms 재귀 — 60회/분, 매 호출마다 HTTP fetch 발생.
- 합계: 분당 175회 DOM 조작 + HTTP 요청.

**원인 3 (확장 호스트 프로세스): `refreshAll()` 디바운스 없음**
- 확장 활성화 시 `refreshAll()`이 7회 이상 연속 호출.
- 각 호출마다 모든 Provider의 `refresh()` → `getNodes()` → `walk()` + 파일 읽기 실행.
- `walk()`는 최대 500개 파일을 `fs.readdirSync`로 전체 탐색 후 `.java`/`.py` 파일 내용 전부 읽음.

**원인 4 (JVM 프로세스): Java Language Server 힙 무제한**
- `redhat.java` (JDT LS) 기본 힙: `-Xmx1G`. 미사용 상태에서도 최대 1GB 점유.
- `vmware.vscode-spring-boot` (Spring Boot LS) 추가 JVM: 별도 힙.
- Pylance: library AST를 메모리에 유지.

Implementation steps:

**`extensions/workbench-background-mod/extension.js`** — 주입 스크립트 3곳 수정:
1. `buildBgAlphaScript()`: `setInterval(upd,800)` → `setInterval(upd,8000)` (MutationObserver가 실시간 처리, 인터벌은 안전망).
2. `buildNotificationSyncScript()`: 
   - `pollActions` timeout `1000` → `2500`.
   - MutationObserver 대상: `document.body` 전체 → `.notifications-toasts,.notifications-center` 컨테이너 우선 선택 (없으면 body 폴백).
   - 감시 옵션: `{childList:true,subtree:true,characterData:true,attributes:true}` → `{childList:true,subtree:true}`.
   - `setInterval(sync,1500)` → `setInterval(sync,4000)`.

**`extension/extension.js`** — 2곳 수정:
3. `refreshAll()`: 150ms trailing debounce 추가. 연속 호출이 1회로 합산됨.
4. `walk()`: 8초 TTL 캐시 (`_walkCache`) 추가. 동일 루트/확장자 조합의 두 번째 이후 호출은 파일 I/O 없이 캐시 반환.
5. `startDockerEventWatcher()`: Docker 바이너리 존재 확인. 절대경로로 지정됐는데 파일이 없으면 watcher 즉시 반환 (10초 재시도 루프 방지).

**`testproject/.vscode/settings.json`** — JVM/분석 힙 제한 추가:
- `java.jdt.ls.vmargs`: `-noverify -Xmx512m -XX:+UseG1GC -XX:+UseStringDeduplication` (1GB → 512MB 상한).
- `boot-java.ls.vmargs`: `-Xmx256m`.
- `python.analysis.memory.keepLibraryAst`: `false` (Pylance library AST 미보관).

Expected memory savings (approximate):

| 항목 | 절감 예상 |
|---|---|
| MutationObserver 범위 축소 | 렌더러 GC 압력 대폭 감소 |
| setInterval 주기 10배 완화 | 렌더러 타이머 객체 ~73% 감소 |
| refreshAll debounce | 확장 호스트 시작 시 walk() 호출 ~7회 → 1회 |
| walk() 캐시 | 8초 이내 중복 탐색 100% 제거 |
| JDT LS 힙 제한 | Java LS 프로세스 최대 ~500MB 절감 |
| Spring Boot LS 힙 제한 | Spring LS 프로세스 최대 ~200MB 절감 |

Anti-regression notes:

- MutationObserver 대상 축소 시 `.notifications-toasts`가 DOMContentLoaded 시점에 존재하지 않는 경우 `document.body` 폴백으로 처리. 폴백 시에도 `{childList:true,subtree:true}` 만 사용해 characterData/attributes 감시 재도입 방지.
- `setInterval(upd,8000)` 은 MutationObserver 실패 시 최대 8초 내 색상 반영을 보장하는 안전망. 제거 금지.
- `refreshAll()` debounce는 150ms trailing. 사용자가 수동 새로고침 버튼 클릭 시에도 동일하게 적용 — 150ms 지연은 인체에 비감지 수준이므로 UX 영향 없음.
- `walk()` 캐시는 8초 TTL. 새 파일을 프로젝트에 추가한 뒤 즉시 새로고침하면 최대 8초 동안 목록에 나타나지 않을 수 있음 — 이는 의도된 트레이드오프.
- JDT LS 512MB는 소규모~중규모 프로젝트에 충분. 대규모 멀티 모듈 프로젝트에서 OOM 발생 시 `java.jdt.ls.vmargs` 에서 `-Xmx512m` 을 `-Xmx768m` 으로 올릴 것.

Installed versions after packaging:

- `custom-dev-tools.custom-dev-tools-theme-kit@0.5.14`
- `custom-dev-tools.custom-workbench-background-mod@0.1.18`
