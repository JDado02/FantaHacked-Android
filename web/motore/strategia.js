// Le due domande dell'asta live. Traduzione di `motore/strategia.py`.
//
//   1. Esce un giocatore: fino a quanto mi conviene spingermi?  -> decisione()
//   2. Tocca a me chiamare: chi chiamo?                         -> consiglio()
//
// Il verdetto e' uno solo per tutto il programma: quello che si legge nella
// lista dei consigli e quello che si legge aprendo la scheda sono la stessa
// frase, calcolata qui una volta.

import { arrotonda } from './comune.js';

export const RUOLI = ['P', 'D', 'C', 'A'];
export const GIORNATE = 38;
export const MARGINE_MINIMO = 0.08;
export const CERTEZZA_RIPIEGO = 0.45;
export const QUANTI_VALUTATI = 90;
export const SOGLIA_OCCASIONE = 1.0;
export const SOGLIA_TRAPPOLA = 3.0;
export const PREZZO_TRAPPOLA = 5;
export const PREZZO_SVUOTO = 8;
export const CONTENDENTI_MINIMI = 2;
export const VERDETTI_BUONI = ['OCCASIONE', 'PRENDILO', 'AL PREZZO GIUSTO',
                               'DA UN CREDITO', 'RIPIEGO'];

export { arrotonda } from './comune.js';

const NOMI_RUOLO = { P: 'portieri', D: 'difensori',
                     C: 'centrocampisti', A: 'attaccanti' };
const NOMI_SINGOLARI = { P: 'portiere', D: 'difensore',
                         C: 'centrocampista', A: 'attaccante' };

export function nomeRuolo(r) { return NOMI_RUOLO[r]; }
export function nomeSingolare(r) { return NOMI_SINGOLARI[r]; }

function dei(n) { return n === 1 ? 'del' : 'dei'; }

export class Consigliere {
  constructor(valutatore, ottimizzatore) {
    this.v = valutatore;
    this.o = ottimizzatore;
    this.stato = valutatore.stato;
    this.reg = valutatore.reg;
  }

  decisione(giocatore) {
    const v = this.v;
    const o = this.o;
    const x = giocatore;
    const chiusura = arrotonda(v.prezzoChiusura(x));
    const [limite0, dett] = o.maxBid(x, chiusura);
    let limite = limite0;
    const concorrenti = v.concorrenti(x);
    const serve = o.serve[x.ruolo] || 0;

    let consigliato = limite ? Math.min(limite, Math.max(1, chiusura)) : 0;
    const conv = o.convenienza(x, chiusura);
    const [verdetto, colore, frase] = this._verdetto(
      x, limite, chiusura, consigliato, serve, dett, concorrenti, conv);
    if (verdetto === 'DA UN CREDITO') { limite = 1; consigliato = 1; }
    return {
      id: x.id, nome: x.nome, squadra: x.squadra, ruolo: x.ruolo,
      max_bid: limite, consigliato, chiusura,
      margine: limite - chiusura,
      verdetto, colore, frase,
      serve_nel_ruolo: serve,
      concorrenti,
      contributo_modificatore: arrotonda(dett.contributo_modificatore),
      guadagno: arrotonda(dett.guadagno),
      utilita: arrotonda(dett.guadagno_al_prezzo || 0.0),
      resa: arrotonda(o.resa(x) * 10) / 10,
      convenienza: arrotonda(conv * 10) / 10,
      motivo: dett.motivo,
      mercato: arrotonda(x.prezzo_mercato || 1),
      costo_atteso: arrotonda(x.prezzo_atteso || x.prezzo_mercato || 1),
      fantamedia: arrotonda(x.fm * 100) / 100,
      presenze: arrotonda(x.presenze),
      gerarchia: Consigliere.gerarchia(x),
      chiude_coppia: this._chiudeCoppia(x),
    };
  }

