# FantaHacked per Android

L'assistente d'asta, sul telefono. **Lo stesso motore** del programma per
computer — non una versione ridotta: il calcolo è identico, e c'è una prova che
lo dimostra numero per numero.

---

## Com'è fatto

```
web/                     l'applicazione: e' questa che finisce nell'apk
├── index.html
├── stile.css
├── app.js               solo quello che si vede e si tocca
├── servizio.js          fa aprire l'app anche senza rete
└── motore/              il motore, tradotto dal Python
    ├── regole.js
    ├── modificatore.js
    ├── asta.js
    ├── dati.js
    ├── valutazione.js
    ├── ottimizzatore.js
    └── strategia.js

app/                     l'involucro Android: una WebView e basta
prove/                   le prove di equivalenza col motore Python
```

L'involucro Android è **novanta righe di Java** che non sanno niente di
fantacalcio: aprono `web/` in una WebView. Tutta l'intelligenza sta nel
JavaScript, ed è la stessa che gira sul computer.

Perché non un motore nativo in Kotlin: due motori vogliono dire due risposte
diverse sullo stesso giocatore, e nessun modo di sapere quale ha ragione.

---

## La prova che i due motori dicono la stessa cosa

Il motore Python è stato tarato giro dopo giro su centinaia di aste simulate.
Riscriverlo in un'altra lingua è il modo più facile di perdere quella taratura
senza accorgersene: nessun numero è palesemente sbagliato, semplicemente non
sono più gli stessi.

Quindi il motore Python **fotografa** i propri numeri in quattro momenti
diversi di un'asta — vuota, dopo dieci acquisti, a metà, quasi finita — e la
pagina di prova li rilegge e li confronta uno per uno:

```bash
# dal progetto del computer
python simulazioni/dump_equivalenza.py  .../prove/attesi.json
python simulazioni/dump_consiglio.py    .../prove/attesi_consiglio.json

# poi, da qui
python -m http.server 8790
# e si apre nel browser prove/index.html, che porta alle tre pagine:
#   prove/applicazione.html           le regole dell'asta
#   prove/equivalenza.html            i numeri
#   prove/equivalenza_consiglio.html  le liste
```

Lo stato attuale:

| | |
|---|---|
| prezzi, VOR, modificatore, curve, knapsack, limiti, verdetti | **22.356 confronti, 0 differenze** |
| le cinque liste dei consigli, nomi e ordine compresi | **44 liste, 0 differenze** |
| le regole dell'asta sul telefono (`prove/applicazione.html`) | **33 verifiche, 0 fallite** |

La terza pagina chiede un'altra cosa. Che i due motori calcolino uguale non
dice niente su cosa succede quando l'applicazione si chiude a metà asta, si
annulla un acquisto sbagliato, o manca un solo posto e i crediti sono finiti:
sono le regole che se saltano non si vede un numero sbagliato, si perde una
serata. Fra le altre: l'asta si ritrova al riavvio, l'annullo rimette i crediti
e libera il giocatore, lo stesso giocatore non si compra due volte, e chi non è
iscritto alla lista di serie A resta a limite zero **anche a fine asta**,
quando la regola degli ultimi posti ripescherebbe chiunque pur di non lasciare
una casella vuota — con ventiquattro slot pieni e un credito in mano, il limite
è 1 su chi è in lista e 0 su chi non c'è. Lo stesso, numero per numero, che
risponde il motore Python.

La soglia è un milionesimo in relativo, e zero sui numeri interi.

### Le tre cose che la prova ha trovato

Non erano difetti della traduzione: erano **fragilità del motore Python**, che
con un motore solo non si potevano vedere.

**Un valore da 1,2e-14.** Un difensore di fondo listone usciva con un valore di
0,000000000000012 invece di zero — l'ultimo bit di una sottrazione fra numeri
quasi uguali. Quel numero, indistinguibile da zero per chiunque, bastava a
farlo entrare nel pool dello zaino al posto di un altro, cambiando il percorso
della programmazione dinamica e il limite su un terzo giocatore. Adesso c'è una
soglia: sotto un miliardesimo di punto, zero.

**Pareggi decisi dal database.** A parità di costo e valore l'ordine dei
giocatori veniva da come SQLite restituiva le righe. Adesso il pareggio è
dichiarato: l'id, che non cambia mai.

