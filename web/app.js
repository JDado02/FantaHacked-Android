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

import { carica as caricaRegole, CAMPI_REGOLE } from './motore/regole.js';
import { apri as apriDati } from './motore/dati.js';
import { StatoAsta, DepositoLocale, ErroreAsta } from './motore/asta.js';
import { Valutatore } from './motore/valutazione.js';
import { Ottimizzatore } from './motore/ottimizzatore.js';
import { Consigliere, nomeSingolare, nomeRuolo } from './motore/strategia.js';
import { Equilibrio } from './motore/equilibrio.js';
import { arrotonda } from './motore/comune.js';

const RUOLI = ['P', 'D', 'C', 'A'];
const NOME_RUOLO = { P: 'Portieri', D: 'Difensori', C: 'Centrocampisti', A: 'Attaccanti' };
const CHIAVE_NOMI = 'fantahacked.nomi';
const CHIAVE_REGOLE = 'fantahacked.regole';

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t === null || t === undefined ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const app = {
  dati: null, regoleBase: null,
  // Due regolamenti, non uno: quello con cui si giochera' la **prossima**
  // asta (lo si sceglie nella schermata iniziale) e quello con cui si sta
  // giocando **questa**, che non cambia piu' fino alla fine.
  regole: null, regoleNuova: null, modifiche: null,
  stato: null, v: null, o: null, c: null, e: null,
  esitoDati: null, scelto: null, ruoloFiltro: '', ordine: 'costa',
  soloTitolari: false, presidenteScelto: null,
  riempiendo: false,
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

  // Le regole arrivano **dentro il pacchetto**, insieme alle proiezioni. Sono
  // la stessa cosa: le proiezioni dipendono dal regolamento, e questa
  // applicazione non sa rifarle - porta il motore di valutazione, non quello
  // delle proiezioni.
  //
  // Su quattro valori pero' si puo' andare oltre, e sono i quattro che
  // cambiano da lega a lega: quante squadre, quanti crediti, modificatore di
  // difesa, portieri a pacchetto. Nessuno dei quattro entra nel calcolo delle
  // proiezioni - il perche' sta in `regole.js`, sopra `applica` - quindi il
  // motore puo' rifare tutti i prezzi addosso a quei numeri senza mentire.
  try {
    app.regoleBase = app.dati.regole
      || await (await fetch('regole_lega.json', { cache: 'no-store' })).json();
  } catch (e) {
    return fermaAvvio('Non riesco a leggere le regole della lega: ' + e.message);
  }
  app.modifiche = modificheSalvate();
  try {
    app.regoleNuova = caricaRegole(app.regoleBase, app.modifiche);
  } catch (e) {
    // Preferenze rovinate o di una versione precedente: meglio ripartire dal
    // regolamento del pacchetto che non aprirsi.
    app.modifiche = {};
    app.regoleNuova = caricaRegole(app.regoleBase, null);
  }
  app.regole = app.regoleNuova;

  const deposito = new DepositoLocale();
  app.stato = new StatoAsta(app.regole, deposito);
  app.stato.collega(new Map(app.dati.giocatori.map((g) => [g.id, g])));
  const salvata = deposito.leggi();
  if (salvata) app.stato.carica(salvata);

  if (app.stato.esiste()) {
    app.regole = regoleDellAsta();
    app.stato.reg = app.regole;
    ricalcola();
    mostra('principale');
  } else {
    preparaNuova();
  }
}

/**
 * Le regole con cui l'asta in corso e' stata creata.
 *
 * Se per qualsiasi motivo non si riescono a rileggere - un'asta salvata da una
 * versione precedente, che il regolamento non lo scriveva - si torna a quelle
 * scelte adesso: un'asta con dei numeri e' meglio di un programma che non
 * parte. In un caso pero' non si puo' cedere, ed e' il numero di squadre:
 * quello lo dicono i presidenti che ci sono davvero, e da lui dipende il
 * livello di rimpiazzo, cioe' ogni prezzo.
 */
function regoleDellAsta() {
  const quanti = (app.stato.d.presidenti || []).length;
  let reg = null;
  try {
    const salvate = app.stato.regoleSalvate();
    if (salvate) reg = caricaRegole(salvate, null);
  } catch (e) { reg = null; }
  if (!reg) reg = app.regoleNuova;
  if (quanti && reg.partecipanti !== quanti) {
    reg = caricaRegole(reg.grezzo(), { partecipanti: quanti });
  }
  return reg;
}

function fermaAvvio(messaggio) {
  $('#avvio-stato').textContent = messaggio;
  $('#avvio-riprova').classList.remove('nascosto');
}

function mostra(quale) {
  for (const s of document.querySelectorAll('.schermo')) s.classList.remove('attivo');
  $('#schermo-' + quale).classList.add('attivo');
  window.scrollTo(0, 0);
}

// ------------------------------------------------------ preferenze locali
function modificheSalvate() {
  try {
    const t = window.localStorage.getItem(CHIAVE_REGOLE);
    const d = t ? JSON.parse(t) : null;
    if (!d || typeof d !== 'object') return {};
    const fuori = {};
    for (const k of CAMPI_REGOLE) if (k in d) fuori[k] = d[k];
    return fuori;
  } catch (e) { return {}; }
}

function salvaModifiche(d) {
  try { window.localStorage.setItem(CHIAVE_REGOLE, JSON.stringify(d)); }
  catch (e) { /* niente */ }
}

function nomiSalvati() {
  try {
    const t = window.localStorage.getItem(CHIAVE_NOMI);
    if (t) return JSON.parse(t);
  } catch (e) { /* niente */ }
  return [];
}

/** "Io", poi "Squadra 2", "Squadra 3"…  Come sul computer. */
function nomePredefinito(i) { return i === 0 ? 'Io' : 'Squadra ' + (i + 1); }

// ------------------------------------------------------------- nuova asta
function preparaNuova() {
  disegnaRegole();
  disegnaNomi();
  $('#btn-annulla-nuova').classList.toggle('nascosto', !app.stato.esiste());
  mostra('nuova');
}