  // ---------------------------------------------------- chi gioca davvero
  static gerarchia(x) {
    const quota = x.titolarita;
    if (quota === null || quota === undefined) {
      return { grado: 'ignoto', etichetta: 'Da verificare', quota: null,
               certezza: 0.0, sicuro: false, posto: null, in_reparto: null,
               nuovo: !!x.nuovo, rigorista: Math.trunc(x.rigorista || 0),
               testo: "Non ho abbastanza dati per dire quanto giochera'." };
    }
    const partite = arrotonda(quota * 38);
    let testo;
    if (x.grado === 'titolare') {
      const posto = x.posto_reparto || 1;
      const quanti = x.in_reparto || 1;
      const reparto = dei(quanti) + ' ' + quanti + ' ' + nomeRuolo(x.ruolo);
      const dove = posto === 1
        ? "il piu' impiegato " + reparto + ' a listone della sua squadra'
        : 'il ' + posto + '° per impiego ' + reparto + ' della sua squadra';
      testo = 'Titolare: ' + partite + ' presenze attese, ' + dove + '.';
    } else if (x.grado === 'ballottaggio') {
      testo = 'In ballottaggio: le presenze attese sono ' + partite
            + " su 38, non e' un posto garantito.";
    } else if (x.grado === 'rotazione') {
      testo = 'Gioca a rotazione: circa ' + partite + ' partite. La fantamedia '
            + 'vale quello che vale su cosi\' poche presenze.';
    } else {
      testo = 'Riserva: ' + partite + ' presenze attese. Qualunque sia la sua '
            + 'fantamedia, in campo lo vedi poco.';
    }
    if (x.nuovo) testo += " E' arrivato quest'anno: lo storico dice poco.";
    return {
      grado: x.grado, etichetta: x.etichetta_grado,
      quota: arrotonda(quota * 100) / 100,
      certezza: arrotonda((x.certezza || 0) * 100) / 100,
      sicuro: !!x.sicuro, posto: x.posto_reparto, in_reparto: x.in_reparto,
      nuovo: !!x.nuovo, rigorista: Math.trunc(x.rigorista || 0), testo,
    };
  }

  _chiudeCoppia(x) {
    const bonus = this.o.coppia_bonus.get(x.id) || 0.0;
    if (bonus <= 0) return null;
    const miei = new Set();
    for (const r of RUOLI) for (const y of this.o.mia_rosa[r]) miei.add(y.id);
    for (const c of this.v.compagniDiMaglia(x.id)) {
      if (!miei.has(c.altro)) continue;
      const altro = this.v.g.get(c.altro);
      if (!altro) continue;
      return {
        con: altro.nome,
        copertura: arrotonda(c.copertura * 100) / 100,
        copertura_buchi: arrotonda(c.copertura_buchi * 100) / 100,
        buchi: arrotonda(c.buchi * 10) / 10,
        punti_extra: arrotonda(bonus),
      };
    }
    return null;
  }

  _meglioDi(x) {
    let obiettivi;
    try {
      obiettivi = ((this.o.piano().per_ruolo || {})[x.ruolo] || {}).obiettivi || [];
    } catch (e) { return ''; }
    const nomi = obiettivi.filter((t) => t.id !== x.id)
      .slice(0, 2).map((t) => t.nome + ' (~' + t.costo + ')');
    if (!nomi.length) return '';
    return nomi.length === 2 ? nomi.join(' o ') : nomi[0];
  }

