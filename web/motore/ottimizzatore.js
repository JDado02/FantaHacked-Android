// Rosa ottima e prezzo massimo personale. Traduzione di `ottimizzatore.py`.
//
// Il prezzo di mercato dice quanto vale un giocatore *per la lega*. In asta
// serve un'altra risposta: quanto vale **per la mia rosa**. Da cui:
//
//     max_bid(g) = il prezzo P piu' alto per cui
//                  OPT(rosa con g, budget-P) >= OPT(rosa senza g, budget)
//
// Sopra quel prezzo la rosa che riesco a completare comprandolo e' peggiore di
// quella che avrei lasciandolo andare. E' un punto di indifferenza: il prezzo
// oltre il quale si perde, non il prezzo da offrire.
//
// Dove il Python usa numpy, qui ci sono `Float64Array`: stessa aritmetica in
// doppia precisione, stesso ordine delle operazioni. E' quello che permette
// alla prova di equivalenza di chiedere scarti sotto il milionesimo invece di
// accontentarsi di "piu' o meno uguale".

import { arrotonda } from './comune.js';

export const RUOLI = ['P', 'D', 'C', 'A'];
export const NEG = -1e18;
export const GIORNATE_STAGIONE = 38;
export const COSTO_RIEMPITIVO = 2;
// Sotto questa soglia un valore non e' un valore, e' rumore.
export const EPS_VALORE = 1e-9;
export const PIANO_SEPARATO = true;
export const PESO_COPPIA = 2.0;
export const VALORE_RIEMPITIVO = 5.0;
export const TITOLARI = { P: 1.0, D: 4.0, C: 4.0, A: 2.0 };

// --------------------------------------------------------------- primitive
function nuovo(n, valore) {
  const v = new Float64Array(n);
  v.fill(valore === undefined ? NEG : valore);
  return v;
}

function accumulaMax(v) {
  let corrente = NEG;
  for (let i = 0; i < v.length; i += 1) {
    if (v[i] > corrente) corrente = v[i];
    v[i] = corrente;
  }
  return v;
}

/** Convoluzione max-piu': out[c] = max su c1+c2<=c di a[c1] + b[c2]. */
export function fondi(a, b, B) {
  const out = nuovo(B + 1);
  for (let c = 0; c <= B; c += 1) {
    const x = a[c];
    if (x <= NEG / 2) continue;
    const quanti = B + 1 - c;
    for (let d = 0; d < quanti; d += 1) {
      const v = x + b[d];
      if (v > out[c + d]) out[c + d] = v;
    }
  }
  return out;
}

/** Come sopra, fra due tabelle di lunghezza diversa: serve al max_bid. */
export function fondiMisto(a, b, lung) {
  const out = nuovo(lung + 1);
  const nb = b.length;
  const fino = Math.min(a.length, lung + 1);
  for (let c = 0; c < fino; c += 1) {
    const x = a[c];
    if (x <= NEG / 2) continue;
    const quanti = Math.min(nb, lung + 1 - c);
    for (let d = 0; d < quanti; d += 1) {
      const v = x + b[d];
      if (v > out[c + d]) out[c + d] = v;
    }
  }
  return out;
}

/** Come `fondi`, ma dice anche quanto budget e' andato al primo gruppo. */
export function fondiConTraccia(a, b, B) {
  const out = nuovo(B + 1);
  const quota = new Int32Array(B + 1);
  for (let c = 0; c <= B; c += 1) {
    const x = a[c];
    if (x <= NEG / 2) continue;
    const quanti = B + 1 - c;
    for (let d = 0; d < quanti; d += 1) {
      const v = x + b[d];
      if (v > out[c + d]) { out[c + d] = v; quota[c + d] = c; }
    }
  }
  return [out, quota];
}

