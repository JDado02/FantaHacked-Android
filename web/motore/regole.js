// Lettura e validazione delle regole di lega.
//
// Traduzione fedele di `motore/regole.py`. "Fedele" qui non e' un vezzo: i
// numeri che escono da questo motore devono essere gli stessi che escono da
// quello Python, altrimenti l'applicazione sul telefono e quella sul computer
// direbbero due cose diverse sullo stesso giocatore, e non ci sarebbe modo di
// sapere quale delle due ha ragione. C'e' una prova apposta che le confronta
// giocatore per giocatore.

export const GIORNATE = 38;
export const RUOLI = ['P', 'D', 'C', 'A'];

export class Regole {
  constructor(d) {
    this._d = d;
    this.partecipanti = parseInt(d.partecipanti, 10);
    this.crediti = parseInt(d.crediti_iniziali, 10);
    const r = d.rosa;
    this.slot = {
      P: parseInt(r.portieri, 10), D: parseInt(r.difensori, 10),
      C: parseInt(r.centrocampisti, 10), A: parseInt(r.attaccanti, 10),
    };
    this.slot_totali = RUOLI.reduce((s, x) => s + this.slot[x], 0);
    this.sostituzioni = parseInt(d.sostituzioni || 0, 10);

    const b = d.bonus_malus;
    this.gol_ruolo = {
      P: +b.gol_portiere, D: +b.gol_difensore,
      C: +b.gol_centrocampista, A: +b.gol_attaccante,
    };
    this.v_assist = +b.assist;
    this.v_gol_subito = +b.gol_subito;
    this.v_rig_parato = +b.rigore_parato;
    this.v_rig_segnato = +(b.rigore_segnato !== undefined ? b.rigore_segnato : b.gol_attaccante);
    this.v_rig_sbagl = +b.rigore_sbagliato;
    this.v_autogol = +b.autogol;
    this.v_amm = +b.ammonizione;
    this.v_esp = +b.espulsione;

    // Due ripartizioni, non una: con quale forma si vuole uscire dall'asta
    // (il piano) e come spende davvero la stanza (la previsione). Tenerle
    // insieme peggiora una delle due; il perche' sta in `regole.py`.
    const m = d.mercato || {};
    const rip = m.ripartizione_budget || {};
    const grezza = {
      P: +(rip.portieri !== undefined ? rip.portieri : 9),
      D: +(rip.difensori !== undefined ? rip.difensori : 16),
      C: +(rip.centrocampisti !== undefined ? rip.centrocampisti : 28),
      A: +(rip.attaccanti !== undefined ? rip.attaccanti : 47),
    };
    const somma = RUOLI.reduce((s, x) => s + grezza[x], 0) || 1;
    this.quota_budget = {};
    RUOLI.forEach((x) => { this.quota_budget[x] = grezza[x] / somma; });

    const ripM = m.ripartizione_mercato || rip;
    const grezzaM = {
      P: +(ripM.portieri !== undefined ? ripM.portieri : grezza.P),
      D: +(ripM.difensori !== undefined ? ripM.difensori : grezza.D),
      C: +(ripM.centrocampisti !== undefined ? ripM.centrocampisti : grezza.C),
      A: +(ripM.attaccanti !== undefined ? ripM.attaccanti : grezza.A),
    };
    const sommaM = RUOLI.reduce((s, x) => s + grezzaM[x], 0) || 1;
    this.quota_mercato = {};
    RUOLI.forEach((x) => { this.quota_mercato[x] = grezzaM[x] / sommaM; });

    this.impara_mercato = m.impara_dall_asta !== undefined ? !!m.impara_dall_asta : true;
    this.fiducia_mercato = Math.min(1, Math.max(0,
      +(m.fiducia_nel_mercato !== undefined ? m.fiducia_nel_mercato : 0.5)));
    this.portieri_pacchetto = !!m.portieri_a_pacchetto;
    const ris = m.riserva_minima_per_ruolo || {};
    this.riserva_ruolo = {
      P: Math.max(0, +(ris.portieri || 0)) / 100,
      D: Math.max(0, +(ris.difensori || 0)) / 100,
      C: Math.max(0, +(ris.centrocampisti || 0)) / 100,
      A: Math.max(0, +(ris.attaccanti || 0)) / 100,
    };

    const pi = d.portiere_imbattuto || {};
    this.imbattuto_attivo = !!pi.attivo;
    this.imbattuto_bonus = +(pi.bonus || 0);

    const md = d.modificatore_difesa || {};
    this.mod_dif_attivo = !!md.attivo;
    this.mod_dif_scala = (md.scala || [])
      .map((x) => [+x.media_minima, +x.bonus])
      .sort((a, b2) => a[0] - b2[0]);
    const testo = String(md.componenti || '').toLowerCase();
    this.mod_dif_n_por = testo.includes('portiere') ? 1 : 0;
    this.mod_dif_n_dif = 3;
    for (const tok of testo.replace(/\+/g, ' ').split(/\s+/)) {
      if (tok && /^\d+$/.test(tok)) { this.mod_dif_n_dif = parseInt(tok, 10); break; }
    }

    this.mod_cen_attivo = !!((d.modificatore_centrocampo || {}).attivo);
    this.mod_att_attivo = !!((d.modificatore_attacco || {}).attivo);
    this.mod_fair_attivo = !!((d.modificatore_fairplay || {}).attivo);

    this._valida();
  }

