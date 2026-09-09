// Stato dell'asta: chi ha comprato cosa, a che prezzo, con quanti crediti.
//
// Traduzione di `motore/asta.py`, con una differenza di deposito e nessuna di
// sostanza: li' c'e' SQLite, qui c'e' un array in memoria salvato nel
// dispositivo. Il principio resta quello, ed e' il motivo per cui l'annulla
// non puo' lasciare i conti storti: **il registro degli acquisti e' l'unica
// verita'**, crediti e slot non si memorizzano mai, si ricontano ogni volta.

export const RUOLI = ['P', 'D', 'C', 'A'];

export class ErroreAsta extends Error {}

export class StatoAsta {
  constructor(regole, deposito) {
    this.reg = regole;
    this.deposito = deposito || null;   // qualcosa con leggi()/scrivi()
    this.d = { creata_il: null, presidenti: [], acquisti: [], turno: 1, prossimo_seq: 1 };
    this.listone = null;                // impostato da collega()
  }

  // Il listone serve solo a sapere ruolo e nome di chi si compra.
  collega(listone) { this.listone = listone; return this; }

  inizializza(nomi, mioNome) {
    const n = [];
    for (const x of (nomi || [])) n.push(x);
    while (n.length < this.reg.partecipanti - 1) n.push('Avversario ' + (n.length + 1));
    const avversari = n.slice(0, this.reg.partecipanti - 1);
    this.d = {
      creata_il: new Date().toISOString().slice(0, 19),
      presidenti: [{ id: 1, nome: mioNome || 'Io', io: 1 }].concat(
        avversari.map((nome, i) => ({ id: i + 2, nome, io: 0 }))),
      acquisti: [],
      turno: 1,
      prossimo_seq: 1,
    };
    this.salva();
    return this;
  }

  esiste() {
    return !!(this.d && this.d.presidenti && this.d.presidenti.some((p) => p.io));
  }

  carica(d) {
    if (d && d.presidenti) this.d = d;
    return this;
  }

  salva() { if (this.deposito) this.deposito.scrivi(this.d); }

  // ------------------------------------------------------------------ turno
  turno() { return this.d.turno; }

  impostaTurno(presidenteId) {
    if (!this.d.presidenti.some((p) => p.id === presidenteId)) {
      throw new ErroreAsta('presidente ' + presidenteId + ' inesistente');
    }
    this.d.turno = presidenteId;
    this.salva();
  }

  avanzaTurno() {
    const ids = this.d.presidenti.map((p) => p.id).sort((a, b) => a - b);
    if (!ids.length) return null;
    const i = ids.indexOf(this.turno());
    const prossimo = ids[(i + 1) % ids.length];
    this.impostaTurno(prossimo);
    return prossimo;
  }

  // ---------------------------------------------------------------- lettura
  presidenti() {
    const fuori = this.d.presidenti.map((p) => {
      const suoi = this.d.acquisti.filter((a) => a.presidente_id === p.id);
      const conta = (r) => suoi.filter((a) => a.ruolo === r).length;
      return {
        id: p.id, nome: p.nome, io: p.io,
        crediti: this.reg.crediti - suoi.reduce((s, a) => s + a.prezzo, 0),
        n_p: conta('P'), n_d: conta('D'), n_c: conta('C'), n_a: conta('A'),
      };
    });
    // Stesso ordine di `v_presidenti`: prima io, poi per numero.
    fuori.sort((a, b) => (b.io - a.io) || (a.id - b.id));
    return fuori;
  }

  io() {
    const r = this.presidenti().find((p) => p.io);
    if (!r) throw new ErroreAsta('asta non inizializzata: chiama inizializza()');
    return r;
  }

  acquisti() {
    return this.d.acquisti.slice().sort((a, b) => a.seq - b.seq).map((a) => {
      const g = this.listone ? this.listone.get(a.giocatore_id) : null;
      return Object.assign({}, a, {
        nome: g ? g.nome : '', squadra: g ? g.squadra : '',
      });
    });
  }

  venduti() { return new Set(this.d.acquisti.map((a) => a.giocatore_id)); }

  // --------------------------------------------------------------- conteggi
  slotUsati(presidenteId, ruolo) {
    return this.d.acquisti.filter(
      (a) => a.presidente_id === presidenteId && a.ruolo === ruolo).length;
  }

  slotResidui(presidenteId, ruolo) {
    if (ruolo) return this.reg.slot[ruolo] - this.slotUsati(presidenteId, ruolo);
    return RUOLI.reduce((s, r) => s + this.slotResidui(presidenteId, r), 0);
  }