function disegnaRegole() {
  const r = app.regoleNuova;
  $('#reg-squadre').value = r.partecipanti;
  $('#reg-crediti').value = r.crediti;
  $('#reg-mod').checked = r.mod_dif_attivo;
  $('#reg-pacchetto').checked = r.portieri_pacchetto;
  $('#reg-mod-testo').textContent = r.mod_dif_attivo ? 'sì' : 'no';
  $('#reg-pacchetto-testo').textContent = r.portieri_pacchetto ? 'sì' : 'no';
  $('#reg-rosa').textContent = r.slot.P + 'P ' + r.slot.D + 'D ' + r.slot.C + 'C '
                             + r.slot.A + 'A';
  $('#reg-monte').textContent = r.crediti_totali;
  $('#reg-pacchetto-nota').textContent = r.portieri_pacchetto
    ? 'Comprando il portiere titolare, il programma registra da solo le sue due '
      + 'riserve a un credito: tre gesti diventano uno, e i prezzi dei portieri '
      + 'si calcolano sul pacchetto intero.'
    : 'I tre portieri si comprano uno per uno, e ognuno ha un prezzo suo.';
}

function disegnaNomi() {
  const salvati = nomiSalvati();
  const n = app.regoleNuova.partecipanti;
  const campi = $('#campi-nomi');
  const correnti = [...campi.querySelectorAll('input')].map((c) => c.value);
  campi.innerHTML = '';
  for (let i = 0; i < n; i += 1) {
    // Quello che c'e' gia' scritto vince su quello che era salvato: cambiare
    // il numero di squadre non deve cancellare i nomi appena digitati.
    const valore = correnti[i] !== undefined && correnti[i] !== ''
      ? correnti[i] : (salvati[i] || nomePredefinito(i));
    const d = document.createElement('div');
    d.className = 'campo-nome' + (i === 0 ? ' mia' : '');
    d.innerHTML = '<span class="n">' + (i === 0 ? 'tu' : (i + 1)) + '</span>'
      + '<input type="text" autocomplete="off" value="' + esc(valore)
      + '" placeholder="' + esc(nomePredefinito(i)) + '">';
    campi.appendChild(d);
  }
}

function leggiRegoleDaiCampi() {
  return {
    partecipanti: parseInt($('#reg-squadre').value, 10),
    crediti_iniziali: parseInt($('#reg-crediti').value, 10),
    modificatore_difesa: $('#reg-mod').checked,
    portieri_a_pacchetto: $('#reg-pacchetto').checked,
  };
}

function cambiaRegole() {
  const scelte = leggiRegoleDaiCampi();
  const errore = $('#reg-errore');
  let nuove;
  try {
    nuove = caricaRegole(app.regoleBase, Object.assign({}, app.modifiche, scelte));
  } catch (e) {
    // Il motore elenca i motivi uno per riga, con un trattino davanti: qui
    // diventano una frase sola, senza la riga di intestazione che a schermo
    // direbbe soltanto "non valido" sopra la spiegazione del perche'.
    errore.textContent = String(e.message || e).split(String.fromCharCode(10))
      .slice(1).map((r) => r.replace(/^\s*-\s*/, '')).filter(Boolean)
      .join(' · ') || String(e.message || e);
    errore.classList.remove('nascosto');
    return;
  }
  errore.classList.add('nascosto');
  app.regoleNuova = nuove;
  app.modifiche = nuove.impostazioni();
  salvaModifiche(app.modifiche);
  if (!app.stato.esiste()) {
    app.regole = nuove;
    app.stato.reg = nuove;
  }
  disegnaRegole();
  disegnaNomi();
}

function creaAsta() {
  const campi = [...document.querySelectorAll('#campi-nomi input')];
  const nomi = campi.map((c, i) => c.value.trim() || nomePredefinito(i));
  try { window.localStorage.setItem(CHIAVE_NOMI, JSON.stringify(nomi)); }
  catch (e) { /* niente */ }
  app.regole = app.regoleNuova;
  app.stato.reg = app.regole;
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
  app.e = new Equilibrio(app.v, app.o);
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
  $('#fase-nome').textContent = fase ? NOME_RUOLO[fase].toUpperCase() : 'FINITA';
  $('#fase-residui').textContent = fase
    ? app.stato.slotResiduiRuolo(fase) + ' ancora da assegnare'
    : 'asta conclusa';

  const turno = app.stato.presidenti().find((p) => p.id === app.stato.turno());
  $('#btn-turno').textContent = turno ? turno.nome : '—';
  $('#btn-completa').disabled = !fase || app.riempiendo;
  $('#btn-avanza').disabled = !fase;
}

// ------------------------------------------------------------- i consigli
function disegnaConsiglio() {
  const cons = app.c.consiglio(12);
  $('#indicazione').textContent = cons.indicazione;

  // Quando i miei slot in questo reparto sono pieni, quello che si vede e' il
  // reparto **dopo**: va detto, altrimenti si legge una lista di difensori
  // mentre si stanno chiamando i portieri e sembra un difetto.
  const ant = $('#anticipo');
  if (cons.anticipo) {
    ant.classList.remove('nascosto');
    // La frase sotto dice gia' che i portieri sono chiusi e quanti ne restano:
    // qui basta il cartello, che serve a non far sembrare un difetto una lista
    // di difensori mentre si chiamano i portieri.
    ant.innerHTML = '<b>Anticipo</b> Qui sotto ci sono i '
      + esc(cons.anticipo_nome) + ', il prossimo reparto che ti serve. I prezzi '
      + 'si assesteranno quando toccherà a loro.';
  } else {
    ant.classList.add('nascosto');
  }

  const cop = $('#copertura');
  if (cons.copertura && cons.copertura.servono) {
    cop.classList.remove('nascosto');
    cop.innerHTML = coperturaBarra(cons.copertura, cons.anticipo || cons.fase);
  } else {
    cop.classList.add('nascosto');
  }

  const sc = $('#scarsita');
  sc.textContent = cons.scarsita || '';
  sc.classList.toggle('nascosto', !cons.scarsita);

  const box = $('#coppie');
  if (cons.coppie && cons.coppie.length) {
    box.classList.remove('nascosto');
    box.innerHTML = '<h4>Maglie da chiudere</h4>'
      + cons.coppie.map((d) => rigaHtml(d, {
        cifra: d.max_bid, etichetta: 'limite', sotto: d.perche,
      })).join('');
    collega(box);
  } else {
    box.classList.add('nascosto');
  }

  const scoperto = !!(cons.copertura && cons.copertura.mancano >= 0.5);
  // Quando il limite e' zero la cifra da mostrare non e' lo zero: sarebbe una
  // riga che dice «e' il ripiego» con accanto un numero che dice «mai», e a
  // colpo d'occhio sembrano due indicazioni opposte. Si mostra invece quanto
  // dovrebbe chiudere, in grigio e con la tilde.
  riempi('#lista-top', cons.top, cons.vuoti.top, (d) => (
    d.max_bid > 0
      ? { cifra: d.max_bid, etichetta: 'limite', sotto: d.perche || d.frase,
          scoperto }
      : { cifra: '~' + d.chiusura, etichetta: 'chiude a', stimata: true,
          sotto: d.perche || d.frase, scoperto }));
  $('#conta-top').textContent = cons.top.length ? '(' + cons.top.length + ')' : '';
  riempi('#lista-alt', cons.alternative, cons.vuoti.alternative, (d) => ({
    cifra: d.chiusura, etichetta: 'chiude a', sotto: d.perche || d.frase, scoperto,
  }));
  riempi('#lista-svuota', cons.svuotare, cons.vuoti.svuotare, (d) => ({
    cifra: d.brucia, etichetta: 'spingi a', sotto: d.perche || d.frase,
  }));
  riempi('#lista-evita', cons.evitare, cons.vuoti.evitare, (d) => ({
    cifra: d.chiusura, etichetta: 'chiude a', sotto: d.perche || d.frase,
  }));
}

