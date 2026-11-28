# 13 — PANNELLO EXPORT UNICO · PNG TRASPARENTE VERO · MP4 DA FOTO · LED SINCRONIZZATI

> Richiesta dell'operatore, 2026-11-28: *"in tutti gli effetti sia nel pannello di destra sia nel lab
> se importo una foto l'export deve essere anche png veramente con sfondo trasparente, jpeg con
> qualità più alta possibile e pdf senza perdita di qualità … se importo un file 1920x1080 ad esempio
> con un logo in png e applico un effetto, nell'export se seleziono png devo avere la mia foto senza
> sfondo"*. Decisioni prese con screenshot e mockup (AskUserQuestion, 4 giri) — vedi §6.
> Estende `10-EXPORT-MASTER.md` (motore MP4) e `11-EXPORT-STILLS-LAB.md` (motore foto).

## 1. Cosa c'era (misurato il 2026-11-28, prima del codice)

| # | Problema | Dove |
|---|---|---|
| 1 | PNG / JPEG / PDF esistono già (sessione 2026-11-23), ma l'alpha del PNG è **la sagoma della foto originale**: dove l'effetto sposta / rimpicciolisce / sfoca il logo restano zone **nere** dentro la sagoma (luna nera in ANALOG / ANAMORPHIC, logo tutto nero in POINTCLOUD, disco nero in BLOB REVEAL e nel Lab); bagliori, HUD e punti fuori sagoma vengono tagliati. | 10 effetti + Lab |
| 2 | Con una foto **RENDER MP4** dice "needs a video file"; c'è solo il REC in tempo reale (Lab: 10 s in tempo reale). | 10 effetti + Lab |
| 3 | Pannelli Export **tutti diversi** (PAINTING / POINTCLOUD a righe, gli altri a blocchi), scritte lunghe, MASTER/HIGH incomprensibili, bottoni con opacità diverse; nel Lab la riga export è nascosta sotto LABORATORY (bisogna scorrere). | 10 effetti + Lab |
| 4 | **MP4 "MASTER"**: in questo Chromium (OpenH264) il bitrate richiesto viene ignorato oltre ~12 Mbps a 1080p30: MASTER e HIGH escono identici. Nessun encoder del browser fa H.264/HEVC lossless (modo `quantizer` non supportato per AVC/HEVC; HEVC assente qui). Il tetto vero di qualsiasi MP4 del browser è il colore 4:2:0 8 bit. | `syn-export.js` |
| 5 | LED dei blocchi del Lab, riquadro del video e linea orizzontale sotto il titolo: **non sincronizzati** (ogni elemento parte quando viene montato; palette diverse: LED violet/cyan/pink/amber, riquadro e linea iri amber/blu/viola/rosa; la linea è un gradiente arcobaleno che scorre). | Lab + 10 effetti |
| 6 | Lab: una foto 4:3 appare **schiacciata** in 16:9 nell'anteprima. PAINTING: in anteprima la foto viene **tagliata** in 16:9 (l'export era già intero). | Lab, PAINTING |

## 2. Il pannello EXPORT (identico ovunque)

```
EXPORT
  QUALITY   ━━━━━━━━━━━━━━━━●  100        (0–100, default 100, ricordato: localStorage syntech.export.q)
  FOTO      [ PNG ] [ JPEG ] [ PDF ]
  VIDEO     [ REC SCREEN ] [ EXPORT MP4 ]
```

- **Nessuna scritta** sotto il cursore né sotto i bottoni; niente pallino rosso. L'avanzamento sta
  **dentro il bottone acceso** ("■ STOP 42%", "■ STOP 0:12", "WRITING…"); esito ed errori nel toast
  dell'effetto. Tutti i bottoni hanno lo stesso aspetto "spento" dei bottoni a segmenti dell'app
  (`.seg-btn` negli effetti, `.fxl-seg` nel Lab) e si **accendono** (`.on`) mentre il loro export gira.
- **Effetti**: costruito da `public/effects/shared/syn-panel.js` (`window.SynPanel`) dentro la sezione
  Export esistente (gli elementi vecchi restano nel DOM, nascosti, perché il JS dell'effetto li legge).
- **Lab**: dentro LABORATORY restano SAVE / OPEN / RESET; da EXPORT VFX CHAIN in giù tutto è
  sostituito da questo pannello. Visibile senza scorrere.

### 2.1 QUALITY

| Uscita | 0 → 100 | A 100 |
|---|---|---|
| PNG | nessun effetto (sempre lossless) | lossless, alpha vera |
| PDF | nessun effetto (sempre lossless, Flate + SMask) | lossless |
| JPEG | qualità `toBlob` 0,05 → 1,0 | q 1,0 = 4:4:4, quantizzazione 1 (il massimo del formato) |
| MP4 (EXPORT e REC SCREEN) | bit per pixel crescenti | il **bitrate più alto che l'encoder di questa macchina accetta** per W×H@fps (si prova dall'alto, fino al livello H.264 6.2); verificato misurando la differenza dall'originale contro il tetto del formato (conversione 4:2:0 senza compressione) |