// ------------------------------------------------------ profondita' di rosa
function binomCdf(k, n, p) {
  if (k < 0) return 0.0;
  if (k >= n) return 1.0;
  const q = 1.0 - p;
  if (q <= 0) return 0.0;
  let termine = Math.pow(q, n);
  let somma = termine;
  for (let i = 0; i < k; i += 1) {
    termine *= ((n - i) / (i + 1)) * (p / q);
    somma += termine;
  }
  return Math.min(1.0, somma);
}

/** Quante giornate scende in campo il k-esimo giocatore di un reparto. */
export function pesiProfondita(slot, nTitolari, disponibilita) {
  const basso = Math.floor(nTitolari);
  const alto = Math.ceil(nTitolari);
  const frazione = nTitolari - basso;
  const out = [];
  for (let k = 1; k <= slot; k += 1) {
    const pBasso = binomCdf(basso - 1, k - 1, disponibilita);
    const pAlto = alto === basso ? pBasso : binomCdf(alto - 1, k - 1, disponibilita);
    out.push((1.0 - frazione) * pBasso + frazione * pAlto);
  }
  return out;
}

// ------------------------------------------------------------------ zaino
export class Zaino {
  constructor(pool, kMax, budget, peso, offset, obbligatorio, traccia) {
    this.k_max = Math.max(0, kMax);
    this.B = budget;
    this.pool = pool;
    this.f = [];
    for (let k = 0; k <= this.k_max; k += 1) this.f.push(nuovo(budget + 1));
    this.f[0] = nuovo(budget + 1, 0.0);
    this.preso = traccia ? [] : null;
    const off = offset || 0;

    const w = (k) => {
      const i = k - 1 + off;
      return (i >= 0 && i < peso.length) ? peso[i] : 0.0;
    };

    for (const voce of pool) {
      const costo = voce[0];
      const valore = voce[1];
      const ident = voce[2];
      const mod = voce[3];
      const forzato = (obbligatorio !== null && obbligatorio !== undefined
                       && ident === obbligatorio);
      const righe = [];
      if (costo > budget && !forzato) {
        if (traccia) this.preso.push(righe);
        continue;
      }
      for (let k = this.k_max; k >= 1; k -= 1) {
        const prec = this.f[k - 1];
        const cur = this.f[k];
        const puntiMod = mod[0];
        const postiMod = mod[1];
        const v = valore * w(k) + (((k + off) <= postiMod) ? puntiMod : 0.0);
        if (costo > budget) continue;
        if (forzato) {
          // Obbligatorio: la soluzione a k giocatori DEVE contenerlo.
          const n2 = nuovo(budget + 1);
          for (let c = costo; c <= budget; c += 1) n2[c] = prec[c - costo] + v;
          this.f[k] = n2;
          if (traccia) {
            const s = new Set();
            for (let c = costo; c <= budget; c += 1) s.add(c);
            righe.push([k, s]);
          }
          continue;
        }
        const migliorati = traccia ? new Set() : null;
        for (let c = budget; c >= costo; c -= 1) {
          const nv = prec[c - costo] + v;
          if (nv > cur[c]) { cur[c] = nv; if (traccia) migliorati.add(c); }
        }
        if (traccia) righe.push([k, migliorati]);
      }
      if (traccia) this.preso.push(righe);
    }
    for (let k = 0; k <= this.k_max; k += 1) accumulaMax(this.f[k]);
  }

  riga(k) {
    if (k < 0) return nuovo(this.B + 1);
    return this.f[Math.min(k, this.k_max)];
  }
}

/** Toglie i giocatori dominati: costo non inferiore e valore non superiore. */
function pota(pool, kMax) {
  // A parita' di costo e di valore l'ordine deve essere dichiarato, non
  // ereditato: sul fondo di un reparto ci sono decine di riempitivi da un
  // credito che valgono zero esattamente, e quale di loro resta nel pool
  // cambia il percorso della programmazione dinamica. L'id e' il pareggio
  // giusto perche' non cambia mai.
  const perCosto = pool.slice()
    .sort((a, b) => (a[0] - b[0]) || (b[1] - a[1]) || (a[2] - b[2]));
  const tenuti = [];
  let migliore = NEG;
  for (const voce of perCosto) {
    if (voce[1] > migliore) { migliore = voce[1]; tenuti.push(voce); }
  }
  const visti = new Set(tenuti.map((v) => v[2]));
  for (const voce of perCosto.slice(0, kMax)) {
    if (!visti.has(voce[2])) { tenuti.push(voce); visti.add(voce[2]); }
  }
  return tenuti.sort((a, b) => (b[1] - a[1]) || (a[2] - b[2]));
}

