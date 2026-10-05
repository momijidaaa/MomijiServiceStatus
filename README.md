# Momiji Status

momijiweb.jp の各種Webサービス・Discord Botの稼働状況を表示するステータスページ。

- フロントエンド: 静的HTML/CSS/JS（Cloudflare Pages）
- API・監視: Cloudflare Workers（Cron Triggers）
- データベース: Cloudflare D1
- 通知: Discord Webhook

公開予定URL: `https://status.momijiweb.jp`

---

## 1. 構成

```text
momiji-status/
├── frontend/        Cloudflare Pagesにデプロイする静的サイト
├── worker/           監視APIを実装するCloudflare Worker
├── database/         D1用のスキーマ定義
├── .gitignore
└── README.md
```

---

## 2. 前提

- Node.js 18以上
- npm
- Cloudflareアカウント
- `npx wrangler login` 済みであること

Windows / VS Code / Termux いずれでも動作する構成です。PM2は使用しません。

---

## 3. セットアップ手順

### 3.1 リポジトリを取得

```bash
git clone https://github.com/your-account/momiji-status.git
cd momiji-status
```

### 3.2 Worker側の依存関係をインストール

```bash
cd worker
npm install
```

### 3.3 D1データベースを作成

```bash
npx wrangler d1 create momiji-status
```

コマンド実行後に表示される `database_id` を `worker/wrangler.toml` の
`database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"` の部分（`[[d1_databases]]` と
`[[env.production.d1_databases]]` の両方）に貼り付けてください。

### 3.4 スキーマを適用

ローカル環境:

```bash
npm run db:migrate:local
```

本番(リモート)環境:

```bash
npm run db:migrate:remote
```

これにより `services` / `checks` / `incidents` テーブルが作成され、
4つの初期サービス（KaroCasi, Karo, MSB Sec, Koyobot v2）が登録されます。

### 3.5 Discord Webhookを設定

ローカル開発用（`worker/.dev.vars` を新規作成、Gitには含まれません）:

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` の中身:

```text
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxxxxxxx/xxxxxxxx
```

本番用シークレット登録:

```bash
npx wrangler secret put DISCORD_WEBHOOK_URL
```

`DISCORD_WEBHOOK_URL` はコード・`wrangler.toml`・フロントエンドのどこにも直接書き込みません。

### 3.6 Workerをローカルで起動

```bash
npm run dev
```

`http://127.0.0.1:8787` でAPIが起動します。

```text
GET /api/status
GET /api/status/:id
GET /api/incidents
GET /api/uptime/:id?period=24h
```

Cron Triggerはローカルの `wrangler dev` では自動実行されないため、動作確認したい場合は
`wrangler dev --test-scheduled` を使うか、下記のように直接HTTPで叩いて確認してください。

```bash
curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled"
```

### 3.7 フロントエンドをローカルで確認

`frontend/js/api.js` は `localhost` / `127.0.0.1` を自動判定して
`http://127.0.0.1:8787` に向くようになっています。

```bash
cd ../frontend
npx serve .
```

もしくは任意の静的サーバーで `frontend/` を配信してください。

---

## 4. デプロイ

### 4.1 Workerのデプロイ

```bash
cd worker
npx wrangler deploy
```

Cron Trigger (`*/1 * * * *`) は `wrangler.toml` の設定に従い自動登録されます。

デプロイ後、WorkerのURL（例: `https://momiji-status-worker.your-subdomain.workers.dev`）
に独自ドメイン `api.momijiweb.jp` をCloudflareダッシュボードの
「Workers & Pages」→対象Worker→「Triggers」→「Custom Domains」から割り当ててください。

`frontend/js/api.js` の `API_BASE_URL` は本番では `https://api.momijiweb.jp` を
使う設定になっているため、割り当てたドメインと一致させてください。

### 4.2 Cloudflare Pagesのデプロイ

1. GitHubにリポジトリをpush
2. Cloudflareダッシュボード → Workers & Pages → 「Create application」→「Pages」→「Connect to Git」
3. リポジトリを選択
4. ビルド設定

```text
Build command:       (空欄のまま)
Build output directory: frontend
```

5. デプロイ後、Pagesのカスタムドメインとして `status.momijiweb.jp` を追加

---

## 5. データ保持

- `checks` テーブルは `DATA_RETENTION_DAYS`（`wrangler.toml` 内、既定60日）を超えたレコードを
  毎回のCron実行時に自動削除します。
- `incidents` テーブルは自動削除しません（長期保存）。

---

## 6. 誤検知対策（フラップ抑制）

- 1回失敗しただけでは状態を変更しません（再チェック待ち）。
- 2回連続失敗で `degraded`、3回連続失敗で `outage` に遷移します。
- 2回連続成功で `operational` に復帰します。
- `outage` から復旧した場合のみ、進行中インシデントを自動でクローズし、
  Discordへ復旧通知を送信します（1インシデントにつき通知は1回のみ）。

---

## 7. しきい値のカスタマイズ

`services` テーブルの `threshold_degraded_ms` / `threshold_outage_ms` カラムを
更新することで、サービスごとに応答時間の判定しきい値を変更できます。

```bash
npx wrangler d1 execute momiji-status --remote \
  --command "UPDATE services SET threshold_degraded_ms = 3000, threshold_outage_ms = 12000 WHERE id = 'karocasi';"
```

---

## 8. 今後の拡張

設計上、以下を既存構造を壊さずに追加できます。

- Minecraft / Java / Bedrock サーバー監視（`services.category` に `minecraft` を追加し、
  `monitor.js` に専用チェック関数を実装）
- Discord Bot Heartbeat監視
- `/admin` 管理画面（`services` / `incidents` のCRUD、認証はWorker側でBearerトークン等を追加）
- メンテナンススケジュール、RSS、メール通知

---

## 9. D1 / Workers の無料枠について

このプロジェクトは以下の工夫で、D1の無料枠（1日あたりの読み取り行数など）やWorkersのリクエスト数制限に
通常のアクセス量では収まるように設計しています。

- 稼働率(24h/7d/30d)と最新チェック結果は、APIリクエストのたびに`checks`テーブルを集計するのではなく、
  Cron実行時に`services`テーブルへキャッシュしています。`/api/status`はサービス一覧を1クエリ読むだけです。
- 24h稼働率は毎分(Cron実行のたび)、7d/30d稼働率は1時間に1回だけ再計算します
  (`STATS_7D_30D_INTERVAL_SECONDS`、`worker/src/index.js`)。
- `/api/status` `/api/status/:id` `/api/incidents` `/api/uptime/:id` はCloudflareのCache API
  (`caches.default`)で数秒〜十数秒だけエッジキャッシュされるため、同時アクセスが増えてもD1への到達回数は
  ほぼ増えません(カスタムドメイン経由でのみ有効。`*.workers.dev`では効かない場合があります)。
- フロントエンドのポーリング間隔は監視間隔(1分)に合わせて60秒にしています。

サービス詳細モーダル(`/api/status/:id`)の24時間稼働バーのみ、クリック時に`checks`テーブルの生データを
読みますが、これはユーザー操作のたびにしか発生しないため影響は軽微です。

サービス数を増やしたり、監視間隔を1分より短くする場合は、`STATS_7D_30D_INTERVAL_SECONDS`やCacheのTTLを
見直してください。

## 10. セキュリティ上の注意

以下はフロントエンドに絶対に含めないでください。

```text
Discord Webhook URL
Cloudflare API Token
D1 Credentials
管理者Token
```

これらはすべて `wrangler secret put` または `.dev.vars`（Git管理外）で管理します。