H.265: a 100 non darebbe più qualità (il limite è 4:2:0 8 bit, uguale in H.264 e H.265); dà solo file
più piccoli a pari qualità e qui non esiste. Resta H.264 (Premiere lo legge ovunque).

### 2.2 FOTO — PNG · JPEG · PDF

- Sorgente **foto**: come oggi (risoluzione nativa, `SynFx` in modo `still`) + alpha vera (§3).
- Sorgente **video**: salva il **fotogramma corrente** alla risoluzione nativa del video (stesso
  percorso `SynFx` still; opaco).
- Webcam: il fotogramma corrente della camera (stesso percorso).

### 2.3 VIDEO

- **REC SCREEN** = registrazione in **tempo reale** di quello che si vede (anche con un file video, dal
  punto in cui si trova, il video suona): si muovono i parametri mentre registra; ri-clic = stop e
  salva. Audio: quello che sta suonando (video / mic / traccia) quando c'è.
- **EXPORT MP4**
  - video file → render offline fotogramma per fotogramma (come oggi);
  - **foto** → **foto animata offline**, fotogramma per fotogramma, risoluzione nativa, **30 fps**:
    clic = parte, ri-clic = finisce (durata = tempo tra i due clic; se il computer è più lento del
    tempo reale completa i fotogrammi mancanti dopo lo stop). **Lab con una TRACK caricata**: dura
    quanto la traccia, audio-reattivo (analisi offline della traccia) e con l'audio nel file; ri-clic =
    finisce prima e salva;
  - webcam → come REC SCREEN (una sorgente live non si può rileggere).

## 3. PNG con trasparenza vera (contratto `SynFx` v2)

Obiettivo: **il logo con l'effetto, sfondo trasparente, niente nero**; bagliori, punti, HUD e sfocature
che escono dal logo restano, semitrasparenti.

Per ogni fotogramma still (e per ogni nodo del Lab):
1. **C** = `SynFx.frame(src)` come oggi: l'effetto sulla foto appoggiata sul nero (premoltiplicata).
2. **M** = alpha geometrica: `SynFx.matte(alphaSrc, i, t)` (NUOVO, facoltativo) con `alphaSrc` = canvas
   delle stesse dimensioni di `src`, RGB = alpha della sorgente, opaco. L'effetto lo disegna con **la
   stessa geometria dell'ultima `frame()`** (stesse deformazioni, posizioni dei punti, ritaglio,
   letterbox, sfocatura, blocchi) e con colore / grana / luce aggiunta **spenti**; il canale R
   dell'uscita è M. Se l'effetto non ha `matte`: M = alpha della sorgente (con `alphaRect`) come oggi.
3. **U** = luce aggiunta dall'effetto fuori dalla sagoma: `U = maxRGB(C)` sopra una soglia di rumore
   (≈ 6/255) — come "Unmult" di After Effects. `frame()` può restituire `unmult:false` per spegnerlo
   (es. un effetto che dipinge uno sfondo proprio).
4. **A = max(M, U)**; colore = C / A (de-premoltiplicato). Foto senza trasparenza → PNG RGB come oggi.

Lab: ogni nodo riceve l'uscita del precedente come immagine premoltiplicata + alpha (A del nodo prima)
→ la trasparenza passa lungo la catena.

## 4. LED sincronizzati e sfumati

- Una sola palette (quella dei LED della shell, `--syn-led-1..4`: violet → cyan → pink → amber) per
  LED dei blocchi del Lab, riquadro del video, angoli del riquadro e **linea orizzontale sotto il
  titolo** (non più un gradiente arcobaleno che scorre: lo stesso colore che sfuma, con bagliore).
- Stesso periodo (6 s), interpolazione continua (sfuma, mai salti).
- **Stessa fase ovunque**: ogni animazione LED viene agganciata all'orologio di parete
  (`startTime = timeline.currentTime − (Date.now() mod 6000)`), all'avvio, a ogni `animationstart` e
  quando un blocco si riapre → shell, Lab e ogni iframe degli effetti (anche aperti dalla colonna di
  destra) mostrano lo stesso colore nello stesso istante. Negli effetti: `syn-chrome.css/js`.
