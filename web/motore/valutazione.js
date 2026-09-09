// Valutazione live: da punti attesi a prezzo consigliato, ricalcolato a ogni
// acquisto. Traduzione fedele di `motore/valutazione.py`.
//
// Tre livelli:
//   1. punti totali   = punti attesi individuali + contributo al modificatore
//   2. VOR            = punti sopra il giocatore di rimpiazzo, dinamico
//   3. prezzo mercato = quota del pool ancora in circolo, secondo il VOR
//
// La proprieta' che rende affidabile il terzo livello: la somma dei prezzi su
// tutti i giocatori ancora prendibili e' esattamente uguale ai crediti ancora
// in mano alla lega. Il mercato si chiude per costruzione.
//
// Nota sull'ordinamento. Python ordina in modo stabile, e a parita' di chiave
// l'ordine e' quello di inserimento, cioe' l'id crescente. JavaScript ordina
// stabile anch'esso (dal 2019), quindi basta caricare la lista in ordine di id
// perche' i pareggi si sciolgano allo stesso modo. Non e' pignoleria: sul
// livello di rimpiazzo due giocatori appaiati al decimo capitano davvero, e
// scioglierli in ordine diverso sposta il prezzo di tutto il reparto.

import { Modificatore } from './modificatore.js';
import { arrotonda } from './comune.js';

export const RUOLI = ['P', 'D', 'C', 'A'];
export const GIORNATE = 38.0;
export const AMPIEZZA_RIMPIAZZO = 2;
export const PRUDENZA_AGGRESSIVITA = 80.0;
export const AGGRESSIVITA_MIN = 0.65;
export const AGGRESSIVITA_MAX = 1.75;

// --- la curva dei prezzi ---------------------------------------------------
export const SOGLIA_STORICO = 4.0;
export const QI_MINIMO = 3;
export const OSSERVAZIONI_MINIME = 20;
export const TETTO_PESO = 0.5;
export const PESO_CURVA = 0.6;

