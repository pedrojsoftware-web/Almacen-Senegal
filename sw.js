// Service worker: guarda la "carcasa" de la app para que abra rápido y sin cobertura.
// Los datos los sincroniza Firebase; esto no los guarda.
const CACHE = "almacen-v1";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Solo archivos de la propia web: primero la red (para coger cambios), si no hay red, la copia guardada.
  if (url.origin !== location.origin || url.pathname.endsWith("datos-iniciales.json")) return;
  e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return r; })
    .catch(() => caches.match(req).then(r => r || caches.match("index.html"))));
});
