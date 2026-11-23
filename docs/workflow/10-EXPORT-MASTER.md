# 10 — EXPORT MASTER (render MP4 fotogramma per fotogramma)

> Richiesta dell'operatore, 2026-11-22: *"ho usato l'effetto anamorphic … la qualità si
> abbassa enormemente. Va tutto a scatti … deve essere come Premiere e After Effects, dove
> con l'export non perde qualità … un export mp4 il più lossless possibile … se carico un
> video da 30 fps, da 24 fps sembra che scenda a 15 … devo poter inserire i parametri che
> decido io … senza avere uno stop motion girato su pellicola nel 1920."*

## 1. Prima di scrivere codice: perché oggi l'export è brutto

Misurato leggendo il codice (`public/effects/anamorphic_lab/index.html`, `src/lab/record.ts`):

| # | Causa | Dove | Effetto che vede l'operatore |
|---|---|---|---|
| 1 | **REC = registrazione in tempo reale** (`canvas.captureStream(30)` + `MediaRecorder`). Il file contiene solo i fotogrammi che il computer riesce a disegnare *mentre il video suona*. Se l'effetto disegna a 15 fps, il file ha 15 fotogrammi diversi al secondo (gli altri sono doppioni). | effetto `toggleRec()`, Lab `MasterRecorder` | "scende a 15 fps", "a scatti", "stop motion" |
| 2 | **Il canvas dell'effetto è limitato a 1280 px di larghezza** (`resizeCanvasToVideo`, `MAX=1280`). Un 1080p o un 4K viene disegnato e registrato a 1280. | effetto | "la qualità si abbassa enormemente" |
| 3 | **Il tempo del video non è quello del file**: `captureStream(30)` campiona a 30 Hz fissi, il loop di disegno va al ritmo dello schermo (60 Hz). Un 24 fps diventa un 30 fps con fotogrammi ripetuti a caso (judder). | effetto + Lab | movimento irregolare |
| 4 | **Encoder in tempo reale** del browser: `MediaRecorder` sceglie da solo il compromesso velocità/qualità e butta fotogrammi se non ce la fa; nel Lab il bitrate è 12 Mbps a 1080p. | effetto + Lab | blocchi, sfocature |
| 5 | Nel Lab ogni nodo passa il video al successivo come stream in tempo reale (budget 30 fps): stesso problema, moltiplicato per i nodi. | Lab | come sopra |

**Conclusione:** non si risolve alzando il bitrate. Serve quello che fanno Premiere e After
Effects: un **render offline**. Il programma non "registra lo schermo": prende il fotogramma
1 del file, ci applica l'effetto alla risoluzione piena, lo codifica; poi il fotogramma 2;
e così via. Ci mette il tempo che serve (anche più lento del tempo reale), ma **ogni
fotogramma del file sorgente diventa esattamente un fotogramma del file finale**, alla sua
risoluzione e al suo frame rate.

## 1b. Seconda richiesta (stessa sessione)

> *"Assicurati che anche tutti gli altri effetti non abbiano questo problema. Devono tutti
> esportare in MP4 e basta. Devono tutti esportare con gli stessi fps del video. Se il video
> ha 60 fps, 240 deve essere fluido … in nessuno degli effetti deve perdere qualità: se uno
> carica un video in 8K deve uscire un video da 8K, non può uscire un video 480p."*

Quindi, per **tutti e 10** gli effetti:
- **Solo MP4.** Mai WebM. Anche il REC delle fonti live (webcam / camera / immagine) scrive
  MP4 (`SynExport.recordLive`: WebCodecs + mp4-muxer, MediaRecorder MP4 solo come riserva).
- **REC con un video caricato = render offline** fotogramma per fotogramma (lo stesso di
  RENDER MP4): nessun file a scatti, qualunque sia la velocità del computer.
- **Stessi fps del file**, qualunque siano: 23,976 … 60 … 120 … 240.
- **Mai ridurre la risoluzione.** Il codec e il livello si scelgono in base a dimensione e
  fps (H.264 fino al livello 6.2 → HEVC → AV1 → VP9). Se la macchina non ha nessun encoder
  per quella dimensione, l'export si ferma con un messaggio chiaro — non esce mai un file più
  piccolo di nascosto.

## 2. Il design

### 2.1 Un motore condiviso: `public/effects/shared/syn-export.js` (`window.SynExport`)

Generico, riusabile da tutti e 10 gli effetti (e più avanti dal Lab). Fa:

1. **Frame rate esatto dal file**: legge il contenitore MP4/MOV (box `moov → trak(vide) →
   mdhd` timescale + `stts`), anche con il `moov` in fondo al file. 23.976 / 24 / 25 /
   29.97 / 30 / 50 / 59.94 / 60 restano esattamente quelli. Per altri contenitori (WebM)
   stima con `requestVideoFrameCallback` e aggancia al valore standard più vicino.
2. **Passo a passo**: per ogni fotogramma `i` porta il `<video>` al centro del fotogramma
   (`(i+0.5)/fps`), aspetta che sia decodificato, chiama `getFrame(i, t)` dell'effetto, e
   codifica il canvas restituito con **WebCodecs `VideoEncoder`** (timestamp esatti
   `i/fps`, nessun fotogramma perso o doppio).
