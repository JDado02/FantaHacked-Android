// Cento aste giocate **dall'applicazione del telefono**.
//
// E' la traduzione di `simulazioni/cento_aste.py`, e non e' un esercizio: le
// prove di equivalenza dicono che i due motori calcolano gli stessi numeri in
// quattro momenti scelti a tavolino, questa dice un'altra cosa - che giocando
// un'asta intera, duecento chiamate una dopo l'altra, con gli stessi
// avversari e lo stesso caso, finiscono con la stessa rosa e lo stesso
// punteggio. E' la differenza fra "sa fare i conti" e "sa giocare".
//
// Perche' funzioni, il caso deve essere lo stesso: vedi `casuale.js`.
// Ogni riga qui sotto segue l'ordine delle chiamate al generatore che fa il
// programma Python, comprese quelle che **non** vengono fatte - un avversario
// senza slot o senza crediti esce prima di estrarre il suo errore, e saltare
// quel controllo sposterebbe tutta l'asta da li' in poi.

import { Casuale } from './casuale.js';

export const RUOLI = ['P', 'D', 'C', 'A'];
export const NOMI = ['Davide', 'Jacopo', 'Windser', 'Luca',
                     'Viane', 'Giorgio', 'Fede', 'Canzia'];

// Quanto sbaglia un umano, per ruolo: mediana del moltiplicatore e dispersione.
const RUMORE = { P: [1.05, 0.16], D: [1.06, 0.22],
                 C: [1.10, 0.26], A: [1.22, 0.32] };
const CONCENTRAZIONE = 26.0;
const MARGINE = 0.0;

const QUANTI_TITOLARI = { P: 1, D: 4, C: 4, A: 2 };

function dirichlet(rng, alpha) {
  const campioni = alpha.map((a) => rng.gammavariate(a, 1.0));
  const tot = campioni.reduce((s, c) => s + c, 0) || 1.0;
  return campioni.map((c) => c / tot);
}

function caratteri(rng, reg) {
  const base = RUOLI.map((r) => reg.quota_budget[r]);
  const fuori = {};
  for (const nome of NOMI.slice(1)) {
    const quote = dirichlet(rng, base.map((q) => Math.max(0.4, q * CONCENTRAZIONE)));
    const d = {};
    RUOLI.forEach((r, i) => { d[r] = quote[i]; });
    fuori[nome] = d;
  }
  return fuori;
}

/** Il prezzo da cui parte un avversario medio, per ogni giocatore: i prezzi
 *  storici d'asta riportati in scala sul monte crediti della lega. */
export function ancoreDiMercato(v, reg) {
  const quota = {};
  const somma = {};
  for (const r of RUOLI) {
    quota[r] = reg.slot[r] * reg.partecipanti;
    const pool = [...v.g.values()].filter((x) => x.ruolo === r)
      .map((x) => x.prezzo_riferimento || 0.0)
      .sort((a, b) => b - a);
    somma[r] = pool.slice(0, quota[r]).reduce((s, p) => s + p, 0) || 1.0;
  }
  const monte = reg.crediti_totali;
  const totale = RUOLI.reduce((s, r) => s + somma[r], 0);
  const ancora = new Map();
  for (const x of v.g.values()) {
    const budgetR = (monte * somma[x.ruolo]) / totale;
    const k = (budgetR - quota[x.ruolo]) / somma[x.ruolo];
    let rif = x.prezzo_riferimento || 0.0;
    if (rif <= 0) rif = x.qi || 1;
    ancora.set(x.id, Math.max(1.0, 1.0 + rif * k));
  }
  return ancora;
}

function offerta(rng, x, ruolo, carattere, liquidita, slotRuolo, spesoRuolo,
                 reg, ancora) {
  if (slotRuolo <= 0 || liquidita < 1) return 0;
  const inclinazione = carattere[ruolo] / Math.max(1e-6, reg.quota_budget[ruolo]);
  const [mu, sigma] = RUMORE[ruolo];
  let errore = rng.lognormvariate(Math.log(mu), sigma);
  if (rng.random() < (ruolo === 'A' ? 0.05 : 0.02)) {
    errore *= rng.uniform(1.4, 2.0);
  }
  let valore = (ancora.get(x.id) || 1.0) * (0.45 + 0.55 * inclinazione) * errore;
  const tetto = Math.max(1.0, carattere[ruolo] * reg.crediti - spesoRuolo);
  valore = Math.min(valore, (tetto * 3.0) / Math.max(1, slotRuolo));
  return Math.trunc(Math.max(0, Math.min(arrotondaPython(valore), liquidita)));
}

