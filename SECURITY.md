# 보안 참고 사항

Custom Dev Tools & Theme Kit은 로컬 우선 VS Code 확장입니다. 원격 데이터 수집, 분석, 텔레메트리, 외부 번역 호출 코드가 포함되어 있지 않습니다.

## 민감한 데이터

- 데이터베이스 비밀번호는 API가 사용 가능한 경우 VS Code의 `SecretStorage`에 저장됩니다.
- `~/.custom-dev-tools-db-connections.json`에 저장되는 로컬 연결 목록은 의도적으로 비밀번호 값을 제외합니다.
- 오류 메시지는 UI에 표시되기 전에 `shortError(...)` 를 통해 필터링되므로, 일반적인 비밀번호 환경 변수 및 알려진 연결 비밀번호는 마스킹 처리됩니다.
- Docker 데이터베이스 자동 감지 시 `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `POSTGRES_PASSWORD` 같은 컨테이너 환경 변수를 읽을 수 있습니다. 이 값들은 로컬 연결 테스트 및 검사 목적으로만 사용되며, `SecretStorage`로 이동 저장됩니다.

## VS Code 무결성

메인 확장 `Custom Dev Tools & Theme Kit`은 VS Code 설치 파일, `product.json`, 다른 설치된 확장, 또는 서드파티 확장 폴더를 수정하지 않습니다. 디자인 뷰는 VS Code의 공식 색상 커스터마이징 설정을 사용합니다.

전체 화면 워크벤치 배경 기능은 별도의 로컬 VSIX인 `Custom Workbench Background Mod`로 분리되어 있습니다. 이 모드는 VS Code의 `workbench.html`에 관리형 CSS 블록을 삽입하고 관련 체크섬 항목을 업데이트할 수 있습니다. 이는 공식 VS Code 확장 API 범위를 벗어나므로, 명확한 동의 안내 및 롤백 경로 없이 Marketplace 안전 확장으로 취급해서는 안 됩니다.

## 로컬호스트 브릿지

알림 DOM 브릿지 서버는 기본적으로 활성화되어 있어, 커스텀 알림 탭이 VS Code 네이티브 알림 센터와 동기화됩니다. `127.0.0.1`에만 바인딩되며, 로컬 UI 동기화에 사용되는 알림 스냅샷만 수신합니다. 아래 설정으로 비활성화할 수 있습니다:

```json
"customDevToolsThemeKit.enableNotificationDomBridge": false
```

네이티브 알림 센터 동기화를 사용하지 않거나 로컬호스트 브릿지를 원하지 않는 경우 비활성화하세요.

## 웹뷰

웹뷰는 VS Code 메시지 패싱을 사용하며, 기본 네트워크 접근을 차단하는 콘텐츠 보안 정책(Content Security Policy)을 포함합니다. 현재 뷰는 확장 소유의 정적 HTML 문자열로 생성되므로 인라인 스크립트를 허용합니다.

## 배포 체크리스트

- 릴리스 아티팩트를 의도적으로 게시하는 경우가 아니라면, 생성된 `dist/` VSIX 파일을 커밋하지 마세요.
- 로컬 백업 폴더나 폐기된 워크벤치 패치 실험 파일을 커밋하지 마세요.
- 기본 배경 이미지는 번들에 포함되지 않습니다. 사용자가 테마 뷰에서 직접 로컬 이미지를 선택합니다.
