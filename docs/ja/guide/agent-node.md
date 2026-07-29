# ノード接続

CyberCode は、設定済みモデルとスマートルートを、OpenAI Chat Completions と Anthropic Messages の両方に対応した権限限定ノードとして他の Agent に提供できます。プロバイダーの認証情報は CyberCode 内に残り、接続先には専用ノードキーだけを渡します。

## CyberCode 側の準備

1. **モデルとルーティング → ノード**を開きます。
2. ユーザーまたは Agent ごとに個別のノード API Key を作成します。完全なキーは一度だけ表示されます。
3. 表で管理する Key の行を選び、その Key に許可するモデルとルート、および `auto` の既定接続先を設定します。
4. 保存後、**接続設定ジェネレーター**でプロトコルと対象を選びます。Base URL、完全な Endpoint、Model、ノード Key を含むカードが開き、各項目または全体をコピーできます。

独立 TUI からも設定できます。

```text
/node start
/node allow all
/node status
```

`/node start` は内蔵ローカル runtime を必要時に起動し、Key がない場合は `cc_...` Key を作成します。完全な Key は一度だけ表示されます。`/node` を直接開くと既定接続先を対話式に選べ、script では `/node default <target-id>` を使用できます。月間上限は `/node limit <件数>`、Key の更新は `/node rotate`、一時停止は `/node stop`、失効は `/node revoke` を使用します。`/agent-node` と `/gateway` は alias です。

::: tip デスクトップ管理のセッション
CyberCode デスクトップから起動された TUI では、node はデスクトップのローカル server が管理します。Key と port の二重変更を防ぐため、デスクトップ設定から操作してください。
:::

## そのまま入力できる完全な例

次は「CI coding agent」を接続する例です。`node.example.com` は文書専用のプレースホルダードメイン、`cc_REPLACE_WITH_YOUR_NODE_KEY` は無効なマスク済み Key です。実際のノードに表示されたアドレスと完全な Key に置き換えてください。

接続先 Agent に **OpenAI Compatible** プロバイダーを追加し、4 項目だけ入力します。

| 接続先の項目 | 入力例 |
| --- | --- |
| Protocol | `OpenAI Chat Completions` |
| Base URL | `https://node.example.com/v1` |
| API Key | `cc_REPLACE_WITH_YOUR_NODE_KEY` |
| Model | `auto` |

通常は Model を `auto` のまま使用します。他の高度な項目は入力不要です。
接続先がプロバイダーの **Name** も要求する場合は、`CyberCode 作業ノード` など識別しやすいローカル名を入力します。この名前はルーティングには使われません。同じモデルを提供する異なる上流は、Model 内のプロバイダー別名で区別されます。

同じ値で接続テストを実行できます。

```bash
curl https://node.example.com/v1/chat/completions \
  -H "Authorization: Bearer cc_REPLACE_WITH_YOUR_NODE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [
      {"role": "user", "content": "node connected とだけ返信してください"}
    ]
  }'
```

### CyberCode 側のノードポリシー

**ノード → アクセスキー → 接続先ポリシー**で、画面に表示される名前を使って設定します。

| ポリシー | 例 |
| --- | --- |
| Key 名 | `CI coding agent` |
| 許可する対象 | `Coding ルート`、`Kimi K2.6` |
| 既定接続先 | `Coding ルート` |
| 月間リクエスト上限 | `5000` |

これらは CyberCode が適用し、接続先は Model=`auto` のままで利用できます。特定のモデルやルートを固定する必要がある場合だけ、後述の高度な Model 説明で正確な ID をコピーします。

## 複数ユーザーの API Key を管理する

1 人のユーザー、端末、外部 Agent ごとに 1 つの Key を割り当て、同じ値を共有しないことを推奨します。権限、月間上限、使用量を分離でき、漏えいした Key だけを停止できます。

1. **Key を追加**を押し、「Alice」「CI runner」「Telegram bot」など利用者が分かる名前を入力します。
2. 作成直後に完全な `cc_...` Key をコピーします。CyberCode は hash のみ保存するため、再起動や再読込の後に完全な値を復元できません。
3. Key の行をクリックします。下の **接続先ポリシー**、月間上限、**接続設定ジェネレーター**は、選択中の Key だけに適用されます。
4. 許可するモデルとルート、`auto` の接続先、月間上限を設定して保存します。
5. ジェネレーターでプロトコルと対象を選び、生成された URL、Model、完全な Key を接続先 Agent に入力します。

| 操作 | 結果 |
| --- | --- |
| 名前変更 | 管理用の表示名だけを変更し、Key と接続はそのまま使える |
| コピー | 作成または更新後、完全な値が今回のメモリに残っている間だけ使える |
| 更新 | この Key だけを交換し、旧値を直ちに無効化する。権限、上限、今月の使用量は維持される |
| 失効 | この利用者だけを停止し、他の Key とノードには影響しない |

Key が既にマスク表示の場合は **キーを更新**し、新しい値を対象 Agent に設定してください。最後の Key を削除するとノードは自動的に停止します。

TUI では次のコマンドを使用できます。

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