  _verdetto(x, limite, chiusura, consigliato, serve, dett, concorrenti, convenienza) {
    // Prima di tutto il resto: se non e' iscritto alla lista di serie A non
    // c'e' niente da valutare. Senza questo ramo il verdetto usciva RIPIEGO
    // su uno che non puo' giocare nemmeno una partita.
    if (x.fuori_lista) {
      return ['FUORI LISTA', 'stop',
              "Non e' iscritto alla lista di serie A: non puo' scendere in "
              + 'campo. In rosa varrebbe come una casella vuota.'];
    }
    if (serve <= 0) {
      return ['NON SERVE', 'stop',
              'Reparto ' + x.ruolo + " completo: non hai piu' slot."];
    }
    const motivo = dett.motivo || '';
    if ((limite <= 0 || limite < chiusura)
        && convenienza > -SOGLIA_TRAPPOLA && chiusura >= 1
        && !(motivo.startsWith("gia'") || motivo.startsWith('crediti finiti'))) {
      const coda = convenienza >= SOGLIA_OCCASIONE
        ? "rende piu' della media dei " + nomeRuolo(x.ruolo)
        : 'costa quello che vale';
      return ['RIPIEGO', 'attenzione',
              "Non e' la prima scelta del motore per questo slot, ma a "
              + chiusura + ' crediti ' + coda + ": e' chi prendere se i tuoi "
              + 'obiettivi volano via.'];
    }
    if (limite <= 0) {
      if (motivo.startsWith("gia'")) {
        return ["GIA' VENDUTO", 'stop', "Questo giocatore e' gia' stato assegnato."];
      }
      if (motivo.startsWith('crediti finiti')) {
        return ['NON PUOI', 'stop',
                'Devi tenere 1 credito per ognuno dei '
                + this.stato.slotResidui(this.o.io) + ' slot scoperti.'];
      }
      if (Math.abs(dett.guadagno || 0.0) < 4 && chiusura <= 2) {
        return ['DA UN CREDITO', 'attenzione',
                'Vale quanto i tanti altri da un credito. Prendilo pure per '
                + 'riempire lo slot, ma non salirci.'];
      }
      const meglio = this._meglioDi(x);
      if (meglio) {
        return ['LASCIA', 'stop',
                'Con quegli stessi crediti il motore preferisce ' + meglio + '.'];
      }
      return ['LASCIA', 'stop',
              "Con gli stessi crediti c'e' di meglio in questo ruolo."];
    }
    if (limite < chiusura) {
      return ['LASCIA', 'stop',
              "Chiudera' sui " + chiusura + ' e per la tua rosa ne vale al '
              + 'massimo ' + limite + '.'];
    }
    const margine = limite - chiusura;
    if (!concorrenti.length) {
      return ['PRENDILO', 'ottimo',
              "Nessun avversario puo' rilanciare: e' tuo a un credito."];
    }
    if (margine >= Math.max(3, MARGINE_MINIMO * Math.max(1, chiusura))) {
      return ['OCCASIONE', 'ottimo',
              'Vale ' + limite + ' per la tua rosa e dovrebbe chiudere sui '
              + chiusura + ': hai ' + margine + ' crediti di margine.'];
    }
    return ['AL PREZZO GIUSTO', 'attenzione',
            'Prendilo solo entro ' + limite + ': sopra stai pagando '
            + "piu' di quanto renda alla tua rosa."];
  }

  // ------------------------------------------------------------ la fase
  /** Il ruolo che si sta chiamando: si va per reparti, dai portieri. */
  fase() {
    for (const r of RUOLI) {
      if (this.stato.slotResiduiRuolo(r) > 0) return r;
    }
    return null;
  }

  /** Quanto sono ricco rispetto agli avversari, a parita' di slot. */
  pressione() {
    const io = this.o.io;
    const mieiSlot = Math.max(1, this.stato.slotResidui(io));
    const mio = this.stato.crediti(io) / mieiSlot;
    const altri = [];
    for (const p of this.stato.presidenti()) {
      if (p.io) continue;
      const s = this.stato.slotResidui(p.id);
      if (s > 0) altri.push(p.crediti / s);
    }
    if (!altri.length) return 1.0;
    const media = altri.reduce((a, b) => a + b, 0) / altri.length;
    return media ? mio / media : 1.0;
  }

