// FantaHacked per telefono: l'interfaccia.
//
// Il motore e' lo stesso del computer, tradotto in JavaScript e verificato
// numero per numero contro quello Python (`prove/equivalenza.html`). Qui c'e'
// soltanto quello che si vede e si tocca.
//
// Una scelta di fondo: **l'asta non esce da questo telefono.** Sta in
// `localStorage` e si salva a ogni acquisto. I dati dei giocatori invece si
// scaricano, e se la rete non c'e' si usa quello che c'e' gia': in una stanza
// d'asta il wifi fa quello che vuole, e un assistente che non si apre e'
// peggio di uno con i dati di tre giorni fa.

import { carica as caricaRegole } from './motore/regole.js';
import { apri as apriDati, ORIGINE } from './motore/dati.js';
import { StatoAsta, DepositoLocale, ErroreAsta } from './motore/asta.js';
import { Valutatore } from './motore/valutazione.js';
import { Ottimizzatore } from './motore/ottimizzatore.js';
import { Consigliere, nomeSingolare } from './motore/strategia.js';

const RUOLI = ['P', 'D', 'C', 'A'];
const NOME_RUOLO = { P: 'Portieri', D: 'Difensori', C: 'Centrocampisti', A: 'Attaccanti' };
const CHIAVE_NOMI = 'fantahacked.nomi';

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t === null || t === undefined ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const app = {
  dati: null, regole: null, stato: null,
  v: null, o: null, c: null,
  esitoDati: null, scelto: null, ruoloFiltro: '',
  presidenteScelto: null,
};

// ------------------------------------------------------------------ avvio
async function avvia() {
  $('#avvio-stato').textContent = 'cerco i dati piu’ recenti…';
  const esito = await apriDati();
  app.esitoDati = esito;
  if (!esito.dati) {
    return fermaAvvio(esito.stato === 'troppo_nuovi'
      ? esito.nota
      : 'Non ho i dati dei giocatori e non riesco a scaricarli. '
        + 'Serve internet solo la prima volta.');
  }
  app.dati = esito.dati;

  // Le regole arrivano **dentro il pacchetto**, insieme alle proiezioni.
  // Sono la stessa cosa: le proiezioni dipendono dal regolamento, e questa
  // applicazione non sa rifarle - porta il motore di valutazione, non quello
  // delle proiezioni. Con regole diverse da quelle che hanno prodotto quei
  // numeri mostrerebbe cifre sbagliate senza accorgersene, quindi le due cose
  // devono arrivare insieme o non arrivare. La copia locale serve solo a un
  // pacchetto vecchio, di prima che le regole ci viaggiassero dentro.
  try {
    const regoleJson = app.dati.regole
      || await (await fetch('regole_lega.json', { cache: 'no-store' })).json();
    app.regole = caricaRegole(regoleJson);
  } catch (e) {
    return fermaAvvio('Non riesco a leggere le regole della lega: ' + e.message);
  }

  const deposito = new DepositoLocale();
  app.stato = new StatoAsta(app.regole, deposito);
  app.stato.collega(new Map(app.dati.giocatori.map((g) => [g.id, g])));
  const salvata = deposito.leggi();
  if (salvata) app.stato.carica(salvata);

  if (app.stato.esiste()) { ricalcola(); mostra('principale'); }
  else preparaNuova();
}

function fermaAvvio(messaggio) {
  $('#avvio-stato').textContent = messaggio;
  $('#avvio-riprova').classList.remove('nascosto');
}

function mostra(quale) {
  for (const s of document.querySelectorAll('.schermo')) s.classList.remove('attivo');
  $('#schermo-' + quale).classList.add('attivo');
}

// ------------------------------------------------------------- nuova asta
function nomiSalvati() {
  try {
    const t = window.localStorage.getItem(CHIAVE_NOMI);
    if (t) return JSON.parse(t);
  } catch (e) { /* niente */ }
  return ['Io'];
}