// ----------------------------------------------------------- ottimizzatore
export class Ottimizzatore {
  constructor(valutatore) {
    this.v = valutatore;
    this.reg = valutatore.reg;
    this.stato = valutatore.stato;
    this.mod = valutatore.mod;
    this.aggiorna();
  }

  aggiorna() {
    const v = this.v;
    const stato = this.stato;
    this.io = stato.io().id;
    this.budget = Math.max(0, stato.crediti(this.io));
    this.serve = {};
    for (const r of RUOLI) this.serve[r] = Math.max(0, stato.slotResidui(this.io, r));
    this.slot_residui = RUOLI.reduce((s, r) => s + this.serve[r], 0);

    const venduti = stato.venduti();
    this.liberi = { P: [], D: [], C: [], A: [] };
    for (const x of v.lista) if (!venduti.has(x.id)) this.liberi[x.ruolo].push(x);

    this.disponibilita = {};
    this.pesi = {};
    for (const r of RUOLI) {
      const quanti = Math.max(1, arrotonda(TITOLARI[r] * this.reg.partecipanti));
      const pool = this.liberi[r].slice()
        .sort((a, b) => (b.presenze * b.fm) - (a.presenze * a.fm)).slice(0, quanti);
      const pres = pool.filter((x) => x.presenze).map((x) => x.presenze);
      const a = pres.length ? (pres.reduce((s, p) => s + p, 0) / pres.length / 38.0) : 0.7;
      this.disponibilita[r] = Math.min(0.95, Math.max(0.35, a));
      this.pesi[r] = pesiProfondita(this.reg.slot[r], TITOLARI[r], this.disponibilita[r]);
    }

    this.pacchetto_por = !!v.pacchetto;
    if (this.pacchetto_por) {
      this.liberi.P = this.liberi.P.filter((x) => x.titolare_por);
      this.serve.P = Math.ceil(this.serve.P / Math.max(1, this.reg.slot.P));
      this.pesi.P = new Array(Math.max(1, this.serve.P + 1)).fill(1.0);
    }

    this.mia_rosa = this._miaRosa();
    this.coppia_bonus = this._coppieDaChiudere();
    this._pad = { P: this._livelloNucleo('P'), D: this._livelloNucleo('D') };
    this.media_difesa = this._mediaDifesa();

    this.valore = new Map();
    this.costo = new Map();
    this.mod_punti = new Map();
    for (const r of RUOLI) {
      for (const x of this.liberi[r]) {
        const grezzo = Math.max(0.0, x.presenze * (x.fm - v.rimpiazzo_fm[r]))
                     + (this.coppia_bonus.get(x.id) || 0.0);
        // Sotto un miliardesimo di punto non c'e' valore, c'e' l'ultimo bit
        // di una sottrazione fra numeri quasi uguali. Vedi ottimizzatore.py.
        this.valore.set(x.id, grezzo > EPS_VALORE ? grezzo : 0.0);
        // Il costo NON e' quanto vale: e' quanto costera'. E non e'
        // `prezzo_atteso`: il perche' sta su PIANO_SEPARATO.
        const pianificato = PIANO_SEPARATO ? x.prezzo_piano : null;
        let c = Math.max(1, arrotonda(
          pianificato || x.prezzo_atteso || x.prezzo_mercato || 1.0));
        if (r === 'P' && v.pacchetto && x.titolare_por) {
          c += (x.riserve_por || []).length;
        }
        this.costo.set(x.id, c);
        this.mod_punti.set(x.id, this.contributoDifesa(x));
      }
    }
    for (const r of RUOLI) {
      this.liberi[r].sort((a, b) => (this.valore.get(b.id) - this.valore.get(a.id))
                                 || (a.id - b.id));
    }

    this._riserve();
    this._tabelle = new Map();
    this._resto = {};
    this._optBase = null;
    this._curva = null;
    this._tasso = null;
    this._tassoRuolo = {};
    this._pianoCache = null;
    this._ottimo = null;
  }

