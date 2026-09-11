# FantaHacked per Android

L'assistente d'asta, sul telefono. **Lo stesso motore** del programma per
computer — non una versione ridotta: il calcolo è identico, e c'è una prova che
lo dimostra numero per numero.

## ⬇️ [Scarica FantaHacked.apk](https://github.com/JDado02/FantaHacked-Android/raw/main/FantaHacked.apk)

**3,4 MB — Android 7 o più recente.** Apri questa pagina dal telefono, tocca il
link qui sopra e installa.

La prima volta Android chiede di consentire l'installazione da fonte
sconosciuta: è il permesso che dà al browser (o al gestore file) la facoltà di
aprire un apk, e lo si concede per quell'app soltanto. L'apk è firmato con la
chiave di sviluppo, quindi Play Protect avvisa che «non riconosce lo
sviluppatore»: si sceglie *installa comunque*.

Al primo avvio l'app scarica i dati dei giocatori — mezzo mega, dieci secondi —
e da lì in poi funziona anche senza rete.

---

## Che cosa fa

Tutto quello che fa il programma per computer. Non è un modo di dire: è lo
stesso motore, e da questa versione anche le stesse funzioni.

**Prima di cominciare** si sceglie il regolamento: quante squadre, quanti
crediti a testa, modificatore di difesa sì o no, secondo e terzo portiere
assegnati in automatico. Toccarne uno rifà **tutti i prezzi** — il livello di
rimpiazzo, il valore e il limite di ogni giocatore — e c'è una prova che lo
verifica su quattro regolamenti diversi, dalle sei alle venti squadre, contro i
numeri del motore Python. I nomi delle squadre sono già compilati («Io»,
«Squadra 2»…) e si sovrascrivono.

**Durante l'asta**, in tre schede:

| | |
|---|---|
| **Chiama** | chi chiamare e fino a quanto, in quattro liste: da prendere, alternative, da far pagare agli altri, da evitare. In cima, quante caselle della formazione stai già coprendo |
| **Listone** | tutti i seicento giocatori, cercabili, filtrabili per ruolo, ordinabili per costo, valore, presenze, media voto, quotazione o nome, con chi li ha già comprati e a quanto |
| **Rosa** | i tuoi crediti, la copertura reparto per reparto, la tua rosa, l'undici che riusciresti a schierare e con che modulo, il rischio di restare in dieci, il piano di spesa coi nomi su cui puntare, le rose degli avversari, e il tasto per rinominare le squadre |

In alto stanno sempre il reparto in chiamata con quante caselle restano, il
turno di chiamata (si passa al successivo con un tocco, o si assegna a chi
vuoi aprendo la sua rosa), e un attrezzo da collaudo: **completa reparto**,
che riempie per tutti il reparto in corso prendendo per te i primi della lista
dei consigli, uno alla volta, coi conti rifatti dopo ognuno. Serve a portare
l'asta in un secondo al punto che si vuole guardare; è tratteggiato e chiede
conferma, perché un tocco di troppo la sera giusta costerebbe la serata.

### Prima chi gioca, poi chi conviene

La regola che decide l'ordine delle liste, ed è la stessa del computer. La rosa
ha otto difensori, ma in campo ne vanno **quattro ogni domenica**: finché quel
nucleo non è coperto, un giocatore da mezzo campionato non può stare sopra uno
su cui si costruisce la formazione, per quanto convenga. Quante caselle copri
davvero non è una soglia: è il valore atteso esatto, calcolato dalle presenze
attese di chi hai preso.

---

## Com'è fatto