function preparaNuova() {
  const salvati = nomiSalvati();
  const n = app.regole.partecipanti;
  const campi = $('#campi-nomi');
  campi.innerHTML = '';
  for (let i = 0; i < n; i += 1) {
    const d = document.createElement('div');
    d.className = 'campo-nome' + (i === 0 ? ' mia' : '');
    d.innerHTML = '<span class="n">' + (i === 0 ? 'tu' : (i + 1)) + '</span>'
      + '<input type="text" autocomplete="off" value="' + esc(salvati[i] || '')
      + '" placeholder="' + (i === 0 ? 'la tua squadra' : 'squadra ' + (i + 1)) + '">';
    campi.appendChild(d);
  }
  const r = app.regole;
  $('#nuova-regole').textContent = r.partecipanti + ' squadre, ' + r.crediti
    + ' crediti, rosa ' + r.slot.P + 'P ' + r.slot.D + 'D ' + r.slot.C + 'C '
    + r.slot.A + 'A' + (r.mod_dif_attivo ? ', modificatore di difesa attivo' : '');
  $('#btn-annulla-nuova').classList.toggle('nascosto', !app.stato.esiste());
  mostra('nuova');
}

function creaAsta() {
  const campi = [...document.querySelectorAll('#campi-nomi input')];
  const nomi = campi.map((c, i) => c.value.trim() || (i === 0 ? 'Io' : 'Squadra ' + (i + 1)));
  try { window.localStorage.setItem(CHIAVE_NOMI, JSON.stringify(nomi)); }
  catch (e) { /* niente */ }
  app.stato.inizializza(nomi.slice(1), nomi[0]);
  ricalcola();
  mostra('principale');
  brindisi('Asta aperta. In bocca al lupo.');
}

// -------------------------------------------------------------- ricalcolo
function ricalcola() {
  const t0 = performance.now();
  app.v = new Valutatore(app.dati, app.regole, app.stato);
  app.o = new Ottimizzatore(app.v);
  app.c = new Consigliere(app.v, app.o);
  app.ms = Math.round(performance.now() - t0);
  disegnaBarra();
  disegnaConsiglio();
  disegnaRosa();
  if ($('#pannello-cerca').classList.contains('attivo')) cerca();
}

function disegnaBarra() {
  const io = app.stato.io();
  $('#miei-crediti').textContent = io.crediti;
  $('#miei-slot').textContent = app.stato.slotResidui(io.id);
  const fase = app.c.fase();
  $('#barra-fase').textContent = fase ? NOME_RUOLO[fase].toUpperCase() : 'FINITA';
}

// ------------------------------------------------------------- i consigli
function disegnaConsiglio() {
  const cons = app.c.consiglio(12);
  $('#indicazione').textContent = cons.indicazione;

  const sc = $('#scarsita');
  sc.textContent = cons.scarsita || '';
  sc.classList.toggle('nascosto', !cons.scarsita);

  const box = $('#coppie');
  if (cons.coppie && cons.coppie.length) {
    box.classList.remove('nascosto');
    box.innerHTML = '<h4>Maglie da chiudere</h4>'
      + cons.coppie.map((d) => rigaHtml(d, {
        cifra: d.max_bid, etichetta: 'limite',
        sotto: d.perche,
      })).join('');
    collega(box, cons.coppie);
  } else {
    box.classList.add('nascosto');
  }

  // Quando il limite e' zero la cifra da mostrare non e' lo zero: sarebbe una
  // riga che dice «e' il ripiego» con accanto un numero che dice «mai», e a
  // colpo d'occhio sembrano due indicazioni opposte. Si mostra invece quanto
  // dovrebbe chiudere, in grigio e con la tilde - la stessa convenzione del
  // programma per computer - e la frase sotto dice quando quel limite smette
  // di essere zero.
  riempi('#lista-top', cons.top, cons.vuoti.top, (d) => (
    d.max_bid > 0
      ? { cifra: d.max_bid, etichetta: 'limite', sotto: d.perche || d.frase }
      : { cifra: '~' + d.chiusura, etichetta: 'chiude a', stimata: true,
          sotto: d.perche || d.frase }));
  $('#conta-top').textContent = cons.top.length
    ? '(' + cons.top.length + ')' : '';
  riempi('#lista-alt', cons.alternative, cons.vuoti.alternative, (d) => ({
    cifra: d.chiusura, etichetta: 'chiude a', sotto: d.perche || d.frase,
  }));
  riempi('#lista-svuota', cons.svuotare, cons.vuoti.svuotare, (d) => ({
    cifra: d.brucia, etichetta: 'spingi a', sotto: d.perche || d.frase,
  }));
  riempi('#lista-evita', cons.evitare, cons.vuoti.evitare, (d) => ({
    cifra: d.chiusura, etichetta: 'chiude a', sotto: d.perche || d.frase,
  }));
}

