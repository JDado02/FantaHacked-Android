// Le due domande dell'asta live. Traduzione di `motore/strategia.py`.
//
//   1. Esce un giocatore: fino a quanto mi conviene spingermi?  -> decisione()
//   2. Tocca a me chiamare: chi chiamo?                         -> consiglio()
//
// Il verdetto e' uno solo per tutto il programma: quello che si legge nella
// lista dei consigli e quello che si legge aprendo la scheda sono la stessa
// frase, calcolata qui una volta.

import { arrotonda } from './comune.js';
import * as formazione from './formazione.js';

export const RUOLI = ['P', 'D', 'C', 'A'];
export const GIORNATE = 38;
export const MARGINE_MINIMO = 0.08;
export const CERTEZZA_RIPIEGO = 0.45;
// Sotto questa quota di presenze attese un giocatore **non copre** un posto da
// titolare. Puo' essere un ottimo affare, e spesso lo e' proprio perche' costa
// poco; ma se la difesa e' fatta di quattro come lui, un giorno su tre uno di
// loro non prende voto e la casella la riempie la panchina, o non la riempie
// nessuno. Ventitre' giornate su trentotto e' il confine sotto cui un titolare
// smette di essere una certezza.
export const QUOTA_TITOLARE = 0.60;

// Per chi il posto non ce l'ha ancora - ballottaggio, rotazione - la soglia e'
// piu' alta, e non e' pignoleria. Per il conto della copertura basterebbe la
// media: `E[min(n, disponibili)]` dipende solo dalle probabilita'. Ma qui la
// domanda e' un'altra: **su chi posso contare per costruire la formazione**, e
// li' l'incertezza sulla stima conta eccome. Le ventisette presenze attese di
// un ballottaggio non sono ventisette partite quasi certe: sono la media fra
// il vincere il posto e giocarne trentaquattro e il perderlo e giocarne dodici.
export const QUOTA_TITOLARE_INCERTO = 0.75;

// E sotto questa quota un giocatore non e' una scommessa, e' uno slot buttato.
// Vale **sempre**, anche a reparto coperto, dove per il resto e' giusto andare
// a caccia di affari: uno che gioca dieci partite non copre niente e non rende
// niente, e la fantamedia alta che a volte porta e' quella di dieci partite
// scelte bene. Non sparisce dalle liste - a volte e' l'unico che resta - ma
// non puo' stare sopra a chi gioca.
export const QUOTA_MINIMA_UTILE = 0.40;

// Manopola di misura, non di gusto: a `false` i consigli tornano a essere
// ordinati solo per resa, com'erano prima. Serve alle prove per giocare le
// stesse aste nei due modi. In tutto il resto del programma resta acceso.
export const PRIMA_I_TITOLARI = true;

// Quanti giocatori del reparto si valutano davvero prima di mettere in fila i
// consigli. Novanta, presi per valore sopra il rimpiazzo, coprono chiunque
// possa essere un'occasione.
export const QUANTI_VALUTATI = 90;

// **Ma il valore sopra il rimpiazzo non e' il solo modo di essere utili.**
//
// Prendere i primi novanta per VOR sembrava innocuo - "sotto ci sono solo
// riempitivi da un credito" - e invece taglia fuori proprio la categoria che
// serve di piu' quando i crediti sono finiti: il **titolare fisso con
// fantamedia normale**. Il suo VOR e' quasi zero per costruzione, perche' la
// sua fantamedia sfiora quella del rimpiazzo; ma gioca trentuno partite e
// costa quattro crediti. Un giocatore da rotazione con fantamedia alta ha VOR
// piu' grande, entra fra i novanta, e finiva consigliato al posto suo.
//
// Successo davvero, su un'asta vera: con tre slot di difesa da riempire e nove
// crediti in cassa, il pannello proponeva un giocatore da diciannove presenze
// e uno da sei, mentre erano liberi a quattro crediti due titolari da trentuno.
// Quelli non erano nemmeno stati guardati.
export const QUANTI_TITOLARI_ECONOMICI = 24;
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

