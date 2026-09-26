'use strict';
const VERSION = 'bai8-pwa-v1';
const SHELL_CACHE = VERSION + '-shell';
const VIDEO_CACHE = VERSION + '-video';
const VIDEO_FILE = 'BAI_8_THU_DIEN_TU.mp4';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png'
];
const videoURL = new URL('./' + VIDEO_FILE, self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => ![SHELL_CACHE, VIDEO_CACHE].includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function notify(status) {
  const clients = await self.clients.matchAll({type:'window', includeUncontrolled:true});
  clients.forEach(client => client.postMessage({type:'VIDEO_CACHE_STATUS', status}));
}

async function cacheVideo() {
  const cache = await caches.open(VIDEO_CACHE);
  const existing = await cache.match(videoURL);
  if (existing) { await notify('cached'); return; }
  await notify('caching');
  try {
    const response = await fetch(videoURL, {cache:'no-store'});
    if (!response.ok) throw new Error('HTTP ' + response.status);
    await cache.put(videoURL, response.clone());
    await notify('cached');
  } catch (e) {
    await notify('error');
  }
}

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'CACHE_VIDEO') event.waitUntil(cacheVideo());
});

function parseRange(range, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range || '');
  if (!m) return null;
  let start = m[1] ? Number(m[1]) : null;
  let end = m[2] ? Number(m[2]) : null;
  if (start === null && end !== null) {
    const suffix = Math.min(end, size);
    start = size - suffix; end = size - 1;
  } else {
    if (start === null) start = 0;
    if (end === null || end >= size) end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= size) return null;
  return {start, end};
}

async function serveVideo(request) {
  const cache = await caches.open(VIDEO_CACHE);
  const cached = await cache.match(videoURL);
  const rangeHeader = request.headers.get('range');
  if (!cached) return fetch(request);
  if (!rangeHeader) return cached;
  const blob = await cached.blob();
  const range = parseRange(rangeHeader, blob.size);
  if (!range) return new Response(null, {status:416, headers:{'Content-Range':'bytes */' + blob.size}});
  const chunk = blob.slice(range.start, range.end + 1, blob.type || 'video/mp4');
  return new Response(chunk, {
    status:206,
    statusText:'Partial Content',
    headers:{
      'Content-Type': blob.type || 'video/mp4',
      'Content-Length': String(range.end - range.start + 1),
      'Content-Range': 'bytes ' + range.start + '-' + range.end + '/' + blob.size,
      'Accept-Ranges':'bytes'
    }
  });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/' + VIDEO_FILE)) {
    event.respondWith(serveVideo(req));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(res => {
      const copy = res.clone(); caches.open(SHELL_CACHE).then(c => c.put('./index.html', copy)); return res;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(res => {
    if (res.ok) { const copy=res.clone(); caches.open(SHELL_CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
