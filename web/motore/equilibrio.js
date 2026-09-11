// La mia squadra, com'e' adesso: undici titolare, coperture, rischi.
//
// Traduzione di `motore/equilibrio.py`. Il resto del motore risponde a domande
// su un giocatore alla volta; questo modulo risponde all'unica domanda che
// conta davvero a fine asta: **che squadra sto costruendo?**
//
// Non e' un riassunto grafico degli acquisti. E' un conto vero:
//
//   - qual e' il miglior undici che riesco a schierare, e con che modulo;
//   - quanti punti a giornata vale, modificatore di difesa compreso;
//   - quali caselle sono coperte da un titolare sicuro e quali da una
//     scommessa;
//   - quanti rigoristi ho, che nel fantacalcio e' mezza differenza fra due
//     rose altrimenti identiche;
//   - quanto sono esposto su una sola squadra di serie A.
//
// Tutto ricalcolato a ogni acquisto, mio o altrui: quando un avversario porta
// via un difensore, cambia chi resta sul mercato e quindi cambia cosa mi manca.

import { arrotonda } from './comune.js';

export const RUOLI = ['P', 'D', 'C', 'A'];

// I moduli ammessi in Classic. L'undici migliore si sceglie fra questi: non ha
// senso valutare una rosa con un modulo che non si puo' schierare.
export const MODULI = [
  ['343', { P: 1, D: 3, C: 4, A: 3 }],
  ['352', { P: 1, D: 3, C: 5, A: 2 }],
  ['442', { P: 1, D: 4, C: 4, A: 2 }],
  ['433', { P: 1, D: 4, C: 3, A: 3 }],
  ['451', { P: 1, D: 4, C: 5, A: 1 }],
  ['532', { P: 1, D: 5, C: 3, A: 2 }],
  ['541', { P: 1, D: 5, C: 4, A: 1 }],
];

// Sotto questa quota di presenze una casella dell'undici non e' coperta: quel
// posto, qualche giornata, andra' riempito dalla panchina.
export const QUOTA_COPERTA = 0.72;

// Da qui in su vale la pena avvisare che si rischia di restare in dieci. Tre
// giornate su trentotto: sotto, e' il rumore di fondo che ha qualunque rosa
// fatta bene, e un avviso che compare sempre non lo legge nessuno.
export const SOGLIA_RISCHIO = 0.08;

export const GIORNATE = 38.0;

function arr(x, n) { return Number((x || 0).toFixed(n)); }

function fm(x) { return x.fm || 0.0; }

/**
 * P(esattamente k disponibili), da probabilita' indipendenti.
 *
 * E' la Poisson-binomiale, costruita a mano un giocatore alla volta: con otto
 * giocatori per reparto sono sessanta moltiplicazioni, e il risultato e'
 * esatto invece che simulato. Un numero che compare a schermo a ogni acquisto
 * non deve tremare per via del seme del generatore.
 */
function distribuzione(quote) {
  let d = [1.0];
  for (let p of quote) {
    p = Math.min(1.0, Math.max(0.0, p));
    const nuovo = new Array(d.length + 1).fill(0.0);
    for (let k = 0; k < d.length; k += 1) {
      nuovo[k] += d[k] * (1.0 - p);
      nuovo[k + 1] += d[k] * p;
    }
    d = nuovo;
  }
  return d;
}

/** [probabilita' di schierare undici, caselle vuote attese a giornata]. */
function formazione(dist) {
  const pPortiere = 1.0 - dist.P[0];
  let completa = 0.0;
  let buchi = dist.P[0] * 1.0;          // senza portiere, quella casella e' vuota
  for (let d = 0; d < dist.D.length; d += 1) {
    const pd = dist.D[d];
    if (pd <= 0) continue;
    for (let c = 0; c < dist.C.length; c += 1) {
      const pc = dist.C[c];
      if (pc <= 0) continue;
      for (let a = 0; a < dist.A.length; a += 1) {
        const pa = dist.A[a];
        if (pa <= 0) continue;
        const peso = pd * pc * pa;
        let manca = Infinity;
        for (const [, m] of MODULI) {
          const q = Math.max(0, m.D - d) + Math.max(0, m.C - c)
                  + Math.max(0, m.A - a);
          if (q < manca) manca = q;
        }
        if (manca === 0) completa += peso;
        buchi += peso * manca;
      }
    }
  }
  return [pPortiere * completa, buchi];
}

/** Fotografia della mia rosa, ricalcolata sullo stato corrente. */
export class Equilibrio {
  constructor(valutatore, ottimizzatore) {
    this.v = valutatore;
    this.o = ottimizzatore;
    this.reg = valutatore.reg;
    this.stato = valutatore.stato;
  }

