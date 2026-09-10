// Il generatore casuale di Python, tradotto.
//
// Serve a una cosa sola, e vale la pena spiegarla: per confrontare **le aste**
// e non solo i numeri, le due applicazioni devono giocare *la stessa* asta.
// Non una simile - la stessa: lo stesso giocatore chiamato al terzo giro, lo
// stesso avversario che si intestardisce, lo stesso rilancio da 41 crediti.
// Altrimenti un 96% contro un 95% non direbbe niente, perche' sarebbero due
// campioni diversi e non due misure della stessa cosa.
//
// Quindi qui c'e' il Mersenne Twister con la stessa inizializzazione di
// CPython, e sopra le stesse formule di `random.py`: `random`, `getrandbits`,
// `choice`, `uniform`, `normalvariate` (Kinderman-Monahan), `lognormvariate`
// e `gammavariate` (Cheng per alpha > 1). Le formule sono copiate riga per
// riga, comprese le condizioni di rifiuto: cambiarne una vorrebbe dire
// consumare un numero casuale in piu' o in meno, e da li' in poi le due aste
// divergerebbero senza che nessuno dei due programmi abbia sbagliato niente.

const N = 624;
const M = 397;
const MATRICE_A = 0x9908b0df;
const ALTO = 0x80000000;
const BASSO = 0x7fffffff;

const NV_MAGICCONST = (4 * Math.exp(-0.5)) / Math.sqrt(2.0);
const LOG4 = Math.log(4.0);
const SG_MAGICCONST = 1.0 + Math.log(4.5);
const E = Math.E;

export class Casuale {
  constructor(seme) {
    this.mt = new Uint32Array(N);
    this.indice = N + 1;
    this.semina(seme);
  }

  // --- inizializzazione, com'e' in CPython -------------------------------
  _initGenrand(s) {
    this.mt[0] = s >>> 0;
    for (let i = 1; i < N; i += 1) {
      const prec = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30);
      this.mt[i] = (Math.imul(1812433253, prec) + i) >>> 0;
    }
    this.indice = N;
  }

  _initByArray(chiave) {
    this._initGenrand(19650218);
    let i = 1;
    let j = 0;
    let k = Math.max(N, chiave.length);
    for (; k; k -= 1) {
      const prec = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30);
      this.mt[i] = (((this.mt[i] ^ Math.imul(prec, 1664525)) >>> 0)
                    + chiave[j] + j) >>> 0;
      i += 1; j += 1;
      if (i >= N) { this.mt[0] = this.mt[N - 1]; i = 1; }
      if (j >= chiave.length) j = 0;
    }
    for (k = N - 1; k; k -= 1) {
      const prec = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30);
      this.mt[i] = (((this.mt[i] ^ Math.imul(prec, 1566083941)) >>> 0) - i) >>> 0;
      i += 1;
      if (i >= N) { this.mt[0] = this.mt[N - 1]; i = 1; }
    }
    this.mt[0] = ALTO;
    this.indice = N;
  }

  /** `random.Random(n)` con n intero: CPython usa il valore assoluto spezzato
   *  in parole da 32 bit, dalla meno significativa. */
  semina(n) {
    let v = Math.abs(Math.trunc(n));
    const chiave = [];
    if (v === 0) chiave.push(0);
    while (v > 0) {
      chiave.push(v >>> 0 & 0xffffffff);
      v = Math.floor(v / 4294967296);
    }
    this._initByArray(chiave.length ? chiave : [0]);
  }

  _genrand() {
    if (this.indice >= N) {
      const mt = this.mt;
      for (let kk = 0; kk < N - M; kk += 1) {
        const y = ((mt[kk] & ALTO) | (mt[kk + 1] & BASSO)) >>> 0;
        mt[kk] = (mt[kk + M] ^ (y >>> 1) ^ (y & 1 ? MATRICE_A : 0)) >>> 0;
      }
      for (let kk = N - M; kk < N - 1; kk += 1) {
        const y = ((mt[kk] & ALTO) | (mt[kk + 1] & BASSO)) >>> 0;
        mt[kk] = (mt[kk + (M - N)] ^ (y >>> 1) ^ (y & 1 ? MATRICE_A : 0)) >>> 0;
      }
      const y = ((mt[N - 1] & ALTO) | (mt[0] & BASSO)) >>> 0;
      mt[N - 1] = (mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? MATRICE_A : 0)) >>> 0;
      this.indice = 0;
    }
    let y = this.mt[this.indice];
    this.indice += 1;
    y = (y ^ (y >>> 11)) >>> 0;
    y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
    y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
    y = (y ^ (y >>> 18)) >>> 0;
    return y >>> 0;
  }

  // --- quello che usa il simulatore --------------------------------------
  random() {
    const a = this._genrand() >>> 5;
    const b = this._genrand() >>> 6;
    return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0);
  }

  getrandbits(k) {
    if (k <= 0) return 0;
    if (k <= 32) return this._genrand() >>> (32 - k);
    throw new Error('non serve piu\' di 32 bit qui');
  }

  _randbelow(n) {
    if (n <= 0) return 0;
    const k = 32 - Math.clz32(n);          // n.bit_length()
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  choice(seq) {
    return seq[this._randbelow(seq.length)];
  }

  uniform(a, b) {
    return a + (b - a) * this.random();
  }

  normalvariate(mu, sigma) {
    for (;;) {
      const u1 = this.random();
      const u2 = 1.0 - this.random();
      const z = (NV_MAGICCONST * (u1 - 0.5)) / u2;
      const zz = (z * z) / 4.0;
      if (zz <= -Math.log(u2)) return mu + z * sigma;
    }
  }

  lognormvariate(mu, sigma) {
    return Math.exp(this.normalvariate(mu, sigma));
  }

  gammavariate(alpha, beta) {
    if (alpha <= 0.0 || beta <= 0.0) throw new Error('alpha e beta > 0');
    if (alpha > 1.0) {
      const ainv = Math.sqrt(2.0 * alpha - 1.0);
      const bbb = alpha - LOG4;
      const ccc = alpha + ainv;
      for (;;) {
        const u1 = this.random();
        if (!(u1 > 1e-7 && u1 < 0.9999999)) continue;
        const u2 = 1.0 - this.random();
        const v = Math.log(u1 / (1.0 - u1)) / ainv;
        const x = alpha * Math.exp(v);
        const z = u1 * u1 * u2;
        const r = bbb + ccc * v - x;
        if (r + SG_MAGICCONST - 4.5 * z >= 0.0 || r >= Math.log(z)) return x * beta;
      }
    }
    if (alpha === 1.0) return -Math.log(1.0 - this.random()) * beta;
    for (;;) {
      const u = this.random();
      const b = (E + alpha) / E;
      const p = b * u;
      let x;
      if (p <= 1.0) x = Math.pow(p, 1.0 / alpha);
      else x = -Math.log((b - p) / alpha);
      const u1 = this.random();
      if (p > 1.0) {
        if (u1 <= Math.pow(x, alpha - 1.0)) return x * beta;
      } else if (u1 <= Math.exp(-x)) return x * beta;
    }
  }
}