function riempi(sel, lista, frasePerVuoto, comeCifra) {
  const el = $(sel);
  if (!lista || !lista.length) {
    el.innerHTML = '<p class="vuota">'
      + esc(frasePerVuoto || 'Niente da segnalare.') + '</p>';
    return;
  }
  el.innerHTML = lista.map((d) => rigaHtml(d, comeCifra(d))).join('');
  collega(el, lista);
}

function rigaHtml(d, cfg) {
  const x = app.v.g.get(d.id);
  const fuori = x && x.fuori_lista;
  return '<button class="riga ' + esc(d.colore || '') + '" data-id="' + d.id + '">'
    + '<div class="riga-testo">'
    + '<div class="riga-nome">' + esc(d.nome)
    + '<span class="squadra">' + esc(d.squadra) + '</span>'
    + (fuori ? '<span class="marchietto fuori">fuori lista</span>' : '')
    + (x && x.rigorista === 1 ? '<span class="marchietto rig">rig</span>' : '')
    + '</div>'
    + '<div class="riga-sotto">' + esc(cfg.sotto || '') + '</div>'
    + '</div>'
    + '<div class="riga-cifra ' + esc(d.colore || '')
    + (cfg.stimata ? ' stimata' : '') + '">'
    + '<b>' + cfg.cifra + '</b><span>' + esc(cfg.etichetta) + '</span></div>'
    + '</button>';
}

function collega(contenitore) {
  for (const b of contenitore.querySelectorAll('.riga')) {
    b.addEventListener('click', () => apriScheda(parseInt(b.dataset.id, 10)));
  }
}

// ------------------------------------------------------------------ cerca
function cerca() {
  const testo = $('#campo-cerca').value.trim();
  const el = $('#risultati');
  let lista;
  if (testo.length >= 1) {
    lista = app.v.cerca(testo);
  } else {
    lista = app.v.disponibili(app.ruoloFiltro || null, 40);
  }
  if (app.ruoloFiltro) lista = lista.filter((x) => x.ruolo === app.ruoloFiltro);
  lista = lista.slice(0, 60);
  if (!lista.length) {
    el.innerHTML = '<p class="vuota">Nessuno con questo nome fra chi e’ ancora libero.</p>';
    return;
  }
  el.innerHTML = lista.map((x) => {
    const g = x.grado ? (x.grado[0].toUpperCase() + x.grado.slice(1)) : 'Da verificare';
    return '<button class="riga" data-id="' + x.id + '">'
      + '<div class="riga-testo"><div class="riga-nome">' + esc(x.nome)
      + '<span class="squadra">' + esc(x.squadra) + ' · ' + x.ruolo + '</span>'
      + (x.fuori_lista ? '<span class="marchietto fuori">fuori lista</span>' : '')
      + '</div><div class="riga-sotto">' + esc(g) + ', '
      + Math.round(x.presenze) + ' presenze attese</div></div>'
      + '<div class="riga-cifra"><b>' + Math.round(x.prezzo_atteso || 1)
      + '</b><span>costera’</span></div></button>';
  }).join('');
  collega(el);
}