  // ------------------------------------------------------- chi chiamare
  /**
   * Chi conviene chiamare adesso, e perche'.
   *
   * Una classifica sola, e mai un vincitore unico: il reparto si mostra
   * intero, in fila per utilita' - quanti punti guadagna la rosa comprandolo
   * al prezzo a cui andra' via. Tre fasce piu' due liste:
   *
   *   top          l'acquisto migliora la rosa: sono le occasioni
   *   evitare      costa molto e rende meno di quello che avresti
   *   alternative  ne' affare ne' trappola: il piano B alla portata
   *   svuotare     non lo voglio, ma far pagare lui e' far pagare loro
   *   coppie       chi completa una maglia che ho gia' meta' in rosa
   */
  consiglio(quanti) {
    quanti = quanti || 12;
    const ruolo = this.fase();
    if (!ruolo) {
      return { fase: null, top: [], evitare: [], alternative: [], svuotare: [],
               coppie: this._coppieAperte(), pressione: 1.0, vuoti: {},
               indicazione: "Asta finita." };
    }
    const v = this.v;
    const o = this.o;
    const stato = this.stato;
    const io = stato.io().id;
    const serve = o.serve[ruolo] || 0;
    const pressione = this.pressione();
    const liquidita = stato.liquidita(io);

    // Il verdetto e' quello che uscira' aprendo la scheda: le liste non
    // decidono niente per conto loro, si limitano a raggruppare. Cosi' un
    // giocatore non puo' finire sotto "da prendere" e poi dire "lascia".
    const VALE = ["OCCASIONE", "PRENDILO", "AL PREZZO GIUSTO"];
    let top = []; let evitare = []; const neutri = []; let svuotare = [];
    let concMax = 0;
    for (const x of v.disponibili(ruolo, QUANTI_VALUTATI)) {
      const d = this.decisione(x);
      const conc = d.concorrenti;
      d.concorrenti = conc.length;
      concMax = Math.max(concMax, conc.length);
      d.perche = d.frase;
      const margine = d.margine;
      // In fila per utilita', non per convenienza: ordinare per margine
      // metterebbe in cima l'affare da tre crediti e in fondo il giocatore
      // che cambia la squadra, che e' il rovescio di quel che serve sapere.
      d.punteggio = d.utilita + 0.25 * Math.max(0, margine);
      const conv = d.convenienza;
      if (VALE.indexOf(d.verdetto) >= 0 || (conv >= SOGLIA_OCCASIONE && d.resa > 0)) {
        const soglia = Math.max(1, MARGINE_MINIMO * Math.max(1, d.chiusura));
        d.categoria = margine >= soglia ? "occasione" : "giusto";
        top.push(d);
      } else if (conv <= -SOGLIA_TRAPPOLA && d.chiusura >= PREZZO_TRAPPOLA) {
        d.categoria = "evitare";
        evitare.push(d);
      } else {
        // Non e' un affare, ma nemmeno un errore: costa quello che vale. E'
        // il giocatore che si prende quando gli obiettivi sono volati via.
        d.categoria = "alternativa";
        neutri.push(d);
      }
      if (d.categoria !== "occasione" && d.categoria !== "giusto") {
        const e = this._svuota(x, d, conc, liquidita);
        if (e) svuotare.push(e);
      }
    }
    top.sort((a, b) => (b.punteggio - a.punteggio)
                    || (b.convenienza - a.convenienza) || (a.id - b.id));
    svuotare.sort((a, b) => (b.punteggio - a.punteggio) || (a.id - b.id));
    evitare.sort((a, b) => ((a.convenienza - 0.15 * a.chiusura)
                          - (b.convenienza - 0.15 * b.chiusura)) || (a.id - b.id));

    // Quando resta un solo slot non servono dodici nomi.
    let quantiVeri = quanti;
    if (concMax < CONTENDENTI_MINIMI) {
      quantiVeri = Math.max(3, Math.min(quanti, 3 * Math.max(1, serve)));
    }
    // Chi sta fra i consigliati non puo' anche essere uno da far pagare agli
    // altri: sono due indicazioni opposte sullo stesso nome, e a schermo
    // diventerebbero un invito a chiamarlo per poi non prenderlo.
    const inTop = new Set(top.slice(0, quantiVeri).map((d) => d.id));
    svuotare = svuotare.filter((d) => !inTop.has(d.id));

    // Il primo della fascia e' il metro di paragone di tutti gli altri: dire
    // "e' il secondo, rende tre punti meno del primo ma ne costa quindici in
    // meno" e' l'unica frase che rende utile una classifica.
    top.slice(0, quantiVeri).forEach((d, i) => {
      d.posto_fascia = i + 1;
      if (i > 0) d.perche = Consigliere._confronto(d, top[0]);
    });

    // Fra i "gia' visti" vanno anche quelli da evitare: le alternative
    // ripescano dal fondo del listone, e da li' rientrava chi era gia' stato
    // classificato trappola.
    const inAlto = new Set(inTop);
    for (const d of evitare) inAlto.add(d.id);
    let alternative = this._alternative(ruolo, serve, neutri, inAlto);
    const inAlt = new Set(alternative.map((d) => d.id));
    svuotare = svuotare.filter((d) => !inAlt.has(d.id));

    // **Una lista vuota non e' una risposta.** Puo' capitare, ed e' perfino
    // corretto nel merito: se il piano destina cinque crediti agli ultimi due
    // difensori perche' il resto rende di piu' in attacco, nessun difensore
    // supera la soglia dell'occasione. Ma quei due slot vanno riempiti lo
    // stesso, e trovarsi la sezione vuota vuol dire non sapere chi chiamare,
    // che e' esattamente il momento in cui si compra a caso.
    let obbligati = 0;
    const budgetRuolo = this._budgetRuolo(ruolo);
    if (!top.length && serve > 0 && alternative.length) {
      const quantiMin = Math.min(alternative.length, Math.max(3, serve));
      for (const d of alternative.slice(0, quantiMin)) {
        // Meglio una lista corta che una lista che si contraddice.
        if (VERDETTI_BUONI.indexOf(d.verdetto) < 0) continue;
        const e = Object.assign({}, d);
        e.categoria = "obbligato";
        e.perche = "Nessuno in questo reparto e' un affare ai prezzi di adesso, "
          + "ma " + serve + " slot vanno riempiti e il piano ci destina "
          + budgetRuolo + " crediti: fra quelli alla portata, questo e' il "
          + "migliore che gioca. "
          + ((d.gerarchia || {}).etichetta || "Da verificare") + ", "
          + d.presenze + " presenze attese.";
        top.push(e);
      }
      const promossi = new Set(top.map((d) => d.id));
      obbligati = promossi.size;
      alternative = alternative.filter((d) => !promossi.has(d.id));
    }

    // Chi chiude una coppia sta in un riquadro suo, in cima a tutto, e non
    // dentro le tre fasce: e' un'informazione che vale a prescindere da
    // quanto quel giocatore renda da solo, e infilarla in mezzo a una
    // classifica ordinata per resa sarebbe il modo migliore di non vederla.
    const coppie = this._coppieAperte();
    const inCoppia = new Set(coppie.map((d) => d.id));
    top = top.filter((d) => !inCoppia.has(d.id));
    evitare = evitare.filter((d) => !inCoppia.has(d.id));
    alternative = alternative.filter((d) => !inCoppia.has(d.id));
    svuotare = svuotare.filter((d) => !inCoppia.has(d.id));

    // Ultimo controllo, sulle liste come escono davvero: sopra ci sono gia'
    // tre deduplicazioni, ognuna al punto giusto del ragionamento, ma le vie
    // per rientrare sono tante abbastanza che inseguirle una per una e' come
    // tapparle sperando. Qui si guarda il risultato, che e' l'unica cosa che
    // l'utente vede.
    const fuori = top.slice(0, quantiVeri);
    const gia = new Set(fuori.map((d) => d.id));
    const alt = alternative.filter((d) => !gia.has(d.id)).slice(0, quantiVeri);
    for (const d of alt) gia.add(d.id);
    const svu = svuotare.filter((d) => !gia.has(d.id))
      .slice(0, Math.max(4, Math.floor(quantiVeri / 2)));

    return {
      fase: ruolo, serve, pressione: arrotonda(pressione * 100) / 100,
      indicazione: this._indicazione(ruolo, serve, pressione, fuori, svu,
                                     obbligati, budgetRuolo),
      top: fuori,
      evitare: evitare.slice(0, quantiVeri),
      alternative: alt,
      svuotare: svu,
      coppie,
      valutati: Math.min(QUANTI_VALUTATI, v.disponibili(ruolo).length),
      liberi_nel_ruolo: v.disponibili(ruolo).length,
      budget_ruolo: budgetRuolo,
      scarsita: this.scarsita(ruolo, serve),
      vuoti: this._percheVuoto(ruolo, top, evitare, alt, svu, concMax),
    };
  }

