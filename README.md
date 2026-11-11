# mado Data Search

MySQLのいくつものデータベースと表に分かれたメタデータ（タイトル、チャンネル、日付など）を、まとめて検索するWebツールです。mado familyの製品のひとつです。

## 仕組み

- 取り込みの処理が、MySQLからClickHouseへ検索に使う列だけを写します。既定では24時間ごとです（`MDS_INGEST_INTERVAL_HOURS`）。
- 検索はClickHouseだけを読みます。タイトルとチャンネルは2文字ごとの全文索引で引きます。
- 説明文などの長い列は写しません。詳細を開いたときに、MySQLから主キーで1行だけ読みます。
- 正本はMySQLです。ClickHouseのデータは、消しても取り込み直せます。

## 取り込みの決まり

- どの表をどの項目として載せるかは`config/sources.yaml`に書きます。形は`config/sources.example.yaml`を見てください。実際の表の名前を公開のリポジトリに入れないよう、`sources.yaml`はGitに入れません。
- 1本の接続で順に読み、`MDS_INGEST_MAX_MEGABYTES_PER_SECOND`で読みの速さを絞ります。セッションは読み取り専用にします。
- 取り込みの途中で止まったときは、次に起動したときに続きから読みます。
- `incremental`は主キーが増えるだけの表で、新しい行だけを足します。詳細の表があとから埋まる行は`rereadRecentKeys`で読み直します。
- `full`は主キーが連番でない表で、`fullEveryDays`ごとに全件を読み直し、読み終えてから1回で差し替えます。
- MySQLで消した行や、`rereadRecentKeys`より前の行の変更は、次に全件を入れ直すまで反映されません。

## 開発

```sh
npm ci
cp config/sources.example.yaml config/sources.yaml   # 表に合わせて直す
docker compose -p mado-data-search-dev up -d           # ClickHouseを127.0.0.1:18123で起動
cat > .env <<'ENV'
MDS_AUTH_MODE=disabled
MDS_COOKIE_SECURE=false
MDS_MYSQL_HOST=127.0.0.1
MDS_MYSQL_USER=...
MDS_MYSQL_PASSWORD=...
MDS_SOURCES_FILE=../../config/sources.yaml
ENV
npm run ingest:dev -w @mds/api -- --once --source <id>
npm run dev -w @mds/api
npm run dev -w @mds/web                              # http://127.0.0.1:5190
```

変更を出す前に`npm run typecheck`、`npm run lint`、`npm test`を通します。

## 配備

`deploy/compose.production.yml`、`deploy/env.example`、`deploy/clickhouse/low-resource.xml`を使います。イメージは`v*`のタグを付けるとGHCRへ出るので、`MDS_IMAGE`にdigestで固定します。ClickHouseのメモリは`mem_limit`（4GB）までです。ClickHouseは外へ開かず、APIだけをloopbackに開いて、前段のnginxからつなぎます。ログインはOIDCで、`MDS_OIDC_ALLOWED_GROUP`のグループに入っている人だけが使えます。リダイレクトURIは`<MDS_PUBLIC_URL>/api/auth/callback`です。
