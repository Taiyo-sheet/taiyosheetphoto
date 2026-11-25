/*
 * 施工写真台帳アプリ用 クラウド共有APIサーバー
 * -------------------------------------------------
 * 役割：1つの工事データ（アプリの「データ送信」で作られるJSON、写真を含む）を
 *       「共有コード」をキーにして保存／取得する。コードを知っている人が
 *       同じ台帳・写真を取り込める＝チームで共有できる。
 *
 * エンドポイント：
 *   GET  /api/health              稼働確認
 *   GET  /api/project/:code       共有コードのデータを取得（読み取り）
 *   PUT  /api/project/:code       共有コードのデータを保存／上書き（更新）
 *
 * 必要な環境変数：
 *   DATABASE_URL  … Render Postgres の接続文字列（Renderが自動注入）
 *   WRITE_TOKEN   … 任意。設定すると「保存(PUT)」に x-write-token ヘッダーが必須になる
 *                   （書き込みを簡易的に保護したい場合のみ設定）
 */
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const WRITE_TOKEN = process.env.WRITE_TOKEN || '';

// Render の Postgres は SSL 接続。localhost のときだけ SSL を無効化。
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false }
});

app.use(cors());                       // 静的サイト(GitHub Pages)からの呼び出しを許可
app.use(express.json({ limit: '60mb' })); // 写真(base64)を含むため上限を大きめに

// 共有コードの形式：英数字・ハイフン・アンダースコアの4〜64文字
const CODE_RE = /^[A-Za-z0-9_-]{4,64}$/;

async function init() {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS projects (' +
    '  code TEXT PRIMARY KEY,' +
    '  data TEXT NOT NULL,' +
    '  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()' +
    ')'
  );
}

app.get('/api/health', function (req, res) {
  res.json({ ok: true, time: new Date().toISOString() });
});

// 取得（読み取り）
app.get('/api/project/:code', async function (req, res) {
  var code = req.params.code;
  if (!CODE_RE.test(code)) return res.status(400).json({ error: 'bad code' });
  try {
    var r = await pool.query('SELECT data, updated_at FROM projects WHERE code=$1', [code]);
    if (!r.rows.length) return res.status(404).json({ error: 'not found' });
    res.json({ code: code, data: r.rows[0].data, updated_at: r.rows[0].updated_at });
  } catch (e) {
    console.error('GET error', e);
    res.status(500).json({ error: 'server error' });
  }
});

// 保存／上書き（更新）
app.put('/api/project/:code', async function (req, res) {
  var code = req.params.code;
  if (!CODE_RE.test(code)) return res.status(400).json({ error: 'bad code' });
  if (WRITE_TOKEN && req.get('x-write-token') !== WRITE_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  var data = req.body && req.body.data;
  if (typeof data !== 'string' || !data) {
    return res.status(400).json({ error: 'data (string) required' });
  }
  try {
    await pool.query(
      'INSERT INTO projects (code, data, updated_at) VALUES ($1, $2, now()) ' +
      'ON CONFLICT (code) DO UPDATE SET data = EXCLUDED.data, updated_at = now()',
      [code, data]
    );
    res.json({ ok: true, code: code, updated_at: new Date().toISOString() });
  } catch (e) {
    console.error('PUT error', e);
    res.status(500).json({ error: 'server error' });
  }
});

init()
  .then(function () {
    app.listen(PORT, function () { console.log('taiyosheet-sync listening on ' + PORT); });
  })
  .catch(function (e) {
    console.error('DB init failed', e);
    process.exit(1);
  });