// Minimi quadrati su due variabili piu' costante: sistema 3x3 per
// eliminazione. Il caso singolare torna null, e chi chiama ripiega sul merito.
export function regressione(righe) {
  const n = righe.length;
  const X = righe.map((r) => [1.0, r[0], r[1]]);
  const y = righe.map((r) => r[2]);
  const M = [];
  for (let a = 0; a < 3; a += 1) {
    const riga = [];
    for (let b = 0; b < 3; b += 1) {
      let s = 0;
      for (let i = 0; i < n; i += 1) s += X[i][a] * X[i][b];
      riga.push(s);
    }
    let s2 = 0;
    for (let i = 0; i < n; i += 1) s2 += X[i][a] * y[i];
    riga.push(s2);
    M.push(riga);
  }
  for (let i = 0; i < 3; i += 1) {
    let p = i;
    for (let r = i; r < 3; r += 1) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    if (Math.abs(M[p][i]) < 1e-9) return null;
    const t = M[i]; M[i] = M[p]; M[p] = t;
    for (let r = 0; r < 3; r += 1) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let c = 0; c < 4; c += 1) M[r][c] -= f * M[i][c];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

const ETICHETTE = {
  titolare: 'Titolare', ballottaggio: 'Ballottaggio',
  rotazione: 'Rotazione', riserva: 'Riserva',
};

export class Giocatore {
  constructor(d) { Object.assign(this, d); }

  get sicuro() { return this.grado === 'titolare' && (this.certezza || 0) >= 0.55; }

  get etichetta_grado() { return ETICHETTE[this.grado] || 'Da verificare'; }
}

export class Valutatore {
  constructor(dati, regole, stato) {
    this.dati = dati;
    this.reg = regole;
    this.stato = stato;
    this.mod = new Modificatore(regole);
    this.g = new Map();
    this.lista = [];
    this._carica();
    this._caricaCoppie();
    this._strutturaPortieri();
    this._contributoModificatore();
    this.riferimento = null;
    this._poolIniziale = 0;
    this._curvaPrezzi();
    this._prezziBase();
    this.aggiorna();
    this.riferimento = this._densita;
    this._poolIniziale = Math.max(1, this.reg.crediti_totali - this.reg.slot_lega);
  }

  // ---------------------------------------------------------- caricamento
  _carica() {
    for (const r of this.dati.giocatori) {
      if (!r.attivo) continue;
      const p = this.dati.proiezioni.get(r.id) || {};
      const c = this.dati.contesto.get(r.id) || {};
      const pa = this.dati.prezzi.get(r.id);
      const x = new Giocatore({
        id: r.id, nome: r.nome, squadra: r.squadra, ruolo: r.ruolo,
        qi: r.qi || 1,
        punti_base: p.punti_attesi || 0.0,
        mv: p.mv_attesa || 0.0,
        metodo: p.metodo || 'ignoto',
        affidabilita: p.affidabilita || 0.0,
        punti_mod: 0.0,
        presenze: p.presenze_attese || 0.0,
        fm: p.fantamedia_attesa || 0.0,
        titolarita: p.titolarita, posto_reparto: p.posto_reparto,
        in_reparto: p.in_reparto, grado: p.grado, certezza: p.certezza,
        nuovo: !!r.nuovo_acquisto,
        fuori_lista: !!p.fuori_lista,
        rigorista: c.rigorista || 0,
        prezzo_riferimento: (pa || 0.0) * this.reg.crediti / 1000.0,
        punti: null, vor: null, prezzo_mercato: null, prezzo_atteso: null,
        prezzo_base: null, prezzo_piano: null, peso_prezzo: null,
        titolare_por: false, riserve_por: [],
      });
      this.g.set(x.id, x);
      this.lista.push(x);
    }
    // Ordine di id crescente, come li restituisce SQLite al motore Python.
    this.lista.sort((a, b) => a.id - b.id);
  }

  // ------------------------------------------------- coppie complementari
  _caricaCoppie() {
    this.coppie = new Map();
    for (const r of (this.dati.accoppiate || [])) {
      const a = r.id_titolare;
      const b = r.id_vice;
      if (!this.g.has(a) || !this.g.has(b)) continue;
      const pa = this.g.get(a).presenze || 0.0;
      const pb = this.g.get(b).presenze || 0.0;
      const buchi = Math.max(0.0, GIORNATE - pa);
      const tappati = Math.min(pb, buchi);
      const comune = {
        tipo: r.tipo,
        copertura: (pa + tappati) / GIORNATE,
        giornate_coperte: pa + tappati,
        buchi, buchi_coperti: tappati,
        copertura_buchi: buchi > 0 ? (tappati / buchi) : 0.0,
        fonti: r.fonti || '', nota: r.nota || '',
      };
      if (!this.coppie.has(a)) this.coppie.set(a, []);
      if (!this.coppie.has(b)) this.coppie.set(b, []);
      this.coppie.get(a).push(Object.assign({}, comune, { altro: b, ruolo_nella_coppia: 'titolare' }));
      this.coppie.get(b).push(Object.assign({}, comune, { altro: a, ruolo_nella_coppia: 'vice' }));
    }
    for (const v of this.coppie.values()) {
      v.sort((p, q) => q.copertura_buchi - p.copertura_buchi);
    }
  }

  compagniDiMaglia(giocatoreId) { return (this.coppie.get(giocatoreId) || []).slice(); }

  // -------------------------------------------------- portieri a pacchetto
  _strutturaPortieri() {
    const perSquadra = new Map();
    for (const x of this.lista) {
      x.titolare_por = false;
      x.riserve_por = [];
      if (x.ruolo === 'P') {
        if (!perSquadra.has(x.squadra)) perSquadra.set(x.squadra, []);
        perSquadra.get(x.squadra).push(x);
      }
    }
    this.pacchetto = !!this.reg.portieri_pacchetto;
    if (!this.pacchetto) return;
    for (const l of perSquadra.values()) {
      l.sort((a, b) => (b.presenze * b.fm) - (a.presenze * a.fm));
      l[0].titolare_por = true;
      l[0].riserve_por = l.slice(1).map((y) => y.id);
    }
  }

  riserveDi(giocatoreId) {
    const x = this.g.get(giocatoreId);
    if (!x || !x.titolare_por) return [];
    return (x.riserve_por || []).slice();
  }

  // -------------------------------------------------- la curva dei prezzi
  _curvaPrezzi() {
    this.curva = {};
    for (const ruolo of RUOLI) {
      // I portieri restano fuori: con le riserve a un credito lo storico
      // d'asta descrive un'altra lega.
      if (this.pacchetto && ruolo === 'P') continue;
      const righe = [];
      for (const x of this.lista) {
        if (x.ruolo !== ruolo) continue;
        const prezzo = x.prezzo_riferimento || 0.0;
        if (prezzo < SOGLIA_STORICO || (x.qi || 0) < QI_MINIMO) continue;
        // Chi non puo' giocare porta il prezzo che aveva quando giocava e zero
        // punti: e' esattamente la coppia che storce la retta.
        if (x.fuori_lista) continue;
        righe.push([Math.log(x.qi), Math.log(Math.max(1.0, this._puntiGrezzi(x))),
                    Math.log(prezzo)]);
      }
      if (righe.length >= OSSERVAZIONI_MINIME) {
        const c = regressione(righe);
        if (c) this.curva[ruolo] = c;
      }
    }
    for (const x of this.lista) {
      const c = this.curva[x.ruolo];
      if (!c) { x.peso_prezzo = null; continue; }
      const [a, b, k] = c;
      const grezzo = a + b * Math.log(Math.max(1.0, x.qi || 1))
                   + k * Math.log(Math.max(1.0, this._puntiGrezzi(x)));
      x.peso_prezzo = Math.min(Math.exp(grezzo), TETTO_PESO * this.reg.crediti);
    }
    return this;
  }

  _tettoReparto(ruolo, slotRes) {
    if (!(this.pacchetto && ruolo === 'P')) return Infinity;
    const venduti = this.stato.venduti();
    const liberi = this.lista.filter(
      (x) => x.ruolo === 'P' && x.titolare_por && !venduti.has(x.id));
    if (liberi.length) return Infinity;
    return slotRes;
  }

  _ripiegoPrezzo(x) {
    if (this.pacchetto && x.ruolo === 'P' && !x.titolare_por) return 0.0;
    return Math.max(0.0, (x.presenze || 0.0) * (x.fm || 0.0));
  }

  _pesi(vor, pool, slotResidui) {
    const quote = (valori) => {
      const fuori = new Map();
      for (const ruolo of RUOLI) {
        // Chi non puo' scendere in campo non prende una fetta del reparto: se
        // la prendesse, sarebbe tolta a chi gioca davvero.
        const dentro = this.lista.filter((x) => x.ruolo === ruolo && !x.fuori_lista);
        let usa = valori;
        let somma = dentro.reduce((s, x) => s + Math.max(0.0, usa.get(x.id) || 0.0), 0);
        if (somma <= 0) {
          usa = new Map(dentro.map((x) => [x.id, this._ripiegoPrezzo(x)]));
          somma = dentro.reduce((s, x) => s + Math.max(0.0, usa.get(x.id) || 0.0), 0);
        }
        const libero = Math.max(0.0, pool[ruolo] || 0.0);
        for (const x of dentro) {
          if (somma > 0 && libero > 0) {
            fuori.set(x.id, 1.0 + Math.max(0.0, usa.get(x.id) || 0.0) / somma * libero);
          } else {
            fuori.set(x.id, 1.0);
          }
        }
      }
      for (const x of this.lista) if (!fuori.has(x.id)) fuori.set(x.id, 1.0);
      return fuori;
    };

    const merito = quote(vor);
    const curva = quote(new Map(this.lista.map((x) => [x.id, x.peso_prezzo || 0.0])));

    const peso = new Map();
    for (const x of this.lista) {
      if (x.fuori_lista) {
        peso.set(x.id, 0.0);
      } else if (this.pacchetto && x.ruolo === 'P' && !x.titolare_por) {
        peso.set(x.id, 0.0);
      } else if (x.peso_prezzo === null || x.peso_prezzo === undefined) {
        peso.set(x.id, Math.max(0.0, merito.get(x.id) - 1.0));
      } else {
        const prezzo = Math.exp((1.0 - PESO_CURVA) * Math.log(merito.get(x.id))
                                + PESO_CURVA * Math.log(curva.get(x.id)));
        peso.set(x.id, Math.max(0.0, prezzo - 1.0));
      }
    }
    return peso;
  }

  _puntiGrezzi(x) { return (x.punti_base || 0.0) + (x.punti_mod || 0.0); }

  // ------------------------------------------ il prezzo che non si muove
  _prezziBase() {
    const reg = this.reg;
    // Livello di rimpiazzo sul listone intero, con tutti gli slot della lega
    // ancora da assegnare.
    const rimpiazzo = {};
    for (const ruolo of RUOLI) {
      let pool = this.lista.filter((x) => x.ruolo === ruolo)
        .sort((a, b) => ((b.presenze || 0) * (b.fm || 0))
                      - ((a.presenze || 0) * (a.fm || 0)));
      let n = reg.slot[ruolo] * reg.partecipanti;
      if (ruolo === 'P' && this.pacchetto) {
        pool = pool.filter((x) => x.titolare_por);
        n = Math.max(1, Math.floor(n / Math.max(1, reg.slot.P)));
      }
      if (!pool.length) { rimpiazzo[ruolo] = 0.0; continue; }
      const i = Math.min(n, pool.length - 1);
      const finestra = pool.slice(Math.max(0, i - AMPIEZZA_RIMPIAZZO),
                                  Math.min(pool.length, i + AMPIEZZA_RIMPIAZZO + 1));
      rimpiazzo[ruolo] = finestra.reduce((s, x) => s + x.fm, 0) / finestra.length;
    }

    const vor = new Map();
    for (const x of this.lista) {
      let v = (x.presenze || 0.0) * ((x.fm || 0.0) - rimpiazzo[x.ruolo])
            + (x.punti_mod || 0.0);
      if (this.pacchetto && x.ruolo === 'P' && !x.titolare_por) v = 0.0;
      vor.set(x.id, Math.max(0.0, v));
    }
    const poolIniziale = {};
    const slotPieni = {};
    for (const ruolo of RUOLI) {
      const slot = reg.slot[ruolo] * reg.partecipanti;
      slotPieni[ruolo] = slot;
      poolIniziale[ruolo] = Math.max(
        0.0, reg.quota_mercato[ruolo] * reg.crediti_totali - slot);
    }
    const peso = this._pesi(vor, poolIniziale, slotPieni);

    const somma = {};
    for (const ruolo of RUOLI) {
      const ordinati = this.lista.filter((x) => x.ruolo === ruolo)
        .sort((a, b) => peso.get(b.id) - peso.get(a.id));
      const quanti = reg.slot[ruolo] * reg.partecipanti;
      somma[ruolo] = ordinati.slice(0, quanti)
        .reduce((s, x) => s + peso.get(x.id), 0);
    }
    for (const ruolo of RUOLI) {
      const slot = reg.slot[ruolo] * reg.partecipanti;
      const budget = reg.quota_mercato[ruolo] * reg.crediti_totali;
      const poolR = Math.max(0.0, budget - slot);
      for (const x of this.lista) {
        if (x.ruolo !== ruolo) continue;
        x.prezzo_base = (somma[ruolo] > 0 && poolR > 0)
          ? 1.0 + peso.get(x.id) / somma[ruolo] * poolR
          : 1.0;
      }
    }
    return this;
  }

  // Il livello di rimpiazzo "a listone intero", che serve solo ai prezzi base.
  _rimpiazzoIniziale(ruolo) {
    if (this._rimpIniz && this._rimpIniz[ruolo] !== undefined) return this._rimpIniz[ruolo];
    if (!this._rimpIniz) this._rimpIniz = {};
    const pool = this.lista.filter((x) => x.ruolo === ruolo)
      .sort((a, b) => (b.presenze * b.fm) - (a.presenze * a.fm));
    let n = this.reg.slot_lega_ruolo(ruolo);
    let p = pool;
    if (ruolo === 'P' && this.pacchetto) {
      p = pool.filter((x) => x.titolare_por);
      n = Math.max(0, Math.floor(n / Math.max(1, this.reg.slot.P)));
    }
    let v;
    if (!p.length) v = 0.0;
    else if (n <= 0) v = p[0].fm;
    else {
      const i = Math.min(n, p.length - 1);
      const finestra = p.slice(Math.max(0, i - AMPIEZZA_RIMPIAZZO),
                               Math.min(p.length, i + AMPIEZZA_RIMPIAZZO + 1));
      v = finestra.reduce((s, x) => s + x.fm, 0) / finestra.length;
    }
    this._rimpIniz[ruolo] = v;
    return v;
  }

  // ------------------------------- contributo al modificatore di difesa
  _contributoModificatore() {
    if (!this.mod.attivo) return;
    const P = this.reg.partecipanti;
    const posti = { P: this.reg.mod_dif_n_por * P, D: this.reg.mod_dif_n_dif * P };
    const rif = {};
    for (const ruolo of ['P', 'D']) {
      const nUtili = posti[ruolo];
      if (nUtili <= 0) continue;
      const ordinati = this.lista.filter((x) => x.ruolo === ruolo)
        .sort((a, b) => b.mv - a.mv);
      const utili = ordinati.slice(0, nUtili).length ? ordinati.slice(0, nUtili)
                                                     : ordinati.slice(0, 1);
      rif[ruolo] = [utili.reduce((s, x) => s + x.mv, 0) / utili.length,
                    ordinati[Math.min(nUtili, ordinati.length) - 1].mv];
    }
    if (!rif.D) return;
    const nPor = this.reg.mod_dif_n_por;
    const nDif = this.reg.mod_dif_n_dif;
    const mediaRif = (nPor * (rif.P || rif.D)[0] + nDif * rif.D[0]) / (nPor + nDif);

    for (const ruolo of ['P', 'D']) {
      if (!rif[ruolo]) continue;
      const nUtili = posti[ruolo];
      const nTotali = Math.max(this.reg.slot_lega_ruolo(ruolo), nUtili + 1);
      const mvMarginale = rif[ruolo][1];
      const ordinati = this.lista.filter((x) => x.ruolo === ruolo)
        .sort((a, b) => b.mv - a.mv);
      let rango = 0;
      for (const x of ordinati) {
        rango += 1;
        if (x.fuori_lista) { x.punti_mod = 0.0; continue; }
        let inclusione;
        if (rango <= nUtili) inclusione = 1.0;
        else if (rango <= nTotali) inclusione = 1.0 - (rango - nUtili) / (nTotali - nUtili);
        else inclusione = 0.0;
        if (inclusione <= 0) continue;
        x.punti_mod = inclusione * this.mod.contributoMarginale(x.mv, mvMarginale, mediaRif);
      }
    }
  }

  // -------------------------------------------------------------- ricalcolo
  aggiorna() {
    this._concorrentiPerRuolo = {};
    const venduti = this.stato.venduti();
    const disponibili = this.lista.filter((x) => !venduti.has(x.id));

    this.rimpiazzo_fm = {};
    this.candidati = {};
    for (const ruolo of RUOLI) {
      let pool = disponibili.filter((x) => x.ruolo === ruolo)
        .sort((a, b) => (b.presenze * b.fm) - (a.presenze * a.fm));
      let n = this.stato.slotResiduiRuolo(ruolo);
      if (ruolo === 'P' && this.pacchetto) {
        pool = pool.filter((x) => x.titolare_por);
        n = Math.max(0, Math.floor(n / Math.max(1, this.reg.slot.P)));
      }
      if (!pool.length) this.rimpiazzo_fm[ruolo] = 0.0;
      else if (n <= 0) this.rimpiazzo_fm[ruolo] = pool[0].fm;
      else {
        const i = Math.min(n, pool.length - 1);
        const finestra = pool.slice(Math.max(0, i - AMPIEZZA_RIMPIAZZO),
                                    Math.min(pool.length, i + AMPIEZZA_RIMPIAZZO + 1));
        this.rimpiazzo_fm[ruolo] = finestra.reduce((s, x) => s + x.fm, 0) / finestra.length;
      }
    }

    for (const x of this.lista) {
      x.punti = x.presenze * (x.fm - this.rimpiazzo_fm[x.ruolo]) + (x.punti_mod || 0.0);
      x.vor = Math.max(0.0, x.punti);
      if (this.pacchetto && x.ruolo === 'P' && !x.titolare_por) x.vor = 0.0;
    }

    this._pesaColMercato(disponibili);
    this._aggressivita();

    for (const ruolo of RUOLI) {
      const pool = disponibili.filter((x) => x.ruolo === ruolo)
        .sort((a, b) => b.vor - a.vor);
      const n = Math.max(this.stato.slotResiduiRuolo(ruolo), 0);
      if (ruolo === 'P' && this.pacchetto) {
        const titolari = pool.filter((x) => x.titolare_por);
        const quanti = Math.max(0, Math.floor(n / Math.max(1, this.reg.slot.P)));
        const scelti = titolari.slice(0, quanti);
        const assegnati = scelti.slice();
        for (const t of scelti) {
          for (const rid of (t.riserve_por || [])) {
            const y = this.g.get(rid);
            if (y && !venduti.has(y.id)) assegnati.push(y);
          }
        }
        if (assegnati.length < n) {
          const gia = new Set(assegnati.map((x) => x.id));
          for (const y of pool) {
            if (assegnati.length >= n) break;
            if (!gia.has(y.id)) assegnati.push(y);
          }
        }
        this.candidati[ruolo] = assegnati.slice(0, n);
        continue;
      }
      this.candidati[ruolo] = pool.slice(0, n);
    }

    this.crediti_residui = this.stato.creditiResiduiLega;
    this.slot_residui = this.stato.slotResiduiLega;
    this.pool_discrezionale = Math.max(0, this.crediti_residui - this.slot_residui);
    this.vor_totale = RUOLI.reduce(
      (s, r) => s + this.candidati[r].reduce((t, x) => t + x.vor, 0), 0);

    for (const x of this.lista) {
      x.prezzo_mercato = (this.vor_totale > 0 && this.pool_discrezionale > 0)
        ? 1.0 + x.vor / this.vor_totale * this.pool_discrezionale
        : 1.0;
    }
    this._densita = this.vor_totale > 0
      ? this.pool_discrezionale / this.vor_totale : 0.0;
    this._prezziAttesi();
    return this;
  }

  // ------------------------------------------- il parere del mercato
  _aggressivita() {
    const speso = new Map();
    const atteso = new Map();
    for (const a of this.stato.acquisti()) {
      const x = this.g.get(a.giocatore_id);
      if (!x) continue;
      speso.set(a.presidente_id, (speso.get(a.presidente_id) || 0) + a.prezzo);
      atteso.set(a.presidente_id,
        (atteso.get(a.presidente_id) || 0) + (x.prezzo_base || 1.0));
    }
    this.aggressivita = {};
    for (const p of this.stato.presidenti()) {
      const sp = speso.get(p.id) || 0.0;
      const at = atteso.get(p.id) || 0.0;
      const k = PRUDENZA_AGGRESSIVITA;
      const valore = (at + k) > 0 ? (sp + k) / (at + k) : 1.0;
      this.aggressivita[p.id] = Math.min(AGGRESSIVITA_MAX,
        Math.max(AGGRESSIVITA_MIN, valore));
    }
    return this.aggressivita;
  }

  _pesaColMercato(disponibili) {
    const b = this.reg.fiducia_mercato || 0.0;
    this.parere_mercato = new Map();
    if (b <= 0) return;
    for (const ruolo of RUOLI) {
      const pool = disponibili.filter((x) => x.ruolo === ruolo);
      const conPrezzo = pool.filter((x) => (x.prezzo_riferimento || 0) > 0);
      if (conPrezzo.length < 8) continue;
      const sommaVor = conPrezzo.reduce((s, x) => s + x.vor, 0);
      const sommaRif = conPrezzo.reduce((s, x) => s + x.prezzo_riferimento, 0);
      if (sommaRif <= 0 || sommaVor <= 0) continue;
      const k = sommaVor / sommaRif;
      for (const x of pool) {
        const rif = x.prezzo_riferimento || 0;
        if (rif <= 0) continue;
        if (this.pacchetto && ruolo === 'P' && !x.titolare_por) continue;
        const secondoMercato = rif * k;
        this.parere_mercato.set(x.id, secondoMercato);
        x.punti = (1 - b) * x.punti + b * secondoMercato;
        x.vor = Math.max(0.0, x.punti);
      }
    }
  }

  // ---------------------------------------------------------- prezzi attesi
  _prezziAttesi() {
    const reg = this.reg;
    const st = this.stato;
    const speso = {};
    const slotRes = {};
    for (const r of RUOLI) {
      speso[r] = st.spesoRuolo(r);
      slotRes[r] = Math.max(0, st.slotResiduiRuolo(r));
    }

    const reparti = (quota) => {
      const rimane = {};
      for (const r of RUOLI) {
        if (slotRes[r] <= 0) { rimane[r] = 0.0; continue; }
        const previsto = quota[r] * reg.crediti_totali;
        rimane[r] = Math.max(slotRes[r],
          reg.impara_mercato ? previsto - speso[r] : previsto);
        rimane[r] = Math.min(rimane[r], this._tettoReparto(r, slotRes[r]));
      }
      const somma = RUOLI.reduce((s, r) => s + rimane[r], 0) || 1.0;
      const scala = this.crediti_residui / somma;
      const out = {};
      for (const r of RUOLI) out[r] = Math.max(slotRes[r], rimane[r] * scala);
      return out;
    };

    this.budget_ruolo = reparti(reg.quota_mercato);
    this.budget_piano = reparti(reg.quota_budget);

    const vorRuolo = {};
    for (const r of RUOLI) {
      vorRuolo[r] = this.candidati[r].reduce((s, x) => s + x.vor, 0);
    }
    const poolLibero = {};
    const poolPiano = {};
    for (const r of RUOLI) {
      poolLibero[r] = Math.max(0.0, this.budget_ruolo[r] - slotRes[r]);
      poolPiano[r] = Math.max(0.0, this.budget_piano[r] - slotRes[r]);
    }
    const peso = this._pesi(new Map(this.lista.map((x) => [x.id, x.vor])),
                            poolLibero, slotRes);
    const pesoRuolo = {};
    for (const r of RUOLI) {
      pesoRuolo[r] = this.candidati[r].reduce((s, x) => s + peso.get(x.id), 0);
    }

    for (const x of this.lista) {
      const r = x.ruolo;
      const poolR = poolLibero[r];
      x.prezzo_atteso = (pesoRuolo[r] > 0 && poolR > 0)
        ? 1.0 + peso.get(x.id) / pesoRuolo[r] * poolR : 1.0;
      const poolP = poolPiano[r];
      x.prezzo_piano = (vorRuolo[r] > 0 && poolP > 0)
        ? 1.0 + x.vor / vorRuolo[r] * poolP : 1.0;
      if (this.pacchetto && r === 'P' && !x.titolare_por) x.prezzo_piano = 1.0;
    }
    return this;
  }

  // ------------------------------------------------------------ indicatori
  get inflazione() {
    if (!this.riferimento) return 1.0;
    return this._densita / this.riferimento;
  }

  disponibili(ruolo, n) {
    const venduti = this.stato.venduti();
    const out = this.lista.filter(
      (x) => !venduti.has(x.id) && (!ruolo || x.ruolo === ruolo));
    // L'id scioglie i pareggi: vedi valutazione.py.
    out.sort((a, b) => (b.vor - a.vor) || (a.id - b.id));
    return n ? out.slice(0, n) : out;
  }

  cerca(testo) {
    const t = String(testo || '').trim().toLowerCase();
    const venduti = this.stato.venduti();
    return this.lista.filter(
      (x) => x.nome.toLowerCase().includes(t) && !venduti.has(x.id));
  }

  // ------------------------------------------------- avversari e chiusura
  concorrenti(giocatore) {
    const cache = this._concorrentiPerRuolo;
    if (cache[giocatore.ruolo]) return cache[giocatore.ruolo];
    const out = [];
    for (const p of this.stato.presidenti()) {
      if (p.io) continue;
      if (this.stato.slotResidui(p.id, giocatore.ruolo) <= 0) continue;
      const liq = this.stato.liquidita(p.id);
      if (liq < 1) continue;
      out.push({
        id: p.id, nome: p.nome, liquidita: liq, crediti: p.crediti,
        aggressivita: arrotonda(((this.aggressivita || {})[p.id] || 1.0) * 100) / 100,
      });
    }
    out.sort((a, b) => b.liquidita - a.liquidita);
    cache[giocatore.ruolo] = out;
    return out;
  }

  consenso(giocatore) {
    const mercato = giocatore.prezzo_atteso || giocatore.prezzo_mercato || 1.0;
    const rif = giocatore.prezzo_riferimento || 0.0;
    if (rif <= 0) return mercato;
    const scala = this._poolIniziale
      ? this.pool_discrezionale / this._poolIniziale : 1.0;
    return 0.5 * mercato + 0.5 * rif * scala;
  }

  prezzoChiusura(giocatore) {
    const c = this.concorrenti(giocatore);
    const atteso = this.consenso(giocatore);
    const tetti = c.map((x) => Math.min(x.liquidita, atteso * (x.aggressivita || 1.0)))
      .sort((a, b) => b - a);
    if (!tetti.length) return 1.0;
    const limite = atteso * AGGRESSIVITA_MAX;
    if (tetti.length === 1) return Math.max(1.0, Math.min(tetti[0], atteso * 0.6));
    return Math.max(1.0, Math.min(limite, tetti[1] + 1));
  }
}
