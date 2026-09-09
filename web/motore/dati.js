// Caricamento del pacchetto dei dati, e il suo aggiornamento.
//
// Il file arriva in formato a colonne - i nomi dei campi una volta sola, poi
// le righe - perche' ripetere venti nomi per seicento giocatori costa piu' del
// doppio in byte, e su una connessione dati la differenza si sente. Qui torna
// a essere oggetti normali.
//
// Come sul computer: si legge prima il `manifest.json`, che sono trecento
// byte, e si scarica il pacchetto solo se la data e' cambiata. Se la rete non
// c'e' si usa quello che e' gia' nel telefono. Un assistente d'asta che non si
// apre perche' il wifi della stanza fa i capricci sarebbe peggio di uno con i
// dati di tre giorni prima.

export const ORIGINE = 'https://raw.githubusercontent.com/JDado02/DBFantaHacked/main';
const CHIAVE_DATI = 'fantahacked.dati';
const CHIAVE_VERSIONE = 'fantahacked.dati.versione';
const ATTESA_MANIFEST = 6000;
const ATTESA_PACCHETTO = 60000;

function aOggetti(t) {
  if (!t) return [];
  return t.righe.map((r) => {
    const o = {};
    t.campi.forEach((c, i) => { o[c] = r[i]; });
    return o;
  });
}

function perId(righe, chiave) {
  const m = new Map();
  for (const r of righe) m.set(r[chiave || 'id'], r);
  return m;
}

/** I dati pronti da dare al Valutatore. */
export class Dati {
  constructor(grezzi) {
    this.grezzi = grezzi;
    this.meta = grezzi.meta || {};
    this.giocatori = aOggetti(grezzi.giocatori);
    this.proiezioni = perId(aOggetti(grezzi.proiezioni));
    this.contesto = perId(aOggetti(grezzi.contesto));
    this.gerarchie = perId(aOggetti(grezzi.gerarchie));
    this.accoppiate = aOggetti(grezzi.accoppiate);
    this.squadre = aOggetti(grezzi.squadre);
    this.prezzi = new Map();
    for (const r of aOggetti(grezzi.prezzi_asta)) {
      this.prezzi.set(r.id, r.prezzo_medio_per_1000);
    }
  }

  /** Le regole con cui sono state calcolate queste proiezioni. */
  get regole() { return this.grezzi.regole || null; }

  get generatoIl() { return this.meta.generato_il || ''; }

  get schema() { return parseInt(this.meta.schema || '1', 10); }
}

// Versione dello schema che questa applicazione sa leggere. Se il pacchetto
// pubblicato e' piu' nuovo ci si ferma e lo si dice, invece di aprirlo a meta'
// e rompersi durante l'asta.
export const SCHEMA_LETTO = 1;

async function conAttesa(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.stato = r.status; throw e; }
    return r;
  } finally { clearTimeout(t); }
}

function locale() {
  try {
    const t = window.localStorage.getItem(CHIAVE_DATI);
    return t ? JSON.parse(t) : null;
  } catch (e) { return null; }
}

function salvaLocale(grezzi, versione) {
  try {
    window.localStorage.setItem(CHIAVE_DATI, JSON.stringify(grezzi));
    window.localStorage.setItem(CHIAVE_VERSIONE, versione || '');
    return true;
  } catch (e) {
    // Su telefoni con poco spazio `localStorage` puo' rifiutare cinque
    // megabyte. Non e' un errore fatale: i dati restano in memoria per questa
    // sessione, e si riscaricano alla prossima.
    return false;
  }
}

/**
 * Il giro completo da fare all'avvio.
 * Non solleva mai: qualunque cosa vada storta, l'applicazione deve partire.
 */
export async function apri(origine) {
  const base = (origine || ORIGINE).replace(/\/+$/, '');
  const inCasa = locale();
  const versioneLocale = (() => {
    try { return window.localStorage.getItem(CHIAVE_VERSIONE) || ''; }
    catch (e) { return ''; }
  })();

  let manifest = null;
  let motivo = '';
  try {
    manifest = await (await conAttesa(base + '/manifest.json', ATTESA_MANIFEST)).json();
  } catch (e) {
    motivo = (e && e.stato === 404)
      ? 'nessun pacchetto pubblicato a quell indirizzo'
      : 'nessuna risposta da internet';
  }

  if (manifest && parseInt(manifest.schema || 1, 10) > SCHEMA_LETTO) {
    if (inCasa) {
      return { dati: new Dati(inCasa), stato: 'troppo_nuovi',
               nota: 'i dati pubblicati vogliono una versione piu’ recente '
                     + 'dell’applicazione' };
    }
    return { dati: null, stato: 'troppo_nuovi',
             nota: 'aggiorna l’applicazione: i dati sono in un formato piu’ nuovo' };
  }

  const remota = manifest ? (manifest.generato_il || '') : '';
  if (inCasa && (!remota || remota <= versioneLocale)) {
    return { dati: new Dati(inCasa),
             stato: manifest ? 'gia_aggiornato' : 'offline', nota: motivo };
  }

  if (manifest) {
    try {
      const r = await conAttesa(base + '/dati.json', ATTESA_PACCHETTO);
      const grezzi = await r.json();
      if (!grezzi.giocatori || grezzi.giocatori.righe.length < 100) {
        throw new Error('pacchetto incompleto');
      }
      salvaLocale(grezzi, remota);
      return { dati: new Dati(grezzi), stato: 'aggiornato', nota: '' };
    } catch (e) {
      if (inCasa) {
        return { dati: new Dati(inCasa), stato: 'errore', nota: String(e.message || e) };
      }
      return { dati: null, stato: 'errore', nota: String(e.message || e) };
    }
  }

  return { dati: inCasa ? new Dati(inCasa) : null, stato: 'offline', nota: motivo };
}

/** Carica un pacchetto gia' in mano, senza toccare la rete (prove e sviluppo). */
export function da(grezzi) { return new Dati(grezzi); }

export function dimentica() {
  try {
    window.localStorage.removeItem(CHIAVE_DATI);
    window.localStorage.removeItem(CHIAVE_VERSIONE);
  } catch (e) { /* niente da fare */ }
}
