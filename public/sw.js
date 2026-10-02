// Chỉ cache giao diện (app shell). Không bao giờ cache API hay file văn bản.
const CACHE = 'qlvb-shell-v11';
// ngrok (gói free) chèn trang cảnh báo trước request từ trình duyệt; header này bỏ qua trang đó.
const SKIP_WARNING = { 'ngrok-skip-browser-warning': '1' };
const SHELL = ['/', '/index.html', '/app.css', '/js/app.js', '/js/store.js', '/js/egov1.js', '/js/csdlvb.js', '/js/zip.js', '/js/egov-work.js', '/js/progress.js', '/js/navigation.js', '/js/xlc.js',
  '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { headers: SKIP_WARNING })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Mạng trước (luôn có bản mới), mất mạng thì dùng cache.
  e.respondWith(
    fetch(e.request.url, { headers: SKIP_WARNING, credentials: 'same-origin' })
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))),
  );
});
