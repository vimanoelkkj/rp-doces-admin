const CACHE='rp-doces-shell-v3';
const SHELL=['/','/manifest.webmanifest','/pwa-192.png','/pwa-512.png'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  const url=new URL(req.url);

  // Nunca cachear API, admin, métodos de escrita ou origem externa.
  if(req.method!=='GET' || url.origin!==self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin/')){
    return;
  }

  // Network-first: evita conteúdo antigo; cache serve só como fallback offline.
  event.respondWith(
    fetch(req).then(res=>{
      if(res.ok){
        const copy=res.clone();
        caches.open(CACHE).then(cache=>cache.put(req,copy));
      }
      return res;
    }).catch(()=>caches.match(req).then(r=>r || caches.match('/')))
  );
});

self.addEventListener('push', event => {
  let data={};
  try { data=event.data ? event.data.json() : {}; } catch { data={body:event.data?.text?.()||''}; }
  event.waitUntil(self.registration.showNotification(data.title || 'R&P Doces', {
    body:data.body || 'Você recebeu uma nova atualização.',
    icon:'/pwa-192.png',
    badge:'/admin-favicon.png',
    tag:data.tag || 'rp-doces',
    renotify:true,
    data:{url:data.url || '/admin/'}
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target=new URL(event.notification.data?.url || '/admin/', self.location.origin).href;
  event.waitUntil((async()=>{
    const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){
      if(new URL(client.url).origin===self.location.origin){ await client.navigate(target); return client.focus(); }
    }
    return clients.openWindow(target);
  })());
});
