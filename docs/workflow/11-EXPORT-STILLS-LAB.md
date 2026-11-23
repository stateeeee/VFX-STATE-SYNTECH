# 11 — EXPORT FOTO (PNG / JPEG / PDF) + LAB FOTOGRAMMA PER FOTOGRAMMA

> Richiesta dell'operatore, 2026-11-23: *"se carico una foto all'interno dell'app, da ogni effetto,
> sia nell'hub sia nella sezione di destra degli effetti, deve poter essere esportata in PNG che sia
> un vero PNG. Se carico una foto con sfondo trasparente, deve restare trasparente. JPEG e PDF.
> Questi tre formati non devono essere compressi, ma devono esportare nella qualità più alta
> possibile. Sempre. Se carico un video o accendo la webcam … MP4 praticamente lossless … se importo
> un video 4K uscirà 4K, HD → HD, 720 → 720, come Premiere … Il LAB: la catena di più effetti
> registra ancora in tempo reale. Rifarla fotogramma per fotogramma come i singoli effetti."*

## 1. Cosa c'è oggi (audit 2026-11-23, Haiku + verifica dell'orchestratore)

| # | Problema | Dove |
|---|---|---|
| 1 | **Nessun effetto esporta una foto.** Nessun bottone PNG/JPEG/PDF. Con una foto c'è solo il REC in tempo reale (MP4 di una foto ferma). | tutti e 10 |
| 2 | **La trasparenza si perde sempre**: canvas WebGL `alpha:false`, o 2D riempito di nero, o shader finale con alpha 1.0. | tutti e 10 |
| 3 | **Risoluzione della foto non nativa in anteprima**: ANALOG / QUADTREE / TIME MACHINE / BOKEH fissi 1920×1080 (la foto viene stirata), PAINTING 1920×1080 cover-crop, ANAMORPHIC ≤1280, INVISIBLE ≤1080p, BLOB REVEAL/TRACKER/POINTCLOUD alla dimensione della finestra. | anteprime |
| 4 | **BOKEH non sa caricare una foto**: il bottone IMAGE la passa a un `<video>`, che non la decodifica → nero. | bokeh |
| 5 | **Lab**: l'EXPORT VFX CHAIN registra in tempo reale (`MasterRecorder`, MediaRecorder 12 Mbps, 1920 px fissi, WebM se manca MP4) → stessi difetti risolti negli effetti il 2026-11-23 (scatti, fps sbagliati, risoluzione persa). | `src/lab/record.ts`, `ChainLab.tsx` |
| 6 | **Webcam**: chiesta a 1280×720 in quasi tutti gli effetti → anche con una webcam 1080p/4K il file esce 720p. | getUserMedia degli effetti |
| ✓ | Video negli effetti: già render offline nativo (4K provato su tutti e 10), fps esatti, MASTER ≈1 bpp H.264 High, audio AAC copiato. Webcam: MP4 WebCodecs ≈1 bpp. | `syn-export.js` |
| ✓ | JPEG del browser a qualità 1.0 = già il massimo possibile (misurato: campionamento colore 4:4:4, tabelle di quantizzazione tutte a 1). | Chromium 157 |

## 2. Il design

### 2.1 `public/effects/shared/syn-still.js` (`window.SynStill`) — motore condiviso delle foto

- **PNG vero, scritto da noi** (non `canvas.toBlob`: il canvas 2D tiene l'alpha premoltiplicato e
  perde precisione nei pixel quasi trasparenti). 8 bit, RGBA se la foto ha trasparenza, altrimenti RGB.
  Compressione deflate **senza perdita** (filtri per riga). Bit per bit identico ai pixel calcolati.
- **JPEG** qualità 1.0 (4:4:4, quantizzazione 1) — il formato è con perdita per natura: questo è il
  suo massimo. Niente trasparenza (il JPEG non la supporta): la foto esce come si vede in anteprima.
- **PDF scritto da noi**, immagine **senza perdita** (Flate) alla risoluzione nativa, con **SMask**
  per la trasparenza; 1 pixel = 1 punto (pagine enormi ridotte solo come dimensione della pagina,
  mai come pixel).
- **Trasparenza**: gli effetti calcolano il colore sulla foto appoggiata sul nero; l'alpha finale è
  l'**alpha originale della foto** (stessa sagoma, pixel per pixel), con i bordi morbidi
  "de-premoltiplicati" per non avere aloni neri. Barre di letterbox / cornici dell'effetto restano
  opache. (Bagliori che escono dalla sagoma vengono tagliati dalla sagoma: decisione documentata.)
- **Risoluzione nativa sempre**: l'effetto disegna la foto alla sua dimensione originale (4000×3000 →
  4000×3000, anche se l'anteprima è 1920×1080), mai ridotta; se supera il limite del browser, errore
  chiaro e nessun file.