// ----------------------------------------------------------------- scheda
function apriScheda(id) {
  const x = app.v.g.get(id);
  if (!x) return;
  app.scelto = x;
  const venduto = app.stato.venduti().has(id);
  const d = app.c.decisione(x);
  const ger = d.gerarchia || {};
  const conc = app.v.concorrenti(x);

  let html = '<div class="scheda-testa">'
    + '<div class="scheda-nome">' + esc(x.nome) + '</div>'
    + '<div class="scheda-sotto">' + esc(x.squadra) + ' · '
    + nomeSingolare(x.ruolo)
    + (x.rigorista === 1 ? ' · rigorista' : '') + '</div></div>';

  if (venduto) {
    const a = app.stato.acquisti().find((y) => y.giocatore_id === id);
    const chi = a ? (app.stato.presidenti().find((p) => p.id === a.presidente_id) || {}).nome : '';
    html += '<span class="verdetto stop">GIÀ VENDUTO</span>'
      + '<p class="frase">Preso da <b>' + esc(chi) + '</b> per <b>'
      + (a ? a.prezzo : '?') + '</b> crediti.</p>';
  } else {
    html += '<span class="verdetto ' + esc(d.colore) + '">' + esc(d.verdetto) + '</span>'
      + '<div class="numeroni">'
      + '<div class="numerone limite"><b>' + d.max_bid + '</b><span>non oltre</span></div>'
      + '<div class="numerone"><b>' + d.chiusura + '</b><span>chiude sui</span></div>'
      + '</div>'
      + '<p class="frase">' + esc(d.frase) + '</p>';
  }

  if (d.chiude_coppia) {
    html += '<div class="blocchetto buono">Hai già <b>'
      + esc(d.chiude_coppia.con) + '</b>, che salta circa <b>'
      + Math.round(d.chiude_coppia.buchi) + '</b> giornate: lui ne copre il <b>'
      + Math.round(d.chiude_coppia.copertura_buchi * 100) + '%</b>. '
      + 'Il limite qui sopra include già <b>+' + d.chiude_coppia.punti_extra
      + '</b> punti per questo.</div>';
  }

  html += '<div class="dettagli">'
    + det('Come gioca', ger.etichetta || 'Da verificare')
    + det('Presenze attese', Math.round(x.presenze) + ' su 38')
    + det('Fantamedia attesa', (x.fm || 0).toFixed(2))
    + det('Punti di stagione', Math.round((x.presenze || 0) * (x.fm || 0)))
    + det('Quotazione', x.qi)
    + det('Prezzo di listino', Math.round(x.prezzo_base || 1) + ' crediti')
    + (conc.length ? det('Chi può rilanciare', conc.length + ' avversari')
                   : det('Chi può rilanciare', 'nessuno'))
    + '</div>';

  if (ger.testo) html += '<div class="blocchetto">' + esc(ger.testo) + '</div>';

  const compagni = app.v.compagniDiMaglia(id)
    .filter((c) => !app.stato.venduti().has(c.altro));
  if (compagni.length) {
    const c0 = compagni[0];
    const altro = app.v.g.get(c0.altro);
    if (altro) {
      html += '<div class="blocchetto">Si divide la maglia con <b>'
        + esc(altro.nome) + '</b>: presi insieme coprono il <b>'
        + Math.round(c0.copertura * 100) + '%</b> della stagione.</div>';
    }
  }

  if (!venduto) {
    html += '<div class="azioni">'
      + '<button class="bottone primario" id="btn-preso-io">L’ho preso io</button>'
      + '<button class="bottone secondario" id="btn-preso-altro">Preso da…</button>'
      + '</div>';
  } else {
    html += '<button class="bottone piatto" id="btn-annulla-questo">'
      + 'Annulla questo acquisto</button>';
  }

  $('#scheda-contenuto').innerHTML = html;
  $('#scheda').hidden = false;
  const io = $('#btn-preso-io');
  if (io) io.addEventListener('click', () => apriRegistra(x, app.stato.io().id, d));
  const altro = $('#btn-preso-altro');
  if (altro) altro.addEventListener('click', () => apriRegistra(x, null, d));
  const ann = $('#btn-annulla-questo');
  if (ann) {
    ann.addEventListener('click', () => {
      app.stato.annulla(id);
      chiudiTutto(); ricalcola(); brindisi('Acquisto annullato.');
    });
  }
}

