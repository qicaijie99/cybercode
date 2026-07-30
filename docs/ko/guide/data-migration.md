# 데이터 마이그레이션과 USB 휴대 모드

데스크톱의 **데이터 마이그레이션** 페이지는 Agent 사이의 누적 데이터 이동과 다른 컴퓨터에서 사용할 CyberCode 휴대용 작업 드라이브 생성을 함께 제공합니다.

## Agent 마이그레이션

1. **데이터 마이그레이션 → Agent 마이그레이션**을 여세요.
2. 원본과 대상을 선택하세요. CyberCode, OpenClaw, WorkBuddy, Claude Code, Codex, Cursor, Trae, Hermes Agent, DeepSeek TUI, Kimi Code, Pi를 지원합니다.
3. 감지된 Skills, 메모리, 규칙과 프로젝트 자료를 확인하세요. 직접 복사, 변환 필요, 비호환 상태가 표시됩니다.
4. 필요한 항목만 선택하고 미리 본 뒤 실행하세요.

원본 데이터는 삭제되지 않습니다. 대상에 같은 이름의 파일이 있으면 알 수 없는 내용을 조용히 덮어쓰지 않고 대상 형식에 맞춰 백업하거나 충돌을 알려 줍니다.

## USB 휴대용 작업 드라이브 만들기

1. **데이터 마이그레이션 → USB 휴대 마이그레이션**을 여세요.
2. USB 또는 이동식 디스크의 루트를 선택하세요. 기존 `CyberCode-Portable` 폴더를 직접 선택해 업데이트할 수도 있습니다.
3. 프로젝트와 macOS Apple Silicon, macOS Intel, Windows x64, Linux x64 중 필요한 플랫폼을 선택하세요.
4. 자격 증명 경고를 확인하고 시작하세요. 공간 부족, checksum 실패, 대상 충돌이 생기면 이유를 표시하고 중단합니다.

휴대용 bundle에는 설정, Skills, plugin, 메모리, 로그인 정보, 선택한 프로젝트, 플랫폼별 앱, 실행 스크립트와 SHA-256 목록을 포함할 수 있습니다. 현재 Release에 휴대용 앱이 없다면 **앱 포함**을 끄고 데이터와 프로젝트만 옮길 수 있습니다.

## 대상 컴퓨터에서 시작

| 시스템 | 실행 파일 |
| --- | --- |
| macOS | `Start-CyberCode.command` 더블 클릭 |
| Windows | `Start-CyberCode.cmd` 더블 클릭 |
| Linux x64 | `./Start-CyberCode.sh` 실행 |

첫 실행에서 해당 앱을 USB 안에 압축 해제합니다. Linux는 AppImage extract-and-run 모드를 사용하므로 FUSE가 필요하지 않습니다. 세션, 예약 작업, Code Graph의 프로젝트 경로는 `portable-projects.json`을 통해 현재 마운트 위치로 변환되어 OS나 드라이브 문자가 달라져도 마이그레이션한 프로젝트를 찾을 수 있습니다.

::: warning 계정 자격 증명을 보호하세요
`data/config`에는 API Key, OAuth 세션과 웹 Cookie가 포함될 수 있습니다. USB를 비밀번호처럼 보호하고, 휴대용 CyberCode를 종료한 뒤 안전하게 분리하세요.
:::