- Tema giorno: invariato (dove il giorno spegne l'animazione resta spenta).

## 5. Lavoro e modelli (orchestratore + Sonnet/Haiku, revisione Opus)

| Compito | Modello | File |
|---|---|---|
| Audit: sezione Export di ogni effetto, adattatori SynStill/SynExport, cause anteprima Lab/PAINTING | Haiku | — |
| Motori condivisi: QUALITY numerica, EXPORT MP4 da foto (start/stop, traccia), REC SCREEN sempre live, foto dal fotogramma corrente, alpha A = max(M,U), `SynPanel`; ANALOG come riferimento | Opus (architect) | `syn-export.js`, `syn-still.js`, `syn-panel.js` (nuovo), `analog/index.html` |
| LED: palette unica, sfumatura, aggancio all'orologio | Sonnet | `chainLab.css`, `index.css`, `syn-chrome.css`, `syn-chrome.js`, piccolo hook nella shell |
| `SynPanel` + `SynFx.matte` negli altri 9 effetti (4 gruppi) + PAINTING anteprima intera | Sonnet ×4 | HTML degli effetti (solo blocchi delimitati) |
| Lab: pannello in LABORATORY, alpha lungo la catena, foto animata (TRACK), REC SCREEN, anteprima non schiacciata | Sonnet | `ChainLab.tsx`, `src/lab/offline.ts` |
| Verifiche (PNG alpha, PSNR MP4, start/stop, LED in fase) | Haiku | scratchpad |
| Controllo di ogni consegna + revisione finale | orchestratore + `syn-reviewer` (Opus) | — |

Regole: modifiche agli HTML solo nei blocchi `SYNTECH-EXPORT` / hook `/* SYNTECH-EXPORT */` (§5.3) e
`SYNTECH-UNIFORM` per la sezione Export; nessuna dipendenza nuova; `npm run lint` pulito.

## 6. Decisioni dell'operatore (2026-11-28)

- PNG: "devo avere la mia foto senza sfondo" → §3.
- Pannello: la versione "video" del mockup, **senza scritte**, REC SCREEN **senza pallino rosso**,
  ordine QUALITY → FOTO → VIDEO, uguale in tutti gli effetti; bottoni con la stessa opacità "spenta"
  degli altri bottoni dell'app, accesi durante l'export.
- MASTER / HIGH → sostituiti dal cursore QUALITY; a 100 "il massimo che un MP4 può dare, verificato".
- Lab: il pannello **dentro LABORATORY** (SAVE / OPEN / RESET restano sopra).
- MP4 da foto: durata = TRACK se caricata, altrimenti "schiaccia per iniziare, rischiaccia per finire".
- Con un video, PNG · JPEG · PDF salvano il fotogramma corrente.
- LED: sincronizzati e sfumati (Lab: blocchi, riquadro video, linea sotto il titolo; effetti: linea +
  riquadro, anche aperti dalla colonna di destra).
- Lab: anteprima non schiacciata; PAINTING: foto intera in anteprima.

## 7. Criteri di accettazione

- Logo PNG 1920×1080 trasparente → ognuno dei 10 effetti → PNG RGBA 1920×1080 (ANAMORPHIC: il suo
  letterbox) **senza zone nere opache dove il logo non c'è**; zone opache del logo opache; bagliori/HUD
  fuori sagoma semitrasparenti. Stesso test nel Lab con 2 nodi.
- Foto opaca → PNG RGB nativo; JPEG nativo q100 4:4:4 a QUALITY 100; PDF nativo senza perdita.
- Video → PNG del fotogramma corrente, nativo.
- Foto → EXPORT MP4 (clic … clic dopo ~3 s) → MP4 30 fps, ~90 fotogrammi, risoluzione nativa; Lab + TRACK
  → durata della traccia, audio AAC.
- REC SCREEN con un video file → MP4 in tempo reale con audio; parametri cambiati durante la
  registrazione visibili nel file.
- QUALITY 100 → MP4 con differenza dall'originale ≈ tetto 4:2:0 (misurato); QUALITY 0 → file molto più
  piccolo. JPEG 100 = q1.0.
- 10 pannelli identici (stessi id, ordine, nessuna scritta), Lab idem dentro LABORATORY senza scorrere.
- LED / riquadro / linea: stesso colore nello stesso istante (misurato con `getComputedStyle` su shell
  e iframe), nessun salto alla riapertura di un blocco.
- `verify-export-master` e `verify-lab-chain` senza nuove regressioni; `npm run lint` pulito; build ok.