  // --------------------------------------------------------------- la rosa
  rosa() {
    const io = this.stato.io().id;
    const out = {};
    for (const r of RUOLI) out[r] = [];
    for (const a of this.stato.acquisti()) {
      if (a.presidente_id !== io) continue;
      const x = this.v.g.get(a.giocatore_id);
      if (x) out[x.ruolo].push(x);
    }
    for (const r of RUOLI) out[r].sort((a, b) => fm(b) - fm(a));
    return out;
  }

  /**
   * Il miglior undici schierabile, e con che modulo.
   *
   * Se un reparto non e' ancora completo le caselle scoperte restano vuote:
   * mostrare una rosa finta a meta' asta non aiuterebbe nessuno.
   */
  undici(rosa) {
    const r0 = rosa || this.rosa();
    let migliore = null;
    for (const [nome, forma] of MODULI) {
      const scelti = {};
      let valore = 0.0;
      let mancanti = 0;
      for (const r of RUOLI) {
        const presi = r0[r].slice(0, forma[r]);
        scelti[r] = presi;
        valore += presi.reduce((s, x) => s + fm(x), 0);
        mancanti += forma[r] - presi.length;
      }
      // Le caselle vuote valgono la media di un riempitivo: senza questo il
      // confronto fra moduli premierebbe sempre quello che chiede meno
      // giocatori nei reparti che non ho ancora comprato.
      valore += mancanti * 5.5;
      if (migliore === null || valore > migliore[0]) {
        migliore = [valore, nome, forma, scelti, mancanti];
      }
    }
    const [, nome, forma, scelti, mancanti] = migliore;
    const elenco = [];
    for (const r of RUOLI) {
      for (const x of scelti[r]) elenco.push(this.voce(x));
      for (let i = 0; i < forma[r] - scelti[r].length; i += 1) {
        elenco.push({ ruolo: r, vuoto: true });
      }
    }
    let somma = 0.0;
    for (const r of RUOLI) somma += scelti[r].reduce((s, x) => s + fm(x), 0);
    const bonus = this._bonusDifesa(scelti);
    return { modulo: nome, forma, giocatori: elenco,
             caselle_vuote: mancanti,
             fantamedia: arr(somma, 1),
             bonus_difesa: arr(bonus, 2),
             punti_giornata: arr(somma + bonus, 1) };
  }

  _bonusDifesa(scelti) {
    if (!this.o.mod.attivo) return 0.0;
    const mv = (scelti.P || []).slice(0, this.reg.mod_dif_n_por).map((x) => x.mv)
      .concat((scelti.D || []).slice(0, this.reg.mod_dif_n_dif).map((x) => x.mv));
    const quanti = this.reg.mod_dif_n_por + this.reg.mod_dif_n_dif;
    // Nucleo incompleto: si completa col livello di chi e' ancora sul mercato,
    // altrimenti il bonus sembrerebbe zero fino all'ultimo acquisto e poi
    // salterebbe di colpo.
    while (mv.length < quanti) mv.push(this.o._pad.D);
    return this.reg.bonus_modificatore(
      mv.reduce((s, m) => s + m, 0) / mv.length);
  }

  // ----------------------------------------------------------------- voci
  voce(x) {
    return {
      id: x.id, nome: x.nome, squadra: x.squadra, ruolo: x.ruolo,
      fm: arr(fm(x), 2), mv: arr(x.mv || 0, 2),
      presenze: arrotonda(x.presenze || 0),
      titolarita: arr(x.titolarita || 0, 2),
      grado: x.grado || 'ignoto',
      certezza: arr(x.certezza || 0, 2),
      sicuro: !!x.sicuro,
      rigorista: Math.trunc(x.rigorista || 0),
    };
  }

  // ------------------------------------------ rischio di restare in dieci
  //
  // E' la domanda che nessun'altra parte del motore fa. L'ottimizzatore
  // massimizza i punti dell'undici, e per farlo pesa ogni giocatore per le
  // giornate in cui scende davvero in campo: uno che non gioca mai vale
  // **zero** in quella funzione. Ma una casella vuota in formazione non e' un
  // giocatore che fa zero punti, e' una giornata giocata in dieci, e la
  // funzione da massimizzare non lo sa.
  //
  // Il guaio arriva riempiendo la panchina di fantamedie alte prodotte da
  // cinque presenze: in rosa ci sono, in campo no. Misurato su una rosa cosi',
  // il rischio passa dal 2% al 58% delle giornate. Qui il numero si vede
  // mentre si compra, non a dicembre.
  rischioUndici(rosa) {
    const r0 = rosa || this.rosa();
    const prob = this._disponibilita(r0);
    const dist = {};
    for (const r of RUOLI) dist[r] = distribuzione(prob[r]);
    const [completa, buchi] = formazione(dist);
    const disponibili = {};
    const daComprare = {};
    for (const r of RUOLI) {
      disponibili[r] = arr(prob[r].reduce((s, p) => s + p, 0), 1);
      daComprare[r] = Math.max(0, this.reg.slot[r] - r0[r].length);
    }
    return {
      quota: arr(1.0 - completa, 4),
      giornate: arr((1.0 - completa) * GIORNATE, 1),
      caselle_vuote: arr(buchi, 3),
      reparto_stretto: this._colloDiBottiglia(dist, completa),
      disponibili,
      da_comprare: daComprare,
    };
  }