  /** Come sta questo rispetto al migliore della fascia, in una riga. */
  static _confronto(d, primo) {
    const dp = arrotonda(d.resa - primo.resa);
    const dc = d.chiusura - primo.chiusura;
    const chi = primo.nome;
    if (dc < 0 && dp < 0) {
      return "Rende " + (-dp) + " punti meno di " + chi + ", ma ne costa "
           + (-dc) + " in meno: e' il ripiego se " + chi
           + " vola oltre il tuo limite.";
    }
    if (dc < 0) {
      return "Costa " + (-dc) + " crediti meno di " + chi + " e rende quanto "
           + "lui: a parita' di reparto e' l'affare piu' grosso della lista.";
    }
    if (dp < 0) {
      return "Rende " + (-dp) + " punti meno di " + chi + " e costa " + dc
           + " crediti in piu': ha senso solo se " + chi + " va via prima.";
    }
    return "Rende " + dp + " punti piu' di " + chi + " ma ne costa " + dc + " in piu'.";
  }

  _indicazione(ruolo, serve, pressione, prendere, svuotare, obbligati, budget) {
    const nome = nomeRuolo(ruolo);
    // Quando la fascia alta e' vuota la cosa da dire non e' "non conviene
    // nessuno": e' **dove sono finiti i crediti**. Senza quella frase il piano
    // sembra un'omissione invece che una scelta.
    if (obbligati && serve > 0) {
      return "Il piano destina solo " + budget + " crediti ai " + serve + " "
           + (serve !== 1 ? nome : nomeSingolare(ruolo))
           + " che ti mancano: il resto rende di piu' negli altri reparti. Qui "
           + "sotto ci sono i migliori in quella fascia di prezzo, non degli "
           + "affari. Se ne vuoi uno piu' forte devi togliere crediti a un "
           + "altro reparto, e aprendolo il motore ti dice quanto ci perdi.";
    }
    if (serve <= 0) {
      return "Hai gia' completato i " + nome
           + ": da qui in avanti chiama solo per far spendere gli altri.";
    }
    if (pressione >= 1.15 && prendere.length) {
      return "Sei piu' liquido della media (" + pressione.toFixed(2)
           + "): chiama i tuoi obiettivi finche' gli altri non possono seguirti.";
    }
    if (pressione <= 0.85) {
      return "Hai meno potere d'acquisto della media (" + pressione.toFixed(2)
           + "): fai spendere loro prima di scoprirti.";
    }
    if (!prendere.length) {
      return "Ai prezzi di adesso nessun " + nomeSingolare(ruolo) + " conviene: "
           + "costano tutti piu' di quanto renderebbero alla tua rosa. Conviene "
           + "chiamare per far spendere gli altri e aspettare che i prezzi scendano.";
    }
    if (serve === 1) {
      return "Ti manca un " + nomeSingolare(ruolo) + ". Sceglilo bene: e' l'ultimo slot.";
    }
    return "Mancano " + serve + " " + nome + " alla tua rosa.";
  }

