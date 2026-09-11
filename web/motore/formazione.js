// Quante caselle della formazione riesci davvero a riempire ogni giornata.
//
// Traduzione di `motore/formazione.py`, e come tutto il resto del motore deve
// dare gli stessi numeri: se il telefono e il computer dicessero due cose
// diverse su quanti titolari ti mancano, non ci sarebbe modo di sapere quale
// dei due ha ragione.
//
// La rosa ha otto difensori, ma in campo ne vanno quattro **ogni domenica**.
//
// Fin qui il valore di un giocatore era `presenze x (fantamedia meno il
// rimpiazzo)`, e il punteggio di una rosa la somma dei migliori per reparto.
// Vale la pena essere precisi su cosa sbaglia quel conto, perche' non e'
// quello che sembra: sui punti del singolo e' giusto, e infatti misurando si
// scopre che un giocatore discontinuo con fantamedia alta **non vale meno**
// dei suoi punti, se dietro c'e' una panchina che copre le giornate in cui
// manca.
//
// Quello che quel conto non vede sono due cose, e sono tutte e due decisive:
//
//   - **la panchina non entra mai nel totale.** Sommando i quattro migliori,
//     il quinto e il sesto difensore valgono zero. Ma giocano, e i punti li
//     fanno: tanti di piu' quanto piu' i titolari saltano;
//   - **le caselle che non si riempiono valgono zero, non poco.** Un reparto
//     di quattro che giocano meta' campionato e nessun altro copre meno di
//     due caselle su quattro: le altre due sono giornate giocate in dieci.
//
// Da cui la regola che il programma segue durante l'asta: prima il nucleo che
// scende in campo, poi - e solo poi - gli affari.
//
// Il conto e' esatto: ogni giocatore prende voto con probabilita' pari alle
// sue presenze attese diviso trentotto, il numero di disponibili di un
// reparto e' una Poisson-binomiale, e la sua distribuzione si costruisce con
// una convoluzione, un giocatore alla volta.
//
// E' ottimista in un punto, e va detto: le assenze si trattano come
// indipendenti, mentre nella realta' sono correlate (turno infrasettimanale,
// sosta, squalifiche). Il rischio vero e' quindi un po' piu' alto di questo,
// mai piu' basso.

export const GIORNATE = 38.0;

// Quanti giocatori di ogni reparto scendono in campo ogni giornata: e' la
// formazione, non la rosa. Uno, quattro, quattro e due fanno undici, ed e' lo
// stesso `TITOLARI` che l'ottimizzatore usa per pesare la panchina: lo stesso
// concetto deve avere un numero solo in tutto il programma.
export const IN_CAMPO = { P: 1, D: 4, C: 4, A: 2 };

/** Con che probabilita' prende voto in una giornata qualunque. */
export function quota(x) {
  let q = (x && x.titolarita !== undefined && x.titolarita !== null)
    ? x.titolarita : null;
  if (q === null) q = ((x && x.presenze) || 0) / GIORNATE;
  return Math.min(1.0, Math.max(0.0, Number(q)));
}

/**
 * Quanti ne saranno disponibili: la distribuzione esatta.
 *
 * Convoluzione una Bernoulli alla volta. Con otto giocatori sono sessanta
 * moltiplicazioni: il costo non e' un argomento contro il conto esatto.
 */
export function distribuzione(quote) {
  let dist = [1.0];
  for (let q of quote) {
    q = Math.min(1.0, Math.max(0.0, q));
    const nuovo = new Array(dist.length + 1).fill(0.0);
    for (let k = 0; k < dist.length; k += 1) {
      const p = dist[k];
      if (p <= 0.0) continue;
      nuovo[k] += p * (1.0 - q);
      nuovo[k + 1] += p * q;
    }
    dist = nuovo;
  }
  return dist;
}

/**
 * Quante delle `inCampo` caselle si riempiono in media, ogni giornata.
 *
 * E' `E[min(inCampo, disponibili)]`. Cresce con il numero di giocatori e con
 * quanto giocano, e si ferma da sola a `inCampo`: il quinto difensore
 * aggiunge poco, il nono niente. E' la forma giusta del rendimento
 * decrescente della panchina, ed e' un teorema, non una curva scelta.
 */
export function postiCoperti(quote, inCampo) {
  if (inCampo <= 0) return 0.0;
  const dist = distribuzione(quote);
  let tot = 0.0;
  for (let k = 0; k < dist.length; k += 1) {
    if (dist[k] > 0.0) tot += dist[k] * Math.min(inCampo, k);
  }
  return tot;
}

/**
 * Quante caselle in piu' riempie un giocatore con quota `nuova`.
 *
 * `riferimento` e' quanto giocherebbe il tappabuchi che prenderesti al suo
 * posto: il paragone giusto non e' con lo slot vuoto - a fine asta un
 * giocatore da un credito lo trovi sempre - ma con quello.
 */
export function guadagno(quote, inCampo, nuova, riferimento) {
  const rif = riferimento === undefined ? 0.0 : riferimento;
  const base = postiCoperti([...quote, rif], inCampo);
  const dopo = postiCoperti([...quote, nuova], inCampo);
  return Math.max(0.0, dopo - base);
}

/**
 * Punti attesi in una giornata dai titolari di un reparto.
 *
 * `giocatori` e' una lista di coppie [fantamedia, quota]. In una giornata
 * scendono in campo i migliori **fra quelli che hanno preso voto**: quindi
 * ognuno porta i suoi punti quando gioca *e* quando fra i piu' forti di lui
 * ce ne sono meno di `inCampo` disponibili. Le caselle che nessuno riempie
 * valgono zero, ed e' proprio quello che il conto lineare non sapeva vedere.
 */
export function puntiGiornata(giocatori, inCampo) {
  const ordinati = giocatori.slice().sort((a, b) => (b[0] || 0.0) - (a[0] || 0.0));
  let tot = 0.0;
  const sopra = [];
  for (const [fm, q] of ordinati) {
    const dist = distribuzione(sopra);
    let posto = 0.0;
    for (let k = 0; k < dist.length && k < inCampo; k += 1) posto += dist[k];
    tot += (fm || 0.0) * Math.min(1.0, Math.max(0.0, q)) * posto;
    sopra.push(q);
  }
  return tot;
}

/**
 * Punti di stagione dell'undici **davvero schierabile**.
 *
 * `rosa` e' un oggetto ruolo -> lista di voci con `fm` e `presenze`. E' il
 * metro con cui giudicare una rosa: quello di prima sommava i punti dei
 * migliori per ruolo dando per scontato che giocassero sempre, e con quella
 * lente una difesa di quattro da meta' campionato valeva quanto una di
 * quattro titolari.
 */
export function puntiStagione(rosa, inCampo) {
  const quanti = inCampo || IN_CAMPO;
  let tot = 0.0;
  for (const ruolo of Object.keys(quanti)) {
    const gi = (rosa[ruolo] || []).map((g) => [
      (g.fm || 0.0),
      Math.min(1.0, (g.presenze || 0) / GIORNATE),
    ]);
    tot += puntiGiornata(gi, quanti[ruolo]);
  }
  return tot * GIORNATE;
}

/** Una riga leggibile: coperti, mancanti, e con che probabilita' si buca. */
export function relazione(quote, inCampo) {
  const dist = distribuzione(quote);
  const coperti = postiCoperti(quote, inCampo);
  let scoperto = 0.0;
  for (let k = 0; k < dist.length && k < inCampo; k += 1) scoperto += dist[k];
  return { coperti,
           mancano: Math.max(0.0, inCampo - coperti),
           servono: inCampo,
           rischio_buco: scoperto };
}
