// Il pezzo che fa funzionare l'applicazione senza rete.
//
// Serve a una cosa sola, ed e' la sera dell'asta: il programma deve aprirsi
// **sempre**, anche se il wifi della stanza e' quello che e'. I file
// dell'applicazione vengono messi da parte alla prima visita e da li' in poi
// si leggono da li'; i dati dei giocatori stanno gia' nel telefono per conto
// loro (`localStorage`), quindi non passano da qui.
//
// Nell'applicazione Android tutto questo non serve - i file sono gia' dentro
// l'apk - ma non da' fastidio, ed e' quello che rende la stessa cartella
// installabile anche dal browser.

const VERSIONE = 'fantahacked-1';
const MIEI = [
  './',
  './index.html',
  './stile.css',
  './app.js',
  './regole_lega.json',
  './manifesto.webmanifest',
  './motore/comune.js',
  './motore/regole.js',
  './motore/modificatore.js',
  './motore/asta.js',
  './motore/dati.js',
  './motore/valutazione.js',
  './motore/ottimizzatore.js',
  './motore/strategia.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSIONE).then((c) => c.addAll(MIEI)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((chiavi) => Promise.all(
    chiavi.filter((k) => k !== VERSIONE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // I dati pubblicati non si mettono da parte qui: ci pensa l'applicazione,
  // che sa anche **quando** vale la pena riscaricarli. Metterli in due posti
  // vorrebbe dire non sapere piu' quale dei due e' il piu' recente.
  if (url.origin !== self.location.origin) return;

  // Prima la rete, poi la copia: cosi' un aggiornamento dell'applicazione
  // arriva subito, e se la rete non c'e' si usa quello che si ha.
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r && r.ok && e.request.method === 'GET') {
          const copia = r.clone();
          caches.open(VERSIONE).then((c) => c.put(e.request, copia));
        }
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
