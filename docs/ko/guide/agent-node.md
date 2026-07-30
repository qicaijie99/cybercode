# 노드 연결

CyberCode는 설정된 모델과 스마트 라우트를 OpenAI Chat Completions와 Anthropic Messages를 모두 지원하는 권한 제한 노드로 다른 Agent에 제공할 수 있습니다. 공급자 자격 증명은 CyberCode 안에 남고, 연결 대상에는 별도의 노드 키만 전달됩니다.

## CyberCode에서 준비

1. **모델 및 라우팅 → 노드**를 엽니다.
2. 사용자 또는 Agent마다 별도의 노드 API Key를 만듭니다. 전체 키는 한 번만 표시됩니다.
3. 표에서 관리할 Key 행을 선택한 뒤 해당 Key에 허용할 모델과 라우트, `auto`의 기본 대상을 지정합니다.
4. 저장한 뒤 **연결 설정 생성기**에서 프로토콜과 대상을 선택합니다. Base URL, 전체 Endpoint, Model, 노드 Key가 들어 있는 카드가 열리며 항목별 또는 전체 복사가 가능합니다.

독립 TUI에서도 바로 설정할 수 있습니다.

```text
/node start
/node allow all
/node status
```

`/node start`는 내장 로컬 runtime을 필요할 때 시작하고 Key가 없으면 `cc_...` Key를 만듭니다. 전체 Key는 한 번만 표시됩니다. `/node`를 직접 열어 기본 대상을 대화형으로 선택하거나 script에서 `/node default <target-id>`를 사용할 수 있습니다. 월 요청 한도는 `/node limit <수량>`, Key 교체는 `/node rotate`, 일시 중지는 `/node stop`, 폐기는 `/node revoke`를 사용합니다. `/agent-node`와 `/gateway`는 alias입니다.

::: tip 데스크톱 관리 세션
CyberCode 데스크톱에서 실행한 TUI에서는 데스크톱 로컬 server가 node를 관리합니다. 두 프로세스가 같은 Key와 port를 수정하지 않도록 데스크톱 설정에서 관리하세요.
:::

## 그대로 입력할 수 있는 전체 예시

다음은 “CI coding agent”를 연결하는 예시입니다. `node.example.com`은 문서 전용 자리 표시자 도메인이고 `cc_REPLACE_WITH_YOUR_NODE_KEY`는 사용할 수 없는 마스킹 Key입니다. 실제 노드에 표시된 주소와 전체 Key로 바꾸세요.

연결할 Agent에 **OpenAI Compatible** 공급자를 추가하고 네 항목만 입력합니다.

| 연결 대상 필드 | 입력 예시 |
| --- | --- |
| Protocol | `OpenAI Chat Completions` |
| Base URL | `https://node.example.com/v1` |
| API Key | `cc_REPLACE_WITH_YOUR_NODE_KEY` |
| Model | `auto` |

일반 사용자는 Model을 `auto`로 유지하면 됩니다. 다른 고급 필드는 입력하지 않아도 됩니다.
연결할 Agent가 공급자 **Name**도 요구하면 `CyberCode 작업 노드`처럼 알아보기 쉬운 로컬 이름을 입력하세요. 이 이름은 라우팅에 사용되지 않으며, 같은 모델을 제공하는 서로 다른 상위 공급자는 Model의 공급자 별칭으로 구분됩니다.

같은 값으로 연결 테스트를 실행할 수 있습니다.

```bash
curl https://node.example.com/v1/chat/completions \
  -H "Authorization: Bearer cc_REPLACE_WITH_YOUR_NODE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [
      {"role": "user", "content": "node connected라고만 답하세요"}
    ]
  }'
```

### CyberCode의 노드 정책

**노드 → 액세스 키 → 대상 정책**에서 화면에 표시되는 이름으로 이 Key를 설정합니다.

| 정책 | 예시 |
| --- | --- |
| Key 이름 | `CI coding agent` |
| 허용 대상 | `Coding 라우트`, `Kimi K2.6` |
| 기본 대상 | `Coding 라우트` |
| 월 요청 한도 | `5000` |