  /** Fin dove si puo' spingere un giocatore che non voglio, in sicurezza. */
  _svuota(x, d, conc, liquidita) {
    if (d.chiusura < PREZZO_SVUOTO) return null;
    let tetto = Math.max(1, arrotonda((x.prezzo_base || 1.0) - 1));
    const capaci = conc.filter((c) => c.liquidita > tetto);
    if (capaci.length < CONTENDENTI_MINIMI) return null;
    const minaccia = capaci.filter((c) => c.liquidita > liquidita).length;
    // Il tetto e' il piu' basso fra due: sotto quanto vale, e non oltre dove
    // il giocatore chiudera' comunque. Spingere sopra la chiusura non fa
    // spendere niente a nessuno, fa solo rischiare di aggiudicarselo.
    tetto = Math.min(tetto, Math.trunc(d.chiusura));
    const e = Object.assign({}, d);
    e.brucia = tetto;
    e.tetto_sicuro = tetto;
    e.contendenti = capaci.length;
    e.minacciosi = minaccia;
    e.categoria = "svuota";
    e.perche = Consigliere._percheSvuotare(e, capaci);
    // Non si ordinano per quanto converrebbe comprarli - e' la domanda
    // sbagliata - ma per quanti crediti bruciano davvero: il tetto, pesato
    // per quanti avversari possono superarlo e quanti sono piu' liquidi di te.
    e.punteggio = e.brucia * (1 + minaccia) / (1 + capaci.length);
    return e;
  }

  static _percheSvuotare(voce, conc) {
    const chi = voce.minacciosi >= 2
      ? (voce.minacciosi + " avversari piu' liquidi di te")
      : (conc.length + " avversari");
    return "Non lo vuoi, ma " + chi + " se lo contenderanno. Spingilo fino a "
         + voce.tetto_sicuro + " e non oltre: sopra quella cifra, se si "
         + "fermano, te lo ritrovi in rosa a un prezzo che non volevi pagare.";
  }

