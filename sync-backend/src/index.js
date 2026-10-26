/**
 * 施工写真 同期バックエンド（Cloudflare Worker）
 * ------------------------------------------------------------------
 * 役割：
 *   - 現場アプリから送られた写真を R2 に保存
 *   - 写真のメタ情報（工事・項目・測点など）を D1 に保存
 *   - 管理者が全稼働現場の写真をまとめて取得
 *   - 工事の状態管理（active / done）と、完了後のクリーンアップ
 *
 * 認証：
 *   会社共通の合言葉（SYNC_KEY）を Authorization: Bearer <SYNC_KEY> で送る。
 *   SYNC_KEY は wrangler secret で設定（コードにもファイルにも書かない）。
 *
 * バインディング（wrangler.toml で設定）：
 *   env.PHOTOS … R2 バケット（写真の実体）
 *   env.DB     … D1 データベース（メタ情報）
 *   env.ALLOWED_ORIGIN … 許可するアプリのURL（CORS用）
 *   env.SYNC_KEY       … 合言葉（secret）
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // --- CORS プリフライト ---
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    try {
      // ヘルスチェック（認証不要・疎通確認用）
      if (pathname === '/api/health' && request.method === 'GET') {
        return json({ ok: true, time: new Date().toISOString() }, 200, env);
      }

      // これ以降は合言葉が必要
      const authError = checkAuth(request, env);
      if (authError) return authError;

      // ルーティング
      if (pathname === '/api/photos' && request.method === 'POST') {
        return await uploadPhoto(request, env);
      }
      if (pathname === '/api/projects' && request.method === 'GET') {
        return await listProjects(env);
      }
      let m;
      if ((m = pathname.match(/^\/api\/projects\/([^/]+)\/photos$/)) && request.method === 'GET') {
        return await listProjectPhotos(decodeURIComponent(m[1]), env);
      }
      if ((m = pathname.match(/^\/api\/projects\/([^/]+)\/status$/)) && request.method === 'POST') {
        return await setProjectStatus(decodeURIComponent(m[1]), request, env);
      }
      if ((m = pathname.match(/^\/api\/projects\/([^/]+)$/)) && request.method === 'DELETE') {
        return await deleteProject(decodeURIComponent(m[1]), env);
      }
      if ((m = pathname.match(/^\/api\/photos\/([^/]+)$/)) && request.method === 'GET') {
        return await getPhoto(decodeURIComponent(m[1]), env);
      }

      return json({ error: 'not_found' }, 404, env);
    } catch (err) {
      return json({ error: 'server_error', detail: String(err && err.message || err) }, 500, env);
    }
  },
};

/* ===== 認証・CORS ===== */
function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': (env && env.ALLOWED_ORIGIN) || '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}
function checkAuth(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const expected = 'Bearer ' + (env.SYNC_KEY || '');
  // SYNC_KEY 未設定、または一致しない場合は拒否
  if (!env.SYNC_KEY || auth !== expected) {
    return json({ error: 'unauthorized' }, 401, env);
  }
  return null;
}
function json(obj, status, env) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(env) },
  });
}

