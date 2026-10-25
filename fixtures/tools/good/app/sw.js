const VERSION = 'app-v1';
const SHELL = ['./', 'index.html'];
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('app-') && k !== VERSION).map(k => caches.delete(k))))));