function det(chiave, valore) {
  return '<div class="d"><span>' + esc(chiave) + '</span><b>' + esc(valore) + '</b></div>';
}

// ---------------------------------------------------------- registrazione
function apriRegistra(x, presidenteId, decisione) {
  app.scelto = x;
  app.presidenteScelto = presidenteId;
  $('#registra-titolo').textContent = x.nome;
  const el = $('#registra-presidenti');
  el.innerHTML = app.stato.presidenti().map((p) => {
    const pieno = app.stato.slotResidui(p.id, x.ruolo) <= 0;
    return '<button data-id="' + p.id + '"' + (pieno ? ' disabled' : '')
      + ' class="' + (p.id === presidenteId ? 'scelto' : '') + '">'
      + esc(p.nome) + (pieno ? ' — pieno' : ' · ' + p.crediti) + '</button>';
  }).join('');
  for (const b of el.querySelectorAll('button')) {
    b.addEventListener('click', () => {
      app.presidenteScelto = parseInt(b.dataset.id, 10);
      for (const y of el.querySelectorAll('button')) y.classList.remove('scelto');
      b.classList.add('scelto');
      aggiornaNotaRegistra();
    });
  }
  const suggerito = decisione
    ? Math.max(1, Math.min(decisione.consigliato || decisione.chiusura || 1,
                           decisione.chiusura || 1))
    : 1;
  $('#registra-prezzo').value = Math.max(1, suggerito);
  aggiornaNotaRegistra();
  $('#scheda').hidden = true;
  $('#registra').hidden = false;
}

function aggiornaNotaRegistra() {
  const x = app.scelto;
  if (!x) return;
  const pid = app.presidenteScelto;
  const nota = $('#registra-nota');
  if (!pid) { nota.textContent = 'Scegli chi se l’è aggiudicato.'; return; }
  const liq = app.stato.liquidita(pid);
  const p = app.stato.presidenti().find((y) => y.id === pid);
  nota.textContent = p.nome + ' può arrivare a ' + liq
    + ' crediti tenendone uno per ogni slot che gli resta.';
}

function conferma() {
  const x = app.scelto;
  const pid = app.presidenteScelto;
  if (!x) return;
  if (!pid) { brindisi('Scegli chi se l’è preso.'); return; }
  const prezzo = parseInt($('#registra-prezzo').value, 10);
  if (!(prezzo >= 1)) { brindisi('Il prezzo minimo è 1.'); return; }
  let limite = null;
  try { limite = app.o.maxBid(x)[0]; } catch (e) { /* niente */ }
  try {
    app.stato.registra(x.id, pid, prezzo, limite);
  } catch (e) {
    brindisi(e instanceof ErroreAsta ? e.message : String(e.message || e));
    return;
  }
  // Coi portieri a pacchetto, il titolare si porta dietro le riserve a un
  // credito: registrarle a mano ogni volta sarebbe tre gesti invece di uno,
  // e dimenticarsene falserebbe gli slot di tutti.
  if (app.v.pacchetto && x.ruolo === 'P' && x.titolare_por) {
    for (const rid of app.v.riserveDi(x.id)) {
      if (app.stato.slotResidui(pid, 'P') <= 0) break;
      try { app.stato.registra(rid, pid, 1, null); } catch (e) { /* pieno */ }
    }
  }
  chiudiTutto();
  ricalcola();
  brindisi(x.nome + ' a ' + prezzo + ' crediti.');
}

