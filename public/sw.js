// API snapshots and source belong to the device's revision-aware IndexedDB store.
// Never cache authenticated requests or turn failed API responses into app HTML.
const CACHE = 'xpositor-shell-v16';
const APP_SHELL = ['/', '/index.html', '/src/main.js', '/src/storage.js', '/src/render.js', '/src/demo.js', '/src/walkthrough.js', '/src/deep-review.js', '/src/deep-audio.js', '/src/agent-guide.js', '/src/audio-lesson.js', '/src/speech-timing.js', '/src/transport.js', '/src/platform.js', '/src/focus-timer.js', '/src/mindfulness.js', '/src/preparation.js', '/src/styles.css', '/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  // Activate on the next navigation after existing tabs close; don't replace a running app.
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => (key.startsWith('xpositor-') || key.startsWith('patchwork-')) && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || !APP_SHELL.includes(url.pathname)) return;
  // Network-first shell ensures a reachable laptop supplies the current module set.
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok && !url.search) event.waitUntil(caches.open(CACHE).then((cache) => cache.put(url.pathname, response.clone())));
    return response;
  }).catch(async () => {
    const cached = await caches.match(url.pathname);
    return cached || new Response('Xpositor shell unavailable offline. Open the laptop link once while connected.', { status:503, headers:{'content-type':'text/plain'} });
  }));
});