/** `round()` di Python: a meta' strada va al pari, non sempre in su. */
function arrotondaPython(x) {
  const giu = Math.floor(x);
  const resto = x - giu;
  if (resto > 0.5) return giu + 1;
  if (resto < 0.5) return giu;
  return giu % 2 === 0 ? giu : giu + 1;
}

function undiciAtteso(rosa) {
  let tot = 0.0;
  for (const r of RUOLI) {
    const migliori = rosa[r].slice()
      .sort((a, b) => (b.punti || 0) - (a.punti || 0))
      .slice(0, QUANTI_TITOLARI[r]);
    tot += migliori.reduce((s, d) => s + (d.punti || 0), 0);
  }
  return tot;
}

function punteggio(rosa, reg, mod) {
  const totale = undiciAtteso(rosa);
  if (!mod.attivo) return totale;
  const nPor = reg.mod_dif_n_por;
  const nDif = reg.mod_dif_n_dif;
  const por = rosa.P.slice().sort((a, b) => (b.mv || 0) - (a.mv || 0)).slice(0, nPor);
  const dif = rosa.D.slice().sort((a, b) => (b.mv || 0) - (a.mv || 0)).slice(0, nDif);
  const scelti = por.concat(dif);
  if (scelti.length < nPor + nDif) return totale;
  const media = scelti.reduce((s, d) => s + (d.mv || 0), 0) / scelti.length;
  return totale + mod.puntiStagione(media);
}

/**
 * Un'asta intera, giocata col motore di questa applicazione.
 * `costruisci` riceve lo stato e restituisce {v, o, c}: cosi' il simulatore
 * non deve sapere come si mettono insieme i moduli.
 */