이 정책은 CyberCode가 적용하며 연결 대상은 Model=`auto`를 계속 사용합니다. 특정 모델이나 라우트를 고정해야 할 때만 뒤의 고급 Model 설명에서 정확한 ID를 복사하세요.

## 여러 사용자의 API Key 관리

한 사용자, 기기 또는 외부 Agent마다 Key 하나를 따로 배정하고 같은 값을 공유하지 않는 것을 권장합니다. 권한, 월 한도, 사용량을 분리할 수 있고 노출된 Key 하나만 중지할 수 있습니다.

1. **Key 추가**를 누르고 “Alice”, “CI runner”, “Telegram bot”처럼 사용자를 알아볼 수 있는 이름을 입력합니다.
2. 만든 직후 전체 `cc_...` Key를 복사합니다. CyberCode는 hash만 저장하므로 앱을 새로 고치거나 닫은 뒤에는 전체 값을 복구할 수 없습니다.
3. 해당 Key 행을 클릭합니다. 아래의 **대상 정책**, 월 한도, **연결 설정 생성기**는 선택한 Key에만 적용됩니다.
4. 허용할 모델과 라우트, `auto` 대상, 월 요청 한도를 설정하고 저장합니다.
5. 생성기에서 프로토콜과 대상을 선택하고 생성된 URL, Model, 전체 Key를 연결할 Agent에 입력합니다.

| 작업 | 결과 |
| --- | --- |
| 이름 변경 | 관리용 이름만 바꾸며 Key 값과 연결은 그대로 유지 |
| 복사 | 생성 또는 교체 후 전체 값이 이번 실행의 메모리에 남아 있을 때만 가능 |
| 교체 | 이 Key만 바꾸고 이전 값을 즉시 무효화하며 권한, 한도, 이번 달 사용량은 유지 |
| 폐기 | 이 사용자만 차단하며 다른 Key와 노드는 계속 동작 |

Key가 이미 마스크 처리되었다면 **키 교체**를 누르고 새 값을 해당 Agent에 업데이트하세요. 마지막 Key를 삭제하면 노드가 자동으로 비활성화됩니다.

TUI에서는 다음 명령을 사용할 수 있습니다.

```text
/node key list
/node key create CI
/node key rename CI BuildBot
/node limit 5000 --key=BuildBot
/node allow route/coding --key=BuildBot
/node default route/coding --key=BuildBot
/node rotate BuildBot
/node revoke BuildBot
```

Key가 여러 개면 한도, 권한, 기본 대상, 교체, 폐기 명령에 `--key=<ID, prefix 또는 정확한 이름>`(또는 표시된 Key 인수)을 지정해야 합니다.

## 1단계: 연결할 프로토콜 선택

CyberCode에 연결할 Agent에서 **공급자 추가**, **사용자 지정 모델** 또는 **Custom Provider**를 열고 표시되는 선택지에 맞춰 선택합니다.

| 연결할 Agent의 선택지 | 선택할 프로토콜 |
| --- | --- |
| OpenAI Compatible, Custom OpenAI, Chat Completions | OpenAI |
| Anthropic, Anthropic Compatible, Anthropic Messages | Anthropic |
| 둘 다 있음 | 해당 Agent가 기본으로 권장하는 프로토콜 |

프로토콜은 요청 형식만 결정합니다. 어느 프로토콜이든 CyberCode 노드에서 허용된 모델과 스마트 라우트를 사용할 수 있습니다.

## 2단계: Key와 Model 이해

### API Key

CyberCode가 노드를 만들 때 표시하는 전체 `cc_...` 노드 키를 입력합니다. Kimi, OpenAI, Zhipu 같은 상위 공급자의 Key를 입력하지 않습니다.

전체 노드 키는 한 번만 표시됩니다. 현재 `cc_xxxxx••••••` 같은 마스크만 보이면 Key를 교체하고 새 Key를 연결할 Agent에 바로 입력하세요.

### Model

`auto`를 입력합니다. 이 Key에 설정된 기본 모델 또는 스마트 라우트를 CyberCode가 선택하므로 일반 사용자는 다른 모델 식별자를 입력할 필요가 없습니다.

## OpenAI 프로토콜로 연결

연결할 Agent에서 **OpenAI Compatible**, **Custom OpenAI** 또는 **Chat Completions** 공급자를 추가하고 다음과 같이 입력합니다.

