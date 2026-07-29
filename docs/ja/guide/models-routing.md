# モデル接続、同期、スマートルーティング

CyberCode はモデル接続を分かりやすいグループに整理し、デスクトップとターミナル TUI で同じローカル設定を共有します。公式 API Key と主要 aggregator、OAuth、Web セッション、画像・動画・音声、ローカル / カスタム接続の順に表示されます。

## 接続方式を選ぶ

| 種類 | 主な用途 | 説明 |
| --- | --- | --- |
| 公式 API Key | 安定性と明確な課金を重視 | Key はローカルに保存されます。Kimi Code と Kimi のような別製品は別エントリです。 |
| Aggregator | 1 つのアカウントで複数モデルを利用 | OpenAI / Anthropic 互換 endpoint に対応します。 |
| OAuth | ブラウザー認証を提供するサービス | 認証結果をローカルに保存し、対応サービスでは token を自動更新します。 |
| Web セッション | 既存サイトのログイン状態を利用 | Cookie、JWT、Web token を使用するため、公式 API より安定性、rate limit、アカウント規約のリスクが高くなります。 |
| 画像・動画・音声 | メディアモデルと認証情報の管理 | 中国向け provider を優先表示します。接続テストは有料生成を実行せず、メディアモデルを chat の既定値にしません。 |
| ローカル / カスタム | LM Studio、Ollama、自前の互換サービス | Base URL、protocol、モデル ID を設定できます。 |

デスクトップでは **設定 → モデルとルーティング → モデルプロバイダー** を開きます。表示名は CyberCode の選択言語に従います。

## OAuth と Web セッション

OAuth カードを開いて認証を完了すると、接続済みカードだけが強調表示されます。token rotation に対応する provider は CyberCode がローカルで有効な token を維持します。

Web セッションでは、カードに表示された Cookie または Web token を入力します。CyberCode は Cookie を正規化し、ブラウザー互換 header と upstream の token 更新を処理します。ブラウザーデータの読み取り、CAPTCHA の代行、アカウント制限や地域制限の回避は行いません。

::: warning 利用規約を確認してください
Web interface は予告なく変わり、rate limit やアカウント制御の対象になる場合があります。権限のあるアカウントだけを使用し、安定運用では公式 API を優先してください。
:::

## モデルの取り込みと同期

互換 `/models` endpoint を持つ API Key、カスタム、ローカル provider では **最新モデルを同期** を利用できます。CyberCode はリモート一覧を統合し、手入力したモデル ID を保持します。

**リアルタイム同期**を有効にすると、起動後と約 24 時間ごとに対応 provider を更新します。OAuth、Web セッション、内蔵メディア一覧はそれぞれの接続方式で管理され、汎用 `/models` 同期では上書きされません。

```text
/provider status
/provider sync [provider ID または名前]
/provider auto-sync on|off [provider ID または名前]
```

## スマートルート

**モデルとルーティング → スマートルーティング**で複数の利用可能なモデルを 1 つの route に追加します。CyberCode は可用性、health 履歴、失敗 cooldown を見て試行先を選び、最大試行回数の範囲で次の候補へ切り替えます。

```text
/routing
/routing status
/routing create coding-fast Daily coding
/routing strategy coding-fast auto
/routing use coding-fast
/routing reset-health
```

`/route` は `/routing` の alias です。詳細な順序と policy はデスクトップで編集できます。

## 他の Agent へ公開

**ノード**は設定済みモデルと route を、専用キーで保護された OpenAI Chat Completions / Anthropic Messages endpoint として公開します。元の provider Key は外部 Agent に渡りません。詳しくは [Agent ノード接続](./agent-node.md) を参照してください。

独立 TUI は必要時に内蔵ローカル runtime を起動するため、追加 proxy は不要です。デスクトップから起動された TUI では、二重書き込みを防ぐためデスクトップ側が server、同期 scheduler、node lifecycle を管理します。