  /** Il piano B: chi posso prendere tutti, non uno solo svenandomi. */
  _alternative(ruolo, serve, neutri, giaVisti) {
    if (serve <= 0) return [];
    const budget = Math.max(this._budgetRuolo(ruolo), serve);
    const perSlot = budget / Math.max(1, serve);
    // Fino a una volta e mezzo la spesa media per slot: sopra, prendendolo,
    // si sbilancia il reparto e gli altri slot restano scoperti.
    const tetto = Math.max(2.0, perSlot * 1.5);
    const gioca = (d) => {
      const g = d.gerarchia || {};
      return g.grado === "titolare" && (g.certezza || 0) >= CERTEZZA_RIPIEGO;
    };
    const out = neutri.filter(
      (d) => !giaVisti.has(d.id) && d.chiusura <= tetto && d.resa > 0);
    // Vengono prima i titolari veri: un ripiego serve quando bisogna riempire
    // uno slot in fretta, e una fantamedia alta prodotta da otto presenze in
    // quel momento fa danno.
    out.sort((a, b) => ((gioca(a) ? 0 : 1) - (gioca(b) ? 0 : 1))
                    || (b.punteggio - a.punteggio) || (a.id - b.id));
    for (const d of out) {
      const g = d.gerarchia || {};
      d.perche = (g.etichetta || "Da verificare") + ", " + d.presenze
               + " presenze attese e " + d.fantamedia.toFixed(2)
               + " di fantamedia: a " + Math.max(1, d.chiusura)
               + " crediti costa quello che vale.";
    }

    // Il fondo del listone non passa dalla valutazione completa: se le
    // alternative vere sono poche, si pesca li' con la vecchia regola.
    if (out.length < 6) {
      const visti = new Set(giaVisti);
      for (const d of out) visti.add(d.id);
      for (const d of this._ripiego(ruolo, serve, visti)) {
        d.categoria = "alternativa";
        d.perche = d.frase || "";
        if (d.punteggio === undefined) d.punteggio = d.utilita || 0;
        out.push(d);
      }
    }
    return out;
  }

  /**
   * Su chi ripiegare se gli obiettivi vanno via troppo cari.
   *
   * Ordinati per resa attesa, non per prezzo: serve sapere chi vale di piu'
   * fra quelli che restano alla portata, non rifare la classifica di sopra.
   *
   * E soprattutto **solo chi gioca**. Un ripiego serve quando bisogna riempire
   * uno slot in fretta; se in quel momento il programma propone una fantamedia
   * alta prodotta da otto presenze, il danno lo fa lui, non l'asta.
   */
  _ripiego(ruolo, serve, giaVisti) {
    if (serve <= 0) return [];
    const v = this.v;
    const o = this.o;
    const liberi = v.disponibili(ruolo);
    const budget = Math.max(this._budgetRuolo(ruolo), serve);
    const perSlot = budget / Math.max(1, serve);
    const tetto = Math.max(2.0, perSlot * 1.5);

    const candidati = liberi.slice()
      .sort((a, b) => ((b.presenze * b.fm) - (a.presenze * a.fm)) || (a.id - b.id));
    const sicuri = [];
    const incerti = [];
    for (const x of candidati) {
      if (giaVisti.has(x.id)) continue;
      if (arrotonda(v.prezzoChiusura(x)) > tetto) continue;
      if (x.grado === "titolare" && (x.certezza || 0) >= CERTEZZA_RIPIEGO) sicuri.push(x);
      else incerti.push(x);
      if (sicuri.length >= 6) break;
    }
    // Il fondo del listone non passa dalla classificazione in fasce, quindi
    // qui puo' arrivare anche una trappola: qualcuno che a quel prezzo rende
    // meno di quanto rendano gli stessi crediti nel suo reparto. Succedeva, e
    // da "alternative" quel nome finiva promosso fra i consigliati con la
    // scheda che continuava a dire LASCIA.
    const trappola = (x) => o.convenienza(x, arrotonda(v.prezzoChiusura(x)))
                            <= -SOGLIA_TRAPPOLA;
    const buoni = sicuri.filter((x) => !trappola(x))
      .concat(incerti.filter((x) => !trappola(x)));
    const out = [];
    for (const x of buoni.slice(0, 6)) {
      const d = this.decisione(x);
      delete d.concorrenti;
      d.categoria = "ripiego";
      out.push(d);
    }
    return out;
  }

  /** Se il reparto si sta svuotando, dirlo: cambia il modo di giocarselo. */
  scarsita(ruolo, serve) {
    const v = this.v;
    const stato = this.stato;
    const liberi = v.disponibili(ruolo);
    const sopra = liberi.filter((x) => x.fm > v.rimpiazzo_fm[ruolo]).length;
    const inGara = stato.presidenti()
      .filter((p) => stato.slotResidui(p.id, ruolo) > 0).length;
    if (sopra <= serve * 2) {
      return "Restano " + sopra + " " + nomeRuolo(ruolo) + " sopra il livello di "
           + "rimpiazzo e te ne servono " + serve + ": da qui in avanti conta "
           + "prenderli, non risparmiare.";
    }
    if (inGara <= 3) {
      return "Solo " + inGara + " squadre hanno ancora slot liberi in questo "
           + "reparto: i prezzi scenderanno.";
    }
    return null;
  }

