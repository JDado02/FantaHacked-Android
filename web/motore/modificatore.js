// Bonus atteso del modificatore di difesa.
//
// Traduzione fedele di `motore/modificatore.py`. Il punto delicato e' che il
// bonus **non** e' `bonus(media_attesa)`: il regolamento lo calcola a gradini
// ogni giornata, e i voti oscillano, quindi una difesa da 6,24 di media supera
// comunque la soglia di 6,25 in circa meta' delle giornate. Integrando sul
// rumore la funzione diventa liscia, e ogni decimo di media voto acquista
// valore: e' quello che rende calcolabile quanto vale un difensore.

export const SD_VOTO_SINGOLO = 0.65;
export const GIORNATE = 38;

export function sdMedia(nGiocatori) {
  return SD_VOTO_SINGOLO / Math.sqrt(Math.max(nGiocatori, 1));
}

// JavaScript non ha `erf`, e qui serve **preciso**, non "abbastanza preciso".
//
// La prima versione usava l'approssimazione di Abramowitz e Stegun 7.1.26,
// che sbaglia di 1,5e-7. Sembra niente. Ma il bonus del modificatore si
// moltiplica per 38 giornate, entra nei punti, da li' nel VOR e da li' nel
// prezzo di ogni giocatore del reparto: la prova di equivalenza col motore
// Python trovava scarti fino a due milionesimi in relativo, e su qualche
// giocatore la programmazione dinamica sceglieva un percorso diverso e il
// limite usciva di un credito. Un credito e' una decisione diversa.
//
// Questa e' la serie a termini tutti positivi
//     erf(x) = (2x/sqrt(pi)) e^(-x^2) * somma di (2x^2)^n / (1*3*5*...*(2n+1))
// che non ha cancellazioni e converge in fretta nell'intervallo che serve
// qui (|x| resta sotto 3). Oltre 5 la coda vale meno di 1e-12 e si taglia.
export function erf(x) {
  const segno = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  if (ax >= 5) return segno;
  const xx = ax * ax;
  let termine = ax;
  let somma = 0;
  for (let n = 0; n < 200; n += 1) {
    somma += termine;
    termine *= (2 * xx) / (2 * n + 3);
    if (termine < 1e-18 * somma) { somma += termine; break; }
  }
  return segno * (2 / Math.sqrt(Math.PI)) * Math.exp(-xx) * somma;
}

function phi(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

export function bonusAtteso(media, scala, sd) {
  if (!scala || !scala.length || sd <= 0) {
    let b = 0;
    for (const [soglia, valore] of (scala || [])) if (media >= soglia) b = valore;
    return b;
  }
  let atteso = 0;
  let precedente = 0;
  for (const [soglia, valore] of scala) {
    const pSupera = 1 - phi((soglia - media) / sd);
    atteso += (valore - precedente) * pSupera;
    precedente = valore;
  }
  return atteso;
}

export class Modificatore {
  constructor(regole) {
    this.reg = regole;
    this.attivo = regole.mod_dif_attivo;
    this.n = regole.mod_dif_n_por + regole.mod_dif_n_dif;
    this.sd = sdMedia(this.n);
    this.scala = regole.mod_dif_scala;
  }

  puntiStagione(mediaVoti) {
    if (!this.attivo) return 0;
    return GIORNATE * bonusAtteso(mediaVoti, this.scala, this.sd);
  }

  guadagno(mediaBase, mediaNuova) {
    return this.puntiStagione(mediaNuova) - this.puntiStagione(mediaBase);
  }

  contributoMarginale(mvGiocatore, mvSostituito, mediaBase) {
    if (!this.attivo) return 0;
    const delta = (mvGiocatore - mvSostituito) / this.n;
    return this.guadagno(mediaBase, mediaBase + delta);
  }
}