/* ===== 写真アップロード ===== */
async function uploadPhoto(request, env) {
  const form = await request.formData();
  const file = form.get('photo');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return json({ error: 'photo_required' }, 400, env);
  }
  const projectId = (form.get('project_id') || '').toString().trim();
  if (!projectId) return json({ error: 'project_id_required' }, 400, env);

  const projectName = (form.get('project_name') || '').toString();
  const procIndex = toInt(form.get('proc_index'));
  const itemIndex = toInt(form.get('item_index'));
  const itemName = (form.get('item_name') || '').toString();
  const mpName = (form.get('mp_name') || '').toString();
  const takenAt = (form.get('taken_at') || '').toString();
  // クライアント側の写真ID（重複アップロード防止に使える）。無ければ生成。
  const photoId = (form.get('photo_id') || crypto.randomUUID()).toString();

  const contentType = file.type || 'image/jpeg';
  const r2Key = `photos/${projectId}/${photoId}.jpg`;
  const body = await file.arrayBuffer();

  await env.PHOTOS.put(r2Key, body, { httpMetadata: { contentType } });

  const now = new Date().toISOString();
  // 工事行を用意（無ければ作成、あれば名前を更新）
  await env.DB.prepare(
    `INSERT INTO projects (id, name, status, created_at, updated_at)
     VALUES (?1, ?2, 'active', ?3, ?3)
     ON CONFLICT(id) DO UPDATE SET
       name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE projects.name END,
       updated_at = ?3`
  ).bind(projectId, projectName, now).run();

  // 写真メタを保存（photo_id で冪等：再送しても重複しない）
  await env.DB.prepare(
    `INSERT INTO photos
       (id, project_id, proc_index, item_index, item_name, mp_name, taken_at, r2_key, content_type, uploaded_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
     ON CONFLICT(id) DO UPDATE SET
       proc_index=?3, item_index=?4, item_name=?5, mp_name=?6, taken_at=?7,
       r2_key=?8, content_type=?9, uploaded_at=?10`
  ).bind(photoId, projectId, procIndex, itemIndex, itemName, mpName, takenAt, r2Key, contentType, now).run();

  return json({ ok: true, photo_id: photoId, r2_key: r2Key }, 200, env);
}

/* ===== 一覧（管理者の集約ビュー用） ===== */
async function listProjects(env) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.name, p.status, p.created_at, p.updated_at,
            COUNT(ph.id) AS photo_count
       FROM projects p
       LEFT JOIN photos ph ON ph.project_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC`
  ).all();
  return json({ projects: results || [] }, 200, env);
}

async function listProjectPhotos(projectId, env) {
  const { results } = await env.DB.prepare(
    `SELECT id, project_id, proc_index, item_index, item_name, mp_name, taken_at, content_type, uploaded_at
       FROM photos
      WHERE project_id = ?1
      ORDER BY proc_index, item_index, uploaded_at`
  ).bind(projectId).all();
  return json({ project_id: projectId, photos: results || [] }, 200, env);
}

/* ===== 写真の実体を返す ===== */
async function getPhoto(photoId, env) {
  const row = await env.DB.prepare(
    `SELECT r2_key, content_type FROM photos WHERE id = ?1`
  ).bind(photoId).first();
  if (!row) return json({ error: 'not_found' }, 404, env);

  const obj = await env.PHOTOS.get(row.r2_key);
  if (!obj) return json({ error: 'object_missing' }, 404, env);

  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': row.content_type || 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
      ...corsHeaders(env),
    },
  });
}

/* ===== 状態変更（active / done） ===== */
async function setProjectStatus(projectId, request, env) {
  const data = await request.json().catch(() => ({}));
  const status = (data.status || '').toString();
  if (status !== 'active' && status !== 'done') {
    return json({ error: 'invalid_status' }, 400, env);
  }
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    `UPDATE projects SET status = ?2, updated_at = ?3 WHERE id = ?1`
  ).bind(projectId, status, now).run();
  return json({ ok: true, changed: res.meta ? res.meta.changes : undefined }, 200, env);
}

/* ===== 完了後のクリーンアップ（Step5で使用） ===== */
async function deleteProject(projectId, env) {
  // R2 の写真をすべて削除
  let cursor;
  do {
    const listed = await env.PHOTOS.list({ prefix: `photos/${projectId}/`, cursor });
    for (const o of listed.objects) {
      await env.PHOTOS.delete(o.key);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  // D1 のメタも削除
  await env.DB.prepare(`DELETE FROM photos WHERE project_id = ?1`).bind(projectId).run();
  await env.DB.prepare(`DELETE FROM projects WHERE id = ?1`).bind(projectId).run();

  return json({ ok: true, deleted_project: projectId }, 200, env);
}

/* ===== ユーティリティ ===== */
function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