  _riserve() {
    const quote = this.reg.riserva_ruolo || {};
    this.riserva = { P: 0, D: 0, C: 0, A: 0 };
    if (!RUOLI.some((r) => quote[r])) { this.surplus = this.budget; return; }
    const speso = {};
    for (const a of this.stato.acquisti()) {
      if (a.presidente_id !== this.io) continue;
      speso[a.ruolo] = (speso[a.ruolo] || 0) + a.prezzo;
    }
    const grezza = {};
    for (const r of RUOLI) {
      if (this.serve[r] <= 0) { grezza[r] = 0.0; continue; }
      grezza[r] = Math.max(0.0,
        (quote[r] || 0.0) * this.reg.crediti - (speso[r] || 0));
    }
    for (const r of RUOLI) {
      const altriSlot = RUOLI.filter((s) => s !== r)
        .reduce((s, x) => s + this.serve[x], 0);
      grezza[r] = Math.min(grezza[r], Math.max(0, this.budget - altriSlot));
    }
    const somma = RUOLI.reduce((s, r) => s + grezza[r], 0);
    if (somma > this.budget) {
      const k = this.budget / somma;
      for (const r of RUOLI) grezza[r] *= k;
    }
    for (const r of RUOLI) this.riserva[r] = Math.trunc(grezza[r]);
    this.surplus = Math.max(0,
      this.budget - RUOLI.reduce((s, r) => s + this.riserva[r], 0));
  }

  _miaRosa() {
    const rosa = { P: [], D: [], C: [], A: [] };
    for (const a of this.stato.acquisti()) {
      if (a.presidente_id !== this.io) continue;
      const x = this.v.g.get(a.giocatore_id);
      if (x) rosa[x.ruolo].push(x);
    }
    for (const r of RUOLI) {
      rosa[r].sort((a, b) => (b.presenze * (b.fm - this.v.rimpiazzo_fm[r]))
                           - (a.presenze * (a.fm - this.v.rimpiazzo_fm[r])));
    }
    return rosa;
  }

  _coppieDaChiudere() {
    const v = this.v;
    const miei = new Set();
    for (const r of RUOLI) for (const x of this.mia_rosa[r]) miei.add(x.id);
    const bonus = new Map();
    for (const r of RUOLI) {
      for (const x of this.liberi[r]) {
        let extra = 0.0;
        for (const c of v.compagniDiMaglia(x.id)) {
          if (!miei.has(c.altro)) continue;
          const titolare = v.g.get(c.altro);
          if (!titolare) continue;
          const scoperte = Math.max(0.0, GIORNATE_STAGIONE - (titolare.presenze || 0.0));
          if (scoperte <= 0) continue;
          const tetto = Math.min(scoperte, x.presenze || 0.0);
          const sopraRimpiazzo = Math.max(0.0, (x.fm || 0.0) - v.rimpiazzo_fm[r]);
          extra += tetto * sopraRimpiazzo;
        }
        if (extra > 0) bonus.set(x.id, extra * PESO_COPPIA);
      }
    }
    return bonus;
  }

