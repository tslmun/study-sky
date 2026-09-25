// Study Sky service worker: keeps the app working offline.
const CACHE = "study-sky-v2";
const SHELL = ["./", "./index.html", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== "study-sky-data").map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Live weather always comes from the network.
  if (url.hostname === "api.open-meteo.com") return;

  // Fonts: use the saved copy, refresh it in the background.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  if (url.origin !== location.origin) return;

  // The page itself: try the network first so updates arrive, fall back to the saved copy offline.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(r => {
      const copy = r.clone(); caches.open(CACHE).then(c => c.put("./index.html", copy)); return r;
    }).catch(() => caches.match("./index.html")));
    return;
  }

  // Everything else: saved copy first.
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return r;
  })));
});

// ---------- Reminders in the background (Android Chrome, when the phone allows it) ----------
async function readJSON(name, fallback){
  try { const c = await caches.open("study-sky-data"); const r = await c.match(name); return r ? await r.json() : fallback; }
  catch(e){ return fallback; }
}
function daysUntil(due){
  const [y, m, d] = due.split("-").map(Number);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - t) / 86400000);
}
async function backgroundCheck(){
  const tasks = await readJSON("./__tasks.json", []);
  const sent = await readJSON("./__sent.json", {});
  const hour = new Date().getHours();
  for (const t of tasks) {
    const n = daysUntil(t.due);
    if (n >= 1 && n <= 3 && !sent[t.id + ":3"]) {
      await self.registration.showNotification(n === 1 ? "Due tomorrow" : `${n} days left`, { body: `${t.title} (${t.course})`, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: t.id + ":3" });
      sent[t.id + ":3"] = Date.now();
    }
    if (n === 0 && hour >= 7 && !sent[t.id + ":0"]) {
      await self.registration.showNotification("Due today!", { body: `${t.title} (${t.course}). You've got this.`, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: t.id + ":0" });
      sent[t.id + ":0"] = Date.now();
    }
  }
  const c = await caches.open("study-sky-data");
  await c.put("./__sent.json", new Response(JSON.stringify(sent)));
}
self.addEventListener("periodicsync", e => {
  if (e.tag === "study-sky-reminders") e.waitUntil(backgroundCheck());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const w of list) if ("focus" in w) return w.focus();
    return self.clients.openWindow("./");
  }));
});