/**
 * Quante caselle della formazione sono gia' coperte, in una barra.
 *
 * E' il numero che decide l'ordine di tutta la lista sotto, e lasciarlo solo
 * dentro una frase vorrebbe dire che nessuno lo guarda: la rosa ha otto
 * difensori, ma in campo ne vanno quattro ogni domenica.
 */
function coperturaBarra(cop, ruolo) {
  const pieno = Math.max(0, Math.min(100, 100 * cop.coperti / cop.servono));
  const stato = cop.mancano >= 0.5 ? 'scoperta' : 'piena';
  const nome = cop.servono === 1 ? nomeSingolare(ruolo) : nomeRuolo(ruolo);
  return '<div class="cop-testa"><span>In campo va'
    + (cop.servono === 1 ? '' : 'nno') + ' ' + cop.servono + ' '
    + esc(nome) + '</span><b>' + cop.coperti.toFixed(1) + '<span>/'
    + cop.servono + '</span></b></div>'
    + '<div class="cop-barra ' + stato + '"><i style="width:' + pieno.toFixed(1)
    + '%"></i></div>'
    // Il perche' lo dice la frase qui sotto, e su uno schermo da telefono
    // ripeterlo due volte di fila costa lo spazio della prima lista.
    + '<div class="cop-sotto">' + (cop.mancano >= 0.5
      ? 'Ne mancano ' + cop.mancano.toFixed(1) + '.'
      : 'Il nucleo è coperto.')
    + ' Titolari fissi in rosa: ' + cop.titolari + '.</div>';
}

function riempi(sel, lista, frasePerVuoto, comeCifra) {
  const el = $(sel);
  if (!lista || !lista.length) {
    el.innerHTML = '<p class="vuota">'
      + esc(frasePerVuoto || 'Niente da segnalare.') + '</p>';
    return;
  }
  el.innerHTML = lista.map((d) => rigaHtml(d, comeCifra(d))).join('');
  collega(el);
}

