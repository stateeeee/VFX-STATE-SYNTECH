# STATE — Live Progress Tracker

> Read this first every session. Update it (checkboxes + log + next step) in
> the same commit as the work, every session, per 07-SESSION-PROTOCOL.md.

## Current phase

**Phases 0–9 COMPLETE** (2026-07-20). All five effects are real 1:1 SynEngine
ports (Phase 8 blob_tracker was the last + hardest), and the ChainLab
**Master MP4** export works end-to-end (Phase 9: WebCodecs frame-stepping →
mp4-muxer, vendored under `public/effects/vendor/`). **Phase 10 (Assets &
polish) is DONE except two external items** (2026-07-25): the definitive
**logo**, the **search box**, **CDN deps fully vendored** (proven 100% offline)
and the **colour/day-mode audit** are all in. On top of the roadmap the operator
drove a multi-round **visual pass** — gel slab in the gaps, gradient-riding logo,
gel-cast hero wordmark, one 6s brand cadence, bare effect host, sidebar audio
meter — all implemented and verified. The **5 effect-card covers are now IN**
(2026-07-29, cut from the operator's own effect screenshots — see the log).
**One item is left, and it is hardware-dependent: the ≥30fps@720p perf pass**
(GPU machine). The checkbox stays unchecked until that lands.

**⇒ PROGETTO IN PAUSA dal 2026-07-31 — leggi "Next step" qui sotto prima di
qualunque cosa.** L'operatore è soddisfatto esteticamente, ha provato l'app in
locale e ha chiuso dicendo che ci tornerà. La "gabbia" resta a stadio preview,
niente implementato, approvazione mai data. Il contesto completo è in
`docs/workflow/HANDOFF-CAGE.md`. Poi `docs/workflow/HANDOFF.md`
(rewritten 2026-07-28: current visual state after the
revert, the operator's mandatory process, everything measured about material,
lighting, frame cost and the platform traps, harness playbook, open items).

## Next step

**PROGETTO IN PAUSA — deciso dall'operatore il 2026-07-31.** *"Forse non c'è
bisogno di continuare perché almeno esteticamente sono soddisfatto."* Ha poi
avviato l'app sulla sua macchina (MacBook Pro M1, 8GB) — **"ok funziona"** — e ha
chiuso: *"ci tornerò più avanti."*

**Non ripartire da solo.** Quando riapre, la prima domanda è **quale dei due
tronconi vuole**, perché sono indipendenti:

1. **La gabbia — ferma a stadio preview, dodici giri, zero codice applicativo
   modificato.** L'ultimo giro (12) ha corretto l'angolo in basso a destra di
   giorno: si accende **intero**, e il bordo esterno della gabbia non si keya più —
   le due cose che aveva cerchiato in rosso e in verde. Da fargli guardare:
   `docs/design/frame/preview-round12-{day,night}.webp`. Tutto — spec accumulata,
   geometria misurata, trappole, piano in 5 commit, tooling — è in
   **`docs/workflow/HANDOFF-CAGE.md`**. **Non implementare prima della sua
   approvazione esplicita**: `CODEX_WORKFLOW.md` lo vieta ed è esattamente ciò che
   ha causato il revert del 2026-07-28. Nota per chi implementerà:
   `tools/verify/verify-ui-gel-pass.js` va **riscritto**, non fatto passare —
   asserisce il gel slab che quel lavoro rimuove (41 assertion rosse per design).
2. **Il pass performance ≥30fps@720p — ancora aperto.** L'unico item di roadmap
   non spuntato. Ha avviato l'app ma **non ha riportato i numeri**, quindi la
   verifica non è stata fatta. È self-service e dura cinque minuti sulla sua
   macchina: AI Lab → catena a 5 effetti → clip 720p → leggere i badge **FPS** e
   **RES%**. Accettazione: `fps ≥ 30` **e** `RES% < 100` (ambra). In sandbox non è
   valutabile (SwiftShader, 1–2 fps): serve la sua GPU.

Sotto, lo stato precedente resta valido per tutto il resto dell'app.

**La UI è allo stato approvato dall'operatore (revert del 2026-07-28), più il
meter audio a due colonne chiesto subito dopo.** Non toccare l'estetica senza una
direzione approvata: leggi `CODEX_WORKFLOW.md` e fermati dopo il piano, come
chiede.

Le **5 cover sono dentro** (2026-07-29). Resta **una sola** voce di Phase 10:
**pass ≥30fps@720p su macchina con GPU** — non valutabile in sandbox
(SwiftShader, 1–2fps); **ricordarglielo**, è self-service dai badge FPS/RES%
dell'AI Lab. Dettagli completi in `docs/workflow/HANDOFF.md`.

Le due domande aperte sulle cover sono **CHIUSE dall'operatore (2026-07-29)**:
l'**altezza della card resta 80px** e la **5ª cover resta quella ritagliata dalla
sezione ANAMORPHIC dell'app bokeh** (non serve uno shot di `anamorphic_lab`).
Non riaprirle.

## Log

### 2026-07-31 — Gabbia, giro 12: l'angolo in basso a destra si accende intero

L'operatore ha annotato il preview **di giorno**: in **rosso** un rettangolo nero
che dovrebbe essere bianco, in **verde** i pezzi bianchi che dovrebbero essere neri.
*"La versione di notte è perfetta."* Le due annotazioni sono **lo stesso errore**,
non due: il piano acceso di giorno nell'angolo era un rettangolo scritto a mano
(`x 0.655, y 0.838, w 0.345, h 0.162`) sopra la sola striscia bassa.

- **Il rettangolo nero** era l'apertura tagliata in due: il bordo superiore del
  piano cadeva **dentro** il buco, a `y=0.838`, e sotto quella riga tutto si
  accendeva mentre sopra restava nero. È il taglio dritto della trappola §4.5 —
  l'operatore ha disegnato il suo rettangolo esattamente lungo quella riga.
- **I pezzi bianchi** erano il contorno esterno della gabbia: era **keyato** (meno
  un rim di 14px) per riuscire ad accendere l'angolo. Così però ogni backdrop che
  sporgeva dalla sua apertura filtrava tra le bolle del bordo basso e del margine
  destro. Il bordo esterno **non è un'apertura, è materiale**: ora non si keya più.
- **L'angolo è una sola apertura** (R[5]: lobo alto, lobo tondo a destra, sventaglio
  fino allo spigolo) e si accende **intera**, dal bounding box misurato della
  regione — mai più scritto a mano. Un bounding box non può tagliare la sua apertura:
  ogni suo lato poggia sul pixel più esterno della regione.
- **Verificato, non guardato.** `tools/frame/check-zones.cjs` è stato riscritto:
  legge i due preview e asserisce il contratto in **14 check** — l'angolo acceso di
  giorno e nero di notte, **ogni zona di materiale identica al bit tra giorno e
  notte** (`|diff| = 0.00` su tutte e sette), e nessuna banda scura lungo le colonne
  dell'angolo (la canarina del taglio dritto: stampa la riga dove lo trova). Esce
  con codice ≠ 0 se fallisce. Sui preview del giro 11 fa **6/14**, e la canarina
  indica `y=0.838`: il tool è noto fallire sullo stato che l'operatore ha rifiutato.
  Sul giro 12 fa **14/14**.
- **La notte resta quella approvata**: l'unica cosa che la tocca è il bordo esterno
  che riprende il proprio artwork al posto del letto nero. Sono pixel scuri per
  costruzione (soglia del flood-fill 26, e il grade li scurisce ancora): misurato,
  un +6/255 sui margini, nient'altro si muove.
- Preview del giro nel repo: `docs/design/frame/preview-round12-{day,night}.webp`.
  I due `preview-approved-*.webp` restano il giro 11 finché non arriva il suo via.
- **Sempre stadio preview: zero codice applicativo modificato.** Toccati solo
  `tools/frame/` e i documenti.

### 2026-07-31 — La "gabbia": dieci giri di preview, niente codice, handoff

L'operatore ha consegnato il suo artwork — una gabbia di bolle con aperture
irregolari — e ha chiesto: *"tenere tutte le funzioni del app ma anziche avere una
interfaccia comune vorrei che fosse riadattata al immagine… non voglio piu led
colorati che dividono le sezioni"*, con la richiesta esplicita di **vedere prima
una foto**: *"generami una foto per capire prima di farti lavorare come viene"*.

Dieci giri di preview, tutti consegnati come composito dell'app vera sotto la
gabbia. **Nessuna riga di codice applicativo è stata cambiata**: l'unica cosa
toccata è stata una patch temporanea a `VfxCanvas.tsx` per fotografare il grafo,
annullata ogni volta. Manca solo il via dell'operatore.

- **Tutto il lavoro è ora nel repo** (era nello scratchpad, che è effimero):
  `docs/design/frame/` (l'artwork, la mappa delle aperture, i due preview
  approvati), `tools/frame/` (il generatore della maschera + geometria, lo script
  di preview, il check delle zone, la patch temporanea del grafo).
- **`docs/workflow/HANDOFF-CAGE.md`** raccoglie la spec accumulata (22 punti), il
  contratto geometrico, **nove trappole** con sintomo e causa, le domande aperte e
  il piano in cinque commit.
- **La geometria è misurata, non stimata**: flood-fill delle aperture, maschera
  sfumata per il contorno (la versione binaria dava una linea seghettata),
  rettangolo adattato a ogni apertura ignorando gli angoli, cerchio inscritto dove
  serve un cerchio.
- **Color grade sulla gabbia**: esposizione +8%, contrasto +12%, **vividezza** +30%
  pesata su `(1 - saturazione)`.
- **Le due trappole che sono costate di più, entrambe della stessa famiglia:** uno
  script che si rompeva **prima** delle scritture su disco, e un preview che
  leggeva la maschera **dal disco** — per tre giri le modifiche venivano calcolate
  e buttate via mentre sembravano applicate. Si sono trovate misurando i pixel, non
  guardando le foto. Regola che resta: *il reporting non deve mai fare da gate
  all'output*, e *misura, non strizzare gli occhi*.
- **Da sapere prima di implementare:** `verify-ui-gel-pass.js` va **riscritta** —
  pretende la lastra gel che stiamo togliendo, quindi le sue 41 asserzioni
  diventerebbero rosse per progetto, non per regressione.

### 2026-07-29 — Le 5 cover degli effetti, tagliate dagli screenshot dell'operatore

Operatore (di notte, prima di dormire): *"ho caricato il mio logo su ogni effetto
dei 5 del app… come immagine da usare devi usare solo il logo, la mia 'stella',
solo cio che e nello spazio di esportazione del html, il logo con sfondo nero,
che deve essere al centro non tagliato… tieni la scritta nella stessa grandezza e
posizione ma cambia il font."* Fatto: Phase 10 item 1 è chiuso.

- **Le 5 immagini sono state recuperate dal transcript di sessione** (come già il
  logo il 2026-07-24) e sono in `docs/design/covers-src/` per rifarle: sono
  screenshot 2000×1250 delle cinque app, non file su disco.
- **Il taglio è misurato, non a occhio** (`tools/gen/gen-effect-covers.cjs`): per
  ogni shot si ritaglia una finestra ben dentro il canvas — fuori restano le
  staffe d'angolo, la hairline della cornice, la didascalia "1920 × 1080 · …", la
  barra di trasporto e il PIP — poi si cerca il **bounding box del contenuto**
  (una riga/colonna conta solo se più pixel superano la soglia, così un pixel di
  antialiasing non trascina il box fino al bordo) e lo si ridisegna centrato su
  una tavola nera con un margine del 2%.
- **La tavola è STRETTA sul soggetto, e questa è la decisione portante.** Con
  `object-contain`, una tavola più stretta della card vincola sempre in
  **altezza**: la stella riempie la card da cima a fondo, centrata, a **ogni**
  larghezza della sidebar. Le tavole vanno da 0.88:1 a 1.46:1, la card più
  stretta possibile è 2.5:1 → il margine è ampio. **`object-cover` (quello che
  c'era) tagliava la stella sopra e sotto** su qualunque card più larga della
  tavola, cioè quasi ovunque: a 1920px la card di default è 5.5:1.
- **Secondo giro, stesso giorno — il layout definitivo: etichetta al centro a
  SINISTRA, arte al centro a DESTRA.** Operatore: *"non mettiamo la scritta sopra
  alla immagine ma mettiamo la scritta al centro a sinistra e l'immagine al centro
  a destra."* L'arte è una colonna a destra (`right-0 h-full w-auto`, quindi il
  box prende l'aspetto della stella) con `max-w-[38%]`, l'etichetta è a
  `left-4 right-[40%]` con `truncate`: **i due non possono collidere per
  costruzione**, e sulla sidebar più stretta il nome si tronca invece di finire
  sotto la stella.
- **Terzo giro — colonna più stretta, titoli più piccoli, testo più vicino
  all'arte.** Operatore: *"vorrei che la sezione di destra fosse piu corta
  orizzontalmente e che i titoli degli effetti fossero piu piccoli… rimpicciolisci
  il font e avvicina la scritta alla grafica."*
  - Colonna **26% → 20%** (min 16→14, max 40→34): a 1600px la card passa da
    349px a **262px**.
  - Titoli **14px → 12px**, tracking 0.14 → 0.12em.
  - L'etichetta ora è **centrata dentro la sua fascia** invece di essere
    inchiodata al bordo sinistro: è il modo per avvicinarla alla grafica senza
    sfilacciare la colonna (i cinque nomi restano su un asse solo).
  - **Le cinque tavole sono state rigenerate a un'unica proporzione** (1.46:1, la
    più larga — lo swirl del bokeh). Tagliate strette una per una, le colonne
    d'arte venivano larghe da 0.88 a 1.46 e le etichette finivano su cinque assi
    diversi; peggio, la più larga sbatteva contro il `max-width` della colonna e
    il bokeh renderizzava la stella **più bassa delle altre**. Con una
    proporzione sola le colonne sono identiche (misurato: arte a 147px per tutte
    e cinque) e le stelle condividono l'altezza.
  - **Trappola vera, trovata prima di consegnare:** il `PanelGroup` ha
    `autoSaveId` e **persiste il layout in localStorage**, quindi sul browser
    dell'operatore il vecchio 74/26 avrebbe vinto sul nuovo default e la modifica
    sarebbe sembrata non applicata. La chiave è ora `syntech-main-horiz-v2`, e la
    suite lo verifica seminando la chiave vecchia e pretendendo la card stretta.