- Salvataggio con "Salva con nome" (aperto subito, dentro il click) o download.

### 2.2 Ogni effetto: `window.SynFx` nel blocco `SYNTECH-EXPORT` (regola §5.3, nessuna riscrittura)

Un solo contratto, usato sia dall'export foto sia dal Lab:

```
window.SynFx = {
  version: 1,
  outSize(w, h) → {w, h}             // dimensione d'uscita per un ingresso w×h (anamorphic: desqueeze)
  begin({mode:'still'|'lab', width, height, fps?, audioFile?}) // ferma il loop live, canvas + FBO alla
                                     // dimensione nativa, stato temporale azzerato (lab)
  frame(src, i, t) → Promise<{canvas, sx?, sy?, sw?, sh?, alphaRect?}>
                                     // disegna `src` (canvas/immagine) con lo shader e i parametri
                                     // dell'effetto, orologio t; lab = stato temporale a cadenza fps;
                                     // still = l'immagine come appare in anteprima (riscaldamento
                                     // deterministico per gli effetti che accumulano)
  end()                              // SEMPRE: ripristina tutto
}
```

+ tre bottoni **PNG · JPEG · PDF** sotto RENDER MP4 (`SynStill.attach`, stessi stili del bottone).
+ BOKEH: sorgente foto aggiunta nel blocco delimitato.
+ Webcam: risoluzione nativa della camera (chiesta fino a 3840×2160 @ 30), così l'MP4 esce alla
  risoluzione reale della webcam.

### 2.3 Lab offline (fotogramma per fotogramma)

- Il Lab carica `syn-export.js` e `syn-still.js` anche nella shell.
- **Video**: `SynExport.render` sul video d'ingresso della shell (fps e fotogrammi esatti dal file,
  seek al fotogramma, audio AAC copiato); per ogni fotogramma la shell passa il fotogramma nativo al
  nodo 1 con `SynFx.frame`, l'uscita del nodo 1 al nodo 2, … ; l'uscita dell'ultimo nodo va
  all'encoder. Nessuno stream in tempo reale nel mezzo, nessun fotogramma perso, risoluzione nativa.
- **Foto**: PNG / JPEG / PDF della catena alla risoluzione nativa della foto (trasparenza come §2.1).
- **Webcam / foto in MP4**: `SynExport.recordLive` (MP4 WebCodecs, mai WebM) al posto di MediaRecorder.

## 3. Lavoro e modelli (richiesta dell'operatore: Sonnet + Haiku delegati, l'orchestratore verifica)

| Compito | Modello | File |
|---|---|---|
| Audit 10 effetti (foto, alpha, risoluzione, export, Lab) | Haiku | — |
| `syn-still.js` (PNG/JPEG/PDF, alpha, salvataggio, bottoni) | Sonnet | `shared/syn-still.js` |
| `SynFx` + bottoni: ANALOG · QUADTREE · TIME MACHINE | Sonnet | 3 HTML |
| `SynFx` + bottoni + foto: ANAMORPHIC · BOKEH | Sonnet | 2 HTML |
| `SynFx` + bottoni: BLOB TRACKER | Sonnet | 1 HTML |
| `SynFx` + bottoni: BLOB REVEAL · INVISIBLE | Sonnet | 2 HTML |
| `SynFx` + bottoni: PAINTING · POINTCLOUD | Sonnet | 2 HTML |
| Lab offline + export foto del Lab + webcam nativa | Sonnet | `ChainLab.tsx`, `record.ts`, `synlab.ts`, `syn-export.js` |
| Verifiche (ffprobe, PIL, pdfinfo, 720/1080/4K, trasparenza) | Haiku | scratchpad |
| Verifica di ogni consegna + revisione finale del diff | orchestratore (Opus) + `syn-reviewer` (Opus) | — |

## 4. Criteri di accettazione

- Da ognuno dei 10 effetti (aperto dall'hub o dalla colonna di destra: è la stessa pagina), con una
  foto 4000×3000 caricata: PNG 4000×3000, JPEG 4000×3000 (4:4:4, q 1.0), PDF con immagine 4000×3000
  senza perdita. Il PNG riletto con PIL = esattamente i pixel calcolati.
- Una foto PNG con sfondo trasparente → PNG RGBA con la stessa alpha (pixel per pixel) e PDF con SMask.
- Foto opaca → PNG RGB (niente canale alpha finto).
- Lab con un video: MP4 con fps esatti, numero di fotogrammi esatto, risoluzione nativa (720p → 720p,
  1080p → 1080p, 4K → 4K), codice a barre 0…N-1 senza buchi né doppioni, audio copiato.
- Lab con una foto: PNG / JPEG / PDF alla risoluzione nativa della foto.
- Anteprime, REC, RENDER MP4, Lab live, Save/restore invariati; `npm run lint` pulito, build ok.