// `round(x, 2)` di Python: arrotondamento decimale corretto, non il giro
// `Math.round(x * 100) / 100` che sui valori a meta' strada cade dalla parte
// sbagliata. I numeri della copertura finiscono in una frase a schermo e in
// una prova che li confronta con quelli del motore Python, uno per uno.
function a2(x) { return Number(x.toFixed(2)); }
function a3(x) { return Number(x.toFixed(3)); }

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

  // ------------------------------------------- chi copre un posto in campo
  /**
   * Su questo giocatore ci si puo' costruire la formazione?
   *
   * Le presenze attese, con una soglia piu' severa per chi il posto non ce
   * l'ha ancora. Non si guarda `certezza`: quella misura quanto **concordano
   * le fonti** sulla gerarchia, non quanto gioca il giocatore, e usarla come
   * filtro buttava fuori Molina - titolare con ventinove presenze attese -
   * solo perche' le guide non erano d'accordo fra loro.
   */
  static giocaSempre(x) {
    const q = formazione.quota(x);
    if (x && x.grado === 'titolare') return q >= QUOTA_TITOLARE;
    return q >= QUOTA_TITOLARE_INCERTO;
  }

  /** Quanto giocano i giocatori che ho gia' in quel reparto. */
  quoteMie(ruolo) {
    const io = this.stato.io().id;
    const fuori = [];
    for (const a of this.stato.acquisti()) {
      if (a.presidente_id !== io || a.ruolo !== ruolo) continue;
      const x = this.v.g.get(a.giocatore_id);
      if (x) fuori.push(formazione.quota(x));
    }
    return fuori;
  }

  /**
   * Quante caselle della formazione riempie gia' il reparto che ho.
   *
   * E' la domanda che il programma non si faceva, e che invece decide la
   * stagione: la rosa ha otto difensori, ma in campo ne vanno quattro ogni
   * domenica. Se quei quattro giocano meta' campionato, la fantamedia alta
   * che li aveva fatti sembrare un affare non la vedi mai: vedi la casella
   * vuota, o il sesto difensore preso da un credito.
   */
  copertura(ruolo) {
    const quote = this.quoteMie(ruolo);
    const inCampo = formazione.IN_CAMPO[ruolo] || 0;
    const r = formazione.relazione(quote, inCampo);
    const io = this.stato.io().id;
    const slot = this.stato.slotResidui(io, ruolo);
    // Non si puo' chiedere di coprire piu' di quanto restino slot.
    const mancano = Math.min(r.mancano, slot);
    return { coperti: a2(r.coperti),
             servono: r.servono,
             mancano: a2(mancano),
             mancano_interi: Math.round(mancano),
             rischio_buco: a3(r.rischio_buco),
             slot_residui: slot,
             titolari: this._quantiTitolari(ruolo) };
  }

  _quantiTitolari(ruolo) {
    const io = this.stato.io().id;
    let n = 0;
    for (const a of this.stato.acquisti()) {
      if (a.presidente_id !== io || a.ruolo !== ruolo) continue;
      const x = this.v.g.get(a.giocatore_id);
      if (x && Consigliere.giocaSempre(x)) n += 1;
    }
    return n;
  }

  /** Quante caselle in piu' riempirebbe, rispetto a un tappabuchi. */
  guadagnoCopertura(x, quote, riferimento) {
    const q = quote === undefined ? this.quoteMie(x.ruolo) : quote;
    const rif = riferimento === undefined
      ? this.v.quotaRiempitivo(x.ruolo) : riferimento;
    return formazione.guadagno(q, formazione.IN_CAMPO[x.ruolo] || 0,
                               formazione.quota(x), rif);
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
    const fase = this.fase();
    if (!fase) {
      return { fase: null, top: [], evitare: [], alternative: [], svuotare: [],
               coppie: this._coppieAperte(), prendere: [], ripiego: [],
               pressione: 1.0, vuoti: {}, indicazione: "Asta finita." };
    }
    if (this.stato.slotResidui(this.stato.io().id, fase) > 0) {
      return this._consiglioRuolo(fase, quanti);
    }
    return this._repartoChiuso(fase, quanti);
  }

  /**
   * Il mio reparto e' pieno, quello della lega no: cosa dire adesso.
   *
   * Succede sempre, e a lungo: coi portieri a pacchetto la mia scelta e'
   * **una**, e poi restano sette pacchetti da assegnare agli altri, sette
   * chiamate durante le quali non posso fare niente. Finora lo schermo
   * rispondeva a quel momento in due modi, tutti e due sbagliati.
   *
   * Prima suggeriva chi "far pagare agli altri" - e sono offerte che non posso
   * fare: con lo slot pieno il rilancio non me lo accetta nessuno, e l'intera
   * sicurezza di quel consiglio ("se si fermano te lo aggiudichi sotto il suo
   * valore") si regge su un acquisto che non puo' avvenire. Poi, quando
   * restava un solo avversario in gara, spariva anche quello e la pagina
   * restava **bianca**: proprio nel reparto piu' lungo da guardare, il
   * programma smetteva di dire qualsiasi cosa.
   *
   * La risposta giusta e' che quei minuti non sono morti: sono il tempo in cui
   * si prepara il reparto dopo. Quindi si mostra quello, dicendo chiaro che e'
   * un anticipo e che i prezzi si assesteranno quando tocchera'.
   */
  _repartoChiuso(fase, quanti) {
    const io = this.stato.io().id;
    let prossimo = null;
    for (const r of RUOLI) {
      if (this.stato.slotResidui(io, r) > 0) { prossimo = r; break; }
    }
    const restano = this.stato.slotResiduiRuolo(fase);
    const nomeFase = nomeRuolo(fase);
    if (prossimo === null) {
      const d = this._consiglioRuolo(fase, quanti);
      d.top = []; d.evitare = []; d.alternative = []; d.svuotare = [];
      d.prendere = []; d.ripiego = [];
      d.indicazione = "La tua rosa e' completa: non puoi piu' fare offerte. "
        + 'Restano ' + restano + ' ' + nomeFase + ' da assegnare agli altri, e '
        + "quando avranno finito l'asta sara' chiusa.";
      return d;
    }
    const d = this._consiglioRuolo(prossimo, quanti);
    // Nemmeno qui si puo' offrire: durante i portieri non si chiama un
    // difensore. La lista serve a sapere su chi andare, non a muoversi ora.
    d.svuotare = [];
    const vuoti = Object.assign({}, d.vuoti || {});
    vuoti.svuotare = "Non ancora: si sta chiamando un altro reparto, e finche' "
      + "dura non puoi ne' prendere ne' far pagare un " + nomeSingolare(prossimo)
      + ". Quando tocchera' a loro questa sezione torna.";
    d.vuoti = vuoti;
    d.fase = fase;
    d.anticipo = prossimo;
    d.anticipo_nome = nomeRuolo(prossimo);
    d.restano_nel_reparto = restano;
    const coda = d.indicazione
      ? d.indicazione[0].toLowerCase() + d.indicazione.slice(1) : '';
    d.indicazione = 'Hai chiuso i ' + nomeFase + ": con gli slot pieni non "
      + "puoi piu' rilanciare in questo reparto, e ne restano " + restano
      + ' da assegnare agli altri. Intanto guarda avanti: ' + coda;
    return d;
  }

  /**
   * I giocatori del reparto su cui vale la pena fare i conti.
   *
   * I primi per valore sopra il rimpiazzo, piu' i piu' economici fra quelli
   * che coprono un posto in formazione: le due domande sono diverse e la
   * seconda non si risponde con la classifica della prima.
   */
  _daValutare(ruolo) {
    const fuori = this.v.disponibili(ruolo, QUANTI_VALUTATI);
    const gia = new Set(fuori.map((x) => x.id));
    const extra = this.v.disponibili(ruolo).filter(
      (x) => !gia.has(x.id) && Consigliere.giocaSempre(x));
    extra.sort((a, b) => ((a.prezzo_base || 99) - (b.prezzo_base || 99))
                      || (formazione.quota(b) - formazione.quota(a))
                      || (a.id - b.id));
    return fuori.concat(extra.slice(0, QUANTI_TITOLARI_ECONOMICI));
  }

  /**
   * Le liste per **un** reparto. Di solito e' quello in chiamata; quando i
   * miei slot li' sono pieni e' invece il prossimo che mi serve.
   */
  _consiglioRuolo(ruolo, quanti) {
    quanti = quanti || 12;
    const v = this.v;
    const o = this.o;
    const stato = this.stato;
    const io = stato.io().id;
    const serve = o.serve[ruolo] || 0;
    const pressione = this.pressione();
    const liquidita = stato.liquidita(io);
    const possoOffrire = stato.slotResidui(io, ruolo) > 0;
    const cop = this.copertura(ruolo);
    const quoteMie = this.quoteMie(ruolo);
    const riempitivo = v.quotaRiempitivo(ruolo);

    // Il verdetto e' quello che uscira' aprendo la scheda: le liste non
    // decidono niente per conto loro, si limitano a raggruppare. Cosi' un
    // giocatore non puo' finire sotto "da prendere" e poi dire "lascia".
    const VALE = ["OCCASIONE", "PRENDILO", "AL PREZZO GIUSTO"];
    let top = []; let evitare = []; const neutri = []; let svuotare = [];
    let concMax = 0;
    const valutati = this._daValutare(ruolo);
    for (const x of valutati) {
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
      // Copre un posto in formazione, o e' un giocatore da panchina? Finche'
      // il nucleo non e' pieno la differenza viene prima di qualunque conto
      // sul prezzo, e va detta su ogni riga.
      d.titolare_pieno = Consigliere.giocaSempre(x);
      d.copre = a3(this.guadagnoCopertura(x, quoteMie, riempitivo));
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
      // Serve pero' uno slot libero in quel ruolo: senza, l'offerta non e'
      // rischiosa, e' **impossibile** - nessuno accetta il rilancio di chi ha
      // gia' la casella piena.
      if (possoOffrire && d.categoria !== "occasione" && d.categoria !== "giusto") {
        const e = this._svuota(x, d, conc, liquidita);
        if (e) svuotare.push(e);
      }
    }

    // **Prima chi gioca.** Finche' mancano titolari al nucleo, un giocatore da
    // panchina non puo' stare sopra uno su cui si costruisce la formazione,
    // per quanto convenga: il primo fa risparmiare crediti, il secondo fa
    // giocare la squadra. Quando il nucleo e' coperto la distinzione sparisce
    // da sola e si torna a ordinare per resa, che a quel punto e' la domanda
    // giusta - i posti dal quinto in giu' sono panchina per definizione.
    //
    // Il criterio e' netto apposta: copre un posto fisso o no. Si era provato
    // a graduarlo con le caselle guadagnate, ed e' un numero giusto ma
    // inservibile per mettere in fila: in un listone pieno di titolari da un
    // credito il guadagno **marginale** di chiunque e' un decimo di casella, e
    // a quel punto ordinare per decimi vuol dire ordinare per rumore.
    const chiave = (d) => {
      const giocaPoco = ((d.presenze || 0) / GIORNATE) < QUOTA_MINIMA_UTILE;
      const giu = PRIMA_I_TITOLARI
        && ((cop.mancano >= 0.5 && !d.titolare_pieno) || giocaPoco);
      // Il punteggio si arrotonda al punto intero, e **a parita' gioca chi
      // gioca di piu'**. Non e' un dettaglio estetico: negli ultimi slot di un
      // reparto la resa di tutti collassa fra zero e uno, e ordinare per
      // decimi di punto vuol dire ordinare per l'errore di stima.
      return [giu ? 1 : 0, -arrotonda(d.punteggio), -(d.presenze || 0),
              -d.convenienza, d.id];
    };
    const confronta = (a, b) => {
      const ka = chiave(a); const kb = chiave(b);
      for (let i = 0; i < ka.length; i += 1) {
        if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
      }
      return 0;
    };
    top.sort(confronta);
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
      if (i > 0) d.perche = Consigliere._confronto(d, top[0], cop.mancano);
    });

    // Fra i "gia' visti" vanno anche quelli da evitare: le alternative
    // ripescano dal fondo del listone, e da li' rientrava chi era gia' stato
    // classificato trappola.
    const inAlto = new Set(inTop);
    for (const d of evitare) inAlto.add(d.id);
    let alternative = this._alternative(ruolo, serve, neutri, inAlto, cop);
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

    // **E quando la fascia alta c'e' ma e' tutta panchina.**
    //
    // E' il caso che ha fatto scrivere tutto questo, ed e' diverso dal
    // precedente: la lista non e' vuota, e' piena di gente che gioca poco.
    // Succede a fine reparto, quando i crediti che restano comprano solo
    // giocatori da pochi crediti: fra quelli, chi ha la fantamedia piu' alta
    // e' quasi sempre un giocatore da rotazione - alta proprio perche' gioca
    // solo le partite giuste - e finisce in cima. Ma se in formazione manca
    // ancora un titolare, la risposta giusta non e' quella: e' il difensore da
    // trentuno presenze che costa uguale.
    if (cop.mancano >= 0.5 && PRIMA_I_TITOLARI && alternative.length) {
      const testa = top.slice(0, Math.max(1, Math.floor(quanti / 3)));
      if (!testa.some((d) => d.titolare_pieno)) {
        const daPromuovere = alternative.filter((d) => d.titolare_pieno);
        const quantiPro = Math.max(1, cop.mancano_interi);
        for (const d of daPromuovere.slice(0, quantiPro)) {
          const e = Object.assign({}, d);
          e.categoria = 'copertura';
          e.perche = 'Copre un posto in formazione: ' + d.presenze
            + ' presenze attese, e a ' + Math.max(1, d.chiusura)
            + " crediti costa quanto chi ne gioca la meta'. In questo reparto "
            + 'ne copri ' + cop.coperti.toFixed(1) + ' su ' + cop.servono
            + ", e finche' non sono coperte questa e' la spesa che rende di "
            + "piu'.";
          top.unshift(e);
        }
        const promossi = new Set(top.map((d) => d.id));
        alternative = alternative.filter((d) => !promossi.has(d.id));
      }
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
      copertura: cop,
      indicazione: this._indicazione(ruolo, serve, pressione, fuori, svu,
                                     obbligati, budgetRuolo, cop),
      top: fuori,
      evitare: evitare.slice(0, quantiVeri),
      alternative: alt,
      svuotare: svu,
      coppie,
      valutati: valutati.length,
      liberi_nel_ruolo: v.disponibili(ruolo).length,
      budget_ruolo: budgetRuolo,
      scarsita: this.scarsita(ruolo, serve),
      vuoti: this._percheVuoto(ruolo, top, evitare, alt, svu, concMax),
    };
  }

  /** Come sta questo rispetto al migliore della fascia, in una riga. */
  static _confronto(d, primo, mancano) {
    mancano = mancano || 0;
    const dp = arrotonda(d.resa - primo.resa);
    const dc = d.chiusura - primo.chiusura;
    const chi = primo.nome;
    let frase;
    if (dc < 0 && dp < 0) {
      frase = "Rende " + (-dp) + " punti meno di " + chi + ", ma ne costa "
            + (-dc) + " in meno: e' il ripiego se " + chi
            + " vola oltre il tuo limite.";
    } else if (dc < 0) {
      frase = "Costa " + (-dc) + " crediti meno di " + chi + " e rende quanto "
            + "lui: a parita' di reparto e' l'affare piu' grosso della lista.";
    } else if (dp < 0) {
      frase = "Rende " + (-dp) + " punti meno di " + chi + " e costa " + dc
            + " crediti in piu': ha senso solo se " + chi + " va via prima.";
    } else {
      frase = "Rende " + dp + " punti piu' di " + chi + " ma ne costa " + dc + " in piu'.";
    }
    // Un ripiego col limite a zero non e' una contraddizione: finche' il primo
    // della fascia e' in lista, quello slot rende di piu' aspettando lui. Ma
    // sullo schermo restava solo la cifra, uno zero accanto alla parola
    // "ripiego". Lo zero e' giusto; mancava la riga che dice quando smette di
    // esserlo.
    if ((d.max_bid || 0) <= 0) {
      frase += " Adesso il suo limite e' zero: conviene solo dopo che " + chi
             + " e' andato a qualcun altro.";
    }
    // E se non copre un posto in formazione va detto qui, sulla riga, non
    // lasciato dedurre da un'etichetta grigia: e' la differenza fra un affare
    // e un buco in difesa una domenica su tre.
    if (mancano >= 0.5 && !d.titolare_pieno) {
      frase += " Attenzione pero': gioca circa " + (d.presenze || 0)
             + " giornate su 38, quindi non copre un posto fisso, e in questo"
             + " reparto ti manca ancora chi lo copra.";
    }
    return frase;
  }

  _indicazione(ruolo, serve, pressione, prendere, svuotare, obbligati, budget,
               copertura) {
    const nome = nomeRuolo(ruolo);
    // **Prima di ogni altra cosa: la formazione sta in piedi?** Con il nucleo
    // scoperto la domanda non e' quale sia l'affare migliore, e' quanti
    // titolari mancano ancora. E' l'unico caso in cui una frase sulla
    // pressione o sui prezzi sarebbe un consiglio giusto dato nel momento
    // sbagliato.
    if (copertura && copertura.mancano >= 0.5 && serve > 0) {
      const quanti = copertura.servono;
      return 'In campo va' + (quanti === 1 ? '' : 'nno') + ' ' + quanti + ' '
           + (quanti === 1 ? nomeSingolare(ruolo) : nome)
           + ' ogni giornata e con la rosa di adesso ne copri '
           + copertura.coperti.toFixed(1) + '. Prima chi gioca, poi chi '
           + "conviene: uno da meta' campionato al posto di uno fisso non ti fa"
           + ' risparmiare crediti, ti lascia scoperto una domenica su tre.';
    }
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
  _alternative(ruolo, serve, neutri, giaVisti, copertura) {
    if (serve <= 0) return [];
    const budget = Math.max(this._budgetRuolo(ruolo), serve);
    const perSlot = budget / Math.max(1, serve);
    // Fino a una volta e mezzo la spesa media per slot: sopra, prendendolo,
    // si sbilancia il reparto e gli altri slot restano scoperti.
    let tetto = Math.max(2.0, perSlot * 1.5);
    // Il tetto serve a non sbilanciare il reparto, ma non deve poter
    // nascondere l'unica cosa che manca. Se in formazione restano caselle
    // scoperte, si alza almeno fino al **titolare fisso piu' economico**
    // disponibile: nove crediti su tre slot facevano un tetto di quattro e
    // mezzo, e con quello un difensore da trentuno presenze a otto crediti non
    // compariva da nessuna parte, mentre uno da diciannove a quattro stava in
    // cima.
    if (copertura && copertura.mancano >= 0.5) {
      const prezzi = neutri.filter((d) => d.titolare_pieno && (d.chiusura || 0) > 0)
        .map((d) => d.chiusura);
      if (prezzi.length) tetto = Math.max(tetto, Math.min(...prezzi));
    }
    // La stessa definizione usata dalla fascia alta: un titolare qui e un
    // titolare li' devono essere la stessa cosa, o le due liste si
    // contraddicono sullo stesso nome.
    const gioca = (d) => !!(PRIMA_I_TITOLARI && d.titolare_pieno);

    // `resa > 0` era l'ultimo cancello, ed e' quello che teneva fuori proprio
    // i giocatori giusti. Negli ultimi slot di un reparto la resa in punti di
    // **chiunque** e' zero virgola qualcosa: la panchina pesa poco per
    // costruzione. Fra due che rendono zero, pero', non sono uguali: uno gioca
    // trentuno partite e l'altro diciannove, e finche' in formazione manca una
    // casella quella differenza e' l'unica che conta.
    const scoperto = !!(copertura && copertura.mancano >= 0.5);
    const out = neutri.filter(
      (d) => !giaVisti.has(d.id) && d.chiusura <= tetto
             && (d.resa > 0 || (scoperto && d.titolare_pieno)));
    // Vengono prima i titolari veri: un ripiego serve quando bisogna riempire
    // uno slot in fretta, e una fantamedia alta prodotta da otto presenze in
    // quel momento fa danno.
    out.sort((a, b) => ((gioca(a) ? 0 : 1) - (gioca(b) ? 0 : 1))
                    || (b.punteggio - a.punteggio) || (a.id - b.id));
    for (const d of out) {
      const g = d.gerarchia || {};
      const coda = gioca(d) ? ''
        : " Da panchina, pero': non contarlo fra i titolari.";
      d.perche = (g.etichetta || "Da verificare") + ", " + d.presenze
               + " presenze attese e " + d.fantamedia.toFixed(2)
               + " di fantamedia: a " + Math.max(1, d.chiusura)
               + " crediti costa quello che vale." + coda;
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
        if (d.titolare_pieno === undefined) {
          const g = d.gerarchia || {};
          d.titolare_pieno = g.grado === "titolare"
            && (g.certezza || 0) >= CERTEZZA_RIPIEGO
            && (g.quota || 0) >= QUOTA_TITOLARE;
        }
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