export function giocaAsta(seme, ctx) {
  const { Regole, StatoAsta, Valutatore, Ottimizzatore, Modificatore,
          dati, regoleJson } = ctx;
  const rng = new Casuale(seme);
  const reg = Regole(regoleJson);
  const st = new StatoAsta(reg, null);
  st.collega(new Map(dati.giocatori.map((g) => [g.id, g])));
  st.inizializza(NOMI.slice(1), NOMI[0]);

  let v = new Valutatore(dati, reg, st);
  let o = new Ottimizzatore(v);

  const ancora = ancoreDiMercato(v, reg);
  const carattere = caratteri(rng, reg);
  const perId = new Map(st.presidenti().map((p) => [p.nome, p.id]));
  const ioId = st.io().id;
  const speso = {};
  for (const n of NOMI) { speso[n] = { P: 0, D: 0, C: 0, A: 0 }; }

  const mieiLimiti = [];
  let persiDiUnSoffio = 0;

  const esauriti = new Set();
  // Un'asta finisce in duecento chiamate; il tetto e' dieci volte tanto e non
  // serve a niente finche' tutto funziona. Serve il giorno in cui qualcosa si
  // avvita: meglio un errore con dentro il seme che una pagina che non
  // risponde piu' e non dice perche'.
  let giri = 0;
  for (;;) {
    giri += 1;
    if (giri > 5000) throw new Error('asta ' + seme + ': il giro non si chiude');
    let fase = null;
    for (const r of RUOLI) {
      if (!esauriti.has(r) && st.slotResiduiRuolo(r) > 0) { fase = r; break; }
    }
    if (fase === null) break;
    const liberi = v.disponibili(fase).filter(
      (x) => !(reg.portieri_pacchetto && fase === 'P' && !x.titolare_por));
    if (!liberi.length) { esauriti.add(fase); continue; }
    const finestra = liberi.slice()
      .sort((a, b) => (ancora.get(b.id) || 0) - (ancora.get(a.id) || 0))
      .slice(0, 8);
    const x = rng.choice(finestra);

    const offerte = [];
    for (const nome of NOMI.slice(1)) {
      const pid = perId.get(nome);
      if (st.slotResidui(pid, fase) <= 0) continue;
      const off = offerta(rng, x, fase, carattere[nome], st.liquidita(pid),
                          st.slotResidui(pid, fase), speso[nome][fase],
                          reg, ancora);
      if (off >= 1) offerte.push([off, nome]);
    }

    let mio = 0;
    if (st.slotResidui(ioId, fase) > 0) {
      const limite = o.maxBid(x)[0];
      mio = limite >= 1 ? Math.trunc(limite * (1.0 + MARGINE)) : 0;
      mio = Math.min(mio, st.liquidita(ioId));
    }
    if (mio >= 1) offerte.push([mio, NOMI[0]]);
    if (!offerte.length) { v.scarta(x.id); continue; }

    // `sorted(reverse=True)` su tuple: prima l'offerta, poi il nome, e a
    // parita' di offerta vince il nome piu' avanti nell'alfabeto.
    offerte.sort((a, b) => (b[0] - a[0]) || (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0));
    const vincitore = offerte[0][1];
    const secondo = offerte.length > 1 ? offerte[1][0] : 0;
    let prezzo = Math.max(1, Math.min(offerte[0][0], secondo + 1));
    const pid = perId.get(vincitore);
    prezzo = Math.min(prezzo, st.liquidita(pid));
    if (prezzo < 1) { v.scarta(x.id); continue; }
    if (vincitore === NOMI[0]) {
      mieiLimiti.push([mio, prezzo, ancora.get(x.id) || 0, fase]);
    } else if (mio >= 1 && offerte[0][0] - mio <= 2) {
      persiDiUnSoffio += 1;
    }
    try {
      st.registra(x.id, pid, prezzo, null);
    } catch (e) {
      v.scarta(x.id);
      continue;
    }
    speso[vincitore][fase] += prezzo;
    if (reg.portieri_pacchetto && fase === 'P') {
      for (const rid of v.riserveDi(x.id)) {
        if (st.venduti().has(rid) || st.slotResidui(pid, 'P') <= 0) continue;
        try {
          st.registra(rid, pid, 1, null);
          speso[vincitore].P += 1;
        } catch (e) { /* slot pieno */ }
      }
    }
    v.aggiorna();
    o.aggiorna();
  }

  // --- il conto finale ----------------------------------------------------
  const mod = new Modificatore(reg);
  const rose = {};
  const acquisti = st.acquisti();
  for (const nome of NOMI) {
    const pid = perId.get(nome);
    const rosa = { P: [], D: [], C: [], A: [] };
    for (const a of acquisti) {
      if (a.presidente_id !== pid) continue;
      const g = v.g.get(a.giocatore_id);
      rosa[a.ruolo].push({
        nome: a.nome, squadra: a.squadra, prezzo: a.prezzo,
        presenze: g ? Math.round(g.presenze) : 0,
        punti: g ? arrotondaPython(g.presenze * g.fm) : 0,
        mv: g ? Math.round(g.mv * 1000) / 1000 : 0.0,
      });
    }
    rose[nome] = rosa;
  }

  const punti = {};
  const senzaMod = {};
  for (const n of NOMI) {
    punti[n] = punteggio(rose[n], reg, mod);
    senzaMod[n] = undiciAtteso(rose[n]);
  }
  const mia = rose[NOMI[0]];
  const spesa = {};
  const slot = {};
  for (const r of RUOLI) {
    spesa[r] = mia[r].reduce((s, d) => s + d.prezzo, 0);
    slot[r] = mia[r].length;
  }
  return {
    seme,
    punti,
    senza_modificatore: senzaMod,
    spesa,
    slot,
    avanzati: st.io().crediti,
    limiti: mieiLimiti,
    soffiati: persiDiUnSoffio,
  };
}

export function posto(esito) {
  const p = esito.punti;
  return 1 + NOMI.slice(1).filter((n) => p[n] > p[NOMI[0]]).length;
}