  _budgetRuolo(ruolo) {
    try {
      const d = (this.o.piano().per_ruolo || {})[ruolo] || {};
      return Math.trunc(d.crediti || 0);
    } catch (e) { return 0; }
  }

  /** Le maglie di cui possiedo gia' meta': l'altra meta' va comprata. */
  _coppieAperte() {
    const v = this.v;
    const o = this.o;
    const miei = new Set();
    for (const r of RUOLI) for (const y of o.mia_rosa[r]) miei.add(y.id);
    if (!miei.size) return [];
    const venduti = this.stato.venduti();
    const out = [];
    const visti = new Set();
    for (const mioId of Array.from(miei).sort((a, b) => a - b)) {
      const mio = v.g.get(mioId);
      if (!mio) continue;
      for (const c of v.compagniDiMaglia(mioId)) {
        const altro = v.g.get(c.altro);
        if (!altro || visti.has(altro.id) || venduti.has(altro.id)) continue;
        visti.add(altro.id);
        const d = this.decisione(altro);
        delete d.concorrenti;
        const scoperte = c.buchi;
        const coperte = c.buchi_coperti;
        const quota = arrotonda(100 * c.copertura_buchi);
        const ruoloSuo = c.tipo === "ballottaggio"
          ? "Si gioca il posto con" : "E' il vice di";
        const testo = ruoloSuo + " " + mio.nome + ", che hai gia' in rosa. "
          + mio.nome + " salta circa " + arrotonda(scoperte) + " giornate, e lui "
          + "ne copre " + arrotonda(coperte) + ": e' il " + quota + "% dei suoi "
          + "buchi. Il mercato paga chi e' sicuro, non chi e' complementare, ed "
          + "e' li' che sta l'affare.";
        out.push({
          id: altro.id, nome: altro.nome, squadra: altro.squadra,
          ruolo: altro.ruolo, tipo: c.tipo,
          con: mio.nome, con_id: mio.id,
          copertura: arrotonda(c.copertura * 100) / 100,
          copertura_buchi: arrotonda(c.copertura_buchi * 100) / 100,
          buchi: arrotonda(scoperte * 10) / 10,
          giornate_coperte: arrotonda(coperte * 10) / 10,
          chiusura: d.chiusura, max_bid: d.max_bid,
          utilita: d.utilita, verdetto: d.verdetto,
          gerarchia: d.gerarchia,
          slot_liberi: o.serve[altro.ruolo] || 0,
          perche: testo,
          decisione: d,
        });
      }
    }
    out.sort((a, b) => (b.copertura_buchi - a.copertura_buchi)
                    || (b.utilita - a.utilita) || (a.id - b.id));
    return out;
  }

  /**
   * Perche' una sezione non ha niente da dire.
   *
   * Una lista vuota senza spiegazione si legge come un guasto: sembra che il
   * programma abbia smesso di rispondere proprio quando serviva. Quasi sempre
   * invece la risposta e' "non c'e' niente da segnalare", e allora la cosa
   * utile e' dire perche' non c'e'.
   */
  _percheVuoto(ruolo, top, evitare, alternative, svuotare, contendenti) {
    const nome = nomeRuolo(ruolo);
    const uno = nomeSingolare(ruolo);
    const soli = contendenti <= 0;
    const out = {};
    if (!evitare.length) {
      out.evitare = soli
        ? "Nessuna trappola: non e' rimasto nessun avversario che possa "
          + "rilanciare su un " + uno + ", quindi qualunque nome di questa "
          + "lista lo paghi un credito."
        : "Nessuna trappola: ai prezzi di adesso i " + nome + " che restano "
          + "costano tutti meno di quanto rendono, o costano cosi' poco che "
          + "sbagliare non fa danno.";
    }
    if (!alternative.length) {
      out.alternative = top.length
        ? "Non servono: sopra ci sono gia' tutti i " + nome
          + " che vale la pena considerare."
        : "Nessun " + uno + " rientra nella spesa media per slot che ti resta "
          + "in questo reparto.";
    }
    if (!svuotare.length) {
      out.svuotare = soli
        ? "Nessuno da far pagare: gli avversari non hanno piu' slot da " + nome
          + " liberi, quindi non c'e' nessuno a cui bruciare crediti."
        : "Nessuno da far pagare: per farlo servono almeno due avversari che "
          + "possano superare il tetto di sicurezza, e adesso non ci sono.";
    }
    return out;
  }
}