複数の Key がある場合、上限、権限、既定接続先、更新、失効には `--key=<ID、prefix、または完全な名前>`（または表示された Key 引数）が必要です。

## 手順 1: 接続先のプロトコルを選ぶ

CyberCode に接続する Agent で **プロバイダーを追加**、**カスタムモデル**、または **Custom Provider** を開き、表示される選択肢に合わせます。

| 接続先 Agent の選択肢 | 選ぶプロトコル |
| --- | --- |
| OpenAI Compatible、Custom OpenAI、Chat Completions | OpenAI |
| Anthropic、Anthropic Compatible、Anthropic Messages | Anthropic |
| 両方 | その Agent が標準で推奨するプロトコル |

プロトコルはリクエスト形式だけを決めます。どちらでも CyberCode ノードで許可されたモデルとスマートルートを利用できます。

## 手順 2: Key と Model を理解する

### API Key

CyberCode がノード作成時に表示する完全な `cc_...` ノードキーを入力します。Kimi、OpenAI、Zhipu など上流プロバイダーの Key は入力しません。

完全なノードキーは一度だけ表示されます。現在 `cc_xxxxx••••••` のようなマスクしか見えない場合は、Key を更新して新しい Key を接続先へすぐ入力します。

### Model

`auto` を入力します。この Key に設定した既定モデルまたはスマートルートを CyberCode が選ぶため、通常は他のモデル識別子は不要です。

## OpenAI プロトコルで接続

接続先で **OpenAI Compatible**、**Custom OpenAI**、または **Chat Completions** プロバイダーを追加し、次のように入力します。

| 項目 | 値 |
| --- | --- |
| API | OpenAI Chat Completions |
| Base URL | CyberCode に表示された URL（例: `http://127.0.0.1:3456/v1`） |
| API Key | CyberCode が作成時に表示した完全な `cc_...` ノードキー |
| Model | `auto` |

Base URL ではなく完全な **Endpoint** を要求される場合は `http://127.0.0.1:3456/v1/chat/completions` を入力します。

## Anthropic プロトコルで接続

接続先 Agent で **Anthropic**、**Anthropic Compatible**、または **Anthropic Messages** プロバイダーを追加し、次のように入力します。

| 項目 | 値 |
| --- | --- |
| API | Anthropic Messages |
| Base URL | CyberCode に表示された Anthropic URL（例: `http://127.0.0.1:3456`） |
| API Key | CyberCode が作成時に表示した完全な `cc_...` ノードキー |
| Model | `auto` |

Anthropic クライアントは通常 Base URL に `/v1/messages` を自動で追加するため、URL に `/v1` は含めません。完全なエンドポイントが必要な場合は `http://127.0.0.1:3456/v1/messages` を使用します。

## 詳細: モデルまたはルートを固定

既定接続先を意図的に使わない場合だけ、`auto` を正確な target ID に変更します。
直接モデルでは、`/` の前が読みやすいプロバイダーノード別名です。**プロバイダー → 詳細設定 → ノード別名** で変更できます。接続設定ジェネレーターに内部プロバイダー UUID は表示されません。

| 目的 | Model の値 | 動作 |
| --- | --- | --- |
| スマートルートを固定 | `route/<route-id>`（例: `route/coding`） | そのルートがプロバイダーとモデルを選ぶ |
| 直接モデルを固定 | `<provider-alias>/<model-id>`（例: `kimi/kimi-k2.6`） | 指定したプロバイダーモデルを常に使う |

ノードガイドの **詳細: モデルまたはルートを固定**を開いて完全な ID をコピーするか、ノード Key 付きの `GET /v1/models` で確認します。表示名から推測しないでください。

## 接続確認

まず Model に入力できる完全な ID を確認します。

```bash
curl http://127.0.0.1:3456/v1/models \
  -H "Authorization: Bearer cc_your_node_key"
```

OpenAI プロトコルをテストします。

```bash
curl http://127.0.0.1:3456/v1/chat/completions \
  -H "Authorization: Bearer cc_your_node_key" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hello"}]}'
```

Anthropic プロトコルをテストします。

```bash
curl http://127.0.0.1:3456/v1/messages \
  -H "x-api-key: cc_your_node_key" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","max_tokens":1024,"messages":[{"role":"user","content":"hello"}]}'
```

ノードは `GET /v1/models`、`POST /v1/chat/completions`、`POST /v1/messages` に対応し、OpenAI と Anthropic の両方でストリーミングを利用できます。

## 別端末から接続

既定の `127.0.0.1` は同じコンピューターからのみ利用できます。スマートフォンや別サーバーから接続する場合は、TLS 対応のリバースプロキシまたは安全なトンネルを使い、その HTTPS URL を公開 URL として設定してください。

公開 URL の入力だけでは、ファイアウォールの開放、公開ポートの待受、トンネル作成は行われません。

## 権限と失効

- 各 Key は、その Key に許可されたモデルとルートだけを利用できます。
- 月間上限と使用量は Key ごとに独立しています。
- Key の更新では、その Key の旧値だけが無効になり、権限、上限、今月の使用量は維持されます。
- 1 つの Key を失効しても他の Key には影響せず、最後の Key を削除したときだけノードが停止します。