  /**
   * Con che probabilita' ognuno prende voto in una giornata qualunque.
   *
   * I portieri della stessa squadra si fondono in una probabilita' sola.
   * Trattarli come due monete separate direbbe che il sette per cento delle
   * giornate si resta senza portiere, il che e' assurdo per chi possiede un
   * pacchetto intero: la seconda moneta esce testa **proprio** quando la prima
   * esce croce.
   */
  _disponibilita(rosa) {
    const prob = {};
    for (const r of RUOLI) {
      const quote = [];
      const perSquadra = new Map();
      for (const x of rosa[r]) {
        const q = Math.min(1.0, Math.max(0.0, (x.presenze || 0.0) / GIORNATE));
        if (r === 'P') {
          if (!perSquadra.has(x.squadra)) perSquadra.set(x.squadra, []);
          perSquadra.get(x.squadra).push(q);
        } else {
          quote.push(q);
        }
      }
      for (const squadra of [...perSquadra.keys()].sort()) {
        const insieme = perSquadra.get(squadra).slice().sort((a, b) => b - a);
        if (insieme.length >= 2) {
          // Una maglia sola: se non gioca il primo gioca il secondo. Il
          // margine copre le giornate in cui sono fermi entrambi.
          const coda = insieme.slice(1).reduce((s, q) => s + q, 0);
          quote.push(Math.min(0.99, insieme[0] + 0.9 * coda));
        } else {
          quote.push(insieme[0]);
        }
      }
      // Gli slot ancora da riempire contano come un giocatore medio di quel
      // reparto: la disponibilita' e' quella che l'ottimizzatore misura sul
      // mercato, non una costante scritta a mano.
      let mancano = Math.max(0, this.reg.slot[r] - rosa[r].length);
      if (r === 'P') {
        // I portieri arrivano a pacchetto: gli slot scoperti sono le riserve
        // del titolare che comprero', non altre maglie.
        mancano = quote.length ? 0 : 1;
      }
      const tipica = (this.o.disponibilita || {})[r];
      const q = tipica === undefined ? 0.75 : tipica;
      for (let i = 0; i < mancano; i += 1) quote.push(q);
      prob[r] = quote;
    }
    return prob;
  }

  /**
   * Il reparto che, con un giocatore in piu', toglierebbe piu' rischio.
   *
   * Non si indovina: si rifa' il conto quattro volte, una per reparto,
   * aggiungendo un giocatore sempre disponibile, e si guarda dove il rischio
   * scende di piu'.
   */
  _colloDiBottiglia(dist, completa) {
    let migliore = null;
    let guadagno = 0.0;
    for (const r of RUOLI) {
      const piuUno = Object.assign({}, dist);
      piuUno[r] = [0.0].concat(dist[r]);   // uno in piu', sempre presente
      const [nuova] = formazione(piuUno);
      if (nuova - completa > guadagno) {
        migliore = r;
        guadagno = nuova - completa;
      }
    }
    if (migliore !== null && guadagno >= 0.002) {
      return { ruolo: migliore, guadagno: arr(guadagno, 4) };
    }

    // Nessun reparto, da solo, sposta il risultato. Non vuol dire che vada
    // tutto bene: vuol dire che ne mancano piu' d'uno, e sono proprio i casi
    // in cui serve sapere da dove cominciare. Si indica allora il reparto che
    // resta piu' lontano dal minimo che un modulo gli chiede.
    let peggiore = null;
    let distanza = 0.0;
    for (const r of RUOLI) {
      let manca;
      if (r === 'P') {
        manca = dist.P[0];
      } else {
        let minimo = Infinity;
        for (const [, m] of MODULI) if (m[r] < minimo) minimo = m[r];
        manca = 0.0;
        for (let k = 0; k < dist[r].length; k += 1) {
          manca += dist[r][k] * Math.max(0, minimo - k);
        }
      }
      if (manca > distanza) { peggiore = r; distanza = manca; }
    }
    if (peggiore === null || distanza <= 0.01) return null;
    return { ruolo: peggiore, guadagno: 0.0, caselle_mancanti: arr(distanza, 2) };
  }