  get crediti_totali() { return this.partecipanti * this.crediti; }

  get slot_lega() { return this.partecipanti * this.slot_totali; }

  slot_lega_ruolo(ruolo) { return this.partecipanti * this.slot[ruolo]; }

  get crediti_per_slot() { return this.crediti_totali / this.slot_lega; }

  _valida() {
    const e = [];
    if (!(this.partecipanti >= 2 && this.partecipanti <= 20)) {
      e.push('partecipanti fuori scala: ' + this.partecipanti);
    }
    if (this.crediti < this.slot_totali) {
      e.push('crediti (' + this.crediti + ') inferiori agli slot di rosa ('
             + this.slot_totali + '): impossibile riempire la rosa');
    }
    for (const r of RUOLI) {
      if (this.slot[r] < 1) e.push('slot ' + r + ' non valido: ' + this.slot[r]);
    }
    if (this.mod_dif_attivo && !this.mod_dif_scala.length) {
      e.push('modificatore di difesa attivo ma scala vuota');
    }
    if (this.mod_dif_attivo) {
      const bonus = this.mod_dif_scala.map((t) => t[1]);
      const ordinati = bonus.slice().sort((a, b2) => a - b2);
      if (bonus.join(',') !== ordinati.join(',')) {
        e.push("la scala del modificatore di difesa non e' crescente");
      }
    }
    for (const r of RUOLI) {
      const q = this.quota_budget[r];
      if (!(q >= 0.005 && q <= 0.9)) {
        e.push("la quota di budget per " + r + " e' fuori scala: "
               + (100 * q).toFixed(1) + '%');
      }
    }
    const riserve = RUOLI.reduce((s, x) => s + this.riserva_ruolo[x], 0);
    if (riserve > 1) {
      e.push("le riserve minime per ruolo sommano a piu' del 100%: "
             + Math.round(100 * riserve) + '%');
    }
    if (this.portieri_pacchetto && this.slot.P < 2) {
      e.push('portieri a pacchetto ma la rosa ha meno di 2 portieri');
    }
    if (e.length) {
      throw new Error('regole_lega.json non valido:\n  - ' + e.join('\n  - '));
    }
  }

  bonus_modificatore(media) {
    let b = 0;
    for (const [soglia, valore] of this.mod_dif_scala) if (media >= soglia) b = valore;
    return b;
  }
}

export function carica(json) { return new Regole(json); }