  _livelloNucleo(ruolo) {
    const n = ruolo === 'P' ? this.reg.mod_dif_n_por : this.reg.mod_dif_n_dif;
    const pool = this.liberi[ruolo].slice().sort((a, b) => b.mv - a.mv);
    if (!pool.length) return 6.0;
    const squadre = this.stato.presidenti()
      .filter((p) => this.stato.slotResidui(p.id, ruolo) > 0).length;
    const rango = Math.max(1, n * Math.max(1, squadre));
    const i = Math.min(rango, pool.length) - 1;
    const finestra = pool.slice(Math.max(0, i - 1), i + 2);
    return finestra.reduce((s, x) => s + x.mv, 0) / finestra.length;
  }

  _nucleo(aggiunto) {
    const out = [];
    for (const [ruolo, quanti] of [['P', this.reg.mod_dif_n_por],
                                   ['D', this.reg.mod_dif_n_dif]]) {
      if (quanti <= 0) continue;
      let mv = this.mia_rosa[ruolo].map((x) => x.mv);
      if (aggiunto && aggiunto.ruolo === ruolo) mv.push(aggiunto.mv);
      mv.sort((a, b) => b - a);
      mv = mv.slice(0, quanti);
      while (mv.length < quanti) mv.push(this._pad[ruolo]);
      out.push(...mv);
    }
    return out;
  }

  _mediaDifesa(aggiunto) {
    const n = this._nucleo(aggiunto);
    return n.length ? n.reduce((s, x) => s + x, 0) / n.length : 0.0;
  }

  contributoDifesa(giocatore) {
    if (!this.mod.attivo || (giocatore.ruolo !== 'P' && giocatore.ruolo !== 'D')) return 0.0;
    if (giocatore.ruolo === 'P' && this.reg.mod_dif_n_por <= 0) return 0.0;
    return this.mod.guadagno(this.media_difesa, this._mediaDifesa(giocatore));
  }

  _postiNucleo(ruolo) {
    if (!this.mod.attivo) return 0;
    if (ruolo === 'P') return this.reg.mod_dif_n_por;
    if (ruolo === 'D') return this.reg.mod_dif_n_dif;
    return 0;
  }

  // ------------------------------------------------------------- tabelle
  _pool(ruolo, escludi) {
    const posti = this._postiNucleo(ruolo);
    const out = [];
    for (const x of this.liberi[ruolo]) {
      if (escludi !== null && escludi !== undefined && x.id === escludi) continue;
      out.push([this.costo.get(x.id), this.valore.get(x.id), x.id,
                [this.mod_punti.get(x.id), posti]]);
    }
    return pota(out, Math.max(1, this.serve[ruolo]));
  }

  _offset(ruolo) { return this.mia_rosa[ruolo].length; }

  _tabella(ruolo, escludi, obbligatorio, traccia) {
    const chiave = ruolo + '|' + (escludi === undefined ? '' : escludi)
                 + '|' + (obbligatorio === undefined ? '' : obbligatorio)
                 + '|' + (traccia ? 1 : 0);
    if (this._tabelle.has(chiave)) return this._tabelle.get(chiave);
    let pool = this._pool(ruolo, escludi);
    if (obbligatorio !== null && obbligatorio !== undefined) {
      const g = this.v.g.get(obbligatorio);
      const voce = [0, this.valore.get(g.id) || 0.0, g.id,
                    [this.mod_punti.get(g.id) || 0.0, this._postiNucleo(ruolo)]];
      pool = pool.concat([voce]).sort((a, b) => b[1] - a[1]);
    }
    const z = new Zaino(pool, Math.max(1, this.serve[ruolo]), this.budget,
                        this.pesi[ruolo], this._offset(ruolo), obbligatorio, traccia);
    this._tabelle.set(chiave, z);
    return z;
  }

  _sposta(riga, offset) {
    const n = this.surplus + 1;
    const out = nuovo(n);
    for (let y = 0; y < n; y += 1) {
      const c = offset + y;
      if (c >= 0 && c <= this.budget) out[y] = riga[c];
      else if (c > this.budget) out[y] = riga[this.budget];
    }
    return out;
  }

  _riga(ruolo, k, escludi, obbligatorio, sconto) {
    return this._sposta(this._tabella(ruolo, escludi, obbligatorio).riga(k),
                        this.riserva[ruolo] - (sconto || 0));
  }

