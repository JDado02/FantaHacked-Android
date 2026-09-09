// Le poche cose che servono a piu' di un modulo.

/**
 * Arrotonda come Python, non come JavaScript.
 *
 * `Math.round(2.5)` fa 3; `round(2.5)` in Python fa **2**, perche' a meta'
 * strada Python va al pari piu' vicino invece che sempre verso l'alto. E' una
 * differenza che sembra da pignoli e non lo e': il costo di ogni giocatore nel
 * piano di spesa e' un arrotondamento, e un credito in piu' o in meno cambia
 * il percorso della programmazione dinamica, quindi il limite, quindi la
 * decisione. La prova di equivalenza col motore Python l'ha trovata su un
 * giocatore su seicento, che e' esattamente il tipo di errore che non si
 * troverebbe mai guardando lo schermo.
 */
export function arrotonda(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return (f % 2 === 0) ? f : f + 1;
}