// ------------------------------------------------------------------ rosa
function disegnaRosa() {
  const io = app.stato.io();
  const piano = app.o.piano();
  const acquisti = app.stato.acquisti().filter((a) => a.presidente_id === io.id);
  const spesi = acquisti.reduce((s, a) => s + a.prezzo, 0);

  $('#riepilogo-rosa').innerHTML = '<div class="dettagli">'
    + det('Crediti rimasti', io.crediti)
    + det('Già spesi', spesi)
    + det('Slot da riempire', app.stato.slotResidui(io.id))
    + det('Puoi offrire fino a', app.stato.liquidita(io.id))
    + (piano.avanzo !== undefined
        ? det('Il piano ne lascerebbe', piano.avanzo + ' non spesi') : '')
    + '</div>';

  const perRuolo = { P: [], D: [], C: [], A: [] };
  for (const a of acquisti) {
    const x = app.v.g.get(a.giocatore_id);
    if (x) perRuolo[x.ruolo].push({ x, prezzo: a.prezzo });
  }
  $('#mia-rosa').innerHTML = RUOLI.map((r) => {
    const suoi = perRuolo[r];
    const pia = (piano.per_ruolo || {})[r] || {};
    return '<div class="reparto"><div class="reparto-testa"><span>'
      + NOME_RUOLO[r] + ' ' + suoi.length + '/' + app.regole.slot[r] + '</span>'
      + '<span>' + (pia.crediti ? pia.crediti + ' crediti nel piano' : '') + '</span>'
      + '</div>'
      + (suoi.length
        ? '<div class="tabellina">' + suoi
            .sort((a, b) => b.prezzo - a.prezzo)
            .map((s) => '<div class="r"><span>' + esc(s.x.nome)
              + ' <span class="sec">' + esc(s.x.squadra) + '</span></span><b>'
              + s.prezzo + '</b></div>').join('') + '</div>'
        : '<p class="vuota">Ancora nessuno.</p>')
      + '</div>';
  }).join('');

  $('#altri-presidenti').innerHTML = app.stato.presidenti().map((p) =>
    '<div class="r' + (p.io ? ' io' : '') + '"><span>' + esc(p.nome)
    + ' <span class="sec">' + (p.n_p + p.n_d + p.n_c + p.n_a) + '/'
    + app.regole.slot_totali + '</span></span><b>' + p.crediti + '</b></div>').join('');

  const ultimi = app.stato.acquisti().slice(-8).reverse();
  $('#ultimi').innerHTML = ultimi.length ? ultimi.map((a) => {
    const p = app.stato.presidenti().find((y) => y.id === a.presidente_id) || {};
    return '<button class="riga" data-id="' + a.giocatore_id + '">'
      + '<div class="riga-testo"><div class="riga-nome">' + esc(a.nome)
      + '<span class="squadra">' + esc(a.squadra) + '</span></div>'
      + '<div class="riga-sotto">' + esc(p.nome || '') + '</div></div>'
      + '<div class="riga-cifra"><b>' + a.prezzo + '</b><span>crediti</span></div>'
      + '</button>';
  }).join('') : '<p class="vuota">Nessun acquisto registrato.</p>';
  collega($('#ultimi'));
  $('#btn-annulla-ultimo').classList.toggle('nascosto', !ultimi.length);
}

// ------------------------------------------------------------- accessori
let timerBrindisi = null;
function brindisi(testo) {
  const b = $('#brindisi');
  b.textContent = testo;
  b.hidden = false;
  clearTimeout(timerBrindisi);
  timerBrindisi = setTimeout(() => { b.hidden = true; }, 2600);
}

function chiudiTutto() {
  $('#scheda').hidden = true;
  $('#registra').hidden = true;
  $('#menu').hidden = true;
}