  _restoRuoli(ruolo) {
    if (this._resto[ruolo]) return this._resto[ruolo];
    const altri = RUOLI.filter((r) => r !== ruolo);
    let acc = this._riga(altri[0], this.serve[altri[0]]);
    for (const r of altri.slice(1)) {
      acc = fondi(acc, this._riga(r, this.serve[r]), this.surplus);
    }
    this._resto[ruolo] = acc;
    return acc;
  }

  // ------------------------------------------------------------------- OPT
  opt() {
    if (this._optBase === null) {
      if (this.slot_residui === 0) { this._optBase = 0.0; this._curva = null; }
      else {
        let acc = this._riga(RUOLI[0], this.serve[RUOLI[0]]);
        for (const r of RUOLI.slice(1)) {
          acc = fondi(acc, this._riga(r, this.serve[r]), this.surplus);
        }
        this._curva = acc;
        this._optBase = acc[this.surplus];
      }
    }
    return this._optBase;
  }

  tassoCambio() {
    if (this._tasso !== null) return this._tasso;
    this.opt();
    const curva = this._curva;
    if (!curva || this.surplus <= 0) { this._tasso = 0.0; return this._tasso; }
    const fetta = Math.max(5, Math.floor(this.surplus / 5));
    const giu = Math.max(0, this.surplus - fetta);
    const alto = curva[this.surplus];
    const basso = curva[giu];
    if (basso <= NEG / 2 || alto <= NEG / 2 || this.surplus === giu) this._tasso = 0.0;
    else this._tasso = Math.max(0.0, (alto - basso) / (this.surplus - giu));
    return this._tasso;
  }

  resa(giocatore) {
    const x = giocatore;
    if (!this.valore.has(x.id)) return 0.0;
    const r = x.ruolo;
    const gia = this.mia_rosa[r].length;
    const pesi = this.pesi[r] || [1.0];
    const peso = gia < pesi.length ? pesi[gia] : 0.0;
    let punti = this.valore.get(x.id) * peso;
    if ((gia + 1) <= this._postiNucleo(r)) punti += (this.mod_punti.get(x.id) || 0.0);
    return punti;
  }

  tassoRuolo(ruolo) {
    if (this._tassoRuolo[ruolo] !== undefined) return this._tassoRuolo[ruolo];
    let slot = this.stato.presidenti()
      .reduce((s, p) => s + this.stato.slotResidui(p.id, ruolo), 0);
    if (ruolo === 'P' && this.pacchetto_por) {
      slot = Math.ceil(slot / Math.max(1, this.reg.slot.P));
    }
    const pool = this.liberi[ruolo].slice()
      .sort((a, b) => this.resa(b) - this.resa(a))
      .slice(0, Math.max(1, slot));
    const resa = pool.reduce((s, x) => s + Math.max(0.0, this.resa(x)), 0);
    const spesa = pool.reduce((s, x) => s + Math.max(1, this.costo.get(x.id)), 0);
    this._tassoRuolo[ruolo] = spesa > 0 ? resa / spesa : 0.0;
    return this._tassoRuolo[ruolo];
  }

  convenienza(giocatore, prezzo) {
    return this.resa(giocatore) - Math.max(0, prezzo) * this.tassoRuolo(giocatore.ruolo);
  }

