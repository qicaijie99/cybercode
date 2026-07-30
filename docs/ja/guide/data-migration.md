# データ移行と USB ポータブル利用

デスクトップの **データ移行** には、Agent 間で蓄積データを移す機能と、別の PC で使える CyberCode ポータブル作業ドライブを作る機能があります。

## Agent 移行

1. **データ移行 → Agent 移行**を開きます。
2. 移行元と移行先を選びます。CyberCode、OpenClaw、WorkBuddy、Claude Code、Codex、Cursor、Trae、Hermes Agent、DeepSeek TUI、Kimi Code、Pi に対応します。
3. 検出された Skills、メモリ、ルール、プロジェクト情報を確認します。直接コピー、変換が必要、非互換の状態が表示されます。
4. 必要な項目だけを選択し、プレビューしてから実行します。

移行元のデータは削除されません。移行先に同名ファイルがある場合、未知の内容を無断で上書きせず、移行先形式に合わせてバックアップまたは競合を表示します。

## USB ポータブル作業ドライブを作る

1. **データ移行 → USB ポータブル移行**を開きます。
2. USB またはリムーバブルディスクのルートを選びます。既存の `CyberCode-Portable` を直接選んで更新することもできます。
3. プロジェクトと、macOS Apple Silicon、macOS Intel、Windows x64、Linux x64 から必要な platform を選びます。
4. 認証情報の注意を確認して開始します。容量不足、checksum 不一致、保存先競合は理由を表示して停止します。

ポータブル bundle には設定、Skills、plugin、メモリ、ログイン情報、選択したプロジェクト、platform 別アプリ、起動スクリプト、SHA-256 一覧を含められます。現在の Release にアプリがない場合は **アプリを含める** を無効にし、データとプロジェクトだけを移行できます。

## 移行先で起動

| OS | 起動ファイル |
| --- | --- |
| macOS | `Start-CyberCode.command` をダブルクリック |
| Windows | `Start-CyberCode.cmd` をダブルクリック |
| Linux x64 | `./Start-CyberCode.sh` を実行 |

初回起動時に対応アプリを USB 内へ展開します。Linux は AppImage の extract-and-run を使うため FUSE は不要です。セッション、定期タスク、Code Graph のプロジェクトパスは `portable-projects.json` で現在の mount 先へ変換され、OS やドライブ文字が変わっても移行済みプロジェクトを参照できます。

::: warning 認証情報を保護してください
`data/config` には API Key、OAuth session、Web Cookie が含まれる場合があります。USB をパスワードと同様に保護し、CyberCode を終了してから安全に取り外してください。
:::