  crediti(presidenteId) {
    const speso = this.d.acquisti
      .filter((a) => a.presidente_id === presidenteId)
      .reduce((s, a) => s + a.prezzo, 0);
    return this.reg.crediti - speso;
  }

  liquidita(presidenteId) {
    const residui = this.slotResidui(presidenteId);
    if (residui <= 0) return 0;
    return Math.max(0, this.crediti(presidenteId) - (residui - 1));
  }

  get creditiResiduiLega() {
    const speso = this.d.acquisti.reduce((s, a) => s + a.prezzo, 0);
    return this.reg.crediti_totali - speso;
  }

  get slotResiduiLega() {
    return this.reg.slot_lega - this.d.acquisti.length;
  }

  spesoRuolo(ruolo) {
    return this.d.acquisti.filter((a) => a.ruolo === ruolo)
      .reduce((s, a) => s + a.prezzo, 0);
  }

  slotResiduiRuolo(ruolo) {
    const assegnati = this.d.acquisti.filter((a) => a.ruolo === ruolo).length;
    return this.reg.slot_lega_ruolo(ruolo) - assegnati;
  }

  // -------------------------------------------------------------- scrittura
  registra(giocatoreId, presidenteId, prezzo, limite) {
    const g = this.listone ? this.listone.get(giocatoreId) : null;
    if (!g) throw new ErroreAsta('giocatore ' + giocatoreId + ' inesistente');
    if (this.d.acquisti.some((a) => a.giocatore_id === giocatoreId)) {
      throw new ErroreAsta(g.nome + " risulta gia' acquistato");
    }
    if (!this.d.presidenti.some((p) => p.id === presidenteId)) {
      throw new ErroreAsta('presidente ' + presidenteId + ' inesistente');
    }
    const p = Math.trunc(prezzo);
    if (!(p >= 1)) throw new ErroreAsta("il prezzo minimo e' 1");
    if (this.slotResidui(presidenteId, g.ruolo) <= 0) {
      throw new ErroreAsta('slot ' + g.ruolo + " gia' pieni per quel presidente");
    }
    const residuiDopo = this.slotResidui(presidenteId) - 1;
    if (this.crediti(presidenteId) - p < residuiDopo) {
      throw new ErroreAsta('con ' + (this.crediti(presidenteId) - p)
        + " crediti non potrebbe piu' riempire i " + residuiDopo + ' slot rimanenti');
    }
    this.d.acquisti.push({
      seq: this.d.prossimo_seq++,
      giocatore_id: giocatoreId,
      presidente_id: presidenteId,
      prezzo: p,
      ruolo: g.ruolo,
      istante: new Date().toISOString().slice(0, 19),
      // Il limite che il motore dava un istante prima della chiamata: e'
      // l'unico modo di giudicare poi la decisione con le informazioni che
      // c'erano allora, invece che col senno di poi.
      limite: (limite === undefined || limite === null) ? null : Math.trunc(limite),
    });
    this.salva();
  }

  annullaUltimo() {
    if (!this.d.acquisti.length) throw new ErroreAsta('nessun acquisto da annullare');
    let ultimo = this.d.acquisti[0];
    for (const a of this.d.acquisti) if (a.seq > ultimo.seq) ultimo = a;
    this.d.acquisti = this.d.acquisti.filter((a) => a.seq !== ultimo.seq);
    this.salva();
    return ultimo.giocatore_id;
  }

  annulla(giocatoreId) {
    const prima = this.d.acquisti.length;
    this.d.acquisti = this.d.acquisti.filter((a) => a.giocatore_id !== giocatoreId);
    if (this.d.acquisti.length === prima) {
      throw new ErroreAsta('quel giocatore non risulta acquistato');
    }
    this.salva();
  }
}

// Il deposito predefinito: il telefono. `localStorage` basta e avanza - lo
// stato di un'asta intera sono una ventina di kilobyte - ed e' sincrono, che
// per un dato da salvare a ogni acquisto e' la cosa giusta: se il programma
// muore un istante dopo, l'acquisto e' gia' sul disco.
export class DepositoLocale {
  constructor(chiave) { this.chiave = chiave || 'fantahacked.asta'; }

  leggi() {
    try {
      const t = window.localStorage.getItem(this.chiave);
      return t ? JSON.parse(t) : null;
    } catch (e) { return null; }
  }

  scrivi(d) {
    try { window.localStorage.setItem(this.chiave, JSON.stringify(d)); }
    catch (e) { /* spazio finito o modalita' privata: l'asta resta in memoria */ }
  }

  cancella() {
    try { window.localStorage.removeItem(this.chiave); } catch (e) { /* niente */ }
  }
}