function apriMenu() {
  const d = app.dati;
  const e = app.esitoDati || {};
  const frasi = {
    aggiornato: 'appena scaricati', gia_aggiornato: 'già aggiornati',
    offline: 'non ho potuto controllare', errore: 'controllo non riuscito',
    troppo_nuovi: 'servono una versione più recente',
  };
  $('#info-dati').innerHTML =
    det('Dati del', d.generatoIl || '—')
    + det('Giocatori', d.giocatori.length)
    + det('Ultimo controllo', frasi[e.stato] || '—')
    + (e.nota ? det('Nota', e.nota) : '')
    + det('Motore', app.ms + ' ms per ricalcolare');
  $('#menu').hidden = false;
}

async function aggiornaDati() {
  brindisi('Cerco dati più recenti…');
  const esito = await apriDati();
  app.esitoDati = esito;
  if (esito.stato === 'aggiornato' && esito.dati) {
    app.dati = esito.dati;
    app.stato.collega(new Map(app.dati.giocatori.map((g) => [g.id, g])));
    ricalcola();
    brindisi('Dati aggiornati al ' + app.dati.generatoIl + '.');
  } else if (esito.stato === 'gia_aggiornato') {
    brindisi('Hai già i dati più recenti.');
  } else {
    brindisi(esito.nota || 'Non sono riuscito a controllare.');
  }
  apriMenu();
}

// ------------------------------------------------------------- eventi
$('#avvio-riprova').addEventListener('click', () => { location.reload(); });
$('#btn-crea').addEventListener('click', creaAsta);
$('#btn-annulla-nuova').addEventListener('click', () => mostra('principale'));
$('#btn-menu').addEventListener('click', apriMenu);
$('#btn-chiudi-menu').addEventListener('click', chiudiTutto);
$('#btn-chiudi-scheda').addEventListener('click', chiudiTutto);
$('#btn-chiudi-registra').addEventListener('click', chiudiTutto);
$('#btn-conferma').addEventListener('click', conferma);
$('#btn-aggiorna-dati').addEventListener('click', aggiornaDati);
$('#btn-nuova-asta').addEventListener('click', () => { chiudiTutto(); preparaNuova(); });
$('#btn-annulla-ultimo').addEventListener('click', () => {
  try { app.stato.annullaUltimo(); ricalcola(); brindisi('Annullato.'); }
  catch (e) { brindisi(e.message); }
});
for (const f of document.querySelectorAll('.foglio-fondo')) {
  f.addEventListener('click', chiudiTutto);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') chiudiTutto(); });

for (const b of document.querySelectorAll('#navigazione .voce')) {
  b.addEventListener('click', () => {
    for (const y of document.querySelectorAll('#navigazione .voce')) y.classList.remove('attiva');
    b.classList.add('attiva');
    for (const p of document.querySelectorAll('.pannello')) p.classList.remove('attivo');
    $('#pannello-' + b.dataset.pannello).classList.add('attivo');
    if (b.dataset.pannello === 'cerca') { cerca(); $('#campo-cerca').focus(); }
    window.scrollTo(0, 0);
  });
}
$('#campo-cerca').addEventListener('input', cerca);
$('#btn-pulisci').addEventListener('click', () => {
  $('#campo-cerca').value = ''; cerca(); $('#campo-cerca').focus();
});
for (const f of document.querySelectorAll('.filtro')) {
  f.addEventListener('click', () => {
    for (const y of document.querySelectorAll('.filtro')) y.classList.remove('attivo');
    f.classList.add('attivo');
    app.ruoloFiltro = f.dataset.ruolo;
    cerca();
  });
}

// Il pezzo che fa aprire l'applicazione anche senza rete. Nell'apk Android
// non serve - i file sono gia' dentro - e infatti li' non c'e' un service
// worker da registrare: la riga sotto non fa niente e non da' errori.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('servizio.js').catch(() => { /* pazienza */ });
}

window.__app = app;   // comodo per le prove
avvia();
