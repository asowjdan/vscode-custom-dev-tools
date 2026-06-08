# Custom Workbench Background Mod

**제작자: asowjdan**

---

## 한국어

VS Code 워크벤치에 로컬 배경 이미지를 적용하고 제거할 수 있는 확장입니다.

### 주요 기능

- **배경 이미지 적용** — 로컬 이미지 파일을 선택해 VS Code 전체 화면 배경으로 적용
- **위치·크기 조절** — 이미지 위치(center, top, bottom 등)와 크기(cover, contain, 고정값)를 설정 패널에서 조절
- **반투명 영역** — 편집기, 사이드바, 패널 배경을 반투명하게 처리해 배경 이미지가 비쳐 보임
- **배경 제거** — 배경 이미지 및 관련 패치 블록을 워크벤치에서 완전히 제거
- **색상 변경 즉시 반영** — 색상 테마를 변경하면 재시작 없이 반투명 배경이 자동으로 업데이트
- **CSP 호환 이미지 삽입** — 최신 VS Code에서 차단될 수 있는 `file://` 대신 `data:image/...;base64,...` URI로 배경 이미지를 삽입
- **체크섬 갱신** — `workbench.html` 패치 후 `product.json` 체크섬을 갱신해 전체 재시작 후 코드 손상 경고가 뜨지 않도록 처리

### 0.1.20 업데이트

- 새 VS Code 설치 환경에서 `file://` 이미지 URL이 workbench CSP에 의해 차단되어 배경이 보이지 않던 문제를 수정했습니다.
- 선택한 로컬 이미지를 `data:image/...;base64,...` URI로 변환해 관리 CSS 블록에 삽입하도록 변경했습니다.
- 패치된 `workbench.html`과 `product.json` 체크섬이 일치하도록 갱신 로직을 정리했습니다.
- 확장 manifest JSON을 정리하고 버전을 `0.1.19`에서 `0.1.20`으로 올렸습니다.

### 사용 방법

1. 확장을 설치하고 VS Code를 재시작합니다.
2. 좌측 액티비티 바의 **배경 모드** 아이콘을 클릭합니다.
3. 이미지 파일을 선택하고 **배경 적용** 버튼을 누릅니다.
4. VS Code 리로드 메시지가 표시되면 리로드합니다.
5. 배경을 제거하려면 **배경 제거** 버튼을 누르고 리로드합니다.

### 주의 사항

- 이 확장은 VS Code의 공식 API 범위를 벗어나 `workbench.html`을 직접 수정합니다. VS Code 업데이트 후 무결성 경고가 표시될 수 있습니다.
- 이미지 파일은 data URI로 변환되어 `workbench.html`에 삽입됩니다. 용량이 큰 이미지는 사용하지 않는 것을 권장합니다.
- 이미지 경로나 파일 내용은 외부 네트워크로 전송되지 않습니다.
- VS Code 업데이트 후에는 배경 설정 패널에서 배경을 다시 적용해야 합니다.

---

## English

A VS Code extension that applies and removes a local background image from the workbench.

### Features

- **Apply background image** — Select a local image file and apply it as the full-window VS Code background
- **Position & size controls** — Adjust image position (center, top, bottom, etc.) and size (cover, contain, fixed) from the settings panel
- **Translucent layers** — Editor, sidebar, and panel backgrounds are rendered semi-transparent so the background image shows through
- **Remove background** — Fully remove the background image and its patch block from the workbench
- **Live color sync** — When you change the color theme, the translucent backgrounds update automatically without a restart
- **CSP-compatible image injection** — Embed images as `data:image/...;base64,...` URIs instead of `file://` URLs that newer VS Code workbench CSP can block
- **Checksum refresh** — Update the `product.json` checksum after patching `workbench.html` to avoid the corrupt-installation warning after a full restart

### 0.1.20 Update

- Fixed background images not rendering on fresh VS Code installs when `file://` image URLs are blocked by the workbench CSP.
- Converted selected local images to `data:image/...;base64,...` URIs before inserting the managed CSS block.
- Kept `product.json` checksum updates aligned with the patched `workbench.html`.
- Repaired the extension manifest JSON and bumped the version from `0.1.19` to `0.1.20`.

### How to Use

1. Install the extension and restart VS Code.
2. Click the **배경 모드** icon in the left activity bar.
3. Select an image file and click the **배경 적용** button.
4. When the reload prompt appears, reload VS Code.
5. To remove the background, click **배경 제거** and reload.

### Notes

- This extension modifies `workbench.html` directly, outside the official VS Code extension API. An integrity warning may appear after VS Code updates.
- Images are embedded into `workbench.html` as data URIs. Avoid using large image files.
- Image paths and file contents are never sent to the network.
- After a VS Code update, reapply the background from the settings panel.

---

*Made by asowjdan*