| 항목 | 값 |
| --- | --- |
| API | OpenAI Chat Completions |
| Base URL | CyberCode에 표시된 URL(예: `http://127.0.0.1:3456/v1`) |
| API Key | CyberCode가 만들 때 표시한 전체 `cc_...` 노드 키 |
| Model | `auto` |

Base URL이 아니라 전체 **Endpoint**를 요구하면 `http://127.0.0.1:3456/v1/chat/completions`를 입력합니다.

## Anthropic 프로토콜로 연결

대상 Agent에서 **Anthropic**, **Anthropic Compatible** 또는 **Anthropic Messages** 공급자를 추가하고 다음과 같이 입력합니다.

| 항목 | 값 |
| --- | --- |
| API | Anthropic Messages |
| Base URL | CyberCode에 표시된 Anthropic URL(예: `http://127.0.0.1:3456`) |
| API Key | CyberCode가 만들 때 표시한 전체 `cc_...` 노드 키 |
| Model | `auto` |

Anthropic 클라이언트는 보통 Base URL 뒤에 `/v1/messages`를 자동으로 추가하므로 URL에 `/v1`을 포함하지 않습니다. 전체 엔드포인트가 필요한 경우 `http://127.0.0.1:3456/v1/messages`를 사용하세요.

## 고급: 모델 또는 라우트 고정

기본 대상을 의도적으로 우회할 때만 `auto`를 정확한 target ID로 바꿉니다.
직접 모델에서 `/` 앞부분은 읽기 쉬운 공급자 노드 별칭입니다. **공급자 → 고급 설정 → 노드 별칭**에서 변경할 수 있습니다. 연결 설정 생성기는 내부 공급자 UUID를 표시하지 않습니다.

| 목적 | Model 값 | 동작 |
| --- | --- | --- |
| 스마트 라우트 고정 | `route/<route-id>`(예: `route/coding`) | 해당 라우트가 공급자와 모델을 선택 |
| 직접 모델 고정 | `<provider-alias>/<model-id>`(예: `kimi/kimi-k2.6`) | 지정한 공급자 모델을 항상 사용 |

노드 가이드의 **고급: 모델 또는 라우트 고정**을 펼쳐 전체 ID를 복사하거나 노드 Key로 `GET /v1/models`를 호출하세요. 표시 이름으로 추측하지 마세요.

## 연결 확인

먼저 Model에 입력할 수 있는 전체 ID를 확인합니다.

```bash
curl http://127.0.0.1:3456/v1/models \
  -H "Authorization: Bearer cc_your_node_key"
```

OpenAI 프로토콜을 테스트합니다.

```bash
curl http://127.0.0.1:3456/v1/chat/completions \
  -H "Authorization: Bearer cc_your_node_key" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hello"}]}'
```

Anthropic 프로토콜을 테스트합니다.

```bash
curl http://127.0.0.1:3456/v1/messages \
  -H "x-api-key: cc_your_node_key" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","max_tokens":1024,"messages":[{"role":"user","content":"hello"}]}'
```

노드는 `GET /v1/models`, `POST /v1/chat/completions`, `POST /v1/messages`를 지원하며 OpenAI와 Anthropic 프로토콜 모두 스트리밍 응답을 사용할 수 있습니다.

## 다른 기기에서 연결

기본 `127.0.0.1` 주소는 같은 컴퓨터에서만 접근할 수 있습니다. 휴대폰이나 다른 서버에서 연결하려면 TLS 역방향 프록시 또는 안전한 터널을 사용하고 해당 HTTPS 주소를 공개 URL로 입력하세요.

공개 URL 입력만으로 방화벽, 공개 포트 또는 터널이 자동 설정되지는 않습니다.

## 권한 및 폐기

- 각 Key는 해당 Key에 허용된 모델과 라우트만 사용할 수 있습니다.
- 월 요청 한도와 사용량은 Key마다 독립적입니다.
- Key를 교체하면 해당 Key의 이전 값만 무효화되고 권한, 한도, 이번 달 사용량은 유지됩니다.
- Key 하나를 폐기해도 다른 Key에는 영향이 없으며 마지막 Key를 삭제할 때만 노드가 비활성화됩니다.
