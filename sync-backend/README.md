# 施工写真 同期バックエンド（Step1）セットアップ手順

これは「現場で撮った写真を自動で集める置き場所（サーバー）」です。
**全部 Cloudflare の無料サービス**で動きます。この手順どおりに進めれば、あなたの環境で動く状態になります。

> この Step1 の目標：**写真を受け取って保存し、管理者がまとめて取り出せる土台**を作ること。
> （kintone連携・Box退避・自動削除は Step4/5 で追加します）

---

## できること（この時点のAPI）

| 操作 | 内容 |
|---|---|
| `GET /api/health` | 疎通確認（合言葉不要） |
| `POST /api/photos` | 写真を1枚アップロード（R2保存＋メタ記録） |
| `GET /api/projects` | 工事の一覧（写真枚数つき） |
| `GET /api/projects/{id}/photos` | ある工事の写真メタ一覧 |
| `GET /api/photos/{id}` | 写真の実体を取得 |
| `POST /api/projects/{id}/status` | 工事を active / done に変更 |
| `DELETE /api/projects/{id}` | 工事の写真を全削除（Step5のクリーンアップ用） |

`/api/health` 以外は、合言葉を `Authorization: Bearer <合言葉>` で送る必要があります。

---

## 必要なもの
- パソコン（Windows / Mac）
- **Node.js**（https://nodejs.org の LTS版をインストール）
- **Cloudflare の無料アカウント**（https://dash.cloudflare.com/sign-up ）

---

## 手順（コピペで進められます）

### 0) このフォルダへ移動して準備
```bash
cd sync-backend
npm install
npx wrangler login     # ブラウザが開くので Cloudflare にログインして許可
```

### 1) R2 バケットを作る（写真の置き場所）
```bash
npx wrangler r2 bucket create taiyo-photo-sync
```
> ※ 初めてR2を使うときは、Cloudflareの画面でR2の有効化（無料プランの開始）を1回求められることがあります。画面の案内に従ってください。

### 2) D1 データベースを作る（メタ情報の置き場所）
```bash
npx wrangler d1 create taiyo-photo-sync
```
実行すると、次のような表示が出ます：
```
[[d1_databases]]
binding = "DB"
database_name = "taiyo-photo-sync"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   ← この値をコピー
```
→ **`wrangler.toml` を開き、`database_id = "ここに…"` の部分を、表示された値に貼り替えて保存**します。

### 3) テーブルを作る（スキーマ適用）
```bash
npm run db:init:remote
```

### 4) 合言葉（SYNC_KEY）を登録する
会社で共有する合言葉を1つ決めて登録します（例：長めのランダムな文字列が安全）。
```bash
npx wrangler secret put SYNC_KEY
# 入力を求められたら、決めた合言葉を貼り付けて Enter
```
> この合言葉を、あとで現場アプリ側にも設定します（アプリからサーバーへ接続するため）。

### 5) 公開（デプロイ）
```bash
npm run deploy
```
成功すると、次のようなURLが表示されます：
```
https://taiyo-photo-sync.<あなたのサブドメイン>.workers.dev
```
→ **このURLを控えてください**（現場アプリに設定します）。

---

## 動作確認

### 疎通確認（合言葉なしでOK）
ブラウザで `（上のURL）/api/health` を開く → `{"ok":true,...}` が出れば成功。

### 合言葉つきの確認（PCのターミナルで）
```bash
# 一覧取得（最初は空のはず）
curl -H "Authorization: Bearer あなたの合言葉" https://（上のURL）/api/projects
# → {"projects":[]} が返ればOK

# テスト画像を1枚アップロード（手元の test.jpg を使用）
curl -X POST "https://（上のURL）/api/photos" \
  -H "Authorization: Bearer あなたの合言葉" \
  -F "project_id=test1" \
  -F "project_name=テスト工事" \
  -F "item_name=テスト項目" \
  -F "photo=@test.jpg"
# → {"ok":true,...} が返ればOK。再度 /api/projects を見ると photo_count が1になります。
```

---

## うまくいかないとき
- `wrangler: command not found` → `npx` を頭につけて実行（例：`npx wrangler ...`）。`npm install` 済みか確認。
- `401 unauthorized` → 合言葉（SYNC_KEY）の登録（手順4）と、`Authorization: Bearer ...` の綴りを確認。
- `D1_ERROR: no such table` → 手順3（スキーマ適用）を実行。
- R2が使えない → Cloudflare画面でR2を有効化（無料プラン開始）。

---

## このあと（次のStep）
- **Step2**：現場アプリに「裏で自動アップロード＋写真圧縮」を追加
- **Step3**：管理者の「全稼働現場まとめ表示」
- **Step4**：完了時に「写真台帳PDF → kintone 添付」
- **Step5**：完了時に「元写真 → Box 退避」＋「R2 自動クリーンアップ」

分からないところが出たら、画面の表示（エラー文やURL）をそのまま教えてください。その都度ご案内します。
