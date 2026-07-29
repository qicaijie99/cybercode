# 모델 연결, 동기화, 스마트 라우팅

CyberCode는 모델 연결을 명확한 그룹으로 나누고 데스크톱과 터미널 TUI가 같은 로컬 설정을 공유합니다. 공식 API Key와 주요 aggregator, OAuth, 웹 세션, 이미지·비디오·오디오, 로컬/사용자 지정 공급자 순서로 표시됩니다.

## 연결 방식 선택

| 유형 | 적합한 용도 | 설명 |
| --- | --- | --- |
| 공식 API Key | 안정성과 명확한 과금이 중요할 때 | Key는 로컬에 저장됩니다. Kimi Code와 Kimi처럼 서로 다른 제품은 별도 항목으로 유지됩니다. |
| Aggregator | 한 계정으로 여러 모델을 사용할 때 | OpenAI 및 Anthropic 호환 endpoint를 지원합니다. |
| OAuth | 브라우저 인증을 제공하는 서비스 | 인증 결과를 로컬에 저장하고 지원되는 경우 token을 자동 갱신합니다. |
| 웹 세션 | 기존 웹사이트 로그인 상태를 사용할 때 | Cookie, JWT, 웹 token을 사용하므로 공식 API보다 안정성, rate limit, 계정 정책 위험이 큽니다. |
| 이미지·비디오·오디오 | 미디어 모델 목록과 자격 증명 관리 | 중국 공급자를 먼저 표시합니다. 연결 테스트는 유료 생성 작업을 실행하지 않으며 미디어 모델을 채팅 기본값으로 설정하지 않습니다. |
| 로컬/사용자 지정 | LM Studio, Ollama, 자체 호환 서비스 | Base URL, protocol, 사용자 지정 모델 ID를 설정할 수 있습니다. |

데스크톱에서 **설정 → 모델 및 라우팅 → 모델 공급자**를 여세요. 공급자 이름은 CyberCode에서 선택한 언어로 표시됩니다.

## OAuth와 웹 세션

OAuth 카드에서 인증을 완료해야 연결된 카드가 강조 표시됩니다. token rotation을 지원하는 공급자는 CyberCode가 유효한 token을 로컬에서 유지합니다.

웹 세션은 카드가 요구하는 Cookie 또는 웹 token을 사용합니다. CyberCode는 Cookie 형식을 정리하고 브라우저 호환 header와 upstream token 갱신을 처리합니다. 브라우저 데이터 읽기, CAPTCHA 처리, 계정 제한이나 지역 제한 우회는 하지 않습니다.

::: warning 서비스 약관을 확인하세요
웹 interface는 예고 없이 변경될 수 있고 rate limit이나 계정 제어가 적용될 수 있습니다. 사용 권한이 있는 계정만 사용하고 안정적인 운영에는 공식 API를 우선하세요.
:::

## 모델 가져오기와 동기화

호환 `/models` endpoint를 제공하는 API Key, 사용자 지정, 로컬 공급자에서는 **최신 모델 동기화**를 사용할 수 있습니다. CyberCode는 원격 목록을 병합하면서 사용자가 직접 입력한 모델 ID를 유지합니다.

**실시간 동기화**를 켜면 시작 후와 약 24시간마다 지원 공급자를 갱신합니다. OAuth, 웹 세션, 내장 미디어 목록은 각 연결 방식에서 관리되며 일반 `/models` 동기화가 덮어쓰지 않습니다.

```text
/provider status
/provider sync [공급자 ID 또는 이름]
/provider auto-sync on|off [공급자 ID 또는 이름]
```

## 스마트 라우트

**모델 및 라우팅 → 스마트 라우팅**에서 여러 사용 가능한 모델 대상을 하나의 route에 추가합니다. CyberCode는 가용성, health 기록, 실패 cooldown을 기준으로 대상을 선택하고 최대 시도 횟수 안에서 다음 후보로 전환합니다.

```text
/routing
/routing status
/routing create coding-fast Daily coding
/routing strategy coding-fast auto
/routing use coding-fast
/routing reset-health
```

`/route`는 `/routing`의 alias입니다. 세부 순서와 policy는 데스크톱 편집기에서 조정할 수 있습니다.

## 다른 Agent에 제공

**노드**는 설정된 모델과 route를 별도 키로 보호된 OpenAI Chat Completions 및 Anthropic Messages endpoint로 제공합니다. 외부 Agent는 원래 공급자 Key를 받지 않습니다. 자세한 내용은 [Agent 노드 연결](./agent-node.md)을 확인하세요.

독립 TUI는 필요할 때 내장 로컬 runtime을 시작하므로 추가 proxy가 필요하지 않습니다. 데스크톱이 실행한 TUI에서는 중복 쓰기를 막기 위해 데스크톱 호스트가 server, 동기화 scheduler, node lifecycle을 관리합니다.
