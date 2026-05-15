# AI를 활용한 vscode 커스텀

Custom Dev Tools & Theme Kit은 여러 기기에서 같은 개발 환경을 빠르게 복원하기 위한 VS Code 확장 프로젝트입니다. Java/Spring, Python, Docker, Database, Notification, Theme 관련 커스텀 뷰를 하나의 VSIX로 묶는 것을 목표로 합니다.

## 포함 기능

- Java/Spring 실행 코드와 컨트롤러 테스트 뷰
- Python 실행 코드 뷰
- Docker 서비스, 이미지, 컨테이너 기반 DB 감지 뷰
- Database 연결 목록, 연결 상세 수정, 테이블/ERD/Redis 조회 뷰
- 알림 목록과 알림 상세 뷰
- 이미지 경로와 테마 색상을 저장하는 Theme 뷰
- 현재 개발 환경에서 쓰는 추천 확장 목록을 `extensionPack`으로 패키징

## 안전한 테마 방향

이 공개 버전은 VS Code 설치 파일, `product.json`, 다른 사람이 만든 확장 폴더를 수정하지 않습니다. 무결성 경고를 막기 위해 파일 체크섬을 임의로 바꾸는 코드도 포함하지 않습니다.

기본 배경 이미지는 없습니다. 사용자가 Theme 뷰에서 이미지를 선택하면 이미지 경로만 저장되고, 색상은 VS Code의 공식 `workbench.colorCustomizations` 설정으로 적용됩니다. VS Code 전체 native workbench 뒤에 이미지를 깔아 두는 방식은 공식 Extension API 밖의 동작이라 공개용 코드에서 제외했습니다.

## 보안 원칙

- 원격 분석이나 외부 전송 코드를 포함하지 않습니다.
- DB 비밀번호는 가능한 경우 VS Code `SecretStorage`에 저장합니다.
- 로컬 연결 설정 파일에는 비밀번호를 저장하지 않습니다.
- Docker DB 자동 감지는 로컬 컨테이너 환경 변수만 읽고, 감지된 비밀번호는 연결 테스트/조회에만 사용합니다.
- Webview는 Content Security Policy를 포함합니다.

자세한 내용은 [SECURITY.md](SECURITY.md)와 [docs/SECURITY_AND_MEMORY_REVIEW.md](docs/SECURITY_AND_MEMORY_REVIEW.md)를 참고하세요.

## 빌드

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-custom-dev-tools-vsix.ps1
```

생성된 VSIX는 `dist/` 아래에 만들어집니다. `dist/`는 Git에 포함하지 않습니다.

## 소스 구조

- `extension/`: 실제 VS Code 확장 소스
- `scripts/`: VSIX 패키징 스크립트
- `docs/`: 보안, 메모리, 설계 결정 기록

## 시행착오 기록

초기 실험에서는 타사 CSS/배경 확장과 VS Code workbench 파일 패치 방식을 검토했습니다. 이 방식은 시각적으로는 강력했지만 설치 무결성 경고, 업데이트 취약성, 공개 배포 부적합 문제가 있어 현재 공개용 소스에서는 제거했습니다. 남은 코드는 마켓플레이스 배포를 전제로 한 안전한 시작점입니다.