```
web/                     l'applicazione: e' questa che finisce nell'apk
├── index.html
├── stile.css
├── app.js               solo quello che si vede e si tocca
├── servizio.js          fa aprire l'app anche senza rete
└── motore/              il motore, tradotto dal Python
    ├── regole.js            il regolamento, e i quattro valori che si scelgono
    ├── modificatore.js
    ├── formazione.js        quante caselle riesci a riempire ogni giornata
    ├── asta.js
    ├── dati.js
    ├── valutazione.js
    ├── ottimizzatore.js
    ├── strategia.js
    └── equilibrio.js        l'undici, le coperture, il rischio di restare in dieci

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

Quindi il motore Python **fotografa** i propri numeri e la pagina di prova li
rilegge e li confronta uno per uno. Sei momenti, non quattro: l'asta vuota,
dopo dieci acquisti, a metà, quasi finita, e due **scene costruite a mano** —
i miei portieri finiti mentre la lega è ancora sui portieri, e la difesa
scoperta a metà reparto. Sono le due situazioni su cui il programma ha davvero
sbagliato, e per caso in una sequenza casuale non capitano. Una scena
costruita a mano non è meno onesta di una casuale: è più onesta, perché è la
scena su cui il programma ha sbagliato.

E tutto si ripete su **quattro regolamenti diversi** — sei squadre e
quattrocento crediti col modificatore spento, venti squadre, dieci squadre coi
portieri uno per uno, e quello del pacchetto. Da quando quei valori si
scelgono dall'applicazione, verificarne uno solo non dice più niente sugli
altri: il numero di squadre fissa il livello di rimpiazzo e i crediti fissano
la scala dei prezzi.

I comandi:

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
| prezzi, VOR, modificatore, curve, knapsack, limiti, verdetti, quadro della rosa — su sei momenti e quattro regolamenti | **54.020 confronti, 0 differenze** |
| le cinque liste dei consigli, nomi, ordine, copertura e frasi comprese | **102 liste, 0 differenze** |
| le regole dell'asta sul telefono (`prove/applicazione.html`) | **74 verifiche, 0 fallite** |
| il generatore casuale di Python, tradotto (`prove/casuale.html`) | **35 confronti, 0 differenze** |
| 500 aste intere, qui e sul computer (`prove/aste.html`) | **500 aste, 16.000 numeri, 0 differenze** |

Le ultime due sono la prova più grossa. Che i due motori calcolino uguale nei
momenti scelti a tavolino non dice ancora che **giochino** uguale:
un'asta sono duecento chiamate una dopo l'altra, e basta un rilancio diverso a
metà reparto perché da lì in poi ogni squadra prenda giocatori diversi. Per
poterlo chiedere, le due simulazioni devono giocare *la stessa* partita — e
quindi il generatore casuale di Python è tradotto in JavaScript riga per riga,
Mersenne Twister compreso, con le stesse condizioni di rifiuto: cambiarne una
vorrebbe dire consumare un numero casuale in più o in meno, e le due aste
divergerebbero senza che nessuno dei due programmi abbia sbagliato niente.

500 aste per parte, stessi semi, e ogni rosa identica. Dalla versione di oggi
si confronta anche il punteggio **schierato**, quello che conta giornata per
giornata chi ha preso voto e lascia a zero le caselle che nessuno riempie:
sarebbe stato strano verificare metà di quello che il programma per computer
misura.

La pagina delle regole dell'asta chiede un'altra cosa. Che i due motori calcolino uguale non
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

Tre, tutte silenziose:

- **`round(30.5)` in Python fa 30, `Math.round(30.5)` in JavaScript fa 31.**
  È la stessa regola del punto qui sotto, ma si è vista solo dopo: le
  cinquecento aste per parte sono venute identiche in tutto — stesse rose,
  stessi prezzi, stessi punti — tranne nel punteggio che conta solo chi si
  riesce a schierare. Due giocatori su otto rose avevano **esattamente** 30,5
  e 28,5 presenze attese, e lì le due lingue si dividono. Non è un caso raro:
  le presenze nascono da `titolarità × 38`, e sul mezzo punto ci cadono
  spesso. Adesso anche l'interfaccia arrotonda come Python, altrimenti il
  telefono scriverebbe «31 presenze attese» dove il computer scrive 30, sullo
  stesso giocatore.

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

Con quattro eccezioni, e vale la pena dire perché sono eccezioni. Quante
squadre, quanti crediti, modificatore di difesa e portieri a pacchetto **non
entrano nel calcolo delle proiezioni**: le presenze attese, la media voto e la
fantamedia di un giocatore sono le stesse in una lega da sei e in una da venti.
Entrano solo nel motore di valutazione, che qui c'è tutto — ed è per questo che
quei quattro si possono scegliere dall'applicazione senza mentire, mentre un
gol di difensore da 4 a 3 vorrebbe dire rifare le proiezioni e non si può.

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

## L'apk

Quello pronto è [`FantaHacked.apk`](FantaHacked.apk) qui nel repository: sta
nel repository apposta, perché il link di GitHub si apre dal telefono e si
installa senza passare da un computer. È una copia di
`app/build/outputs/apk/debug/app-debug.apk`, e si sovrascrive a ogni versione
invece di accumularsi.

**3,4 MB**, Android 7 (`minSdk 24`) o più recente. Con il telefono collegato e
il debug USB attivo:

```bash
strumenti/sdk/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Ricostruirlo

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
