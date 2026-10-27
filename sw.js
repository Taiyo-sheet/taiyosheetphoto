// 施工看板：電波のない現場でも、一度開いたことがあれば起動できるようにする（Service Worker）
//
// 「古い画面が残る」を防ぐ作り
//  ・画面（index.html）は「ネットを先に見る」。つながっていれば、いつも最新を表示して保存し直す
//  ・つながらない（または4秒返事がない）ときだけ、保存した画面を出す
//  ・外部の部品（文字の形・ZIP・PDF 用）は、はじめて使ったときに保存する
//  ・写真・工事の記録は、この仕組みとは別（端末の IndexedDB / localStorage）。ここでは触らない
// 画面の作りを大きく変えたときは、CACHE の番号を上げる（古い保存を消す）
const CACHE = 'kanban-v1';
const PAGE_TIMEOUT_MS = 4000;
const EXTERNAL = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(new Request('./', { cache: 'reload' }))).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 画面：ネット優先、だめなら保存した画面
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const net = fetch(new Request(req, { cache: 'no-cache' })).then(async (res) => {
        if (res && res.ok && res.type === 'basic') await cache.put('./', res.clone());
        return res;
      });
      try {
        return await Promise.race([net, new Promise((_, ng) => setTimeout(() => ng(new Error('timeout')), PAGE_TIMEOUT_MS))]);
      } catch (e) {
        const saved = await cache.match('./') || await cache.match(req);
        if (saved) { net.catch(() => {}); return saved; }
        return net; // 保存がまだないときは、ネットの返事をそのまま待つ
      }
    })());
    return;
  }

  // 外部の部品：保存があればそれを使い、なければ取りに行って保存する（URL に版が入っているので、古くならない）
  if (EXTERNAL.includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch (e) {
        return hit || Response.error();
      }
    })());
  }
});
