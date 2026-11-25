# 施工写真台帳アプリ クラウド共有API（Render + Postgres）

工事データ（アプリの「データ送信」で作られるJSON、写真を含む）を「共有コード」で
保存・取得するための小さなAPIサーバーです。コードを知っている人が同じ台帳・写真を
取り込めるので、**チームで共有**できます。

- フロント（index.html）は今まで通り GitHub Pages で動かしたまま、このAPIだけ Render に置きます。
- アプリ側の「クラウド共有」ボタンは、このAPIを公開してURLが決まってから組み込みます。

---

## デプロイ手順（Renderダッシュボードでの手動セットアップ：確実な方法）

### 1. データベースを作る
1. Render ダッシュボード → **New +** → **Postgres**
2. 名前：`taiyosheet-db`、リージョン：Tokyo など近い場所、プラン：任意（有料推奨）
3. 作成後、**「Internal Database URL」**（または External）をコピーしておく

### 2. Webサービス（API）を作る
1. **New +** → **Web Service** → このGitHubリポジトリ（`taiyosheetphoto`）を選択
2. 設定：
   - **Branch**：このブランチ（`claude/render-sync-backend`）※本番マージ後は `main`
   - **Root Directory**：`server`
   - **Runtime**：Node
   - **Build Command**：`npm install`
   - **Start Command**：`node server.js`
   - **Plan**：Starter（常時起動）推奨
3. **Environment** に環境変数を追加：
   - `DATABASE_URL` = 手順1でコピーした接続文字列
   - （任意）`WRITE_TOKEN` = 書き込みを保護したい場合に好きな文字列
4. **Create Web Service** → デプロイ完了を待つ

### 3. 動作確認
- 発行されたURL（例：`https://taiyosheet-sync.onrender.com`）の末尾に `/api/health` を付けて開く
- `{"ok":true, ...}` が返ればOK

### 4. URLを共有してください
- その **サービスURL**（`https://xxxx.onrender.com`）を教えてください。
  アプリ側に「クラウド共有」機能を組み込みます。

> ※ ワンクリックで作りたい場合はリポジトリ直下の `render.yaml`（Blueprint）も使えます。
>   New + → Blueprint → このリポジトリ を選択。plan名でエラーが出たら上記の手動手順へ。

---

## API仕様
| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/health` | 稼働確認 |
| GET | `/api/project/:code` | 共有コードのデータ取得（読み取り） |
| PUT | `/api/project/:code` | 共有コードのデータ保存／上書き（body: `{"data":"<JSON文字列>"}`） |

- `code` は英数字・ハイフン・アンダースコアの4〜64文字。
- `WRITE_TOKEN` を設定した場合、PUT には `x-write-token` ヘッダーが必要。

## ローカルで試す場合
```bash
cd server
npm install
DATABASE_URL="postgres://localhost:5432/taiyo" node server.js
```

## 今後の発展（フェーズ2以降の候補）
- 自動同期（手動ボタン→バックグラウンド同期）
- 写真はBox/オブジェクトストレージへ退避し、DBはメタデータのみ（大容量対策）
- ログイン／工事ごとの権限管理
- Boxへの自動アップロード連携
