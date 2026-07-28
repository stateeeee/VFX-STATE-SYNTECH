# HANDOFF — continua esattamente da qui

> **Riscritto 2026-07-28**, a fine sessione `claude/ui-app-update-pmjxcf`.
> Leggi PRIMA `CLAUDE.md` e `docs/workflow/STATE.md`, poi questo, poi
> `CODEX_WORKFLOW.md` (vincolante: è il processo che l'operatore impone).
>
> L'operatore parla **italiano**; documenti e commenti nel repo restano in
> **inglese**.

---

## 1. Dove sei, in una riga

**Fasi 0–10 complete e verificate** (i cinque effetti sono port 1:1 su
SynEngine, l'export Master MP4 di ChainLab funziona end-to-end).

**La UI è tornata esattamente com'era prima della sessione del 27–28 luglio.**
Tutto il lavoro estetico di quelle due giornate è stato **annullato su richiesta
esplicita dell'operatore** ("non mi piace il risultato, torniamo a quando l'UI
era come nella foto"). Restano solo i documenti di analisi e il workflow. Il
branch è mergiato in `main`.

## 2. Cosa vede l'operatore adesso (stato corrente = il suo screenshot approvato)

- Sfondo: la **lastra gel procedurale** violetto→oro (`.syn-bg-layer` in
  `src/index.css`) con il tile di bolle disegnato a canvas
  (`src/lib/gelTexture.ts`) e 28 bolle CSS che salgono. Cadenza brand 6s
  condivisa da slab, logo e wordmark.
- Logo in alto a sinistra: **ricolorato** dalla rampa violetto→oro mascherata +
  blend `luminosity` (`.syn-logo-color` / `.syn-logo-shade`), 44px.
- Wordmark hero a `top-7 left-8`.
- Cornice `p-4`, solchi `gap-4`, pannelli `rounded-2xl` con hairline
  `border-ink-700/60`.
- Nessuna roccia, nessun clip-path, nessuna texture fotografica.

Verifiche verdi su questo stato: **gel 32/32**, brand 13/13, search 6/6,
covers 7/7, phase 2 26/26, phase 3 14/14 (BPM 124), lint + build puliti.

## 3. Cosa NON esiste più nel codice (cancellato nel revert)

`src/components/GelCrust.tsx`, `src/components/PanelClips.tsx`,
`src/lib/stoneMontage.ts`, `src/lib/panelClips.ts`,
`public/assets/bg-texture.jpg`.

Recuperabili se servono: `git show 02a6922:src/lib/stoneMontage.ts` ecc.
Il commit `02a6922` è l'ultimo stato completo "roccia + clip-path".

## 4. Cosa resta, ed è la parte di valore

| File | Contenuto |
|---|---|
| `CODEX_WORKFLOW.md` | **Il processo imposto dall'operatore.** Vincolante. |
| `ANALISI.md` | Inventario componenti/CSS/layout, superfici modificabili, rischi |
| `DESIGN_ANALYSIS.md` | App vs reference: i sei gap misurati, in ordine di priorità |
| `IMPLEMENTATION_PLAN.md` | Piano in 7 commit (descrive il lavoro poi annullato) |
| `docs/design/textures/` | Le due texture dell'operatore, sorgenti intatte |

## 5. Le regole dell'operatore, in ordine di importanza

1. **RESTYLE, non redesign.** Mai toccare logica React/TS, stato, routing,
   canvas, shader, WebGL, audio, API, struttura cartelle. Solo CSS, Tailwind,
   token, ombre, gradienti, overlay, SVG decorativi.
2. **Processo obbligatorio**: analisi → confronto immagini → piano → *attesa
   approvazione* → implementazione **una sezione per commit**. Ha detto "vai"
   una volta sola, per un piano già approvato; **di default si aspetta**.
3. **Priorità estetiche in ordine**: 1 materiale, 2 illuminazione, 3 profondità,
   4 forme, 5 texture, 6 colori. *La texture è quasi l'ultima cosa.*
4. Ragiona da **Art Director**, non da programmatore.
5. Le sezioni restano **nere opache** (ha scelto esplicitamente l'opzione 2
   quando gli è stato chiesto se renderle traslucide).

## 6. Cosa ho imparato, e che ti risparmia giorni

Fatti misurati in sessione, non opinioni.

### Sul materiale (se si riproverà la roccia)

- **Larghezza della cresta e dimensione delle perle NON devono essere lo stesso
  numero.** Scalare la patch perché la sua altezza diventi la larghezza della
  cresta schiaccia una finestra da 96px dentro 34px e riduce ogni perla a 3–6px:
  il materiale legge come ghiaia. Vanno separati (patch a scala reale, alfa
  stretta sulla banda).
- **I flip verticali distruggono l'illuminazione**: la luce è cotta nella
  texture, capovolgere mette le crown speculari sotto le perle.
- **I ritagli vanno scelti misurando** (energia dei bordi a piccola scala contro
  saturazione), non a occhio: a occhio si pescano membrane lisce.
- **Un'ombra portata su pannelli `#000` è un no-op.** Il volume lo dà lo shading
  di forma, applicato `source-atop` **per stampa** — un gradiente a piastrelle
  disegna una riga netta attraverso tutto lo schermo.
- Le stampe si sovrappongono ~3×: qualunque alfa imposti arriva **triplicata**.

### Sul costo per frame (contratto reale, non teorico)

- `AudioEngine` stima il BPM leggendo il flusso spettrale **tra i frame**:
  qualunque cosa costosa sopra il canvas dell'hero si legge come tempo più
  veloce. Misurato: 189 BPM con un blur a schermo intero, 171 con quattro layer
  in blend, 138 con uno, 124 con nessuno. Target 120.
- **Un'ombra `inset` sul guscio dell'hero costa frame** (124 → 138). Su tutti
  gli altri pannelli non costa nulla.
- La stima **sotto SwiftShader è rumorosa**: tre run senza alcun overlay hanno
  dato 120 / 144 / 129. Non attribuire una regressione a una modifica senza
  misurare la baseline nello stesso momento.

### Trappole di piattaforma

- **`position: fixed` crea uno stacking context in Chrome**: lo z-index dei figli
  si risolve *dentro* il wrapper. Un wrapper con `z-index: auto` fa dipingere
  tutto in ordine di DOM (sintomo: il layer sembra "sotto" e schiacciato).
- **`visibility: hidden` su un `<svg>` che porta solo `<defs>`** eredita nel
  contenuto della maschera: la maschera va a luminanza zero e tutto ciò che la
  referenzia sparisce. Usare 0×0, non `visibility`.
- **`clip-path` non cambia il box dell'elemento** (verificato: hero 1026×506,
  canvas 1024×504, buffer coerente) e **ritaglia anche l'hit testing** in Chrome.
- Nell'annotazione dell'operatore **anche le scritte e le frecce sono rosse**: in
  un flood-fill fanno da muro e mordono tacche nei contorni. Scartare le
  componenti rosse compatte (diagonale < 200px).
- Il contorno rosso del **rail sinistro è aperto** nell'annotazione: non c'è
  nulla di chiuso da tracciare. Va chiesto all'operatore di chiuderlo.

### Harness (ti fa perdere 20 minuti se non lo sai)

- Gli script in `tools/verify/*.js` sono **CommonJS** ma `package.json` è
  `"type": "module"` → `require is not defined`. Copiali in `<scratch>/x.cjs` ed
  esegui quelli: `NODE_PATH=/opt/node22/lib/node_modules node <scratch>/x.cjs`.
- `verify-phase3` richiede `beat120.wav` e `test.webm` nella sua dir
  `__SCRATCH__`: generali con `tools/verify/make-beat-wav.js` e
  `tools/verify/gen1080.js` (sostituendo il placeholder `__SCRATCH__`).
- Playwright non è dipendenza del progetto: `NODE_PATH=/opt/node22/lib/node_modules`,
  chromium in `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- **Riavvia sempre `npm run dev`** dopo aver modificato i sorgenti, prima di
  fare screenshot.

## 7. Il prossimo passo, se l'operatore riapre il tema estetico

Non ripartire dal codice. Riparti dal **processo**: `CODEX_WORKFLOW.md` STEP 2
(confronto immagini) con lo screenshot attuale e la sua reference, e **fermati**
a far approvare il piano.

Il fallimento di questa sessione non è stato tecnico: sono state prodotte cinque
versioni estetiche diverse senza che l'operatore approvasse una direzione, ed è
finita con un revert completo. Le verifiche erano verdi a ogni passo; non è
questo che misura il successo qui.

Se riparte la roccia: chiedi **prima** se vuole roccia (materiale sopra i
pannelli) o container sagomati (clip-path). Ha chiesto entrambe le cose in
giorni diversi e sono incompatibili fra loro.

## 8. Voci ancora aperte da prima di questa sessione

1. **5 cover degli effetti** — l'operatore le sta finendo. Wiring già pronto:
   basta mettere il file in `public/assets/covers/<ModuleId>.{webp,png,jpg}`
   (ModuleId: `analog`, `anamorphic_lab`, `blob_reveal`, `blob_tracker`,
   `bokeh`) e la card lo mostra sotto uno scrim, senza modifiche al codice.
2. **Pass performance ≥30fps@720p** — va fatto sulla SUA macchina con GPU (sotto
   sandbox SwiftShader gira a 1–2fps, non è valutabile). È self-service: AI Lab →
   catena a 5 effetti → clip 720p → leggere i badge FPS / RES%. L'engine fa già
   adaptive-res: RES% sotto 100 (ambra) È la condizione di accettazione, insieme
   a fps ≥ 30. **Ha chiesto esplicitamente di essere ricordato.**