  // -------------------------------------------------------------- max_bid
  maxBid(giocatore, prezzo) {
    const g = giocatore;
    const d = {
      motivo: '', guadagno: 0.0, guadagno_al_prezzo: 0.0,
      opt_senza: 0.0, opt_con: 0.0,
      contributo_modificatore: this.mod_punti.get(g.id) || 0.0,
    };
    // Fuori dalla lista di serie A: non si compra, punto. Prima di ogni altro
    // conto, perche' ogni altro conto lo tratterebbe come un giocatore molto
    // scarso - e a fine asta la regola degli ultimi posti lo ripescherebbe.
    if (g.fuori_lista) {
      d.motivo = "non e' iscritto alla lista di serie A:"
               + ' non puo\' giocare nemmeno una partita';
      d.fuori_lista = true;
      return [0, d];
    }
    if ((this.serve[g.ruolo] || 0) <= 0) {
      d.motivo = 'reparto ' + g.ruolo + " gia' completo";
      return [0, d];
    }
    if (this.stato.venduti().has(g.id)) { d.motivo = "gia' assegnato"; return [0, d]; }
    const liq = this.stato.liquidita(this.io);
    if (liq < 1) {
      d.motivo = 'crediti finiti: devi tenerne 1 per ogni slot scoperto';
      return [0, d];
    }

    const B = this.budget;
    const resto = this._restoRuoli(g.ruolo);
    const n = this.serve[g.ruolo];

    let optSenza;
    if (this.insiemeOttimo().has(g.id)) {
      const senza = fondi(resto, this._riga(g.ruolo, n, g.id), this.surplus);
      optSenza = senza[this.surplus];
    } else {
      optSenza = this.opt();
    }
    d.opt_senza = optSenza;

    const tabCon = this._tabella(g.ruolo, undefined, g.id).riga(n);
    const lung = this.surplus + this.riserva[g.ruolo];
    const z = fondiMisto(tabCon, resto, lung);
    const optCon = (p) => {
      const t = lung - p;
      return (t >= 0 && t <= lung) ? z[t] : NEG;
    };

    let limite = 0;
    for (let P = Math.min(Math.trunc(liq), B); P >= 1; P -= 1) {
      const v = optCon(P);
      if (v <= NEG / 2) continue;
      if (v >= optSenza - 1e-9) { limite = P; d.opt_con = v; break; }
    }
    if (limite <= 0 && this.ultimiPosti(g.ruolo)) {
      limite = 1;
      d.ultimo_posto = true;
      d.motivo = "lo slot va riempito comunque: a un credito vale piu' di una"
               + ' giornata giocata in dieci';
    } else if (limite <= 0) {
      d.motivo = "anche a 1 credito toglie piu' di quanto aggiunge: quello slot"
               + " rende di piu' su un altro giocatore";
    }
    const g1 = optCon(1);
    d.guadagno = g1 > NEG / 2 ? (g1 - optSenza) : 0.0;
    if (prezzo !== undefined && prezzo !== null) {
      const p = Math.max(1, Math.min(Math.trunc(prezzo), Math.trunc(liq), B));
      const gp = optCon(p);
      d.guadagno_al_prezzo = gp > NEG / 2 ? (gp - optSenza) : 0.0;
      d.prezzo_valutato = p;
    }
    return [limite, d];
  }

  /** Vero quando quello slot va riempito e basta, senza piu' scegliere. */
  ultimiPosti(ruolo) {
    if ((this.serve[ruolo] || 0) <= 0) return false;
    const slotTotali = RUOLI.reduce((s, r) => s + this.serve[r], 0);
    if (slotTotali > 0 && this.budget < COSTO_RIEMPITIVO * slotTotali) return true;
    try {
      const liberi = this.v.disponibili(ruolo).length;
      return liberi <= this.stato.slotResiduiRuolo(ruolo);
    } catch (e) { return false; }
  }

  insiemeOttimo() {
    if (this._ottimo === null) {
      const fuori = new Set();
      const per = this.piano().per_ruolo || {};
      for (const r of Object.keys(per)) {
        for (const t of (per[r].obiettivi || [])) fuori.add(t.id);
      }
      this._ottimo = fuori;
    }
    return this._ottimo;
  }