**Due righe mancanti in fondo a `_svuota`.** La lista "da far pagare agli
altri" usciva ordinata per quanto converrebbe *comprarli*, che è esattamente la
domanda opposta. Tutti i numeri erano giusti; la lista diceva un'altra cosa.
È il motivo per cui la seconda prova confronta anche **le liste**, e non solo
la matematica.

### E le differenze di lingua

Due, entrambe silenziose:

- **`Math.round(2.5)` fa 3, `round(2.5)` in Python fa 2.** Il costo di ogni
  giocatore nel piano è un arrotondamento, e un credito cambia il percorso
  dello zaino. C'è una funzione apposta che arrotonda come Python.
- **JavaScript non ha `erf`.** L'approssimazione classica sbaglia di 1,5e-7,
  che moltiplicata per 38 giornate ed entrata nei punti spostava i prezzi di
  due milionesimi — abbastanza da cambiare un limite di un credito. Sostituita
  con una serie a termini positivi, esatta in doppia precisione.

---

## I dati

Si scaricano da
[DBFantaHacked](https://github.com/JDado02/DBFantaHacked): **190 KB**, che
GitHub manda compressi a circa 43. All'avvio l'app legge un `manifest.json` da
trecento byte e scarica solo se la data è cambiata.

Nel pacchetto ci sono anche **le regole della lega**, e non per comodità: le
proiezioni dipendono dal regolamento e quest'app non sa rifarle — porta il
motore di valutazione, non quello delle proiezioni. Con regole diverse da
quelle che hanno prodotto quei numeri mostrerebbe cifre sbagliate senza modo di
accorgersene, quindi le due cose arrivano insieme o non arrivano.

**Se internet non c'è, l'app si apre lo stesso** con i dati che ha già. Sei
secondi di attesa massima, poi si va avanti. Nella stanza dell'asta il wifi fa
quello che vuole.

## L'asta

Sta in `localStorage`, su questo telefono, e si salva a ogni acquisto. **Non
esce da qui**: niente sincronizzazione, niente conflitti, niente server. Fai
l'asta col telefono o col computer, e l'altro non ne sa niente — è la scelta
giusta, perché due dispositivi che scrivono sulla stessa asta sono un modo
elaborato di perderla.

---

## Costruire l'apk

Il progetto è completo e pronto a compilare, ma **l'apk non è ancora stato
costruito qui**: servono l'SDK Android e l'accettazione delle sue licenze, che
è un contratto con Google e lo firma chi installa.

Da un computer Windows senza niente installato tranne un JDK 17:

```powershell
powershell -ExecutionPolicy Bypass -File costruisci_apk.ps1
```

Scarica Gradle e l'SDK dentro `strumenti\` (fuori dal repository: si cancella
la cartella e non resta niente), si ferma sulle licenze e ti chiede di
rispondere `y`, poi compila. L'apk esce in
`app/build/outputs/apk/debug/app-debug.apk`.

Con Android Studio già installato è un comando solo:

```bash
./gradlew assembleDebug
```

La prima volta Android Studio chiede di generare il wrapper Gradle: qui c'è
solo `gradle-wrapper.properties`, perché il `.jar` è un binario e non ha senso
tenerlo sotto controllo di versione.

Gradle impacchetta la cartella `web/` direttamente (`assets.srcDirs`), quindi
**non ci sono copie da tenere allineate**: quella che si apre nel browser per
lavorarci è la stessa che finisce nell'apk.

Un dettaglio che sembra tecnico e non lo è: la WebView carica i file da
`https://appassets.androidplatform.net/` invece che da `file://`. Con
`file://` la pagina non ha un'origine, e il browser blocca ogni richiesta verso
l'esterno: l'app non riuscirebbe **mai** a scaricare i dati.

## Provarla senza Android

```bash
python -m http.server 8790
```

e si apre `http://127.0.0.1:8790/web/`. È la stessa applicazione che finisce
nell'apk, non una versione ridotta.

**E si usa già così, dal telefono, senza apk.** Sulla stessa rete wifi si apre
`http://<indirizzo-del-computer>:8790/web/` (`ipconfig` dice l'indirizzo), e da
lì il browser propone «aggiungi a schermata home»: diventa un'icona, si apre a
schermo intero e — passato il primo caricamento — funziona anche se il wifi
cade, perché i dati e il codice restano nel telefono. L'asta è comunque salvata
in locale, quindi il computer può anche spegnersi a metà.