function rigaHtml(d, cfg) {
  const x = app.v.g.get(d.id);
  const fuori = x && x.fuori_lista;
  // Due etichette, e sono la stessa domanda vista dai due lati: su questo ci
  // costruisco la formazione, o e' uno da panchina? Si mostrano solo finche'
  // il nucleo e' scoperto, perche' dopo la distinzione non serve piu' e un
  // marchietto che c'e' sempre non lo legge nessuno.
  let tag = '';
  if (cfg.scoperto && d.titolare_pieno === true) {
    tag = '<span class="marchietto copre">copre</span>';
  } else if (cfg.scoperto && d.titolare_pieno === false) {
    tag = '<span class="marchietto panchina">panchina</span>';
  }
  return '<button class="riga ' + esc(d.colore || '')
    + (d.categoria === 'copertura' ? ' promossa' : '')
    + '" data-id="' + d.id + '">'
    + '<div class="riga-testo">'
    + '<div class="riga-nome">' + esc(d.nome)
    + '<span class="squadra">' + esc(d.squadra) + '</span>'
    + (fuori ? '<span class="marchietto fuori">fuori lista</span>' : '')
    + (x && x.rigorista === 1 ? '<span class="marchietto rig">rig</span>' : '')
    + tag
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

// --------------------------------------------------------------- listone
//
// E' la stessa lista del programma per computer: cerca, filtro per ruolo,
// ordinamenti e il segno di chi e' gia' stato comprato e da chi. La colonna a
// destra segue l'ordinamento scelto, altrimenti si legge una classifica che
// non corrisponde ai numeri sotto gli occhi.
const ORDINI = {
  costa: { etichetta: 'chiude a', valore: (x) => arrotonda(app.v.prezzoChiusura(x)),
           chiave: (x) => -app.v.prezzoChiusura(x) },
  valore: { etichetta: 'vale', valore: (x) => arrotonda(x.prezzo_mercato || 1),
            chiave: (x) => -(x.prezzo_mercato || 0) },
  presenze: { etichetta: 'presenze', valore: (x) => arrotonda(x.presenze || 0),
              chiave: (x) => -(x.presenze || 0) },
  mv: { etichetta: 'media voto', valore: (x) => (x.mv || 0).toFixed(2),
        chiave: (x) => -(x.mv || 0) },
  quota: { etichetta: 'quotazione', valore: (x) => x.qi,
           chiave: (x) => -(x.qi || 0) },
  nome: { etichetta: 'chiude a', valore: (x) => arrotonda(app.v.prezzoChiusura(x)),
          chiave: null },
};

function cerca() {
  const testo = $('#campo-cerca').value.trim().toLowerCase();
  const el = $('#risultati');
  const venduti = app.stato.venduti();
  let righe = [];
  for (const x of app.v.g.values()) {
    if (app.ruoloFiltro && x.ruolo !== app.ruoloFiltro) continue;
    if (testo && !x.nome.toLowerCase().includes(testo)
        && !x.squadra.toLowerCase().includes(testo)) continue;
    if (app.soloTitolari && !x.sicuro) continue;
    righe.push(x);
  }
  const ord = ORDINI[app.ordine] || ORDINI.costa;
  if (app.ordine === 'nome') {
    righe.sort((a, b) => (a.nome.toLowerCase() < b.nome.toLowerCase() ? -1
                        : a.nome.toLowerCase() > b.nome.toLowerCase() ? 1 : 0));
  } else {
    righe.sort((a, b) => (ord.chiave(a) - ord.chiave(b)) || (a.id - b.id));
  }
  const totale = righe.length;
  righe = righe.slice(0, 60);
  $('#conta-listone').textContent = totale
    ? (totale > 60 ? 'i primi 60 di ' + totale
                   : totale + (totale === 1 ? ' giocatore' : ' giocatori'))
    : '';
  if (!righe.length) {
    el.innerHTML = '<p class="vuota">Nessuno con questo nome.</p>';
    return;
  }
  const nomi = new Map(app.stato.presidenti().map((p) => [p.id, p.nome]));
  const comprati = new Map(app.stato.acquisti().map((a) => [a.giocatore_id, a]));
  el.innerHTML = righe.map((x) => {
    const g = x.etichetta_grado || 'Da verificare';
    const a = comprati.get(x.id);
    const sotto = a
      ? 'Preso da ' + (nomi.get(a.presidente_id) || '?') + ' per ' + a.prezzo
      : g + ', ' + arrotonda(x.presenze) + ' presenze attese';
    return '<button class="riga' + (venduti.has(x.id) ? ' venduta' : '')
      + '" data-id="' + x.id + '">'
      + '<div class="riga-testo"><div class="riga-nome">' + esc(x.nome)
      + '<span class="squadra">' + esc(x.squadra) + ' · ' + x.ruolo + '</span>'
      + (x.fuori_lista ? '<span class="marchietto fuori">fuori lista</span>' : '')
      + (x.rigorista === 1 ? '<span class="marchietto rig">rig</span>' : '')
      + (a ? '<span class="marchietto venduto">venduto</span>' : '')
      + '</div><div class="riga-sotto">' + esc(sotto) + '</div></div>'
      + '<div class="riga-cifra"><b>' + ord.valore(x) + '</b><span>'
      + esc(ord.etichetta) + '</span></div></button>';
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

  // Quante caselle della formazione aggiunge davvero, nel mio reparto: e' la
  // domanda che il resto della scheda non fa.
  if (!venduto) {
    const cop = app.c.copertura(x.ruolo);
    if (cop.servono) {
      const piu = app.c.guadagnoCopertura(x);
      html += '<div class="blocchetto' + (cop.mancano >= 0.5 ? '' : ' quieto') + '">'
        + 'In campo va' + (cop.servono === 1 ? '' : 'nno') + ' <b>' + cop.servono
        + '</b> ' + esc(cop.servono === 1 ? nomeSingolare(x.ruolo)
                                          : nomeRuolo(x.ruolo))
        + ' e con la rosa di adesso ne copri <b>' + cop.coperti.toFixed(1)
        + '</b>. ' + (Consigliere.giocaSempre(x)
          ? 'Lui copre un posto fisso'
          : 'Lui non copre un posto fisso')
        + ' (' + arrotonda(x.presenze) + ' presenze attese), e ne aggiunge <b>+'
        + piu.toFixed(2) + '</b> rispetto a un riempitivo da un credito.</div>';
    }
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
    + det('Presenze attese', arrotonda(x.presenze) + ' su 38')
    + det('Fantamedia attesa', (x.fm || 0).toFixed(2))
    + det('Punti di stagione', arrotonda((x.presenze || 0) * (x.fm || 0)))
    + det('Quotazione', x.qi)
    + det('Prezzo di listino', arrotonda(x.prezzo_base || 1) + ' crediti')
    + det('Chi può rilanciare', conc.length ? conc.length + ' avversari' : 'nessuno')
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
  try {
    registraAcquisto(x, pid, prezzo);
  } catch (e) {
    brindisi(e instanceof ErroreAsta ? e.message : String(e.message || e));
    return;
  }
  chiudiTutto();
  ricalcola();
  brindisi(x.nome + ' a ' + prezzo + ' crediti.');
}

/**
 * Un acquisto, col limite di quel momento e le riserve del pacchetto.
 *
 * Il limite si legge **prima** di registrare: un istante dopo lo slot e'
 * occupato e quel numero non esiste piu'. E' quello che permettera', guardando
 * la rosa a fine asta, di dire se un acquisto era un errore o solo un giocatore
 * fuori scala pagato sopra la media.
 */
function registraAcquisto(x, pid, prezzo) {
  let limite = null;
  if (pid === app.stato.io().id) {
    try { limite = Math.trunc(app.o.maxBid(x)[0]); } catch (e) { limite = null; }
  }
  app.stato.registra(x.id, pid, prezzo, limite);
  const extra = [];
  // Coi portieri a pacchetto, il titolare si porta dietro le riserve a un
  // credito: registrarle a mano ogni volta sarebbe tre gesti invece di uno, e
  // dimenticarsene falserebbe gli slot di tutti.
  if (app.v.pacchetto && x.ruolo === 'P' && x.titolare_por) {
    for (const rid of app.v.riserveDi(x.id)) {
      if (app.stato.venduti().has(rid)) continue;
      if (app.stato.slotResidui(pid, 'P') <= 0) break;
      try {
        app.stato.registra(rid, pid, 1, null);
        const r = app.v.g.get(rid);
        extra.push(r ? r.nome : String(rid));
      } catch (e) { break; }
    }
  }
  return extra;
}

// ------------------------------------------------------ completa reparto
//
// Serve a provare il programma, non a giocarci: portare un'asta al punto che
// si vuole guardare vuol dire registrare a mano decine di acquisti, e chi lo fa
// per collaudare una modifica lo fa dieci volte di seguito.
//
// Non e' una simulazione a parte: passa dagli stessi metodi che usa
// l'interfaccia, un acquisto alla volta, e fra un acquisto e l'altro il motore
// rifa' tutti i conti. E' l'unico modo perche' lo stato a cui si arriva sia uno
// stato **vero**.

/** A chi assegnare il prossimo: a chi ne manca di piu', poi per numero. */
function chiTocca(ruolo) {
  let migliore = null;
  let quanti = 0;
  for (const p of app.stato.presidenti()) {
    const n = app.stato.slotResidui(p.id, ruolo);
    if (n > quanti) { migliore = p.id; quanti = n; }
  }
  return migliore;
}

/** Il piu' caro fra i liberi del reparto: e' l'ordine con cui va via. */
function migliorLibero(ruolo) {
  const liberi = app.v.disponibili(ruolo).filter(
    (x) => !(app.regole.portieri_pacchetto && ruolo === 'P' && !x.titolare_por));
  if (!liberi.length) return null;
  let migliore = liberi[0];
  for (const x of liberi) {
    const a = [x.prezzo_atteso || 0, -x.id];
    const b = [migliore.prezzo_atteso || 0, -migliore.id];
    if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) migliore = x;
  }
  return migliore;
}

/** Chi chiamerei io: il primo della lista, come farebbe una persona. */
function primoConsigliato(ruolo) {
  const venduti = app.stato.venduti();
  let d = {};
  try { d = app.c.consiglio(12); } catch (e) { d = {}; }
  for (const sezione of ['top', 'alternative']) {
    for (const voce of (d[sezione] || [])) {
      const x = app.v.g.get(voce.id);
      if (!x || x.ruolo !== ruolo || venduti.has(x.id)) continue;
      if (app.regole.portieri_pacchetto && ruolo === 'P' && !x.titolare_por) continue;
      return x;
    }
  }
  return migliorLibero(ruolo);
}

/**
 * Quanto farlo pagare: la chiusura attesa, dentro quello che ha.
 *
 * Sui **miei** acquisti si aggiunge il tetto del motore. Non e' un dettaglio da
 * poco per uno strumento di collaudo: senza, il riempimento mi farebbe pagare
 * sopra il limite su mezza rosa, e il pannello che si sta andando a guardare
 * direbbe che ho sbagliato l'asta - sarebbe lo strumento di misura a produrre
 * il difetto che dovrebbe misurare.
 */
function prezzoRiempimento(x, pid) {
  let prezzo = arrotonda(app.v.prezzoChiusura(x));
  if (pid === app.stato.io().id) {
    let limite = 0;
    try { limite = Math.trunc(app.o.maxBid(x)[0]); } catch (e) { limite = 0; }
    if (limite >= 1) prezzo = Math.min(prezzo, limite);
  }
  return Math.max(1, Math.min(prezzo, app.stato.liquidita(pid)));
}

async function completaReparto() {
  if (app.riempiendo) return;
  const ruolo = app.c.fase();
  if (!ruolo) { brindisi("L'asta è già conclusa."); return; }
  const caselle = app.stato.slotResiduiRuolo(ruolo);
  const mie = app.stato.slotResidui(app.stato.io().id, ruolo);
  const nome = nomeRuolo(ruolo);
  const domanda = 'Completo i ' + nome + ' per tutte le squadre: ' + caselle
    + ' caselle da riempire' + (mie ? ', ' + mie + ' delle quali tue' : '')
    + ' — prendo i primi della lista dei consigli, uno alla volta, coi conti '
    + 'rifatti dopo ognuno.';
  const vai = await chiedi('Completa i ' + nome, domanda, 'Completa');
  if (!vai) return;

  app.riempiendo = true;
  $('#btn-completa').textContent = 'sto riempiendo…';
  $('#btn-completa').disabled = true;
  // Un giro dell'orologio prima di partire, se no il bottone non fa in tempo a
  // ridisegnarsi e il telefono sembra bloccato per qualche secondo.
  setTimeout(() => {
    let fatti = 0;
    try {
      while (app.stato.slotResiduiRuolo(ruolo) > 0 && fatti < 400) {
        const io = app.stato.io().id;
        const mio = app.stato.slotResidui(io, ruolo) > 0;
        const pid = mio ? io : chiTocca(ruolo);
        if (pid === null) break;
        const x = mio ? primoConsigliato(ruolo) : migliorLibero(ruolo);
        if (!x) break;
        const prezzo = prezzoRiempimento(x, pid);
        try {
          registraAcquisto(x, pid, prezzo);
        } catch (e) {
          // Uno slot che non si riesce a riempire non deve bloccare gli altri:
          // si toglie di mezzo quel giocatore e si va avanti, altrimenti il
          // giro non finisce piu'.
          app.v.scarta(x.id);
          continue;
        }
        fatti += 1;
        app.v.aggiorna();
        app.o.aggiorna();
      }
    } finally {
      app.riempiendo = false;
      $('#btn-completa').textContent = 'completa reparto';
      const riempite = caselle - app.stato.slotResiduiRuolo(ruolo);
      ricalcola();
      // Due numeri diversi, e coi portieri a pacchetto non coincidono: otto
      // chiamate riempiono ventiquattro caselle. Il messaggio prima e quello
      // dopo devono parlare della stessa cosa.
      brindisi(nome + ' completati: ' + riempite + ' caselle riempite.');
    }
  }, 30);
}

// -------------------------------------------------------------- bilancio
/**
 * Ha comprato sopra o sotto quello che quei giocatori valgono.
 *
 * E' il modo piu' rapido di capire chi in quella stanza sta facendo un'asta
 * cara e chi sta facendo affari: due presidenti con gli stessi crediti residui
 * non sono nella stessa posizione se uno ha in rosa centoventi crediti di roba
 * e l'altro centottanta.
 *
 * Il metro e' `prezzo_base`: quanto quel giocatore sarebbe costato in una
 * stanza normale. Non e' il valore a punti (che sui portieri e' fuori scala) e
 * non e' il prezzo del momento (che a reparto esaurito crolla a un credito e
 * farebbe risultare tutti in perdita).
 *
 * **Per la mia rosa la domanda pero' e' un'altra.** Un giocatore fuori scala
 * vale, per una rosa che se lo puo' permettere, molto piu' di quanto la stanza
 * media paghi quel ruolo: il motore puo' dire «fino a 144» su uno che il
 * mercato chiude a 63, e pagarlo 100 e' un ottimo affare pur essendo 37 sopra
 * il prezzo di mercato. Chiamarli crediti buttati sarebbe falso. Sui miei
 * acquisti il verdetto si basa percio' sul **limite salvato al momento della
 * chiamata**.
 */
function bilancio(presidenteId) {
  let speso = 0;
  let atteso = 0;
  const miei = [];
  for (const a of app.stato.acquisti()) {
    if (a.presidente_id !== presidenteId) continue;
    const x = app.v.g.get(a.giocatore_id);
    speso += a.prezzo;
    if (x) {
      atteso += arrotonda(x.prezzo_base || x.prezzo_atteso
                          || x.prezzo_mercato || 1);
    }
    if (a.limite !== null && a.limite !== undefined && a.limite > 0) {
      miei.push({ nome: a.nome, prezzo: a.prezzo, limite: a.limite,
                  oltre: Math.max(0, a.prezzo - a.limite) });
    }
  }
  if (presidenteId === app.stato.io().id && miei.length) {
    const limiti = miei.reduce((t, x) => t + x.limite, 0);
    const spesoL = miei.reduce((t, x) => t + x.prezzo, 0);
    const margine = limiti - spesoL;
    const sopra = miei.filter((x) => x.oltre > 0);
    const base = { speso, atteso, scarto: speso - atteso,
                   limiti, margine, sopra_limite: sopra.length };
    if (sopra.length) {
      const quanti = sopra.reduce((t, x) => t + x.oltre, 0);
      return Object.assign(base, { verso: 'negativo',
        testo: 'Hai pagato sopra il tuo limite su ' + sopra.length
             + ' acquisti (' + sopra.slice(0, 3).map((x) => x.nome).join(', ')
             + '): sono ' + quanti + ' crediti che non rendono. Sul resto sei '
             + 'rientrato.' });
    }
    if (margine > 0) {
      return Object.assign(base, { verso: 'positivo',
        testo: 'Tutti dentro il limite che il motore dava al momento della '
             + 'chiamata, con ' + margine + ' crediti di margine in totale. '
             + 'Hai speso ' + speso + ' per giocatori che sul mercato ne '
             + 'valgono ' + atteso + ": la differenza non e' uno spreco, e' "
             + "quello che valgono in piu' per la tua rosa." });
    }
    return Object.assign(base, { verso: 'pari',
      testo: "Sei esattamente sui limiti che il motore dava: nessun errore, ma "
           + 'nemmeno margine.' });
  }
  const scarto = speso - atteso;
  if (atteso <= 0) {
    return { speso, atteso, scarto: 0, verso: 'niente',
             testo: 'Non ha ancora comprato niente.' };
  }
  const quota = scarto / atteso;
  if (scarto <= -3 && quota <= -0.05) {
    return { speso, atteso, scarto, quota: arrotonda(100 * quota),
             verso: 'positivo',
             testo: 'Sta facendo affari: ha speso ' + speso + ' crediti per una '
                  + 'rosa che ne vale ' + atteso + '. Sono ' + (-scarto)
                  + ' crediti guadagnati.' };
  }
  if (scarto >= 3 && quota >= 0.05) {
    return { speso, atteso, scarto, quota: arrotonda(100 * quota),
             verso: 'negativo',
             testo: 'Sta pagando caro: ' + speso + ' crediti per una rosa che ne '
                  + 'vale ' + atteso + '. Sono ' + scarto + ' crediti buttati, e '
                  + 'alla fine gli mancheranno.' };
  }
  return { speso, atteso, scarto, quota: arrotonda(100 * quota), verso: 'pari',
           testo: 'In pari: ' + speso + ' crediti spesi per una rosa che ne vale '
                + atteso + '.' };
}

function bilancioBlocco(b) {
  if (!b) return '';
  return '<div class="bilancio ' + esc(b.verso) + '">'
    + '<div class="bilancio-cifre"><b>' + b.speso + '</b><span>spesi</span>'
    + '<b>' + b.atteso + '</b><span>di valore</span>'
    + (b.margine !== undefined
        ? '<b>' + b.margine + '</b><span>di margine</span>' : '')
    + '</div><p>' + esc(b.testo) + '</p></div>';
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
    + '</div>'
    + bilancioBlocco(bilancio(io.id));

  // Quante caselle della formazione copre ogni reparto: la stessa domanda del
  // pannello dei consigli, per tutti e quattro insieme.
  $('#copertura-rosa').innerHTML = '<div class="tabellina">' + RUOLI.map((r) => {
    const cop = app.c.copertura(r);
    const classe = cop.mancano >= 0.5 ? 'manca' : 'ok';
    return '<div class="r"><span>' + NOME_RUOLO[r]
      + ' <span class="sec">' + cop.titolari + ' titolari fissi</span></span>'
      + '<b class="' + classe + '">' + cop.coperti.toFixed(1) + '/'
      + cop.servono + '</b></div>';
  }).join('') + '</div>'
    + '<p class="nota piccola">La rosa ha otto difensori, ma in campo ne vanno '
    + 'quattro ogni domenica: questo è quante di quelle caselle si riempiono '
    + 'davvero, contando le presenze attese di chi hai preso.</p>';

  const perRuolo = { P: [], D: [], C: [], A: [] };
  for (const a of acquisti) {
    const x = app.v.g.get(a.giocatore_id);
    if (x) perRuolo[x.ruolo].push({ x, prezzo: a.prezzo, limite: a.limite });
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
            .map((s) => '<button class="r cliccabile" data-id="' + s.x.id + '">'
              + '<span>' + esc(s.x.nome)
              + ' <span class="sec">' + esc(s.x.squadra) + ' · '
              + arrotonda(s.x.presenze) + ' pres.</span></span><b>'
              + s.prezzo
              + (s.limite !== null && s.limite !== undefined && s.prezzo > s.limite
                ? '<span class="sopra"> sopra il limite di ' + s.limite + '</span>'
                : '')
              + '</b></button>').join('') + '</div>'
        : '<p class="vuota">Ancora nessuno.</p>')
      + '</div>';
  }).join('');
  for (const b of $('#mia-rosa').querySelectorAll('.cliccabile')) {
    b.addEventListener('click', () => apriScheda(parseInt(b.dataset.id, 10)));
  }

  disegnaUndici();
  disegnaPiano(piano);

  $('#altri-presidenti').innerHTML = app.stato.presidenti().map((p) => {
    // Il verso del bilancio accanto al nome: chi sta facendo affari e chi sta
    // pagando caro si legge a colpo d'occhio, senza aprire niente.
    const b = bilancio(p.id);
    return '<button class="r cliccabile' + (p.io ? ' io' : '')
      + (p.id === app.stato.turno() ? ' turno' : '') + '" data-pid="' + p.id + '">'
      + '<span>' + esc(p.nome)
      + ' <span class="sec">' + (p.n_p + p.n_d + p.n_c + p.n_a) + '/'
      + app.regole.slot_totali + ' slot</span></span>'
      + '<b class="verso-' + esc(b.verso) + '">' + p.crediti + '</b></button>';
  }).join('');
  for (const b of $('#altri-presidenti').querySelectorAll('.cliccabile')) {
    b.addEventListener('click', () => apriAvversario(parseInt(b.dataset.pid, 10)));
  }

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

/** L'undici migliore, il rischio di restare in dieci, e gli avvisi. */
function disegnaUndici() {
  const q = app.e.quadro();
  const u = q.undici;
  const perRuolo = { P: [], D: [], C: [], A: [] };
  for (const g of u.giocatori) perRuolo[g.ruolo].push(g);
  let html = '<div class="undici-testa"><b>' + u.modulo + '</b>'
    + '<span>' + u.punti_giornata.toFixed(1) + ' punti a giornata'
    + (u.bonus_difesa ? ' (di cui ' + u.bonus_difesa.toFixed(2)
                        + ' di modificatore)' : '') + '</span></div>'
    + '<div class="undici">' + RUOLI.map((r) => '<div class="reparto-campo">'
      + perRuolo[r].map((g) => (g.vuoto
        ? '<span class="maglia vuota">' + r + '</span>'
        : '<span class="maglia' + (g.sicuro ? ' sicuro' : '') + '" title="'
          + esc(g.nome) + '">' + esc(g.nome) + '</span>')).join('')
      + '</div>').join('') + '</div>';

  const r = q.rischio;
  html += '<div class="tabellina">'
    + '<div class="r"><span>Giornate a rischio di restare in dieci</span><b class="'
    + (r.quota >= 0.08 ? 'manca' : 'ok') + '">' + r.giornate.toFixed(1) + '/38</b></div>'
    + '<div class="r"><span>Titolari sicuri in rosa</span><b>' + q.titolari_sicuri
    + '/' + q.in_rosa + '</b></div>'
    + '<div class="r"><span>Rigoristi</span><b>' + q.rigoristi.length + '</b></div>'
    + (q.concentrazione.length
      ? '<div class="r"><span>Più giocatori da</span><b>'
        + esc(q.concentrazione[0].squadra) + ' (' + q.concentrazione[0].quanti
        + ')</b></div>'
      : '')
    + '</div>';

  if (q.avvisi.length) {
    html += q.avvisi.map((a) => '<div class="avviso piccolo">' + esc(a.testo)
      + '</div>').join('');
  }
  $('#undici').innerHTML = html;
}

function disegnaPiano(piano) {
  const per = piano.per_ruolo || {};
  const vuoti = RUOLI.every((r) => !(per[r] && per[r].slot));
  if (vuoti) {
    $('#piano').innerHTML = '<p class="vuota">La rosa è completa: non c\'è più '
      + 'niente da pianificare.</p>';
    return;
  }
  // Non solo quanti crediti per reparto, ma **su chi**: sono i nomi che il
  // calcolo comprerebbe con quei crediti, ed e' l'unica forma in cui un piano
  // di spesa diventa una cosa da fare invece di una percentuale.
  $('#piano').innerHTML = RUOLI.filter((r) => (per[r] || {}).slot).map((r) => {
    const p = per[r];
    const chi = (p.obiettivi || []).map((o) =>
      '<span class="obiettivo">' + esc(o.nome)
      + '<b>' + o.costo + '</b></span>').join('');
    return '<div class="reparto"><div class="reparto-testa">'
      + '<span>' + NOME_RUOLO[r] + ' · ' + p.slot + ' da prendere</span>'
      + '<span>' + p.crediti + ' crediti</span></div>'
      + (chi ? '<div class="obiettivi">' + chi + '</div>'
             : '<p class="vuota">Con questi crediti il calcolo non arriva a '
               + 'nessun nome preciso.</p>')
      + '</div>';
  }).join('')
    + '<p class="nota piccola">Come conviene dividere i crediti che restano, e '
    + 'su chi: non è una regola di lega, è il risultato del calcolo che '
    + 'massimizza i punti della rosa finita. Cambia a ogni acquisto, tuo o '
    + 'altrui.</p>';
}

// ------------------------------------------------------- rosa avversaria
function apriAvversario(pid) {
  const p = app.stato.presidenti().find((y) => y.id === pid);
  if (!p) return;
  const acquisti = app.stato.acquisti().filter((a) => a.presidente_id === pid);
  const perRuolo = { P: [], D: [], C: [], A: [] };
  for (const a of acquisti) {
    const x = app.v.g.get(a.giocatore_id);
    if (x) perRuolo[x.ruolo].push({ x, prezzo: a.prezzo });
  }
  let html = '<div class="scheda-testa"><div class="scheda-nome">' + esc(p.nome)
    + '</div><div class="scheda-sotto">'
    + (p.n_p + p.n_d + p.n_c + p.n_a) + '/' + app.regole.slot_totali
    + ' slot · ' + p.crediti + ' crediti · può offrire fino a '
    + app.stato.liquidita(pid) + '</div></div>'
    + bilancioBlocco(bilancio(pid));
  html += RUOLI.map((r) => '<div class="reparto"><div class="reparto-testa">'
    + '<span>' + NOME_RUOLO[r] + ' ' + perRuolo[r].length + '/'
    + app.regole.slot[r] + '</span></div>'
    + (perRuolo[r].length
      ? '<div class="tabellina">' + perRuolo[r]
          .sort((a, b) => b.prezzo - a.prezzo)
          .map((s) => '<div class="r"><span>' + esc(s.x.nome)
            + ' <span class="sec">' + esc(s.x.squadra) + '</span></span><b>'
            + s.prezzo + '</b></div>').join('') + '</div>'
      : '<p class="vuota">Ancora nessuno.</p>') + '</div>').join('');
  if (!p.io) {
    html += '<button class="bottone secondario" id="btn-dai-turno">'
      + 'Dai il turno di chiamata a ' + esc(p.nome) + '</button>';
  }
  $('#avversario-contenuto').innerHTML = html;
  $('#avversario').hidden = false;
  const t = $('#btn-dai-turno');
  if (t) {
    t.addEventListener('click', () => {
      app.stato.impostaTurno(pid);
      chiudiTutto(); disegnaBarra(); disegnaRosa();
      brindisi('Tocca a ' + p.nome + '.');
    });
  }
}

// ---------------------------------------------------------------- rinomina
function apriRinomina() {
  // In ordine di numero, non di visualizzazione: i campi devono corrispondere
  // uno a uno alle righe salvate.
  const ordinati = app.stato.d.presidenti;
  $('#campi-rinomina').innerHTML = ordinati.map((p, i) =>
    '<div class="campo-nome' + (p.io ? ' mia' : '') + '">'
    + '<span class="n">' + (p.io ? 'tu' : (i + 1)) + '</span>'
    + '<input type="text" autocomplete="off" value="' + esc(p.nome) + '">'
    + '</div>').join('');
  $('#rinomina').hidden = false;
}

function salvaNomi() {
  const nomi = [...document.querySelectorAll('#campi-rinomina input')]
    .map((c) => c.value);
  try {
    app.stato.rinomina(nomi);
  } catch (e) {
    brindisi(e.message || String(e));
    return;
  }
  try { window.localStorage.setItem(CHIAVE_NOMI, JSON.stringify(nomi)); }
  catch (e) { /* niente */ }
  chiudiTutto();
  ricalcola();
  brindisi('Nomi aggiornati.');
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

/**
 * Una domanda con due risposte, e la risposta arriva come promessa.
 *
 * Non usa `window.confirm`: dentro la WebView dell'apk quella finestrella non
 * si apre, e la funzione torna `false` senza che nessuno abbia risposto. Un
 * bottone che non fa niente e non dice perche' e' peggio di un bottone che
 * non c'e'.
 */
function chiedi(titolo, testo, etichettaSi) {
  return new Promise((risolvi) => {
    $('#conferma-titolo').textContent = titolo;
    $('#conferma-testo').textContent = testo;
    $('#conferma-si').textContent = etichettaSi || 'Vai';
    $('#conferma').hidden = false;
    const chiudi = (risposta) => {
      $('#conferma').hidden = true;
      $('#conferma-si').removeEventListener('click', si);
      $('#conferma-no').removeEventListener('click', no);
      $('#conferma .foglio-fondo').removeEventListener('click', no);
      risolvi(risposta);
    };
    const si = () => chiudi(true);
    const no = () => chiudi(false);
    $('#conferma-si').addEventListener('click', si);
    $('#conferma-no').addEventListener('click', no);
    // Toccare fuori vale come «lascia stare»: un foglio che si chiude senza
    // rispondere lascerebbe la promessa appesa, e il bottone morto per sempre.
    $('#conferma .foglio-fondo').addEventListener('click', no, { once: true });
  });
}

function chiudiTutto() {
  $('#scheda').hidden = true;
  $('#registra').hidden = true;
  $('#menu').hidden = true;
  $('#avversario').hidden = true;
  $('#rinomina').hidden = true;
  // La conferma no: si chiude rispondendo, non toccando fuori. Un foglio che
  // sparisce senza risposta lascerebbe la promessa appesa per sempre.
}

function apriMenu() {
  const d = app.dati;
  const e = app.esitoDati || {};
  const frasi = {
    aggiornato: 'appena scaricati', gia_aggiornato: 'già aggiornati',
    offline: 'non ho potuto controllare', errore: 'controllo non riuscito',
    troppo_nuovi: 'servono una versione più recente',
  };
  const r = app.regole;
  $('#info-dati').innerHTML =
    det('Dati del', d.generatoIl || '—')
    + det('Giocatori', d.giocatori.length)
    + det('Ultimo controllo', frasi[e.stato] || '—')
    + (e.nota ? det('Nota', e.nota) : '')
    + det('Motore', app.ms + ' ms per ricalcolare')
    + det('Squadre', r.partecipanti)
    + det('Crediti a testa', r.crediti)
    + det('Modificatore difesa', r.mod_dif_attivo ? 'attivo' : 'spento')
    + det('Portieri a pacchetto', r.portieri_pacchetto ? 'sì' : 'no');
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
$('#btn-chiudi-avversario').addEventListener('click', chiudiTutto);
$('#btn-chiudi-rinomina').addEventListener('click', chiudiTutto);
$('#btn-conferma').addEventListener('click', conferma);
$('#btn-aggiorna-dati').addEventListener('click', aggiornaDati);
$('#btn-nuova-asta').addEventListener('click', async () => {
  // Cancellare un'asta a meta' serata e' la cosa peggiore che possa capitare,
  // e da qui capita con due tocchi. La domanda dice quanti acquisti si stanno
  // per perdere, che e' l'unica informazione che fa cambiare idea.
  if (app.stato.esiste() && app.stato.acquisti().length) {
    const quanti = app.stato.acquisti().length;
    const vai = await chiedi('Nuova asta',
      'Quella in corso ha ' + quanti + ' acquisti registrati, e comincia'
      + "ndone un'altra si perdono. Sicuro?", 'Cancella e ricomincia');
    if (!vai) return;
  }
  chiudiTutto();
  preparaNuova();
});
$('#btn-rinomina').addEventListener('click', apriRinomina);
$('#btn-salva-nomi').addEventListener('click', salvaNomi);
$('#btn-completa').addEventListener('click', completaReparto);
$('#btn-avanza').addEventListener('click', () => {
  const pid = app.stato.avanzaTurno();
  disegnaBarra(); disegnaRosa();
  const p = app.stato.presidenti().find((y) => y.id === pid);
  if (p) brindisi('Tocca a ' + p.nome + '.');
});
$('#btn-turno').addEventListener('click', () => apriAvversario(app.stato.turno()));
$('#btn-annulla-ultimo').addEventListener('click', () => {
  try { app.stato.annullaUltimo(); ricalcola(); brindisi('Annullato.'); }
  catch (e) { brindisi(e.message); }
});
for (const f of document.querySelectorAll('.foglio-fondo')) {
  f.addEventListener('click', chiudiTutto);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') chiudiTutto(); });

// Le regole della prossima asta: ogni tocco rifà tutti i prezzi, quindi si
// applica subito invece di aspettare un bottone "salva" che nessuno premerebbe.
for (const id of ['#reg-squadre', '#reg-crediti']) {
  $(id).addEventListener('change', cambiaRegole);
}
for (const id of ['#reg-mod', '#reg-pacchetto']) {
  $(id).addEventListener('change', cambiaRegole);
}

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
$('#solo-titolari').addEventListener('change', () => {
  app.soloTitolari = $('#solo-titolari').checked;
  cerca();
});
for (const f of document.querySelectorAll('.filtro')) {
  f.addEventListener('click', () => {
    for (const y of document.querySelectorAll('.filtro')) y.classList.remove('attivo');
    f.classList.add('attivo');
    app.ruoloFiltro = f.dataset.ruolo;
    cerca();
  });
}
for (const f of document.querySelectorAll('.ordine')) {
  f.addEventListener('click', () => {
    for (const y of document.querySelectorAll('.ordine')) y.classList.remove('attivo');
    f.classList.add('attivo');
    app.ordine = f.dataset.ordine;
    cerca();
  });
}

// Il pezzo che fa aprire l'applicazione anche senza rete. Nell'apk Android non
// serve - i file sono gia' dentro - e infatti li' non c'e' un service worker da
// registrare: la riga sotto non fa niente e non da' errori.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('servizio.js').catch(() => { /* pazienza */ });
}

window.__app = app;   // comodo per le prove
window.__completaReparto = completaReparto;
avvia();
