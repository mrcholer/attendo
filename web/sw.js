const CACHE='xattendo-v6-shell-7';
const SHELL=['/index.html','/style.css','/app.js','/theme.js','/campus.js','/ui.js','/manifest.webmanifest','/icon-192.png','/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('xattendo-v6-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 const navigation=req.mode==='navigate'&&['/','/index.html'].includes(url.pathname);
 if(!navigation&&!SHELL.includes(url.pathname))return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE),key=navigation?'/index.html':url.pathname;
  try{const res=await fetch(req,{cache:'no-store'});if(res.ok)await cache.put(key,res.clone());return res}catch{const cached=await cache.match(key);return cached||new Response('App shell unavailable',{status:503,headers:{'Content-Type':'text/plain'}})}
 })());
});