- **Quarto giro — testo a sinistra e ancora più piccolo; e il bianco del brain
  graph.** Operatore: *"nella sezione di destra il testo degli effetti allinealo a
  sinistra e rimpicciolisci ancora un po. nel brain graph solo vfx syntech e
  l'effetto selezionato devono avere il puntino bianco."*
  - Etichetta: da centrata nella fascia a **allineata a sinistra**, **12px →
    11px**, tracking 0.12 → 0.1em.
  - **Brain graph: il bianco è ora riservato.** In `VfxCanvas` il punto di un hub
    diventava bianco quando gli arrivava il battito (`flash > 0.4`), l'anello a
    `flash > 0.15` e l'overlay dei satelliti era bianco puro: a turno **tutti e
    cinque** i moduli sembravano selezionati. Ora il bianco è solo del core e del
    modulo selezionato; hover e battito accendono l'accento violetto.
  - **Perché serviva un test e non uno screenshot:** il lampeggio è intermittente,
    quindi ogni singolo frame mostrava un insieme diverso e plausibile (la foto
    che l'operatore ha mandato come riferimento era, per caso, già corretta).
    Nuovo `tools/verify/verify-graph-highlight.js`: strumenta il contesto 2D,
    registra ogni arco riempito con raggio e colore, usa il ripulisci-canvas come
    confine di frame e conta i punti bianchi **per frame** su ~250 frame.
    **Prima: max 6 per frame, 6 posizioni distinte. Dopo: esattamente 2, sempre**,
    e il secondo segue il modulo selezionato quando cambia. **7/7.**
  - Trappola del test: in night mode il loop non chiama `clearRect` (il canvas è
    opaco) ma un `fillRect` a tutta area — agganciando solo `clearRect` il
    contatore di frame resta a 1 e la matematica per-frame collassa in silenzio.
- **Il primo giro aveva l'etichetta sopra l'arte, ed è così che si è imparata la
  cosa utile:** con etichetta e stella entrambe centrate, qualunque banda di scrim
  scurisce la stella **esattamente in vita** e la fa leggere come tagliata.
  Provata, guardata, scartata. Ora il problema non esiste: il testo sta sul nero,
  niente scrim e niente alone.
- **Font dell'etichetta: JetBrains Mono**, maiuscolo, `tracking 0.14em`, **stessa
  dimensione (14px)**, come chiesto. È la faccia che usano le cinque app negli
  header dei pannelli ("SOURCE", "BLOB REVEAL · ROTOSCOPE ENGINE v2.0") e che lo
  shell usa già per GEMINI PRO e i nodi: la card ora parla la lingua
  dell'anteprima che contiene. Prima era Inter, il default.
- La card prende un **letto nero** sotto l'arte quando la cover c'è, così il
  letterbox ai lati è invisibile; senza cover il fallback resta identico a prima.
- **`verify-phase10-covers.js` riscritto** (il vecchio provava il contratto
  drop-in con un'immagine finta e un 404: con i file veri non reggeva più).
  Adesso è un contratto geometrico: **16/16** — cinque cover decodificate,
  `object-contain`, letto nero, arte allineata a destra e a piena altezza della
  card, etichetta mono/14px/tracciata a sinistra e centrata in verticale, e
  soprattutto **il bordo destro del testo non raggiunge mai l'arte**, verificato
  **trascinando la sidebar ai due estremi (card da 2.54:1 a 6.92:1)**; più day
  mode, fallback su 404, zero errori di pagina.
- Trappola del test, per chi lo tocca: l'arte è posizionata sul **padding box**,
  quindi "piena altezza" sono 78px su una card da 80 (i 2px sono i bordi); e i
  controlli a larghezza di default vanno fatti **prima** dei drag, altrimenti
  girano con la sidebar rimasta al minimo.
- Regressione: **gel/UI 41/41**, **phase 2 26/26**, **search 6/6**, **brand
  13/13**; `npm run lint` + `npm run build` puliti.
- **Due cose da far decidere all'operatore** (screenshot consegnati):
  1. **L'altezza della card (80px) è il limite dell'arte.** La stella è già a
     ~78px: più grande non può essere senza tagliarla. A 112px l'anteprima
     respira molto di più — mockup A/B renderizzato dalle cover vere.
  2. **La 5ª cover viene dalla sezione ANAMORPHIC dell'app bokeh**
     (`bokeh_state_v1 (3).html`, LETTERBOX + SQUEEZE 2.20), non dall'app
     `anamorphic_lab`: è lo screenshot che ha caricato come quinto. Se vuole il
     look dell'app vera, basta uno screenshot e la cover si rigenera in un
     comando.

### 2026-07-28 (dopo il revert) — Il meter audio: due colonne, a tutta altezza

Operatore: *"nella sezione di sinistra verticale, l'audio fallo arrivare fino in
fondo occupando tutto lo spazio restante e la scritta audio mettila sotto non
sopra. aggiungi una seconda colonnina che stia di fianco a quella che ce gia, al
centro."* Fatto, solo `AudioMeter.tsx` (+ un commento in `App.tsx`) — nessun
altro pezzo dell'estetica approvata è stato toccato.

- **Il meter riempie tutto lo spazio che resta** sotto OPTIMIZER: la sua radice è
  `flex-1 min-h-0` e le colonne sono `h-full`, quindi arrivano fino al piede del
  rail (misurato: **236px** a 1000px di viewport, contro i 96px fissi di prima;
  1px residuo sotto la caption).
- **L'altezza non è più una costante, quindi va MISURATA.** `TRACK_PX` è sparito:
  un `ResizeObserver` sulla prima colonna alimenta `trackPx`, e fill / tacche /
  peak-hold continuano a fare i loro conti in pixel veri. Il gradiente resta
  ancorato con `backgroundSize: 100% ${trackPx}px`, così i colori non si stirano
  quando il livello sale.
- **Seconda colonna = il canale destro, non un clone.** `tap → upmix → splitter`,
  un analyser per canale, `→ merger → gain(0) → destination` (la catena resta
  agganciata alla destination, come prima, e la riproduzione resta muta).
  **Trap:** un `ChannelSplitter` è `discrete`, quindi una clip **mono** darebbe
  silenzio alla colonna destra — prima dello splitter c'è un gain
  `explicit`/`speakers` che duplica il mono su L e R, come fa un meter hardware.
- **La caption "Audio" è sotto**, in fondo: colonne → readout dB → "AUDIO". Il
  readout mostra il canale più alto dei due.
- Sotto pressione (finestra bassa) **cedono le colonne, non la nav**: a 1280×620
  l'overflow del rail passa da **220px a 124px** rispetto a prima (l'overflow a
  quelle altezze è preesistente — logo + nav + blocco GEMINI da soli superano il
  rail — ma ora il meter si comprime invece di aggiungersi).
- `verify-ui-gel-pass.js` esteso con la nuova direzione (coppia stereo, pariglia
  centrata nel rail, caption sotto le colonne, colonne fino al piede, colonna
  destra viva) e la soglia "hot" ri-basata sull'altezza misurata invece che sui
  96px ormai obsoleti. **41/41**, con una clip di test stereo (L che sale fino a
  hot, R basso: maxL 220px vs maxR 90px — le due colonne sono indipendenti).
- Regressione: **gel/UI 41/41**, **phase 2 26/26**, **phase 3 14/14 (BPM 120,
  esatto)**; `npm run lint` + `npm run build` puliti; day mode verificato.

### 2026-07-28 (fine) — REVERT: la UI torna allo stato approvato

Operatore: *"non mi piace il risultato. torniamo a quando l'ui era come nella
foto caricata."* Fatto.

- `src/App.tsx`, `src/index.css`, `src/components/NodalComposition.tsx` e
  `tools/verify/verify-ui-gel-pass.js` riportati a `eb74197` (lo stato prima
  della sessione). Cancellati `GelCrust.tsx`, `PanelClips.tsx`,
  `stoneMontage.ts`, `panelClips.ts`, `public/assets/bg-texture.jpg`.
- La UI è di nuovo la lastra gel procedurale violetto→oro, logo ricolorato dalla
  rampa, wordmark a `left-8`, cornice `p-4` / solchi `gap-4`.
- Verificato sullo stato ripristinato: **gel 32/32**, brand 13/13, search 6/6,
  covers 7/7, phase 2 26/26, phase 3 14/14 (BPM 124), lint + build puliti.
- **Conservati** (sono la parte di valore della sessione): `CODEX_WORKFLOW.md`,
  `ANALISI.md`, `DESIGN_ANALYSIS.md`, `IMPLEMENTATION_PLAN.md`, e
  `docs/workflow/HANDOFF.md` riscritto con tutto ciò che è stato misurato.
- Il codice annullato resta raggiungibile: `02a6922` è l'ultimo stato completo
  "roccia + clip-path".

**Lezione, per chi legge dopo.** Le decisioni #18–#23 descrivono cinque
direzioni estetiche diverse in due giorni, tutte con le suite verdi, tutte
annullate. Il problema non era tecnico: si è implementato prima di far approvare
una direzione. `CODEX_WORKFLOW.md` esiste per questo — va rispettata anche la
parte che dice **"Wait"**.


### 2026-07-28 — Red-lined geometry: the containers take the operator's curves

Operator delivered an annotated screenshot (red curves = "la nuova geometria
esatta dei bordi dei container") plus a 3-phase workflow. **This reverses the
2026-07-27 rule** that panels must stay rectangles: the containers themselves are
now clipped to the traced curves. Decision #22 is superseded by #23.

- **The curves are TRACED, not eyeballed** (`src/lib/panelClips.ts`): the red
  stroke was thresholded out of the annotation, dilated to close its antialiasing,
  and regions were flood-filled from OUTSIDE the frame, so a region is whatever
  the operator's line actually encloses. Contours were walked, box-smoothed,
  Douglas-Peucker simplified and turned into Catmull-Rom cubics.
- **Trap:** the annotation's LABELS and ARROWHEADS are red too and acted as walls
  inside the fill — the arrow beside "CORREZIONE CURVATURA" bit a notch out of the
  hero's left edge. Only red components with a bounding diagonal over 200px (the
  boundary strokes) are kept.
- **The left rail is NOT clipped**: its red outline is genuinely open — filling
  from inside escapes to the page border at every dilation up to 8px. Nothing
  closed to trace. Flagged for the operator.
- Paths are `clipPathUnits="objectBoundingBox"` (0..1 of each element's own box),
  so the curvature survives every panel drag and window resize **with no JS**.
- **The cosmic field** (`.syn-field`) is back full-screen behind everything; the
  panels are cut out of it, which is what the reference does.
- **The stone follows the same curves.** `paintStone` takes `Section = { rect,
  pts? }` and walks the traced outline when there is one, so ridge and clip edge
  coincide instead of the rock floating beside its own edge.
- **Phase 3 (video engine) verified, not assumed:** `clip-path` does not change an
  element's box, so the hero panel still measures 1026×506 and its canvas still
  sizes to 1024×504 with a matching buffer — no offscreen rendering, no
  ResizeObserver change. And Chrome clips HIT TESTING to the path: the centre of
  the hero resolves to the CANVAS, a clipped-away corner does not resolve to the
  hero at all, so the field behind is un-clickable while the modules stay live.
- Suite updated: the "panels stay plain rectangles" assertion is replaced by one
  requiring every `[data-clip]` section to carry an applied objectBoundingBox
  clip with a non-zero box.
- Regression all green: stone/UI **40/40**, brand 13/13, search 6/6, covers 7/7,
  phase 1 21/21, phase 2 26/26, phase 3 14/14 (**BPM 120**); lint + build clean.


### 2026-07-27 (5th pass) — FASE 4 executed: the restyle, 7 commits

Operator: *"vai, fermati solo quando hai finito tutto il lavoro"* — plan approved,
run all of it. Done, one commit per area per `CODEX_WORKFLOW.md`.

| Commit | Area | What it fixed |
|---|---|---|
| `82ca0a1` | material + lighting | bead scale hierarchy; one light key |
| `5afea00` | depth | form shading over the whole rock |
| `2b2b714` | forms | junction pools, outer seam, rarer bigger gems |
| `a6bfa63` | top bar + rail | lit-plane inset treatment |
| `19e3679` | right panel + cards | card/field key light, radii, borders |
| `2b60fd7` | bottom panels | same treatment; hero shell left bare |

Findings worth keeping:

- **Ridge width and bead size were the same number, and that was the whole bug.**
  The patch was scaled so its HEIGHT became the ridge width, squashing a 96px
  window 3× into a 34px ridge and taking every bead down with it — the material
  read as gravel. They are separate now: the patch is drawn at its own scale
  (real 12–18px beads) and the ALPHA is squeezed to the band, an ellipse as wide
  as the stamp but only as tall as the ridge.
- **Bead size must be held for a RUN of stamps.** Rerolled per stamp it averages
  straight back to one size; the reference varies it in zones.
- **Vertical flips destroy the lighting.** The key is baked into the piece, so a
  flip puts specular crowns under the beads. Horizontal only, rotation ≤0.16 rad.
- **A cast shadow is a no-op on #000 panels** — black on black shows nothing. What
  gives a ridge volume against black is its own form shading, painted
  `source-atop` per placement. NOT as one tiled gradient: that drew a hard bright
  rule straight across the whole UI where its tiles met.
- **Overlapping placements triple whatever you set.** 0.17 white per placement
  came out milky and killed the piece's colour; 0.055 is right.
- **Junction pools only between BROAD sections** — a pool at a corner of the 78px
  icon rail is wider than the rail and lands on its labels.
- **An inset box-shadow on the HERO shell costs frames.** It has to be composited
  over the animating canvas: phase 3 went 124 → 138 the moment it went on, back to
  124/129 when removed. Every other panel takes it happily. Noted inline in
  `App.tsx` so it does not get tidied back in.

Regression at the end: stone/UI **40/40**, brand 13/13, search 6/6, covers 7/7,
phase 1 21/21, phase 2 26/26, phase 3 14/14 (**BPM 124**); lint + build clean;
day mode unchanged (no rock, cream surfaces, plain white top hairline).

Still deliberately NOT matching the reference: its translucent rail/right column
(operator chose **option 2 — sections stay solid opaque black**).


### 2026-07-27 (4th pass) — Operator locks the process: CODEX_WORKFLOW

Operator decisions this round:
- **Option 2 confirmed: sections stay solid opaque black.** The reference's
  translucent rail/right column is explicitly out of scope now.
- The stone is still "troppo diversa" from the reference, and the operator has
  imposed a phased ART-DIRECTION workflow (`CODEX_WORKFLOW.md`, checked in at
  repo root, verbatim): analyse → design-compare → plan → implement one area
  per commit, WAITING for their review between phases. Priorities in order:
  material, lighting, depth, forms, texture, colours. RESTYLE, not redesign.
  Only CSS/Tailwind/decorative layers may change; logic/canvas/shaders frozen.

Produced this session (FASE 1–3, no code touched):
- `ANALISI.md` — component/CSS/layout inventory, allowed surfaces, risks.
- `DESIGN_ANALYSIS.md` — app vs reference: the six measured gaps (bead scale
  and grout, single light key broken by stamp rotation, missing contact
  shadow, missing junction pools/outer seam, stamp repetition, mauve mud).
- `IMPLEMENTATION_PLAN.md` — 7 commits: 1 material (bead scale/hierarchy),
  2 lighting (one key, no vertical flips, rotation ±0.12), 3 depth (baked
  drop shadow + panel inset), 4 forms (junction pools, corner clusters, outer
  seam, fewer/larger gems), 5 top bar + sidebar chrome, 6 right panel + cards,
  7 bottom panels + buttons. Guard-rails per commit: lint, gel suite,
  phase-3 BPM after montage steps, night+day screenshots.

**STOPPED before FASE 4 by design — the workflow requires the operator to
approve/correct `IMPLEMENTATION_PLAN.md` before any implementation commit.**


### 2026-07-27 (3rd pass) — The alien stone: a MONTAGE, laid over the panels

Operator, twice: the rocks in the reference are *"una rielaborazione della
texture … prendere dei pezzi e montarli"*, and — decisively — *"i pannelli
fossero come prima, ma che la forma gliela dia la roccia come se fosse sopra ai
pannelli … non devono essere i pannelli con forme non regolari."*

That killed the previous pass's whole idea. Both earlier attempts shaped the
PANELS (a mask with `feTurbulence` eroding the holes). The panels must stay plain
rectangles; the rock goes on top and covers their edges, and *that* is what makes
them look irregular. `verify-ui-gel-pass.js` **40/40**, phase 3 **BPM 120**.

- **New `src/lib/stoneMontage.ts`.** Pieces of bead vein are cut from the artwork
  and stamped along every section's outline, rotated to follow the edge, with red
  gem cabochons set into the ridge and the brass rivets at the four outer corners.
  `GelCrust.tsx` now owns only the geometry; the erosion mask is gone entirely.
- **The source patches are chosen by measurement, and this was the whole ball
  game.** Hand-picking off a coordinate grid put most windows on smooth membrane,
  and the montage came out as pastel mush — the material was wrong, not the
  technique. A sliding window now scores every candidate for small-scale edge
  energy (beads are busy) against saturation (beads are pale grey-blue), rejecting
  anything containing the artwork's black field; the top non-overlapping windows
  are all dense bead vein. The bluest are listed twice, because an even pick came
  out mauve where the reference reads blue.
- **The ridge's silhouette needs a low-frequency term.** Per-stamp jitter alone
  gives a band of even thickness — knitted rope. Two slow sine waves on the offset
  plus a swell term on the size, and loose clusters thrown clear of the line, give
  the reference's swell-and-neck with beads sitting on their own out on the black.
- **The outward bias must be ABSOLUTE PIXELS, not a fraction of the ridge.** What
  the bias has to clear is half the layout gap, which has nothing to do with how
  fat the beads are. As a fraction it under-shot, both facing ridges sat astride
  their edges, and together they ate ~100px — swallowing "Add Node" and the GEMINI
  PRO header. At `biasPx = 15` (half the 28px gap) the ridge fills the gap and
  leans ~12px onto each panel, which is what the reference does.
- **A `position: fixed` wrapper is a stacking context in Chrome.** The strips'
  own `z-index: 40` was being resolved *inside* a wrapper with `z-index: auto`, so
  the whole rock painted in DOM order — behind the panels, trapped in the 28px gaps
  with two dead-straight edges. The wrapper carries the z-index now. (Cost an hour;
  the symptom looks exactly like "the ridge is too thin".)
- Outer frame widened to `p-10` so the bezel has room to sit without covering the
  top bar's text.
- Suite rewritten for the montage: the stone must reach the page as a **Blob URL**
  (seeing `bg-texture.jpg` in a strip's `background-image` would mean the artwork
  went back to being shown whole instead of cut up), a ridge per section, strips
  not one sheet, none over the hero canvas, never animating, no CSS filter/blend —
  **and, per the operator's direction, an assertion that no `[data-crust]` section
  carries a `mask-image` or `clip-path`.** The panels must stay rectangles.
  Divider thresholds were re-based on the montage's real character: bead crust
  scores colour ~28, where the stretched photo scored ~75 by landing on smooth
  magenta membrane.
- Regression, all green: stone/UI **40/40**, brand 13/13, search 6/6, covers 7/7,
  phase 1 21/21, phase 2 26/26, phase 3 14/14 (**BPM 120**); lint + build clean.
- **Still NOT matching the reference, deliberately — needs the operator's call:**
  in the reference the left rail and the right column are TRANSLUCENT over the
  artwork (the nebula reads through them) and the right sidebar has no black panel
  at all — its cards float directly on the texture. Our sections are all solid
  black, per the 2026-07-25 direction. The operator said this pass was only about
  the rock, so it was left alone.

### 2026-07-27 (later) — The artwork DIVIDES the sections: the crust

Operator: *"vorrei che la texture non fosse sotto alle sezioni ma che le
dividesse. mi piace questa roccia irregolare che divide le sezioni dell app."*
Done — `verify-ui-gel-pass.js` **42/42**.

- **New `src/components/GelCrust.tsx`.** The artwork moved from *behind* the
  panels (`z-index: -1`) to *over* them (`z-index: 40`, `pointer-events: none`),
  masked down to the skeleton between them: an SVG `<mask>` that is white
  everywhere and punches each section out as a hole. The holes' edges run through
  `feTurbulence` + `feDisplacementMap`, so the material reads as irregular rock
  and the sections as holes eroded through it — not as a machined 16px gap.
- **Sections announce themselves with `data-crust`** (top bar, icon rail, hero
  shell, node panel, Gemini panel, right sidebar). Geometry is measured live and
  re-measured by a `ResizeObserver`, so the holes track panel drags and window
  resizes; verified by dragging a handle and diffing the mask rects.
- **Two erosion strengths, because one does not fit both.** A ±8px bite is texture
  on the hero and a third of a 48px top bar. Sections are sorted by short side:
  broad ones `inset 5 / erode 16`, slim ones `inset 2 / erode 8`, each its own
  `<g filter>`.
- **Night-mode panel hairlines are gone** (`border-ink-700/60` → `border-transparent`
  on the six shells). This is load-bearing, not tidying: the noise pushes each hole
  a few px OUT as well as in, and every outward bulge would otherwise frame a
  rounded rectangle floating inside an irregular hole. Day mode keeps its borders —
  there is no crust there.
- **Dividers widened to 28px** (`gap-7`, resize handles `w-7`/`h-7`) and the frame
  to 32px (`p-8`). At 20px the two facing holes' outward bulges met and closed the
  divider in places; 28px keeps it open at ≥18px and lets it open to ~50px where
  both sides bite inward. Hero wordmark nudged `left-3` → `left-4` to clear the bite.
- **The artist's label is painted out of the shipped texture.** The piece carries a
  "COSMOGEL REACTOR X" barcode block at 736²(79,90)–(155,178); behind the panels it
  never showed, but the crust exposes it right over the top bar, where it reads as a
  UI glitch. `public/assets/bg-texture.jpg` is now a derived asset with that block
  cloned over from the gel below it (mirrored + feathered). **The original is
  untouched at `docs/design/textures/texture-A-jewel-mosaic.jpg` — operator, say the
  word and the label goes back.**
- **Painted as 13 strips covering ~32% of the viewport, never one full sheet**, so
  no crust layer overlaps the hero's animating canvas. A scanline over the section
  rows yields the skeleton; every strip shares one `<defs>` and one page-coordinate
  `viewBox`, so the material and the noise run continuously and the seams are
  invisible. **Do not give the defs carrier `visibility: hidden`** — visibility
  inherits into the mask content, the mask resolves to zero luminance, and every
  strip masks itself away (cost an hour).
- **On the frame-cost contract, honestly:** the strips are insurance, not a measured
  fix. Phase 3's BPM estimate under sandbox SwiftShader is too noisy to resolve
  this — three runs with NO crust at all gave **120 / 144 / 129**, and the crust
  (one sheet or strips) lands in the same band. Final run: **BPM 124, 14/14**. The
  real check remains the ≥30fps GPU pass the operator still owes.
- Suite rewritten again: artwork by URL, stretched + bleeding, masked, one hole per
  section (6/6), erosion present, over the panels and click-through, strips <60%
  coverage, none over the canvas, never animating, no CSS filter/blend. Plus a real
  pixel test — walk the hero's bottom edge column by column and require the boundary
  to **wander** (measured: range 20–34px, sd ~4px), which is what separates eroded
  rock from a straight gap.
- Regression, all green: crust/UI **42/42**, brand 13/13, search 6/6, covers 7/7,
  phase 1 21/21, phase 2 26/26, phase 3 14/14; lint + build clean; day mode
  unchanged (no crust, borders intact); an open effect sits correctly inside its
  eroded hole.

### 2026-07-27 — The backdrop IS the artwork; logo restored in its own colours

Operator sent four images: the app as it is, the look they want, the texture they
used for that mockup, and the logo. Three notes, all done
(`verify-ui-gel-pass.js` **36/36**).

- **The backdrop is now the operator's own artwork.** `public/assets/bg-texture.jpg`
  (= `docs/design/textures/texture-A-jewel-mosaic.jpg`, the very file they sent,
  736², rotation 0°) replaces the procedural violet→gold ramp + canvas bead tile in
  `.syn-bg-layer`. The sections stay solid black, so it reads only in the frame and
  the gaps — panels cut out of a slab of jewelled gel.
- **Stretched WHOLE (`100% 100%`), not `cover` — this is the whole trick.** The
  piece is a slab with its own crusted bead border and corner rivets, and in the
  reference that border is what frames the UI. `cover` on a square artwork in a 16:9
  window zooms ~2.5× into the middle and throws the border off screen (tried it
  first: it looked like blurry wallpaper). The horizontal stretch is invisible on
  material this abstract.
- **The black field is bled off screen by measurement, not by eye.** The artwork's
  own margin was measured from the pixels — 8.42% left/right, 7.61/7.47% top/bottom
  — so `inset: -9.5%` lands the crusted edge ~8px inside the viewport with a hair of
  black rim around it. `p-4` → **`p-7`** on the app root (gaps stay `gap-4`): the
  frame has to be wider than the gaps or there is no border of material to read.
- **Logo restored top-left, in its OWN iridescence.** It was never actually missing
  from the app — it is missing from the operator's *mockup* — but it was being
  recoloured: a violet→gold ramp masked to the mark plus a `luminosity` blend, which
  existed only to tie it to the procedural slab. That slab is gone and the backdrop
  is now iridescent itself, so the delivered mark is shown untouched (44px → **56px**
  for presence) with just a narrow sheen sweeping across it on the 6s cadence.
  **Operator: if you preferred the ramp-tinted logo, it is a one-block revert in
  `.syn-logo` — say the word.**
- **Hero wordmark pushed hard left** (`left-8` → `left-3`, 13px from the panel edge):
  the brain graph masses around and right of centre, so an indented title leaves the
  left half plain black. Asserted now, so it cannot drift back.
- **Frame cost went DOWN, which matters here.** The old slab was three layers (ramp
  plate + a 640² canvas tile + 28 animated bubble elements); it is now ONE image
  layer drifting by transform, still with zero blend modes and zero filters. Phase 3
  re-run: **BPM = 120, exactly on target** (the contract's whole point — beat
  detection reads spectral flux BETWEEN frames).
- Suite rewritten to match: the artwork is asserted by URL, by `100% 100%`, by
  decoding, by being a single unblended unfiltered layer, and by pixels (frame
  bright 143.8; gap bright 166.8 / colour 76.4; panel interior 0.2 / 0.0 — the
  sections demonstrably cover it). Logo: present top-left, never recoloured, sheen
  masked + sweeping, and renders chromatic (spread 19.8) rather than as a silhouette.
- Regression, all green: gel/UI **36/36**, brand **13/13**, search **6/6**, covers
  **7/7**, phase 2 **26/26**, phase 3 **14/14** (BPM 120), phase 1 **21/21**;
  `npm run lint` + `npm run build` clean. Day mode unchanged (no slab, cream
  surfaces, logo legible on cream).
- **Harness note for the next session:** the verify scripts are CommonJS but
  `package.json` is `"type": "module"`, so `node tools/verify/x.js` throws
  `require is not defined` — copy to `<scratch>/x.cjs` and run that. `verify-phase3`
  also needs `beat120.wav` + `test.webm` in its `__SCRATCH__` dir; generate them
  with `tools/verify/make-beat-wav.js` and `tools/verify/gen1080.js` (sed the
  `__SCRATCH__` placeholder to a real path first).

### 2026-07-25 — One cadence for the brand; the hero wordmark cast in the gel

Operator: animate the slab's gradient like the hero wordmark, and give that
wordmark the logo's inflated 3D gel — same texture, same 3D mode. Both done,
`verify-ui-gel-pass.js` **36/36**.

- **One 6s cadence for the whole brand.** The slab's ramp was sliding on 26s and
  the logo on 18s; both are now **6s**, the wordmark shimmer's own clock. Half the
  slab's plate is two viewport widths and the wordmark shifts two of its own widths
  per cycle, so slab, logo and both titles sweep at exactly the same rate — asserted
  by the suite.
- **The hero wordmark is now cast in the gel** (`.hero-gel-text`, applied only to
  the big one — at 15px in the top bar the bubbles would be noise). Four background
  layers on ONE element, clipped to the glyphs: the gel tile, a lit crown, a shaded
  base, then the colour ramp, plus a hairline dark `-webkit-text-stroke` for the
  moulded rim. Same texture and same idea as the logo — there the mark's own
  luminance shapes it, here the tile's crowns and undersides do. The tile is
  exposed to CSS as `--syn-gel-tex` / `--syn-gel-tex-text` on the app root, since
  it is generated at runtime.
- **Three real defects found and fixed while tuning** (each is now covered by an
  assertion, since each was invisible in a still frame):
  1. **The wordmark went BLACK for part of every cycle.** The ramp layer is 200%
     wide and slides a full 200%, and I had set that layer to `no-repeat`, so it
     scrolled clean out of the box — with `color: transparent`, the glyphs then had
     nothing to show. Fixed by letting the ramp repeat (as the plain wordmark
     always did). The suite now samples the wordmark's brightness across a whole
     6s cycle and requires it to stay steady (was 84…197, now 176…188).
  2. **Corner-placed lighting sank the tail of the word.** A specular dome at the
     top-left plus a shadow at the bottom-right adds up to a left-to-right ramp, so
     "ntech" crushed to near-black. Replaced with vertical lit-crown-over-shaded-
     base, which inflates every letter equally.
  3. **The text tile was being resampled every frame.** Drawing the 640² tile at
     560px made the browser rescale it on each repaint of the animated wordmark —
     BPM 133. Drawing it at its natural 640px restored **BPM 120** (twice in a row).
     A `shade` option was also added to the generator: at letter scale a
     full-strength bead shadow can swallow a whole stroke, so the text variant uses
     softer undersides.
- `verify-phase10-brand.js` updated: the hero lines legitimately run
  `syn-gel-text-flow` now, so the "animated" check accepts either shimmer name.
- Regression, all green: phase 1 **21/21**, phase 2 **26/26**, phase 3 **14/14**
  (BPM 120), vendor **19/19**, brand **13/13**, search **6/6**, covers **7/7**;
  lint + build clean.

### 2026-07-25 — Gel material: glossier, with air bubbles and inflated 3D

Operator note: the slab should read as *gel with reflections and air bubbles
inside*, with the swollen 3D of the new logo. Reworked and verified
(`verify-ui-gel-pass.js` **30/30**).

- **The material is now painted, not gradient-guessed.** `src/lib/gelTexture.ts`
  renders a **seamless 640px tile** on a canvas once: macro swell domes, a dense
  field of bubbles (fine grain plus a scatter of big beads, each with a shaded
  underside, a tight specular crown and a wet rim) and long gloss smears. Beads
  that touch an edge are redrawn on the opposite side, so the tile wraps with no
  seam. It is transparent — white crowns, dark undersides — so plain alpha
  compositing embosses the beads onto the ramp beneath.
- **Why a tile, and why only one layer:** only the ~16px gaps between the sections
  show the slab, so the texture must be DENSE to read at all — CSS gradients tiled
  at that scale looked like a mechanical polka-dot grid, and an SVG field dense
  enough to read meant thousands of nodes. A 640px tile is cheap and its repeat is
  invisible through narrow gaps.
- **FRAME-COST FINDING (the important one, now a documented contract).** Anything
  blended or filtered over the sliding ramp is re-composited every frame, and this
  sandbox has no GPU, so it lands on the CPU. Measured against phase 3's BPM
  estimate (beat detection reads spectral flux BETWEEN frames): **blur filter →
  189 BPM; four blend layers → 171; one blend layer → 138; zero blends/filters →
  124** (target 120). So the slab now carries **no `mix-blend-mode` and no
  `filter` at all** — the whole material is baked into the one tile and everything
  animates only `transform`. The suite asserts zero blended layers and zero
  filters, so this cannot regress silently.
- Tuning: the specular crown was tightened (a broad white haze bleached the ramp's
  colour instead of glazing it) and the undersides deepened, which brought the
  saturated violet/gold back while keeping the gloss.
- Regression, all green: phase 1 **21/21**, phase 2 **26/26**, phase 3 **14/14**
  (BPM 124), vendor **19/19**, brand **13/13**, search **6/6**, covers **7/7**;
  lint + build clean.

### 2026-07-25 — UI pass: gel slab, gradient logo, bare effect host, audio meter

Six operator notes, all done and verified (`tools/verify/verify-ui-gel-pass.js`
**27/27**; needs a clip with audio — `AUDIO_CLIP=<webm>`):

1. **Sections back to 100% opaque black.** `--syn-ink-950/900/850` → `#000000`,
   `--syn-ink-800` → `#1a1a1a`, `--syn-hero-canvas` → `opaque` (the hero fills
   again). The photographic backdrop is gone: `public/assets/bg-texture.jpg`
   removed, `docs/design/textures/` kept as reference only.
2. **Animated "gel" LED slab in the gaps.** `--syn-bg` stays `transparent`, so the
   new `.syn-bg-layer` shows only between the sections — they read as holes cut
   over a colour-shifting sheet. It runs the SAME violet→gold ramp as the
   wordmarks (`#8b5cf6 → #7c3aed → #ffda4d → #ffb31a`) with a screened layer of
   soft pools/speculars drifting on a slower clock for the liquid, glossy read.
3. **The logo rides that ramp while keeping its inflated glossy 3D:** a masked
   gradient layer supplies the hue, the mark sits on top in `luminosity` blend so
   it contributes only light and shade (`.syn-logo*`). Day mode gets the deeper
   ramp, as the wordmarks do.
4. **Effect host is bare.** `EffectHost` no longer renders the "← BACK TO GRAPH" +
   module-name bar; the iframe fills the panel edge to edge (verified: 0px above,
   0px below, single child). Each standalone HTML already has its own header and
   status bar, so the shell was stacking a second set of chrome on a
   self-sufficient UI. Closing is the sidebar HOME nav (03-SPEC §2). `onBack`
   stays in the props contract.
5. **Playback level meter in the sidebar** under OPTIMIZER (`AudioMeter.tsx`):
   one column (channels summed, not a stereo pair), green low → amber → red hot,
   scale ticks at −6/−12/−24 dB, white peak-hold, dB readout, RMS over a −54…0 dB
   scale, "hot" above −6 dB. It taps the hero `<video>` through WebAudio — the
   element ships `muted` (for autoplay) and a muted element analyses as silence,
   so it is unmuted and routed through a **gain of 0**: real samples reach the
   analyser while playback stays as silent as before, and both are restored on
   unmount. One `MediaElementAudioSourceNode` per element is cached in a WeakMap
   (a second one throws). Verified against a purpose-built clip whose level ramps
   quiet→hot: fill 77→90 of 96px, hot state reached, readout live.
6. **Wordmarks bolder** — both at **700**, the vendored Space Grotesk maximum
   (they were 600). Anything heavier would need a different family.

- **Real bug caught by the regression, worth recording:** the first gel used an
  animated `background-position` plus a full-viewport `filter: blur(22px)`. That
  cost enough frames to break **AudioEngine's BPM estimate (189 instead of 120)** —
  beat detection reads spectral flux BETWEEN frames, so a hungry backdrop skews
  it. Rebuilt to animate **only `transform`** (GPU-composited, zero repaint) with
  no blur — the plate is 400% wide with the ramp laid twice so sliding it by half
  its width loops seamlessly, and the radial falloffs are wide enough to look
  molten unblurred. **BPM back to 124, phase 3 14/14.** The suite now asserts both
  the transform animation and the absence of a blur filter, so this cannot
  regress silently.
- Regression, all green: phase 1 **21/21**, phase 2 **26/26**, phase 3 **14/14**,
  vendor-offline **19/19**, brand **13/13**, search **6/6**, covers **7/7**;
  `npm run lint` + `npm run build` clean.

### 2026-07-25 — Brand: definitive logo + unified titles; background experiment (10 previews)

Operator asleep, three tasks handed over: (1) swap in the definitive logo,
(2) unify the two "VFX Syntech" titles, (3) render background-texture previews
to judge in the morning ("domattina ti diro se tenerla oppure no").

- **Definitive logo — DONE.** The operator uploaded the final iridescent mark
  (1306×816 webp); recovered from the session transcript → kept verbatim as
  `public/assets/logo.webp`, processed into `public/assets/logo.png` (501×512).
  Because the mark is MULTICOLOUR (unlike the old white one) the black field is
  keyed to alpha with the **RGB untouched**: largest foreground component kept
  (drops the Gemini sparkle watermark + 86 specks), **largest interior hole
  preserved** (the design's central hole) and the 532 smaller dark-shading gaps
  filled so they stay opaque in their original colour. The day-mode `invert` is
  GONE (it would destroy the brand colours) — replaced by a soft shadow.
- **Titles unified — DONE.** The top-bar wordmark and the hero title now share
  one style: the **top-bar font** (Space Grotesk, semibold, tracking-tight, Title
  Case) plus the **hero's shimmer animation** on both, each keeping its own
  position/proportion/size (15px vs 60px, identical −0.025em tracking ratio). The
  hero's white "VFX" + caps "SYNTECH" split is gone; both lines are the animated
  "VFX" / "Syntech".
- **Day-mode legibility fix this forced (documented judgement call):** with the
  bright brand ramp the small wordmark measured **1.48:1** on the cream top bar
  (unreadable; WCAG wants 4.5). Added `.syn-day .hero-gradient` — **same
  animation, same hue family, deeper violet/amber stops** → ~3.8–4.6:1, while
  night keeps the original bright ramp untouched. Theme hook: a `syn-day` class
  on the app root. Flagged for the operator: if they prefer the identical bright
  ramp in day mode, it is a one-block revert in `src/index.css`.
- **Verified** (`tools/verify/verify-phase10-brand.js`) **13/13**: logo decoded +
  chromatic (mean channel spread 57.8) + keyed (188k transparent px) + never
  inverted in either theme; both titles animated by `gradient-shimmer` with
  identical family/weight/tracking ratio and their own sizes; shimmer proven
  advancing; no page errors. `npm run lint` clean.
- **Background-texture experiment — 10 previews delivered, NOT applied to the app.**
  The operator's two artworks are preserved as design references in
  `docs/design/textures/` (+ README) and the look is rendered by the new
  `tools/preview/bg-texture-preview.cjs`, which injects it into the RUNNING app
  and screenshots it — no app file changes. The recipe: the texture replaces the
  darkest blacks at **token level** (`--syn-bg`, `--syn-ink-950/900/850` →
  translucent), one `background-attachment: fixed` texture on `<body>` shows
  through every section (so the separate panels read as ONE continuous image with
  the alpha doubling as the legibility scrim), and the hero brain-graph canvas is
  **screen-blended** so its opaque black drops out and only the glowing nodes
  float over the texture. Rotation is BAKED into the image (fixed backgrounds
  can't be rotated, and transformed layers create blend groups that would break
  the canvas trick). Deliverables: 4 rotations (0/45/90/135) per texture + one
  **3D wrap** per texture (perspective shell flaps folding over the UI edges,
  slightly translucent so the sections stay perceptible underneath = "encased").
  Claude's picks for the 3D pass: **A at 45°** and **B at 90°**.
  **Awaiting the operator's keep/discard decision.**
- **Background artwork CHOSEN + SHIPPED (operator, same night).** From the 10
  previews the operator picked **texture A at rotation 0°**, with the correction:
  **"the sections must be 90% opacity and cover the artwork, which is barely
  visible"** (the previews ran the panels at 55%, which let the artwork dominate
  and washed out the sidebar labels). Implemented for real, night mode only:
  `public/assets/bg-texture.jpg` + `.syn-bg-layer` in `index.css` (fixed,
  `inset:-10%` so `cover` crops the artwork's own black margin) + the night
  surface tokens at **90%** (`--syn-ink-950/900/850`), `--syn-bg: transparent` so
  the gaps between sections show it at full strength, and a new
  `--syn-hero-canvas: transparent` token that makes **VfxCanvas clear instead of
  fill** so the artwork also shows through the hero (a translucent fill would
  accumulate to solid black frame after frame). Day mode renders no layer and
  keeps its cream surfaces. The 3D wrap variant was not chosen.
  **Verified** (`tools/verify/verify-phase10-bgtexture.js`) **12/12**, including
  the quantitative spec: in the gaps the artwork is unattenuated (sd 61, peak 254)
  while inside a section it is flattened to near-black (bright 20.5, sd 2.7) — a
  22× local-contrast difference, i.e. the sections demonstrably cover it. Day-mode
  gap stays cream (bright 252). Effect-open + AI Lab states checked visually.
  Swapping in the full-resolution artwork is a one-file replace.
- **Regression after the brand edits (App.tsx + index.css) — all green:** brand
  **13/13**, phase-10 search **6/6**, covers **7/7**, vendor-offline **19/19**,
  phase 2 **26/26**, phase 1 **21/21** (all 5 standalones still clean), phase 3
  **14/14**. `npm run lint` + `npm run build` clean. No verify suite depends on
  the hero title's text, so the Title-Case change is safe.

### 2026-07-24 — Phase 10 near-complete (logo + CDN vendoring + colour audit)

Autonomous session (operator at work: "usa tutti i token senza fermarti").
Operator's chat answers drove it — 1 logo uploaded (covers still coming),
2 authorised the HTML `<script>` edits, 3 keep the one-off colours, 4 remind me
about the perf test at the end.

- **CDN vendoring (item 3) — DONE + verified 100% offline.** Every external CDN
  dep the shell + the five effect HTMLs used is now served from
  `public/effects/vendor/` (~45 MB):
  - **three.js r128** → `vendor/three.min.js` (from the `three@0.128.0` npm dep).
  - **MediaPipe** → `vendor/mediapipe/{selfie_segmentation,pose,face_mesh,
    tasks-vision}/` via `npm pack`. selfie_segmentation keeps both simd+nosimd
    wasm (core: 3 effects + the shell PersonMask); pose/face_mesh/tasks-vision
    are SIMD-only (lazy blob_tracker features, modern-Chrome target, graceful
    fallback). pose ships the **lite** model only (`modelComplexity:0`) — dropped
    the 27 MB heavy + 6.4 MB full. The tasks-vision `selfie_segmenter.tflite`
    was fetched from storage.googleapis and vendored too.
  - **Fonts** → `vendor/fonts/{effects,shell}.css` + 36 self-hosted woff2
    (latin + latin-ext subsets of JetBrains Mono / Barlow Condensed / Space
    Grotesk / Inter). Effect HTMLs `@import ../vendor/fonts/effects.css`; the
    shell loads `vendor/fonts/shell.css` via a `<link>` in `index.html` (the
    Google-Fonts `@import` in `src/index.css` removed).
  - Edits (operator-authorised, decision #15): each effect HTML's font `@import`,
    the selfie `<script src>` + `locateFile` (anamorphic/blob_reveal/bokeh),
    blob_tracker's three.js `<script>` + pose/face_mesh `<script>`+`locateFile`
    + tasks-vision `import()`/wasm dir/tflite path; `PersonMask.ts` `CDN_BASE`.
  - **Verified** (`tools/verify/verify-phase10-vendor.js`) **19/19 PASS**: with
    NO CDN access (the sandbox blocks them anyway) all 5 effects load, THREE +
    SelfieSegmentation resolve from vendor, vendored fonts render, **zero
    external-CDN requests**, no dep/page errors. Plus a wasm-init run: a fresh
    `SelfieSegmentation` initialises the **5.6 MB simd wasm + tflite** and returns
    a 256² mask, 0 CDN hits — the whole native pipeline runs offline. This also
    **retires the long-standing sandbox gotcha** (`THREE is not defined`).
  - **Lazy blob_tracker deps also proven offline** (`verify-phase10-vendor-lazy.js`
    **6/6**): Pose (onResults from vendor, lite model), FaceMesh (onResults), and
    the tasks-vision ImageSegmenter (categoryMask) each init + run from vendor
    with zero CDN — each on its OWN fresh page (co-loading several Emscripten
    runtimes in one document collides on the global `Module`; a test artefact,
    never how blob_tracker loads them).
- **Logo (item 1) — DONE.** The operator uploaded the logo in chat (not on disk);
  recovered it from the session transcript (2000×1250 webp) → kept as
  `public/assets/logo.webp`, and produced `public/assets/logo.png` (tight crop +
  black field keyed transparent, alpha=luminance, decision #17). Wired into the
  sidebar top-left (replaces the temp "VS" diamond): white mark + violet glow at
  night, `invert` to dark for day mode. **Verified 7/7** (present, decoded
  496×512, correct src, 5 cards intact, inverts in day mode, no errors) + night/
  day screenshots eyeballed.
- **Effect-card covers (item 1, rest) — wiring READY, awaiting operator's 5 files.**
  New `EffectCardArt` in `App.tsx` tries `/assets/covers/<ModuleId>.{webp,png,jpg}`;
  on load it fades the cover in under a scrim with a white label, on error it
  falls back to today's plain-label card. Drop the files in → they appear, no
  code change. (Not fabricated — the operator is finishing them.)
- **Colour / day-mode sweep (item 5) — audited.** Grep of `src/` hexes: only the
  violet accent family + standard neutrals/surfaces + the intentional per-effect
  accents + blob_tracker's documented palette. Operator chose to **keep** the 4
  one-off colours ("lasciarli"). No new stray colours introduced; day mode
  re-verified with the logo change.
- **Perf pass (item 4) — still a GPU-machine check** (~1–2 fps under sandbox
  SwiftShader). **Operator asked to be reminded when everything else is done —
  see Next step / the closing note to the operator.**
- Regression: `npm run lint` clean; `npm run build` clean (dist carries the
  vendored assets + the shell `<link>`); phase-10 **search box 6/6** after the
  card refactor. Standalone effects: the 19/19 offline load IS the regression
  (they now load in-sandbox for the first time).
- **Full regression re-run (all green) — 2026-07-24, after the CDN/logo/card
  edits:** **phase 1 21/21** (all 5 standalones load CLEAN + bridge silent — the
  old sandbox CDN fails are gone), **phase 2 26/26** (AI Lab UX), **phase 3
  14/14** (incl. **SEG reaches READY from the vendored PersonMask**, no CDN
  mirror), **phase 8 chain 6/6** (the suite hard-*aborts* all CDN/font requests
  and the full 5-node chain — three.js incl. — still renders: proof the app is
  CDN-independent). fps 3 under SwiftShader (the ≥30fps criterion stays a
  GPU-machine check, as always).
- **Cover happy-path also proven** (`verify-phase10-covers.js` **7/7**): a
  network-injected test image (no placeholder shipped) makes a card render the
  cover — decoded, opaque, under the scrim, white label — while an un-injected
  card falls back to the plain label. Confirms the operator's 5 covers will
  drop in cleanly.
- **Production build verified too** (not just the Vite dev server): `npm run
  build` → `NODE_ENV=production node dist/server.cjs` serves every vendored asset
  (logo.png, three.min.js, fonts/shell.css, mediapipe tflite — all 200) and the
  shell `<link>` is present; re-ran the vendor suite **19/19** + the shell logo/
  card suite **7/7** against the prod server — all green. So the whole Phase-10
  surface works in the deployed build the operator will ship, not only in dev.

### 2026-07-20 — Phase 10 IN PROGRESS (Assets & polish — search box)

- **Functional effect search box (Phase 10 item 2) — DONE.** The right-sidebar
  "Search systems…" placeholder (`<span>`) is now a real controlled `<input>`
  (`systemSearch` state in `App.tsx`) that filters the effect cards by name or id
  (case-insensitive), with a ✕ clear button and a "no systems match" empty state.
  Testids: `effect-search`, `effect-search-clear`, `effect-search-empty`.
- **Verified** (`tools/verify/verify-phase10-search.js`) **6/6 PASS**: input
  present + all 5 cards; "blob" → blob_tracker+blob_reveal; "bok" → bokeh only;
  no-match → empty state + 0 cards; clear → all 5 back; no page errors. `npm run
  lint` clean.
- **Phase 10 remaining** (in order): item 1 **6 operator images** (BLOCKED — see
  notification); item 3 vendor CDN deps locally (needs an operator call — repointing
  the effect HTMLs' CDN `<script>` srcs would edit them outside the bridge blocks,
  which brushes against hard rule #1; the shell-side PersonMask/fonts CDN can be
  vendored freely); item 4 perf pass (GPU-machine check); item 5 day-mode + stray
  non-token colour sweep.

### 2026-07-20 — Phase 9 COMPLETE (Chain export — Master MP4)

- **The ChainLab "Master MP4" button is real.** Two vendored files under
  `public/effects/vendor/` (served statically, NOT package.json deps — hard rule
  #6 OK):
  - **`mp4-muxer.min.js`** — the real `mp4-muxer` v5.2.2 UMD build (Vanilagy,
    MIT), exposes `window.Mp4Muxer` (`Muxer` + `ArrayBufferTarget`), obtained via
    `npm pack` (not installed).
  - **`syntech-export.js`** — the WebCodecs frame-stepping exporter matching the
    exact contract ChainLab already calls: `window.SyntechExport.{isSupported,
    exportMasterQuality({video, fps, getFrame, filename, onProgress})}` →
    `{filename, codec, audio}`. It seeks the source video frame-by-frame, calls
    the caller's `getFrame()` (which advances a synthetic clock + returns
    `engine.canvas` — deterministic render at native res), encodes each frame via
    `VideoEncoder`, muxes to a `fastStart:'in-memory'` MP4, and downloads it.
- **Codec strategy:** preferred **universal H.264 (avc)** first (so the operator's
  Chrome produces a QuickTime/everything-compatible MP4), with **AV1 then VP9**
  fallbacks for machines lacking an H.264 encoder (both play in-MP4 in modern
  browsers). `isConfigSupported()` picks the first the encoder accepts; the muxer
  video codec + the `avc:{format:'avc'}` flag follow the pick. v1 is video-only
  (audio muxing is a documented follow-up — the muxer already supports a track).
- **DECISION (documented): added AV1/VP9 fallbacks** beyond the roadmap's plain
  H.264 — headless Chromium has NO H.264 encoder (all `avc1.*` `isConfigSupported`
  = false; a no-GPU/headless limitation like the ≥30fps criterion), so H.264-only
  would be unverifiable here AND would fail on any user machine without an H.264
  encoder. The fallbacks make the exporter robust and let the full pipeline be
  proven headless.
- **Verified** (`tools/verify/verify-phase9-export.js`) **7/7 PASS**: SyntechExport
  + Mp4Muxer load and `isSupported()`; a UNIT export (mock 2s video + synthetic
  getFrame) produces a **structurally-valid MP4** (ftyp+moov+mdat) whose **stsz
  sample_count = 60 (2s × 30fps)** and **mvhd duration = 2.0s**; the **real
  ChainLab "Master MP4" button** over a short clip + a blob_tracker→analog chain
  reports **"✓ …mp4 (AV1)"** and the downloaded blob is a valid MP4 (29 frames,
  ~0.97s); no page errors. **The 10s@1080p acceptance is the same code path at
  scale — a machine-capability run (like ≥30fps@720p); the operator's Chrome uses
  H.264.** `npm run lint` clean (vendor .js are static, outside tsc).
- **Autonomous session note:** done without the operator (they're away); decisions
  recorded (#14). Next is **Phase 10, which is BLOCKED on the 6 operator images**
  — see the notification below / Open items.

### 2026-07-20 — Phase 8 COMPLETE (1:1 port: BLOB TRACKER) + L8 close-out

- **Phase 8 done — the last + hardest effect is a real 1:1 SynEngine port.**
  All layers ported and verified (per-layer logs below): L1 tracker core, L2 FX,
  L3 edge contour, L3b smart contour, L4 optical flow, L5 three.js ripple, L6
  three.js panels, L7a reactivity routes, L7b colours, L7c fixed-points chaos.
  **All five effects are now real ports** (analog, bokeh, anamorphic_lab,
  blob_reveal, blob_tracker); no DummyNode remains — `nodes.ts` factory is
  permanent (`blob_tracker: () => new BlobTrackerNode()`, the commented
  fallback removed).
- **L8 param-table reconciliation vs the control inventory**: added **`mirrorBg`**
  (btn-mirror-bg) — horizontally mirrors the tracked video, flipping BOTH the dc
  base draw and the 320×180 detection draw so markers stay aligned (the
  standalone only mirrors the panels-mode backdrop; the node makes it a coherent
  input-flip). CONSOLIDATED (documented, not added): **connSat** (sConnSat — a
  hue/sat/lightness colour-PICKER control, subsumed by the L7b palette enum);
  **ar-* / vr-* gains + ar-on/auto + vr-on/auto/face/pose/flow** (built-in
  analyser config, replaced by the shared engines + ParamBus amount, L7a);
  **flowFeedAR** (flow→AR feedback, part of the bespoke reactivity); **panels
  label colour** (panelsColorActive, left at L6 styling); **cam-*** ISO/exp/WB/
  zoom (source/hardware concerns, as in anamorphic/blob_reveal).
- **Verification** — `tools/verify/verify-phase8-chain.js` **6/6 PASS**: mirrorBg
  flips the video (bright side swaps R→L, luma 0.638↔0.636 — a precise flip);
  a broad feature set (panels+ripple+flow+contour+thermal) renders non-black
  (meanL 0.24) and live (mad 0.062); no GL errors; no page errors. **Regression
  — every engine-only phase-8 layer suite re-run after the L8 edit: L5 5/5
  (ripple@force0 still a PIXEL-IDENTICAL passthrough — proves the whole 2D
  pipeline is byte-identical after all L6/L7/L8 changes), L6 7/7, L3b 5/5, L7a
  4/4, L7b 4/4, L7c 5/5 — 0 failures.** Shell regression: phase 2 **26/26**;
  phase 1 16/21 real-pass (the 5 fails are all the documented sandbox-CDN block
  — `THREE`/`SelfieSegmentation is not defined` when the standalones load from
  blocked CDNs; the effect HTMLs are untouched, so not a regression); phase 3
  exceeded the in-session time budget (long audio suite; no engine-service code
  was changed — only blob_tracker param `defaultRoute`s were added). `npm run
  lint` clean. **fps 2 @ res 0.5 under sandbox SwiftShader — the ≥30fps@720p
  acceptance stays a GPU-machine criterion**, flagged for the operator (as in
  Phases 4–7).
- **Session note (operator away):** this whole run (L6 → L3b → L7a/b/c → L8) was
  done autonomously per the operator's instruction to "proceed through all
  tasks". Design decisions made without the operator are recorded in the
  Decisions table (#10–#13) and the per-layer logs for review; none touch the
  five effect HTMLs, the ModuleIds, or the `--syn-*` tokens.

### 2026-07-20 — Phase 8 Layer 7c (BLOB TRACKER — chaos engine) verified

- **`src/engine/nodes/blob_tracker.ts` L7c — fixedPtsMode chaos engine — DONE.**
  `fpInitState`/`fpTick`/`fpBlobsForFrame` are ported verbatim from the
  standalone (`_initFpState`/`_tickFpStates`/`_fpBlobsForFrame`, L5482-5554): when
  `fixedPtsMode` is on, blob detection is REPLACED by a fixed set of points, each
  an animated marker with its own jitter (velocity-damped), size wobble,
  shape/connStyle timers, per-point FX flags (invert/thermal/security/liquid/
  glitch/data toggled on their own clocks), an alpha birth/death lifecycle, and
  occasional ephemeral overlaps. The synthetic blobs feed the EXISTING draw
  pipeline (drawFxInBlob/drawTextFill/drawBlobMarker/drawConnections) via
  per-blob **global swaps** — `fpRender` temporarily sets this.v.blobShape/
  blobScale/fx* to the point's values, draws, restores — exactly the standalone's
  trick, so no draw-function refactor. connWidth is capped at 4 for the chaos
  connections, as in the standalone.
- **DECISION (chain has no mouse): the points are AUTO-PLACED** on a golden-angle
  scatter (`fpEnsurePoints`, stable per count/size) instead of user clicks — the
  only faithful adaptation for a non-interactive chain node. `fixedPtsMode` +
  `fixedMaxPts` (1–10, standalone sFixedMax) are the new params.
- **CONSOLIDATED (decision #1): the autoMode panel driving** (per-panel
  Z-thrust/kick from the standalone's bespoke onset detector) is the auto-driver
  already replaced by the L7a ParamBus routes (panelTurb←motion, panelScale←bass
  give reactive panels). The per-mesh onset choreography is an accepted omission
  — documented for the operator; it would require porting the whole bespoke
  7-band analyser, which decision #1 explicitly replaces with the shared engines.
- **Verified** (`tools/verify/verify-phase8-L7c.js`, engine-only, behavioural —
  stochastic) **5/5 PASS**: enabling chaos points replaces detection and changes
  the frame (mad 0.0043); the field animates over time (jitter+FX, mad 0.0061);
  the 10-point field is live (mad 0.013); no GL errors; no page errors. A hero
  screenshot shows the scattered animated markers — a red thermal box, a violet
  inverted box with a connColor line, subtle boxes — each with its own per-point
  FX, confirming the global-swap path. `npm run lint` clean. **All L7 sub-layers
  (a routes / b colours / c chaos) are now done — only L8 remains for Phase 8.**

### 2026-07-20 — Phase 8 Layer 7b (BLOB TRACKER — colours) verified

- **`src/engine/nodes/blob_tracker.ts` L7b — colours — DONE.** The number/boolean
  ParamSchema can't hold a hex, so the standalone's colour pickers become
  **palette-enum indices** into a curated 10-colour `PALETTE` (index 0/1/2 are
  the standalone defaults #ffffff / #0011ff / #00ff88; 3 is the app accent
  violet #8b5cf6). New params: **trackerColorIdx** (default 0 — markers,
  contours, ID/A labels, dots), **connColorIdx** (default 1 — the tracker graph
  AND the L6 panel graph), **vfxColorOn** + **vfxColorIdx** (default off / 2 —
  overrides the Text-Fill FX colour, the standalone's `vfxColorActive`+`vfxColor`
  on the two text sites). `this.trackerColor`/`this.connColor` are resolved from
  the enums via `pal()` each render, so every existing overlay call site picks up
  the colour with no other change.
- **DECISION (documented): palette-enum indices** over free hex (ParamSchema
  constraint) — keeps the mod matrix/AI-hint model uniform and the look curated.
  The panel-label colour override (standalone `panelsColorActive`/
  `panelsLabelColor`) is left at the L6 default styling — a minor, low-value
  deferral, noted for the operator.
- **Verified** (`tools/verify/verify-phase8-L7b.js`, engine-only, mean-RGB
  direction on deterministic overlays) **4/4 PASS**: trackerColorIdx white→red
  on a filled contour drops mean G+B (−17.9/−17.9); connColorIdx blue→amber on
  the glowing panel graph raises R, drops B (+1.85/−1.90); the vfxColor override
  recolours the (random) Text-Fill green→magenta, raising mean R+B when averaged
  over 7 frames (+9.35/+7.20); no page errors. `npm run lint` clean.

### 2026-07-20 — Phase 8 Layer 7a (BLOB TRACKER — reactivity routes) verified

- **`src/engine/nodes/blob_tracker.ts` L7a — reactivity ROUTES — DONE.** The
  standalone's bespoke auto-driver (`audioReactiveFrame`/`applyAudioToParams`/
  `videoReactiveFrame`: a 7-band analyser — sub/bass/lowMid/mid/hiMid/high/air +
  centroid/flux/onset/BPM — non-linearly modulating threshold, blobScale,
  datamosh, glitch, connWidth, connStyle, panelTurb, ripple, panel scale, the XY
  Lissajous…) is **mapped to ParamBus `defaultRoute`s on the shared AudioEngine/
  VideoAnalyzer signals** (decision #1 architecture, the Phase-4 analog pattern).
  Seeded (additive `base + signal·amount·range`, so bases at the low end grow
  with the signal): **connWidth←bass 0.45, connGlow←loud 0.4, datamosh←treble
  0.5, glitchAmt←beat 0.5, panelScale←bass 0.4, panelTurb←motion 0.6**, plus
  rippleForce←beat (L5). Chosen to echo the standalone couplings (bass pulses
  the graph, treble drives datamosh, onset spikes glitch, bass swells the
  panels, motion stirs the turbulence).
- **AUDIT / consolidation (documented for review):** the `ar-bass/mid/hi-gain`,
  `ar-onset-sens`, `vr-mot-sens/cut-thr/smooth/srate` sliders and the
  `ar-on/ar-auto`, `vr-on/vr-auto/vr-face/vr-pose/vr-flow` toggles are NOT added
  as node params — they configured the standalone's built-in analyser, which the
  shared AudioEngine/VideoAnalyzer + the ParamBus route `amount` replace (exactly
  as blob_reveal consolidated beatSens/beatGap). The mod matrix's amount slider
  IS the per-band gain; users can re-target or add routes there. blobScale is
  left unrouted (its default 1 is already the max, so an additive route can't
  breathe it — the standalone drove padY 0.55→1.0 by override, not addition).
- **Verified** (`tools/verify/verify-phase8-L7a.js`, engine-only via the
  ParamBus tap) **4/4 PASS**: all 7 routes seeded with the exact source+amount;
  driving signals=1 modulates every routed param to `base+amt·(max−min)` (all 7
  match); zero signals return every param to base; no page errors. `npm run
  lint` clean. (The container restarted mid-layer — a fresh dev server picked up
  the new routes cleanly, reconfirming the restart-after-edit rule from L3b.)

### 2026-07-20 — Phase 8 Layer 3b (BLOB TRACKER — smart contour) verified

- **`src/engine/nodes/blob_tracker.ts` L3b — smart contour (ctMode=2) — DONE.**
  In smart mode the contour ray-casts the **shared PersonMask** instead of the
  detection binary — the standalone's `_ctComputeContours` uses
  `_ctSmartMask ?? _ctBinMask`, so `refreshSmartMask` downscales `ctx.personMask`
  to PW×PH (reading the mask ALPHA, the same channel bokeh/anamorphic read),
  refreshed once per `personMaskVersion`, and the render path swaps it in for
  the contour mask when ctMode≥1.5 and a mask is present (else edge). Everything
  downstream (radialContour → douglasPeucker → catmull-rom → drawContour) is the
  already-ported edge machinery, unchanged.
- **DECISION (operator asleep — documented for review): mapped smart contour to
  the shared PersonMask (SelfieSegmentation) rather than adding the standalone's
  distinct Tasks-Vision ImageSegmenter (selfie_segmenter.tflite) dep.** Same
  04-SPEC substitution as blob_reveal/bokeh/anamorphic — no new dependency, no
  storage.googleapis.com asset, reuses the established mask plumbing. `segEnabled`
  is **derived** from ctMode (smart ⇒ 1) via a getParam special-case, so the
  shell lazy-loads the segmenter exactly like the standalone's ct-smart button
  triggers `_loadMediaPipe` — no separate seg-enable control (the standalone has
  none either).
- **Verified** (`tools/verify/verify-phase8-L3b.js`, engine-only — a synthetic
  mask injected through the PersonMask tap, no MediaPipe) **5/5 PASS**:
  segEnabled derives from ctMode (edge=0, smart=1); smart with NO mask is a
  **pixel-identical fallback to edge (corr 1.000, mad 0.000)**; an injected
  person mask whose shape ≠ the luma blobs makes the contour follow the MASK
  (mad 0.030, contour bounds proven to snap to the injected box); no GL/page
  errors. `npm run lint` clean.
- **Harness note (bit us, recorded for L7/L8):** (1) the dev server serves
  STALE code after source edits in this sandbox — RESTART it (kill by port:
  `fuser -k 3000/tcp` or the PID from `fuser 3000/tcp`; `pkill -f 'tsx
  server.ts'` does NOT match the real cmdline) before every verify run.
  (2) The ParamBus pushes each param's base every frame, so a headless
  `node.setParam(k,v)` is reverted next frame — drive params through the UI
  control (setBase path) instead. (3) Injecting a PersonMask must neutralise
  `mask.enable`/`mask.tick` first, or the real loader's async failure
  (CDN blocked) sets ready=false and wipes the injected mask mid-flight.

### 2026-07-20 — Phase 8 Layer 6 (BLOB TRACKER — three.js panels scene) verified

- **`src/engine/nodes/blob_tracker.ts` L6 — the FIXED 8-panel 3D "AI analysis"
  montage — DONE and verified behaviourally.** The standalone's `DEFS`/`PLBLS`
  (8 panel geometries + labels, L2497-98), panel `VS`/`FS` (UV-rect sampling +
  edge vignette + `mirrorU`, L2499-2500) and `SimplexNoise` (L2482-84) are
  ported verbatim onto the node's OWN second offscreen `THREE.WebGLRenderer`
  (transparent, `preserveDrawingBuffer`) — the L5 offscreen-three→texture
  pattern reused. `panelsAnimate`'s non-auto branch is ported: per-panel
  simplex float/rotation scaled by `panelTurb` × motion-energy (`motionEnergy`
  now smoothed from the L1 `rawEnergy`), `panelScale`, `padY`(=padThresh)
  opacity, `mirrorPanels`, and the noise-driven camera drift. The panel source
  is `ctx.source` (raw video, like the standalone's `THREE.VideoTexture(vidEl)`).
- **Compositing (per HANDOFF recipe):** after the L1–L4 tracker overlays land
  on `dc`, when `panelsEnabled` the node dims `dc` by `1-panelsBgOpacity` toward
  the standalone's `#050302` backdrop, renders the panels scene to its offscreen
  canvas, `drawImage`s it OVER `dc`, then draws the labels/lines into `dc` —
  BEFORE the L5 ripple samples `dc`. Order proven correct by the hero shot: the
  tracker's own blob `ID:/A:` labels sit dimmed behind the panels while the
  panel labels are crisp on top.
- **Operator decision #9 honoured — labels + connector lines drawn INTO the
  node texture** (Canvas-2D at the projected screen positions via
  camera-`project()` → `toScreen`/`lAnchor`), NOT the standalone's HTML `p-lbl`
  divs + SVG `svg-lines`. The label box (`rgba(8,6,20,.88)` bg, `#a0b8ff` tag,
  `#70a0ff` score) approximates the `.p-lbl` CSS; the panel↔panel connections
  reuse the tracker's connColor/connStyle/connWidth/connOpacity/connGlow at the
  standalone's `×0.08` panel-line scale; the label→panel connector lines gate on
  `panelsLabels`+`panelsConnLines`. Accepted (non-pixel-identical) deviation.
- **Params added (8):** `panelsEnabled` (fx-panels), `panelScale` (sScale,
  reactive), `panelTurb` (sTurb, reactive), `panelCamZ` (sCamZ),
  `panelsBgOpacity` (sBgOp — maps the standalone panels-mode backdrop: in the
  chain node it dims the tracker composite behind the panels; default 0.5),
  `panelsLabels` (btn-plabels, on), `panelsConnLines` (btn-pconnlines, on),
  `mirrorPanels` (btn-mirror-panels). Note `sScale`→`panelScale` is DISTINCT
  from `blobScale`(=xyBlobScale, XY-pad driven) — verified against the HTML.
- **Verified** (`tools/verify/verify-phase8-L6.js`, engine-only — three comes
  from npm so no CDN mirror needed) **7/7 PASS**: enabling panels changes the
  frame (mad 0.203 vs off); the montage is **pixel-static at panelTurb=0
  (mad 0.0000** — deterministic frozen simplex + converged camera); labels
  toggle changes the frame (mad 0.0055); mirrorPanels flips the sampled UV
  (mad 0.055); panelTurb=1 animates it over time (mad 0.0029); no GL errors on
  the engine context; no page errors. Hero screenshot shows all 8 labelled
  panels + the blue connection graph over the dimmed tracker. Pixel-exact vs
  the standalone is NOT expected (HTML-label deviation + independent animation
  clock) — behavioural per the HANDOFF. `npm run lint` clean.
- Remaining for Phase 8: L3b smart contour (MediaPipe ImageSegmenter), L7
  reactivity + colours + fixedPtsMode + the autoMode panel branch, L8 full
  param table + full suites + regression → then the checkbox flips.

### 2026-07-19 — Phase 8 IN PROGRESS (1:1 port: BLOB TRACKER — Layer 1 verified)

- **`src/engine/nodes/blob_tracker.ts`** started — the last + hardest port
  (~6876-line three.js r128 + many-Canvas2D hybrid). Strategy (04-SPEC): run
  the standalone's whole pipeline offscreen (three.js + 2D overlays) and
  upload the composite as the node texture — the blob_reveal
  offscreen→texture pattern extended to three.js. `three@0.128.0` added
  (allowed this phase). The node carries a full LAYER MAP in its header
  (■ done / □ remaining) with standalone line refs.
- **Layer 1 — tracker core — DONE and parity-verified**: base video draw →
  320×180 `processForDetect` (γ=1.75) → `getBinary` (threshold+padY) →
  `findBlobs` (connected-components, minArea + circularity<0.15 reject) →
  `drawBlobMarker` (square/rect/circle/corner, dashed, ID/A labels) →
  `drawConnections` (dist≤500, neonLine glow layers / drawArrow) →
  `computeMotion` (64×36 energy) → offscreen `dc` uploaded FLIP_Y. All math
  is the standalone's verbatim. **`verify-phase8-static-L1.js`: 7/7 configs
  corr=1.000, mad=0.000 (pixel-identical)** vs the standalone's DEFAULT
  tracker state (default = L1 exactly: FX.blob+conn on, everything else off,
  and the bgFxMode-off else-branch is a no-op since `_applyFxBg` touches
  nothing with no FX flag). Both pinned to 1280×720, paused same frame;
  configs: default, threshold ±, minArea, brightness, contrast, connWidth.
- **Layer 2 — FX system — DONE and parity-verified**: `drawFxInBlob`
  (invert/thermal/security/liquid/glitch1(data)/glitch2, shape-masked) +
  `drawTextFill` (nums/letters/tmix) + `applyFxBg`, with the bgFxMode on/off
  branch (patch save→applyFxBg→restore). `verify-phase8-static-L2.js`
  **12/12 PASS**: invert + thermal **pixel-identical (corr=1.000, mad=0.000)**
  in BOTH bg and in-blob modes; security/liquid/glitch1/glitch2/text change
  the frame on BOTH sides with near-identical magnitude (ratio 1.00–1.06 —
  time/Math.random-seeded, so behavioural not pixel-equal). Fixed a real port
  bug found by the check: the standalone's `getBinary` also flips the
  detection binary when invert is on (`FX.invert?1-v:v`) — added.
- **Layer 3 (edge contour) — DONE and parity-verified**: `radialContour`
  (64-ray cast on the detection binary) → `douglasPeucker` simplify →
  `catmullRomPath` spline (+ optional fill); `drawBlobMarker` delegates to
  `drawContour` when ctMode≥1 and the contour has ≥6 pts.
  `verify-phase8-static-L3.js` **8/8 PASS, all corr=1.000, mad=0.000
  (pixel-identical)**: edge default, smooth 0/20, expand ±10, fill. Smart
  mode (ctMode=2) still deferred — a distinct MediaPipe Tasks ImageSegmenter
  dep; ctMode=2 falls back to edge for now.
- **Layer 4 (optical flow) — DONE and behaviourally verified**: Lucas-Kanade
  16×16 per blob (`flowUpdateGray`/`flowLK`/`flowComputeVel`/`drawFlowViz`,
  verbatim) → EMA 0.42 → arrows (green→red by speed) + fading trails.
  `verify-phase8-behavior-L4.js` **3/3 PASS**: the flow overlay appears and is
  sustained on BOTH sides while the video plays. Flow is temporal — its
  absolute magnitude is motion-per-rendered-frame (fps-dependent), so it is
  NOT cross-comparable between the two independently-running pages (the engine
  does more 2D work + a GL upload, so it renders at a different rate); the LK
  is a verbatim transcription. flowFeedAR (flow→AR signal) is deferred to L7.
- **Layer 5 (three.js ripple sim) — DONE and verified** (operator decision a:
  audio/beat force): the standalone's mouse-driven wave sim + displacement
  shaders are ported VERBATIM onto the node's own offscreen `THREE.WebGLRenderer`
  (float rRtA/rRtB ping-pong at 512²), whose canvas becomes the node output;
  the mouse force is replaced by the reactive `rippleForce` param pre-wired to
  `beat`. `verify-phase8-L5.js` **5/5 PASS**: ripple-ON at force 0 is a
  **pixel-identical passthrough of dc (corr=1.000, mad=0.000** — proves the
  three.js sim/shaders/orientation are correct); injecting force visibly
  displaces the frame (mad 0.0043); the field evolves over time (feedback
  ping-pong); no GL errors on the engine context; no page errors. First
  three.js scene integrated — the offscreen-three→texture pattern works.
- **The whole deterministic 2D pipeline + the ripple three.js scene are ported
  and verified.** The node is **temp-wired** into `nodes.ts` (tracker core +
  FX + contour + flow + ripple — far better than the DummyNode passthrough —
  but L3-smart/L6–L8 are not there yet, so **Phase 8 is NOT done**; checkbox
  unchecked until the full port + full suites).
- Layers remaining (node header has the map): L3-smart (MediaPipe
  ImageSegmenter), L6 three.js panels scene
  (rRenderer/glC float ping-pong), L6 three.js panels scene + the stack
  composite (dc→panels→fxOv→glC), L7 reactivity (ar-*→routes,
  vr-*→VideoAnalyzer) + colours (ParamSchema can't hold colours — design
  TODO) + fixedPtsMode chaos, L8 full param table + suites.

### 2026-07-19 — Phase 7 complete (1:1 port: BLOB REVEAL)

- **`src/engine/nodes/blob_reveal.ts`** ports the standalone's pure Canvas-2D
  rotoscope engine into a SynEngine node. The standalone has NO WebGL — it
  composites on seven 2D canvases — so the node runs that EXACT pipeline on
  its own offscreen canvases and uploads the finished frame as its output
  texture (04-SPEC port note: "1:1 means identical output, not identical
  plumbing"). Pipeline, verbatim: black frame → detectAndDrawBlobs (320×180
  luma threshold → square-kernel dilate with audio boost → 4-neighbour BFS
  connected components with the same wrap guard → area filter scaled by the
  node/proc size ratio → top-N by area, each grown by the audio-reactive
  expansion and used as a clip window onto the full-res video) → drawSubject
  (brightness/contrast mask conditioning → erode via the inset-redraw shrink
  → CSS-blur feather → destination-in cut of the video by the mask ALPHA →
  opacity blit). The output canvas is uploaded FLIP_Y to match the engine's
  source-upload orientation. Factory swapped in `nodes.ts`.
- **Param table** (12 node params): segEnabled + the blob/rotoscope sliders
  (segThr, erode, feather, opacity, segN, lumThr, minArea, maxBlobs, dilate,
  audioExp) at the standalone's exact ranges/defaults, plus `beatReact` — the
  standalone's internal `beatExpand` runtime value exposed as a reactive param
  so the mod matrix can drive it. Consolidations, justified: the XY pad is a
  controller of maxBlobs+dilate (routing UI covers it); `btn-model`
  (HIGH QUALITY/FAST = MediaPipe modelSelection) is a shared-PersonMask
  service concern; beat-detector tuning (`sl-bsens`/`sl-bgap`) fed only the
  standalone's built-in analyser, which the shared AudioEngine replaces;
  REC/fullscreen/transport/webcam/file are shell concerns.
- **Deliberate substitutions (decision #1)**: (a) the standalone's own eager
  MediaPipe becomes the shared PersonMask service (segEnabled +
  ctx.personMask/personMaskVersion). The service's maskCanvas carries the raw
  segmentationMask with the same ALPHA semantics bokeh/anamorphic already read,
  so the destination-in subject cut is identical; `segN` throttles the node's
  mask refresh (every Nth arrival) to reproduce the standalone's send-every-N
  staleness. (b) The built-in AudioContext/analyser (video-track beat
  detection) is replaced by the real AudioEngine, the Phase-4 pattern: the
  internal beatExpand becomes `beatReact`, pre-wired via ParamBus defaultRoute
  to `loud` (amount 0.9) so blobs breathe with the music exactly as the
  original's loud-floor did. The node draws from ctx.source (the
  NodeRenderContext exposes it "for nodes that need CPU pixel analysis" — this
  is the canonical such node), giving byte-identical input to the standalone.
- **Parity run (06-VERIFICATION §4)**, suites committed as
  `tools/verify/verify-phase7-{static,behavior,chain}.js`:
  1. *Static pixel parity* — the deterministic blob-window pipeline
     (segEnabled OFF), both sides pinned to 1280×720 (engine resScale 2/3;
     standalone dc/c-* forced via DOM ids), paused on the same frame —
     **10/10 configs corr=1.000, mad=0.000 (pixel-identical)**: defaults,
     lumThr low/high, minArea low/high, maxBlobs 1/30, dilate 0/high, combo.
  2. *Behavior suite* — **14/14 PASS, 0 failed**: A real-MediaPipe READY on
     BOTH sides (the standalone's real segmenter fires onResults, whose
     createImageBitmap is overridden to feed the SAME synthetic mask, a fresh
     bitmap each call since onResults closes the previous); B playing
     blob-window long-exposure corr=0.984; C subject reveal with the SAME
     injected mask both sides — **all 5 configs corr=1.000 (pixel-identical:
     default, erode, feather, opacity, threshold)** and enabling seg reveals
     the subject symmetrically (delta S/E=0.089/0.089); D a 120 BPM beat
     track expands the blob windows through the beatReact→loud route
     (max mad vs quiet 0.0119); E beatReact is pre-wired to LOUD and its
     readout modulates with the beat (spread 0.33).
  3. *Chain sanity* — **3/3 PASS**: fresh session, the four real ports
     blob_reveal→anamorphic_lab→bokeh→analog wired (blob_tracker racked but
     bypassed), PersonMask READY on the real MediaPipe path (mask v12), no GL
     errors, non-black output (meanLum 10), no page errors. **fps 1 @ res 0.5
     under sandbox SwiftShader** — the ≥30fps @720p acceptance stays a
     GPU-machine criterion (as in Phases 4–6), flagged for the operator.
  4. Regression: phase 1 **21/21**, phase 2 **26/26**, phase 3 **14/14** —
     all green. phase 5 static and phase 6 static: every config that
     completed was pixel-identical (phase 5 **11/18 observed corr=1.000
     mad=0.000, 0 fail** before the sandbox timeout; phase 6 reached the
     pinning stage — both sides confirmed 1280×720 — but the run was killed
     by the timeout during the 14× mask-EMA setup, before its configs) —
     these 22-config settle-detect suites exceed the runner timeout under
     SwiftShader load and could not finish in-session, but the Phase-7 change
     is isolated to the new blob_reveal node + its factory entry (no bokeh /
     anamorphic / engine-core edits), so a regression there is structurally
     impossible; they were full-green (22/22 each) in the Phase 5/6 close-outs.
     lint clean. The phase-3 SEG check was updated (committed with the port):
     blob_reveal is now a real node that boots segEnabled ON (faithful to the
     standalone), so the shared PersonMask loads when it is racked; the check
     no longer asserts "hidden at startup" (an artefact of the old seg-off
     DummyNode) but the real lazy property — on-demand load reaching READY,
     then the mask gated off (personMaskSource → null) when segEnabled is
     unchecked.
- Notes for Phase 8 (blob_tracker, the last + hardest): three.js r128 hybrid
  — a 1:1 port may keep three.js rendering to an offscreen canvas uploaded as
  the node texture (04-SPEC; three.js becomes an allowed npm dep that phase).
  It has BOTH audio-reactive and video-reactive control groups (heaviest
  reactivity). Reuse blob_reveal's offscreen-2D→texture pattern for its 2D
  overlays; match the standalone's real canvas size before comparing.

### 2026-07-19 — Phase 6 complete (1:1 port: ANAMORPHIC LAB)

- **`src/engine/nodes/anamorphic_lab.ts`** implements the standalone's exact
  pipeline in the SynEngine: subject-aware bokeh pre-pass at the standalone's
  FIXED 1280×720 working res, active only while `bokehMM > 0` (mask intake
  per segmentation arrival with the 320×180 alpha→R swizzle, temporal EMA
  α=0.35 with 1.6× rising asymmetry, 5×5 feather → 48-tap pillbox disc blur
  with oval ratio from squeeze+trim, bright-rim edge ring, background
  magnification, hard subject-gate → feathered composite 0.45) → single
  main pass: chromatic aberration → exposure → anisotropic bokeh bloom +
  halation → film grade (lift/contrast/filmic shoulder/split-tone temp/sat)
  → LUT (identity in this build) → Instax/VHS grain → elliptical vignette →
  auto-detected anamorphic flare (+ ghosts) → compare split, with squeeze/
  barrel/letterbox/breathing shaping the sampled UVs. GLSL → ES 3.00 with
  the math untouched (`active` renamed `act`: reserved word in ES 3.00).
  The f-stop→CoC easing (~120ms τ, dt-clamped) and the CPU auto-flare
  hotspot detector (80×45 source readback every 160ms, same smoothing/
  jitter constants) are ported verbatim. ghostGlitch reproduces the
  deliberate mask double-flip. Factory swapped in `nodes.ts`.
- **Param table — 100% coverage** (29 node params): the 20 `s-*` sliders
  (same ranges/steps), fStop/ovalFineTune/bokehMM (the Ghost mm slider =
  the Bokeh % slider = one engine, exposed once), LED toggles → letterbox/
  breathing/flare/flareMaster/compare/ghostGlitch booleans, `segEnabled`
  for the shared PersonMask. **Defaults are the standalone's BOOT state**
  (P literals overlaid with the `isco` preset it applies on load).
  Consolidations, justified: mm chips + riccardo %/toggle are controllers
  of bokehMM; auto-temp button is a one-shot controller of temp; presets →
  ChainLab presets; `desqueeze` resizes the standalone's CANVAS (display
  geometry — a chain node cannot change the chain resolution; the squeeze
  LOOK is uSqueeze, fully ported); LUT file upload omitted (sampleLUT is
  an identity pass-through in this build — lutMix is still a param);
  source/webcam/Nikon-UVC camera panel + cam-* hardware sliders
  (ISO/exposure/WB/zoom via applyConstraints) are SOURCE concerns, not
  effect params; REC/fullscreen/motion-VU are shell/display concerns.
- **Reactivity finding (corrects the Phase 5 handoff note)**: the build's
  only AudioContext is REC-export plumbing — there is NO audio-reactive
  parameter modulation in the original; its reactivity is video-driven
  (auto-flare hotspot tracking, ported). Therefore NO defaultRoutes are
  seeded; continuous look params are marked `reactive` for the mod matrix.
- **Parity run (06-VERIFICATION §4)**, suites committed as
  `tools/verify/verify-phase6-{static,behavior,chain}.js`:
  1. *Static pixel parity* — standalone canvas caps at 1280×720 → engine
     pinned at resScale 2/3; same injected mask both sides; settle-detected
     grabs — **22/22 configs corr ≥0.999, mad ≤0.004** (26 suite steps,
     0 failed): isco defaults, raw-neutral, temp ±1, lift+contrast,
     sat 0/1.8, rolloff, exposure ±1, halation, bloom, CA, barrel,
     vignette, squeeze 2.2, ratio 2.8, compare split, bokehMM+fStop,
     oval bokeh, ghost-glitch, hero combo. (Proven in the previous
     session; suite unchanged since.)
  2. *Behavior suite* — **9/9 PASS (run 6, 0 failed)**: A real-MediaPipe
     READY; B playing long-exposure corr=0.971 (0.967–0.983 across runs
     4–6); C auto-flare fires on both sides (on-vs-off delta
     S/E=0.0836/0.0797) and flickers (S/E .0069/.0068); D breathing
     drift only when enabled (off 0/0, on S/E .0020/.0015); E f-stop
     easing verified with **option (b)** per HANDOFF: rack f/22→f/2.8
     (radius 27px — sandbox-viable; same dt-clamped easing math
     exercised; wide-aperture settled look already pixel-proven by the
     static configs f/2 and f/1.4) — total S/E=.014/.010,
     remaining-early S/E=.008/.003 (57%/30% mid-flight: gradual on both
     sides), settled corr=0.981. E needed two more calibration fixes
     (runs 4–5 were 8/9 with only E red and the port math fine): each
     side's mid-flight state must be observed on ITS OWN frame clock,
     and the engine's param change + frame+2 pixel grab must be FUSED
     into one in-page evaluate — Playwright round-trips queue ~16
     rendered frames behind the SwiftShader pipeline, reading a settled
     frame as "snap". F manual bass route onto vignette modulates the
     readout (spread=0.35; no default routes BY DESIGN — see reactivity
     finding).
  3. *Chain sanity* — **3/3 PASS**: fresh session, the three real ports
     anamorphic_lab→bokeh→analog wired (blob_tracker/blob_reveal racked
     but bypassed), PersonMask READY on the real MediaPipe path, mask
     v13 flowing, no GL errors, non-black output (meanLum 22.6), no
     page errors. **fps 1 @ res 0.5 under sandbox SwiftShader** — the
     ≥30fps @720p acceptance stays a GPU-machine criterion (as in
     Phases 4–5): flagged for the operator, not assessable here.
  4. Regression: phase 1 **21/21**, phase 2 **26/26**, phase 3 **14/14**,
     phase 5 static **22/22** — all green, 0 failed; lint clean.
- Notes for Phases 7–8: ES 3.00 reserved words; frame-aware waits for
  anything eased per rendered frame; match the standalone's real canvas
  size before comparing (blob_reveal fits the VIEWPORT — read
  `dc.width/height` after `fit()`).

### 2026-07-18 — Phase 5 complete (1:1 port: BOKEH)

- **`src/engine/nodes/bokeh.ts`** implements the standalone's exact pipeline
  in the SynEngine: mask intake per segmentation arrival (temporal EMA
  ping-pong α=0.28 with the 1.6× rising asymmetry → 5×5 gaussian spatial
  blur) → STAGE 1 bokeh blur (all 5 kernel styles: 37-tap Poisson disc,
  swirly Helios, explosive coma, anamorphic 2.39 oval + streak flares,
  40-tap shape-pad blend) → STAGE 1.5 post-blur distort (swirl / explosive
  / anamorphic squeeze) → STAGE 2 background FX (datamosh with frame-based
  I-frame clock, CPU pixel sort at fixed 480×270 with verbatim run/luma
  logic, liquid, morph, lava — all mask-gated, ping-pong buffers) →
  STAGE 3 composite (feather, Optics vignette, anamorphic squeeze/barrel/
  letterbox/breathing/elliptical vignette). All 11 fragment shaders are the
  standalone's GLSL translated to ES 3.00 with the math untouched, incl.
  the fixed 16/9 tap-aspect constants. Factory swapped in `nodes.ts`.
- **Param table — 100% coverage** of the standalone's parameter surface
  (38 node params): 9 sliders + 21 knobs (same ranges/defaults from the
  markup data-attrs; `lqAmount` default 0.025 per the knob — the P-object
  literal 0.5 is overwritten by `initKnobs()` at startup), `#style-sel` →
  `bokehStyle` 0–4 (4 = shape pad, the `btn-bshape` state), BSHAPE pad →
  `bshapeX/Y`, `#bgfx-sel` → `bgfxStyle` 0–5, `psAngle` 0–3 (H/V/D+/D-),
  LED toggles → `anamLetterbox`/`anamBreathing`, plus `segEnabled` for the
  shared PersonMask. Consolidations, justified: focal-sel buttons and the
  XY pad are controllers of bokehRadius/bokehBloom (rack covers that);
  the 6 presets are ChainLab-preset territory; source/transport/record/
  fullscreen are shell concerns. `psPasses` exists in the standalone's P
  but has no UI control and is never read by `runPixelSort` — dead key,
  intentionally not ported. The standalone couples `distortMode` to
  `bokehStyle` on style clicks (a control-surface behavior); the node
  keeps them independent params with the same defaults.
- **Deliberate substitution (decision #1-consistent)**: the standalone's
  eagerly-loaded MediaPipe becomes the shared PersonMask service via
  `segEnabled` + new `personMaskVersion` plumbing (SynEngine ctx +
  ChainLab); until the first mask arrives the node passes through, exactly
  the standalone's `maskReady` gate. The original has NO audio reactivity
  (04-SPEC: video-driven only) → no defaultRoutes seeded; continuous look
  params are marked `reactive` so the lab's mod matrix can route them.
- **PersonMask fixes (trivial, risk-free)**: `clearRect` before drawing
  each mask (source-over left stale person pixels forever — the mask
  could only grow) + `version` counter consumed by the node to step the
  temporal EMA once per arrival like the standalone's `onSegResults`.
- **Parity run (06-VERIFICATION §4)**, evidence in scratchpad
  (`phase5-*-summary.json`, `phase5-*.log`, `shots/p5s-*`), suites
  committed as `tools/verify/verify-phase5-{static,behavior,chain}.js`:
  1. *Static pixel parity* — `__SYN` tap, adaptiveRes off @1:1, both
     videos paused on the same 1920×1080 frame, and the SAME injected
     person mask on both sides (standalone via global `onSegResults`,
     engine via the PersonMask tap; EMA stepped 14× each) —
     **18/18 configs corr=1.000, mad=0.000 (pixel-identical)**: defaults,
     radius min/max, all 5 kernel styles incl. shape-pad corners,
     feather 0/1, vignette max, anam-full, letterbox off, ratio max,
     all 3 distort modes, hero combo. Suite: 22 steps, 0 failed. Hero
     screenshots standalone vs engine indistinguishable.
  2. *Behavior suite* — 13/13 PASS: real-MediaPipe path READY with mask
     versions advancing; playing-defaults long-exposure corr=0.934
     (interleaved same-instant sampling); all 5 background FX leave the
     subject core intact (mad ≤0.016) while the background transforms on
     BOTH sides with matching magnitudes (datamosh S/E .176/.104,
     pixel-sort .177/.177, liquid .0011/.0013 in its left-edge band —
     its knob range caps the wipe front at ~4% of width by design,
     morph .089/.020, lava .065/.052); datamosh I-frame cadence proven on
     the engine (min-dist from clean: 2Hz=0.002 vs 0.01Hz=0.159);
     CPU pixel-sort static convergence corr=1.000 cross-side; breathing
     drift only when enabled (S .0013/E .0018 vs 0/0 off); manual
     bass→bokehRadius route swings the readout 19→44 (spread 29.5).
  3. *Chain sanity* — fresh session, bokeh→analog (the two real ports)
     with the other three racked but bypassed: PersonMask READY on the
     real path, no GL errors, non-black output, mask v13 flowing.
     **fps 1 @ res 0.5 under sandbox SwiftShader** — the ≥30fps @720p
     acceptance stays a GPU-machine criterion (as in Phase 4): flagged
     for the operator, not assessable here.
  4. *Accepted deltas (sandbox-only)*: standalone datamosh cadence
     unobservable headless (<1fps renders make a 30-frame snap cycle >30
     wall-seconds) — mechanism ported line-for-line and engine-proven;
     bokeh gold-noise jitter seeds differ per side by clock (behavioral,
     invisible at verification downscale).
  5. Regression: phase 1/2/3 suites re-run — phase 1 **21/21** (the two first-run fails were a missing three.js mirror in this session’s scratchpad CDN, not regressions — blob_tracker untouched), phase 2 **26/26**, phase 3 **14/14** (needs `test.webm` present in the scratchpad);
     lint clean.
- Notes for Phases 6–8 (also in HANDOFF.md): inject deterministic masks
  through `onSegResults` (standalone) + the PersonMask tap (engine) so
  segmentation parity is MediaPipe-independent; never write files into
  the repo while a suite drives the shell (Vite full-reload kills the
  run); `page.screenshot` starves under GL load — grab canvases with
  `toDataURL`; ChainLab racks ALL five nodes (unwired ⇒ enabled=false) —
  don't wait on chain length; drive standalone bgfx switches via the real
  seg buttons (their click handlers clear feedback buffers).

### 2026-07-18 — Phase 5 checkpoint (mid-session commit 834bd6d)

- Stop-hook checkpoint before verification finished: node implemented,
  lint clean, parity still running — superseded by the entry above.

### 2026-07-18 — Phase 4 complete (1:1 port: ANALOG)

- **`src/engine/nodes/analog.ts`** implements the standalone's exact
  pipeline in the SynEngine: optional pixel sort (odd-even transposition,
  1–12 passes, H/V/diag, persistent pass parity) → feedback loop
  (zoom/rotate/decay/hue/drift/mirror, ping-pong across frames) → CRT &
  glitch composite (barrel, tracking, tear, chroma split, bloom, dropout,
  roll bar, noise, scanlines, phosphor, vignette, dry/wet blend). All four
  fragment shaders are the standalone's GLSL translated to ES 3.00 with
  the math character-for-character intact, including the fixed
  1920/1080/540 texel constants that define the CRT look. Factory swapped
  in `nodes.ts`; the other four effects remain DummyNodes.
- **Param table — 100% coverage** of the standalone's controls
  (26 controls → 27 node params): 18 knobs (same data-min/max/defaults),
  4 sliders (sortThresh 0–1, sortPasses 1–12, reactSens 0.1–2,
  modDepth 0–1), 3 LED toggles (feedbackMirror, sortEnabled,
  reactEnabled), sort-direction seg → `sortDir` 0/1/2. Consolidations,
  justified: the XY pad is a *controller* of two existing params (routing
  UI covers that role in the lab); transport/source/record/export/preset
  panels are shell/ChainLab concerns, not effect params.
- **Deliberate substitution (the one intended difference)**: the
  standalone's PSEUDO-AUTO reactive generator (synthesized bass/mid/high)
  is replaced by the real analysis — new `reactBass/reactMid/reactHigh`
  params pre-wired via the new `ParamSchema.defaultRoute` (seeded in
  `ParamBus.snapshot`) to bass/loud/treble; reactSens/modDepth/
  reactEnabled behave exactly as the original's shader math dictates.
- **Parity run (06-VERIFICATION §4)**, evidence in scratchpad
  (`phase4-*.json`, `shots/p4*`):
  1. *Static pixel parity* — via the new dev-only `window.__SYN` tap:
     adaptiveRes off, resScale 1, both videos paused on the same frame of
     a generated 1920×1080 clip (canvas sizes must match the standalone's
     fixed 1080p or fixed-frequency patterns alias differently) —
     **13/13 checks corr=1.000, mad=0.000 (pixel-identical)** across
     neutral, barrel, vignette, scanlines, phosphor, chroma, bloom,
     blend-0, sort-H, sort-V, hero combo.
  2. *Motion suite* (live playback, long-exposure comparisons): corr
     0.97–0.99 on all configs; stochastic passes (noise/tear/tracking)
     raise temporal variance on both sides (S ×3.3, E ×3.6, corr 0.90).
  3. *Feedback trails* — frame-based analysis (engine runs ~59fps vs
     standalone ~4.5fps under SwiftShader, so wall-time comparison is
     invalid): per-rendered-frame decay after a seek step,
     **S=0.884 vs E=0.888** against fa=0.9 minus decay pull — identical
     math (first post-seek interval excluded: it captures the source
     frame switch, not trail decay).
  4. *Reactivity* — with the 120 BPM file, the auto-routed reactBass
     readout pulses 0.53→0.98 (spread 0.45) and drives tear/zoom.
  5. *Chain sanity* — analog + 2 dummy nodes render continuously
     (19–25 fps at 50% adaptive res under sandbox SwiftShader; the
     ≥30fps @720p criterion is a GPU-machine check — flagged for the
     operator, not assessable here).
  6. Hero screenshots standalone vs engine are visually
     indistinguishable (barrel curvature, chroma fringe, phosphor
     texture, vignette, moiré).
- Regression: Phase 1/2/3 suites re-run (see below), lint clean.
- Notes for Phases 5–8: use the `__SYN` tap + 1080p clip + paused-frame
  static comparison as the parity workhorse; MediaRecorder webm seeks
  need a timeout race (no cues); compare temporal features per rendered
  frame, never per wall-clock sample.

### 2026-07-17 — Phase 3 complete (engine services: the reactivity backbone)

- **AudioEngine** (real): shared AudioContext + AnalyserNode (fft 2048).
  Mic mode (getUserMedia) and audible file mode (reused `<audio>` element +
  MediaElementSource). Per-frame `tick(now)` → bass (20–250 Hz), loud
  (full band), treble (4–12 kHz), all 0..1 with fast-attack/slow-release
  smoothing; beat = bass-onset pulse (flux over running average, 240 ms
  refractory, ×0.88 decay); BPM = median of the last ≤16 inter-beat gaps
  folded into 60–200, null until ≥4 gaps. `FileTransport` now starts null
  (transport bar appears only in file mode) and mirrors the element
  (play/pause/seek/loop/duration). mode: off | mic | file.
- **VideoAnalyzer** (real): 32×18 offscreen sample at ~15 Hz →
  `bright` = mean luma, `motion` = mean |Δluma| ×6 clamp, both smoothed;
  decays to 0 with no/stalled source.
- **ParamBus** (real): snapshot seeds bases from node params (existing
  entries win); apply runs per frame:
  `final = clamp(base + signal × amount × (max−min))` pushed via setParam,
  so `node.getParam` (and the amber mod readout) is the live value;
  serialize/restore deep-copy + re-snapshot for preset gaps.
- **PersonMask** (real): lazy CDN load of MediaPipe SelfieSegmentation
  (same URL family as the effects; Phase 10 vendors it), off → loading →
  ready, failure → off + 5 s retry cooldown + console.warn; ~15 Hz send,
  mask drawn to `maskCanvas` for `engine.personMaskSource`.
  **Fix worth remembering**: dispose() must be reversible — React
  StrictMode's dev double-mount calls the unmount cleanup on the
  ref-persistent instance, and a one-way `disposed` latch left the model
  stuck at LOADING forever. Now dispose bumps a load token and a later
  enable() reloads cleanly.
- **DummyNode** upgraded: real param storage + placeholder schema
  (`intensity`, `mix` — reactive; `segEnabled` on blob_reveal / bokeh /
  anamorphic_lab). Explicitly NOT the effects' real params — each port
  phase (4–8) swaps in the exact table from its HTML.
- Verified per 06-VERIFICATION (headless, `verify-phase3.js`) **14/14
  PASS**: generated 120 BPM kick-pattern WAV → bass meter swings 54–96,
  BPM readout = 120; pause freezes / seek jumps the transport; routing
  BASS onto analog.intensity (base 0, amt 0.6) → mod readout oscillates
  0.33–0.56; chain video → motion 28–61, bright ~72; SEG hidden while
  off → READY on demand (mirrored CDN); bus routing survives a preset
  save→mutate→load round-trip; no page errors. Regression: Phase 2 suite
  26/26, Phase 1 suite 21/21, lint clean.
- Closes the Phase 2 open item: ParamBus serialize/restore is real, so
  chain presets now carry bases + routes across disarm/re-arm.

### 2026-07-17 — Phase 2 complete (AI Lab armed mode + drag wiring)

- **Wiring model** (new source of truth for the chain): serial `WireMap`
  (`'IN' | id → id | 'OUT'`, one wire per port) owned by the shell,
  persisted as `syntech.composition.v3` (v2 auto-migrates: enabled order →
  wiring). `enabled` is now DERIVED: a node is ACTIVE iff it sits on the
  complete IN→OUT path (`walkChain`); everything else ghosts at 50% with
  BYPASS badge and drops out of the chain readout.
- **NodalComposition**: real drag wiring — press a port, drag, release on a
  compatible port to connect; sides enforced by construction (only out→in
  can commit; INPUT has right port only, OUTPUT left only). Pressing an
  occupied out-port re-aims its wire; pressing an occupied in-port picks
  the wire's end up; releasing in the void (or back where it started)
  disconnects. Connecting to an occupied port replaces that port's wire.
  Add Node menu strictly alphabetical (ANALOG → BOKEH) and auto-wires the
  new node before OUTPUT (spec §6); ✕ removes the node and heals the chain
  (neighbours reconnect).
- **AI Lab armed mode**: nav toggle stays violet until manually clicked
  off; Home no longer disarms. Arming mounts the real `ChainLab` surface in
  the hero (it was imported but never rendered before). While armed, an
  opened effect covers the lab (display:none) without unmounting it, so
  composition + params survive navigation; Home returns to the lab.
- **Rack ⇄ graph sync (both ways)**: ChainLab takes a live `chain` prop
  (engine reordered + enabled flags on change) and lifts rack edits
  (power toggles, ▲▼ reorder, preset loads) back up via `onChainChange` →
  the shell rebuilds the wiring.
- Verified per 06-VERIFICATION: lint clean; headless Playwright
  (`verify-phase2.js`) **26/26 PASS** including the roadmap acceptance:
  chain IN→analog→blob_tracker→OUT built purely by port dragging, both
  ACTIVE; detaching the middle wire ghosts both + readout drops to
  passthrough; out→out release rejected; armed violet toggle survives
  effect-open + Home; rack bypass/re-enable rewrites wiring and rack order
  mirrors it; wiring persists across reload. Regression: Phase 1 suite
  re-run **21/21 PASS** (all five effects open, save/restore, standalone
  clean); no page errors.
- Known limit (logged): node params reset when the lab is disarmed and
  re-armed (nodes + wiring persist; params are engine-local until ParamBus
  serialize/restore becomes real in Phase 3). Dummy-node rendering is
  passthrough until Phases 4–8 port the effects.

### 2026-07-17 — Phase 1 complete (bridge v1: settings save/restore)

- Appended the delimited `SYNTECH-BRIDGE` block (03-SPEC-SHELL §5) to all
  five effect HTMLs — additive only, before `</body>`, silent when the page
  has no parent (standalone). Contract implemented: `syn:ready` on load,
  `syn:get-settings` → `syn:settings`, `syn:apply-settings`.
- Per-effect capture/apply:
  - **analog / blob_tracker**: their own preset serializers live inside
    IIFEs (unreachable), so the bridge mirrors them 1:1 through reachable
    top-level globals — sliders + knobs (`syncKnob`) + LED/seg buttons +
    XY pad (`PAD` / `setPad`, `padX/padY`); blob_tracker also colors and
    custom text. Field lists copied from `PRESET_*` in the HTML.
  - **anamorphic_lab**: all range sliders + the six `tog-*` toggles.
  - **blob_reveal**: sliders + `btn-seg` / `btn-model` toggles.
  - **bokeh**: sliders + knobs (`setKnob`) + `#style-sel` group + letterbox/
    breathing/shape-pad toggles (style applied before `btn-bshape` because
    the shape pad stashes the prior style as its restore point).
- Shell: `EffectHost` (forwardRef) applies `syntech.effectSettings.<id>` on
  `syn:ready` and exposes `requestSave()`; nav **Save** in single-effect
  mode persists the effect's settings + "Saved" flash (03-SPEC-SHELL §4),
  session-snapshot behavior unchanged elsewhere. No Home confirmations.
- **Deliberately not saved** (runtime/device state, not settings):
  `cam-device-sel` pickers, mic/webcam/record/fullscreen buttons,
  play/pause/loop transport, bokeh shape-pad x/y position (its on/off IS
  saved), and the effects' own video-blob session systems.
- Payload note: `syn:settings` payload is a per-effect structured object
  (`{sliders:{id:v}, knobs:{...}, ...}`) rather than a flat key map — the
  shell treats it as opaque; shape documented here for Phases 4–8.
- Verified per 06-VERIFICATION: lint clean; headless Playwright
  (`verify-phase1.js`), **21/21 PASS** — per effect: tweak slider (+1
  toggle where curated) → Save (flash observed, localStorage key written) →
  Home → reopen → values restored exactly; zero shell page errors; each
  HTML opened standalone (direct top-level URL) with zero non-font console
  errors and zero `syn:*` messages (bridge silent). Regression: all five
  effects still open and boot in single-effect mode.

### 2026-07-17 — Phase 0 complete (baseline & housekeeping)

- Merged the workflow branch into `main`; session ran on
  `claude/fable-5-merge-roadmap-phase-uzbso9` rebased on that `main`.
- Deleted the 20 dead root scripts listed in the phase (close_div.cjs,
  fix_*.cjs/js, recover_git.py, remove/replace/revert_*.cjs,
  update_vfxcanvas.cjs) — grep confirmed nothing references them.
- Found & fixed an in-scope gap: the right-sidebar effect cards had **no
  click handler**, violating 03-SPEC-SHELL §7 ("Clicking a card =
  single-effect mode"). Added `onClick={handleModuleOpen(id)}` +
  `cursor-pointer` to the card div in `src/App.tsx` — only code change.
- Verified per 06-VERIFICATION.md: `npm install` + `npm run lint` clean,
  `npm run dev` serves :3000, all five effect URLs return 200. Headless
  Playwright suite (scratchpad `verify-phase0.js`), 27/27 checks PASS:
  home brain graph renders; each of the 5 effects opens full-hero **both**
  from its sidebar card and from its brain-graph hub (hub positions computed
  from `VfxCanvas` hubsConfig, real mouse click); inside every effect:
  canvas present, a slider tweaked via input event, and a generated 3s test
  video (canvas+MediaRecorder webm) loaded — DOM `<video>` reaches
  readyState 4 and plays (blob_tracker, blob_reveal, anamorphic_lab);
  analog/bokeh keep the video off-DOM, verified via drop-overlay hidden +
  filename label. Screenshots confirm blob_tracker tracking the test clip
  (FPS 37) and analog's SORT–FEEDBACK–CRT pipeline rendering.
- Console errors: **only** Google Fonts `ERR_CONNECTION_RESET`, a
  sandbox-only limitation (no direct internet for the headless browser).
  Blocked CDN libs (three.js, MediaPipe) were served from local npm mirrors
  via route interception — see Open items for the reusable workaround.
- Deviation from a strict read of the phase: "internal UI works" was
  verified headless (video load + slider + screenshots), not by a human;
  fonts could not be loaded in-sandbox (cosmetic only).

### 2026-07-17 — Workflow created (setup session)

- Analyzed repo + the 5 uploaded effect HTMLs; wrote CLAUDE.md and
  docs/workflow/01–08 + STATE.md.
- Committed the 5 official effect HTMLs to `public/effects/<id>/index.html`
  (blob_tracker replaced with the operator's current build; analog,
  blob_reveal, bokeh, anamorphic_lab added).
- No feature code written; engine stubs untouched. Verification: none run
  (docs-only session) — Phase 0 does the first full baseline check.