  // ------------------------------------------------------- piano di spesa
  piano() {
    if (this._pianoCache) return this._pianoCache;
    if (this.slot_residui === 0 || this.budget <= 0) {
      this._pianoCache = { per_ruolo: {}, crediti: this.budget, valore: 0.0 };
      return this._pianoCache;
    }
    const B = this.budget;
    const righe = RUOLI.map((r) => [r, this._riga(r, this.serve[r])]);
    let acc = righe[0][1];
    const quote = [];
    for (const [, riga] of righe.slice(1)) {
      const [a2, q] = fondiConTraccia(acc, riga, this.surplus);
      acc = a2; quote.push(q);
    }
    let residuo = this.surplus;
    const spesa = {};
    for (let i = quote.length - 1; i >= 0; i -= 1) {
      const sinistra = quote[i][residuo];
      spesa[righe[i + 1][0]] = residuo - sinistra;
      residuo = sinistra;
    }
    spesa[righe[0][0]] = residuo;
    for (const r of RUOLI) spesa[r] = (spesa[r] || 0) + this.riserva[r];

    const perRuolo = {};
    for (const r of RUOLI) {
      perRuolo[r] = {
        slot: this.serve[r],
        crediti: spesa[r] || 0,
        obiettivi: this._obiettivi(r, this.serve[r], spesa[r] || 0),
      };
    }
    const spesaPrevista = RUOLI.reduce(
      (s, r) => s + perRuolo[r].obiettivi.reduce((t, o) => t + o.costo, 0), 0);
    this._pianoCache = {
      per_ruolo: perRuolo, crediti: B, valore: this.opt(),
      spesa_prevista: Math.trunc(spesaPrevista),
      avanzo: Math.trunc(Math.max(0, B - spesaPrevista)),
    };
    return this._pianoCache;
  }

  _obiettivi(ruolo, n, budget) {
    if (n <= 0 || budget <= 0) return [];
    const pool = this._pool(ruolo);
    const z = this._tabella(ruolo, undefined, undefined, true);
    const scelti = this._miglioraRiempitivi(ruolo, Ottimizzatore._traccia(z, pool, n, budget));
    const out = [];
    for (const ident of scelti) {
      const x = this.v.g.get(ident);
      if (x) {
        out.push({ id: x.id, nome: x.nome, squadra: x.squadra,
                   costo: this.costo.get(x.id), mv: arrotonda(x.mv * 100) / 100 });
      }
    }
    out.sort((a, b) => b.costo - a.costo);
    return out;
  }

  /** Fra due riempitivi da un credito, propone quello che almeno gioca. */
  _miglioraRiempitivi(ruolo, scelti) {
    const chiave = (ident) => {
      const x = this.v.g.get(ident);
      return x ? (x.presenze || 0.0) * (x.fm || 0.0) : 0.0;
    };
    const lista = scelti.slice();
    const presi = new Set(lista);
    for (let i = 0; i < lista.length; i += 1) {
      const ident = lista[i];
      const costo = this.costo.get(ident);
      if (costo === undefined || costo > COSTO_RIEMPITIVO) continue;
      if ((this.valore.get(ident) || 0.0) >= VALORE_RIEMPITIVO) continue;
      let migliore = null;
      let suo = chiave(ident);
      for (const y of this.liberi[ruolo]) {
        if (presi.has(y.id) || this.costo.get(y.id) !== costo) continue;
        const k = chiave(y.id);
        if (k > suo) { migliore = y.id; suo = k; }
      }
      if (migliore !== null) {
        presi.delete(ident); presi.add(migliore); lista[i] = migliore;
      }
    }
    return lista;
  }

  static _traccia(z, pool, k, budget) {
    const scelti = [];
    let c = budget;
    let kk = k;
    for (let i = pool.length - 1; i >= 0; i -= 1) {
      if (kk <= 0) break;
      const righe = (z.preso && i < z.preso.length) ? z.preso[i] : null;
      if (!righe || !righe.length) continue;
      const costo = pool[i][0];
      for (const [k2, colonne] of righe) {
        if (k2 !== kk || !colonne || !colonne.size) continue;
        if (colonne.has(c)) { scelti.push(pool[i][2]); c -= costo; kk -= 1; }
        break;
      }
    }
    return scelti;
  }
}