3. **Qualità**:
   - **MASTER** (default, "quasi lossless"): H.264 High, ~1 bit per pixel per fotogramma
     (≈ 60 Mbps a 1080p30, tetto 240 Mbps), keyframe ogni secondo (comodo per il montaggio),
     `latencyMode: 'quality'`.
   - **HIGH**: H.264 High ~0,35 bpp (≈ 22 Mbps a 1080p30), file più leggero.
   - Codec: H.264 (si apre in Premiere, Resolve, QuickTime, ovunque) → se la macchina non ha
     un encoder H.264: HEVC → AV1 → VP9, e il messaggio finale dice quale è stato usato.
   - Nota onesta: nel browser non esiste ProRes né un MP4 matematicamente lossless; H.264 a
     questo bitrate è "visually lossless" (indistinguibile a occhio), che è lo standard dei
     master di consegna.
   - Il bitrate è un TETTO (modo `variable`): su immagini semplici l'encoder ne usa molto
     meno, su grana/dettaglio arriva al tetto (misurato: 0,97 bpp MASTER, 0,38 HIGH con grana
     0,6). Il modo `quantizer` non è disponibile per H.264 nei browser.
   - **Colore**: BT.709 limited range (16–235), taggato nel file — come le camere e Premiere
     (il default del browser sarebbe full range con tag sRGB, che alcuni Premiere leggono male).
4. **Audio del file originale**: se il file è MP4/MOV con audio AAC (il caso normale) i
   pacchetti audio vengono **copiati identici** (zero perdita), tagliati alla durata del video.
   Altrimenti decodificato dal file (non registrato dagli altoparlanti) e ricodificato AAC
   320 kbps (fallback Opus se la macchina non ha AAC, con avviso; audio non includibile →
   avviso che nomina il codec; nessun audio nel file → video muto senza errori).
5. **Salvataggio su disco in streaming** quando il browser lo permette (File System Access
   API, finestra "Salva con nome" all'inizio): niente gigabyte in RAM per un 4K lungo.
   Altrimenti in memoria + download, come oggi.
6. **STOP** in qualsiasi momento (non salva nulla), avanzamento con percentuale e velocità.

### 2.2 Ogni effetto: un blocco delimitato `SYNTECH-EXPORT` (quarta modifica permessa, §5.3)

L'effetto fornisce solo `getFrame(i, t)`: disegna quel fotogramma con il **suo** shader e i
**parametri che l'operatore ha scelto**, alla risoluzione piena della sorgente, con un orologio
deterministico (`t = i/fps`: grana, breathing, flare animati seguono il tempo del video, non
quello del computer). Più un bottone **RENDER MP4** + scelta qualità nella sezione Export.
Il REC in tempo reale resta per webcam / camera / immagine (fonti live che non si possono
"rileggere").

### 2.3 Ordine di lavoro di questa sessione (aggiornato dopo la seconda richiesta)

0. Haiku: mappa dei 9 effetti restanti (canvas, limiti di risoluzione, orologio, stato
   temporale, audio, ML asincrono, REC attuale) → `scratchpad/audit-effects.md`.
5. Dopo ANAMORPHIC: gli altri 9 effetti adottano `SynExport.attach(...)` con il loro blocco
   `SYNTECH-EXPORT`, divisi tra più agenti in parallelo (mai due agenti sullo stesso file),
   ognuno verificato con lo stesso test a codice a barre.

Prima stesura:

1. **ANAMORPHIC** (l'effetto che l'operatore ha usato): motore condiviso + blocco
   `SYNTECH-EXPORT` + piccoli agganci marcati nel suo `render()` (orologio, pausa del loop
   live durante il render, risoluzione piena) — Opus `syn-architect`.
2. Clip di prova deterministici (24 / 25 / 29,97 / 30 fps, con il numero del fotogramma
   scritto nell'immagine come codice a barre, audio) — Haiku `syn-scout`.
3. Test automatico che apre l'effetto vero, fa il render e controlla con `ffprobe` e con il
   codice a barre: stessa risoluzione, stesso fps, stesso numero di fotogrammi, nessun
   fotogramma doppio o saltato, audio presente — Sonnet `syn-builder`.
4. Revisione Opus `syn-reviewer` sul diff completo → solo con PASS: STATE.md, commit, push.

### 2.4 Dopo (prossime sessioni)

- ~~Lo stesso blocco negli altri 9 effetti~~ — FATTO nella stessa sessione (2026-11-23).
- **Lab offline**: `SynLab` impara `renderFrame(sorgente, i, t)`; la catena viene resa nodo
  per nodo fotogramma per fotogramma invece che come stream in tempo reale.

## 3. Criteri di accettazione (ANAMORPHIC)

- Sorgente 1920×1080 a 24 fps, 4 s → file 1920×1080 (o la larghezza desqueeze / l'altezza
  del letterbox scelto), **24 fps, 96 fotogrammi**, codice a barre 0…95 senza buchi né doppioni.
- Lo stesso per 30 fps e 29,97 fps (MOV con `moov` in fondo) e 25 fps senza audio.
- Audio presente e lungo quanto il video (quando la sorgente ce l'ha).
- Bitrate MASTER ≥ ~0,8 bpp su materiale con dettaglio/grana (tetto VBR); il colore/look uguale all'anteprima (stesso shader, stessi parametri).
- Anteprima live, REC, webcam/camera, Lab, Save/restore dell'effetto invariati.