  // ------------------------------------------------------------ il quadro
  quadro() {
    const rosa = this.rosa();
    const undici = this.undici(rosa);
    const forma = undici.forma;
    const copertura = {};
    const avvisi = [];

    for (const r of RUOLI) {
      const presi = rosa[r];
      const sicuri = presi.filter((x) => x.sicuro);
      copertura[r] = {
        in_rosa: presi.length,
        slot: this.reg.slot[r],
        nell_undici: forma[r],
        titolari_sicuri: sicuri.length,
        da_verificare: presi.filter((x) => !x.sicuro).length,
        scoperte: Math.max(0, forma[r] - sicuri.length),
      };
    }

    const rigoristi = [];
    for (const r of RUOLI) {
      for (const x of rosa[r]) {
        if ((x.rigorista || 0) === 1) rigoristi.push(this.voce(x));
      }
    }
    // Quanti giocatori ho della stessa squadra di serie A. Averne tanti
    // raddoppia i colpi quando quella squadra gira e li raddoppia anche
    // quando si inceppa: e' varianza, non valore.
    const perSquadra = new Map();
    for (const r of RUOLI) {
      for (const x of rosa[r]) {
        perSquadra.set(x.squadra, (perSquadra.get(x.squadra) || 0) + 1);
      }
    }
    const concentrazione = [...perSquadra.entries()].sort((a, b) => b[1] - a[1]);

    let totali = 0;
    let sicuriTotali = 0;
    for (const r of RUOLI) {
      totali += rosa[r].length;
      sicuriTotali += rosa[r].filter((x) => x.sicuro).length;
    }

    // --- avvisi ---------------------------------------------------------
    // Solo quando c'e' ancora modo di rimediare **e** il tempo comincia a
    // stringere. A inizio asta ogni casella e' scoperta: dirlo sarebbe vero e
    // inutile, e un avviso che compare sempre non lo legge nessuno.
    for (const r of RUOLI) {
      const c = copertura[r];
      const mancaAncora = this.reg.slot[r] - c.in_rosa;
      if (c.scoperte > 0 && mancaAncora > 0 && mancaAncora <= c.scoperte + 1) {
        avvisi.push({
          tipo: 'copertura', ruolo: r,
          testo: "Nell'undici " + nomeRuolo(r) + ' hai ' + c.scoperte
               + ' caselle che oggi non sono coperte da un titolare sicuro, e '
               + 'ti restano solo ' + mancaAncora + ' acquisti in quel reparto.',
        });
      }
    }
    const avanzati = rosa.A.length + rosa.C.length;
    const slotAvanzati = this.reg.slot.A + this.reg.slot.C;
    if (!rigoristi.length && avanzati >= slotAvanzati / 2.0
        && (slotAvanzati - avanzati) > 0) {
      avvisi.push({
        tipo: 'rigoristi',
        testo: 'Non hai nessun rigorista designato. Sono cinque o sei gol '
             + "garantiti a stagione: valgono piu' di una fantamedia "
             + 'leggermente piu\' alta.',
      });
    }
    if (concentrazione.length && concentrazione[0][1] >= 5) {
      avvisi.push({
        tipo: 'concentrazione',
        testo: 'Hai ' + concentrazione[0][1] + ' giocatori del '
             + concentrazione[0][0] + '. Se quella squadra si inceppa si '
             + 'inceppa mezza rosa: da qui in avanti guarda altrove.',
      });
    }

    // Il rischio di restare in dieci: e' l'unico numero del quadro che non
    // parla di quanto la rosa rende, ma di quante volte riesci a metterla in
    // campo.
    const rischio = this.rischioUndici(rosa);
    if (rischio.quota >= SOGLIA_RISCHIO) {
      const stretto = rischio.reparto_stretto || {};
      const dove = stretto.ruolo
        ? " Il reparto che ti tiene fermo e' quello " + nomeRuolo(stretto.ruolo) + '.'
        : '';
      avvisi.push({
        tipo: 'rischio', ruolo: stretto.ruolo || null,
        testo: 'Con questa rosa rischi di non riuscire a schierare undici in '
             + 'circa ' + giornate(rischio.giornate) + ' giornate su 38: in '
             + 'rosa quei giocatori ci sono, in campo no.' + dove,
      });
    }

    return {
      undici,
      copertura,
      rischio,
      rigoristi,
      concentrazione: concentrazione.slice(0, 4)
        .map(([squadra, quanti]) => ({ squadra, quanti })),
      in_rosa: totali,
      titolari_sicuri: sicuriTotali,
      avvisi,
    };
  }
}

/** "due" invece di "2.0", che a schermo si legge meglio. */
function giornate(n) {
  if (n < 1.5) return 'una';
  return String(arrotonda(n));
}

function nomeRuolo(r) {
  return { P: 'in porta', D: 'in difesa', C: 'a centrocampo',
           A: 'in attacco' }[r];
}
