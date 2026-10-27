/*
 * 施工写真台帳アプリ Service Worker
 * -------------------------------------------------
 * 方針：ネットワーク優先（network-first）
 *   - オンライン時：常に最新を取得して表示（キャッシュも更新）
 *     → 「古い画面が残り続ける」問題を避ける
 *   - オフライン時：直近に取得したキャッシュを表示
 *     → 電波が無い場所でも、一度開いたことがあれば起動できる
 * 対象：同一オリジンのGETのみ（CDN等の外部リソースは素通し）
 */
const CACHE = 'taiyosheet-cache-v1';

self.addEventListener('install', function (event) {
  // 新しいSWをすぐ有効化
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    // 古いバージョンのキャッシュを削除
    const keys = await caches.keys();
    await Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // 同一オリジンのみ扱う

  event.respondWith((async function () {
    try {
      // ネットワーク優先
      const res = await fetch(req);
      if (res && res.status === 200 && res.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      // オフライン時はキャッシュで代替
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const idx = await caches.match('./') || await caches.match('index.html');
        if (idx) return idx;
      }
      throw err;
    }
  })());
});
