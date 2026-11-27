# 12 — PREVIEW QUALITY (anteprima nitida e fluida, come Premiere)

> Richiesta dell'operatore, 2026-11-26: *"ho appena provato a usare l'effetto anamorphic … il mio
> video, oltre a perdere di qualità visiva sgranandosi, va anche a scatti … anche gli altri effetti
> hanno questo problema. La mia idea era quella di creare un programma come Adobe Premiere Pro, come
> After Effects. Io carico un video, lo modifico, però non deve perdere di qualità, non deve perdere FPS."*
> Decisioni (AskUserQuestion): anteprima **automatica** (come "Auto" di Premiere: nitida quanto lo
> schermo mostra, mai sopra il video); mascotte: **"animala solo se la tocco"**.

L'export (RENDER MP4, PNG/JPEG/PDF, Lab offline) è già nativo e fotogramma per fotogramma
(`10-EXPORT-MASTER.md`, `11-EXPORT-STILLS-LAB.md`). Questo documento riguarda **l'anteprima live**:
quello che l'operatore vede mentre lavora.

## 1. Cause (misurate leggendo il codice, prima di scrivere codice)

| # | Causa | Dove | Cosa vede l'operatore |
|---|---|---|---|
| 1 | **Risoluzione dell'anteprima sotto quella dello schermo**: ANAMORPHIC ≤ 1280 px; ANALOG / BOKEH / QUADTREE / TIME MACHINE fissi 1920×1080 (un 4K diventa 1080p); INVISIBLE ≤ 1920×1080; BLOB REVEAL / BLOB TRACKER in pixel CSS (metà su Retina). Il canvas viene poi ingrandito dal browser. | 8 effetti | "si sgrana" (anche la grana della pellicola diventa a blocchi) |
| 2 | **Formato sbagliato**: ANALOG / BOKEH / QUADTREE / TIME MACHINE disegnano sempre in un riquadro 16:9 → un video 9:16 viene stirato in anteprima (l'export invece è giusto). | 4 effetti | video verticale deformato |
| 3 | **Il video viene ricaricato sulla GPU a ogni giro dello schermo** (60 o 120 volte al secondo) anche quando il fotogramma non è cambiato (un 24 fps cambia 24 volte) e anche a video fermo. Solo INVISIBLE usava `requestVideoFrameCallback`. | 9 effetti | scatti, GPU sprecata |
| 4 | **Schermi a 120/144 Hz** (MacBook Pro ProMotion): tutti gli effetti disegnano 120 volte al secondo — doppio lavoro senza alcun guadagno per un video a 24–60 fps; gli effetti con stato per-fotogramma (feedback, scie) evolvono al doppio della velocità rispetto all'export (che riproduce ≈60 Hz). | tutti | scatti, look diverso dall'export |
| 5 | **LAB: catene di più nodi a 30 fps fissi** → un 24 fps esce irregolare (24 in 30), un 60 fps dimezzato; ogni nodo con la sua fase → fotogrammi doppi/saltati tra un nodo e l'altro. | LAB | scatti nella catena |
| 6 | La **mascotte 3D** si anima sempre a 30 fps sullo stesso thread degli effetti (gli iframe stessa-origine condividono il main thread della shell). | shell | un po' di potenza tolta all'anteprima |

## 2. Il design

### 2.1 Motore condiviso `public/effects/shared/syn-view.js` (`window.SynView`)

- `SynView.size(srcW, srcH, boxW, boxH)` → dimensione del canvas dell'anteprima = formato della
  sorgente adattato (contain) al riquadro CSS × `devicePixelRatio`, **mai sopra la sorgente**
  (= "Auto" di Premiere). Misurato: 1080p su Retina → 1920×1080; 4K in un riquadro largo 1250 CSS px
  → 2500×1406; 4K a schermo intero su 5K → 3840×2160; 9:16 → 790×1406 (verticale, non stirato).
- `SynView.fit(w, h, gl)` → riduce SOLO se la GPU non può disegnare quella dimensione.
- `SynView.watch(el, cb)` → ricalcola quando cambia il riquadro (finestra, schermo intero, Lab) o il
  `devicePixelRatio` (finestra spostata su un altro schermo), con debounce 150 ms.
- `SynView.frames(getVideo)` → `gate.fresh()`: carica il fotogramma sulla GPU **solo quando è nuovo**
  (`requestVideoFrameCallback`), una volta a video fermo, sempre durante export/SynFx; se il browser non
  consegna rVFC per quel video → come prima (mai un'immagine congelata). Misurato: video 24 fps su
  schermo 60 Hz → 48 caricamenti in 2 s (prima 120), 0 a video fermo; fps stimati 24,00.
- `SynView.capRefresh()` → su schermi > 75 Hz i callback rAF della pagina girano ogni n-esimo vsync
  (n intero): 120 Hz → 60, 144 → 72, 240 → 60; 90/100 Hz → tutti (60 sarebbe una cadenza 1-2
  irregolare); sorgente a 120 fps su 120 Hz → 120. A 60 Hz è un passaggio diretto. Si mette SOTTO il
  gate del Lab (`syn-lab.js`).

### 2.2 Ogni effetto: blocco delimitato `SYNTECH-PREVIEW` (quinta modifica permessa, 03-SPEC §5.4)

```
<!-- SYNTECH-PREVIEW-START (live preview quality; standalone-safe) -->
<script src="../shared/syn-view.js"></script>
<script> …adattatore: dimensione dell'anteprima, gate dei fotogrammi, capRefresh… </script>
<!-- SYNTECH-PREVIEW-END -->
```

subito dopo `SYNTECH-EXPORT-END`, più agganci di una riga marcati `/* SYNTECH-PREVIEW */` dove il
codice dell'effetto deve chiedere la dimensione o il gate. Regole:

- **Risoluzione** = `SynView.size(sorgente, area visibile)`, ottenuta **riusando il motore nativo
  dell'export di quell'effetto** (`sizeTo` / `resizeCanvasToVideo(true)` / `resizeTo` …): stessi
  FBO, stessa compensazione dei valori in pixel → l'anteprima ha il look dell'export, solo nitida.
  Il formato segue la sorgente (verticale = verticale), come l'export.
- Mai ridimensionare mentre un export / SynFx / REC live gira; dopo, si torna alla dimensione
  dell'anteprima ATTUALE (non più ai vecchi 1280 / 1920×1080).
- Il REC live (webcam / camera / immagine) registra almeno quello che registrava prima — di
  preferenza la risoluzione nativa della sorgente live.
- **Gate dei fotogrammi** su ogni caricamento del video (texImage2D / `VideoTexture.needsUpdate` /
  drawImage del video nei canvas 2D), mai sui caricamenti di immagini o nei percorsi export/SynFx.
- **capRefresh()** chiamato una volta.
- PAINTING (già a risoluzione schermo × DPR) e POINTCLOUD (già riquadro × DPR): solo gate +
  capRefresh; la loro risoluzione non cambia (cambiarla sposterebbe il look delle pennellate / dei punti).
- Valori del look misurati in pixel, tenuti uguali a qualunque dimensione dell'anteprima: BOKEH
  `PREVREF` (1920 px sul lato lungo, nel formato della sorgente — vale anche per l'export: per le sorgenti
  non 16:9 sfocatura / maschera / datamosh ora sono rotondi invece che stirati, il 16:9 è identico);
  ANALOG pixel sort = numero di passate × lato lungo / 1920 (solo in anteprima); QUADTREE bordo × H/1080;
  BLOB REVEAL parametri ×k (come l'export); BLOB TRACKER HUD disegnato con `setTransform(k)` (stesse
  dimensioni sullo schermo) — solo nei modi in cui ogni disegno passa da lì; nei modi a pixel (INVERT,
  THERMAL, SECURITY, LIQUID, GLITCH, FIXED PTS, RIPPLE, PANELS) resta alla risoluzione di prima, e
  l'uscita verso il Lab ha comunque una dimensione costante (cambiare modo non resetta i nodi a valle).
- INVISIBLE: un ridimensionamento del riquadro (finestra, schermo intero, Lab) copia il clean plate
  catturato nella nuova dimensione (blit) — non lo perde mai.

### 2.3 LAB

- Budget dei nodi = **fps della sorgente** (file: `SynExport.probeFps`; webcam: fps della traccia;
  foto: 30), tra 24 e 60 con più nodi, invece di 30 fissi; un nodo solo resta nativo. La presa
  REC in tempo reale (webcam / foto) registra alla stessa cadenza e, per tutta la sua durata, ogni nodo
  disegna alla risoluzione NATIVA della sorgente (area del pannello = nativa / DPR), poi torna allo stage.
- Con un budget del Lab attivo `SynView.capRefresh` si fa da parte (`window.__synLabBudget`): il ritmo
  lo dà solo il gate condiviso, così i nodi non finiscono su vsync alterni a 120 Hz.
- Il gate di `syn-lab.js` scatta su **slot di tempo assoluti** (`performance.timeOrigin + t`), uguali
  in tutti gli iframe → tutti i nodi disegnano nello stesso vsync, nessun doppione tra nodi.
- Ogni nodo è nitido grazie a 2.2 (il suo riquadro = lo stage del Lab).

### 2.4 Shell

- Mascotte: ferma (nessun loop) finché non la si tocca; anima a piena velocità durante l'interazione
  e mentre si assesta, poi si ferma di nuovo.

## 3. Criteri di accettazione

- Per ognuno degli 8 effetti con limite: video 1080p e 4K, viewport 1600×1000 a DPR 2 → canvas
  = `SynView.size` (1080p → 1920×1080; 4K → larghezza = riquadro × 2), verticale non stirato;
  look invariato rispetto a prima a parità di dimensione (screenshot confrontati).
- Caricamenti del video al secondo = fotogrammi del video al secondo (± 1), 0 a video fermo.
- Export (RENDER MP4, PNG/JPEG/PDF, Lab offline), REC live, Save/restore, Lab: invariati
  (test esistenti: `verify-export-master.cjs`, `verify-lab-chain.cjs`).
- LAB: catena di 2 nodi con un 24 fps → nodi a 24, stesso slot; con un 60 fps → 60.
- `npm run lint` pulito, `npm run build` ok, revisione Opus PASS.

## 4. Limiti onesti

Il container non ha una GPU vera (WebGL software, 0,1–3 fps): qui si misurano le CAUSE (pixel,
caricamenti, cadenza, blocchi del main thread), non gli fps reali. La fluidità vera si prova sul Mac
dell'operatore.
