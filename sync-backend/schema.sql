-- 施工写真 同期バックエンド：D1（SQLite）スキーマ
-- 適用方法（READMEに詳細）:
--   npx wrangler d1 execute taiyo-photo-sync --file=./schema.sql --remote

-- 工事（現場）
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,          -- 現場アプリ側の工事ID（currentProjectId）
  name        TEXT NOT NULL DEFAULT '',  -- 工事件名
  status      TEXT NOT NULL DEFAULT 'active', -- active / done
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- 写真メタ情報（実体は R2、ここには場所と付帯情報のみ）
CREATE TABLE IF NOT EXISTS photos (
  id           TEXT PRIMARY KEY,         -- 写真ID（冪等キー）
  project_id   TEXT NOT NULL,
  proc_index   INTEGER,                  -- 工程(タブ)の番号
  item_index   INTEGER,                  -- 項目の番号
  item_name    TEXT,                     -- 項目名（表示用に保存）
  mp_name      TEXT,                     -- 測点名
  taken_at     TEXT,                     -- 撮影日時（クライアント値）
  r2_key       TEXT NOT NULL,            -- R2上のキー
  content_type TEXT,
  uploaded_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photos_project ON photos(project_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
