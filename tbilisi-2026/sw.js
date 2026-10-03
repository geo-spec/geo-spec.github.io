/* Офлайн для «Тбилиси в кармане»: оболочка сайта, тайлы карты и прогноз. */
var V = 'tb-v3';
var SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'data.js', 'routes.js', 'manifest.json',
  'vendor/leaflet.js', 'vendor/leaflet.css',
  'fonts/golos-cyr.woff2', 'fonts/golos-lat.woff2', 'fonts/golos-latext.woff2',
  'fonts/yeseva-cyr.woff2', 'fonts/yeseva-lat.woff2', 'fonts/noto-georgian.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(V).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== V && k !== 'tb-tiles' && k !== 'tb-wx'; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});


self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  if (url.hostname === 'server.arcgisonline.com' && url.pathname.indexOf('/tile/') > 0) {
    var key = req.url;
    e.respondWith(caches.open('tb-tiles').then(function (c) {
      return c.match(key).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res.ok && res.type !== 'opaque') c.put(key, res.clone());
          return res;
        });
      });
    }));
    return;
  }

  if (url.hostname === 'api.open-meteo.com') {
    e.respondWith(fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open('tb-wx').then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return caches.open('tb-wx').then(function (c) { return c.match(req); }).then(function (r) { return r || Response.error(); }); }));
    return;
  }

  if (url.origin !== self.location.origin) return;

  /* своё: сначала кэш, в фоне обновляем */
  var isNav = req.mode === 'navigate';
  e.respondWith(caches.open(V).then(function (c) {
    var lookup = isNav ? c.match('index.html') : c.match(req, { ignoreSearch: true });
    return lookup.then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res.ok && res.type === 'basic') c.put(isNav ? 'index.html' : req, res.clone());
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    });
  }));
});
