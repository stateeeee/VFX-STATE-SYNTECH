# ANALISI.md — struttura del progetto (FASE 1, solo lettura)

> Prodotta secondo `CODEX_WORKFLOW.md` STEP 1. Nessun codice modificato.
> Ruolo: Senior Product Designer + Art Director + Frontend Engineer.

## Struttura React

Shell a componente unico (`src/App.tsx`, 909 righe) senza routing: le "pagine"
sono stati locali (`openEffectId`, `chainOpen`, `projectsOpen`). Layout a
pannelli ridimensionabili con `react-resizable-panels`. Tema notte/giorno via
stato `isDayMode` (classe `syn-day` sul root). Persistenza `localStorage`.

## Componenti

| Componente | File | Ruolo visivo | Logica da NON toccare |
|---|---|---|---|
| Shell / layout | `src/App.tsx` | top bar, rail sinistro, griglia pannelli, modale progetti, card effetti | stato composizione, save/load, bridge effetti |
| **TopBar** | dentro `App.tsx` (`<header data-crust>`) | barra 48px, wordmark centrato, orologio | timer sessione |
| **Sidebar** (rail sinistro) | dentro `App.tsx` (`<nav data-crust>`) | logo 56px, 5 voci nav, sezione Gemini, meter audio | handler nav |
| **Canvas** (hero) | `src/components/VfxCanvas.tsx` (1073) | grafo cerebrale animato su canvas 2D | TUTTO: fisica, drag, pulses — vietato |
| **Inspector / AI** | `src/components/AiDirector.tsx` (521) | pannello Gemini Pro in basso a destra | chiamate API, preset |
| **Bottom Panel** | `src/components/NodalComposition.tsx` (506) | grafo nodale INPUT→OUTPUT | wiring, drag dei cavi |
| Right Panel | dentro `App.tsx` | ricerca + 5 card effetti (`EffectCardArt`) | filtro, apertura effetti |
| AI Lab | `src/components/ChainLab.tsx` (873) | rack SynEngine full-hero | engine, segnali, export |
| EffectHost | `src/components/EffectHost.tsx` | iframe fullscreen di un effetto | bridge postMessage |
| AudioMeter | `src/components/AudioMeter.tsx` | colonna dB nel rail | WebAudio tap |
| **GelCrust** (decorativo) | `src/components/GelCrust.tsx` (175) | misura i pannelli `[data-crust]`, posiziona la pietra in strisce `position:fixed` | è SOLO decorativo: modificabile |
| stoneMontage (decorativo) | `src/lib/stoneMontage.ts` (257) | monta la roccia da ritagli di `public/assets/bg-texture.jpg`, dipinta UNA volta in canvas → Blob URL | idem: modificabile |
| gelTexture | `src/lib/gelTexture.ts` | tile per il fill del wordmark hero | modificabile (decorativo) |

## Canvas e shaders (VIETATI dal workflow)

- `VfxCanvas.tsx`: canvas 2D, rAF continuo — non toccare.
- `src/engine/SynEngine.ts` + `nodes.ts`: WebGL2 — non toccare.
- `public/effects/<id>/index.html`: i 5 effetti standalone con i loro shader —
  ground truth assoluta (CLAUDE.md regola 1) — non toccare.
- `AudioEngine/VideoAnalyzer/PersonMask/params`: segnali — non toccare.

## CSS utilizzati

- **`src/index.css`** (unico foglio): design token `--syn-*` (regola 4 di
  CLAUDE.md: ogni colore passa da qui), `@theme` Tailwind v4 (niente
  `tailwind.config`), classi brand (`.hero-gradient`, `.hero-gel-text`,
  `.syn-logo*`), layer pietra (`.syn-gel-crust`, `.syn-gel-crust-root`),
  scrollbar, keyframes (shimmer 6s condiviso, eq-bounce, node-flow).
- **Tailwind inline** in ogni componente: superfici `bg-ink-950/900`
  (= nero pieno, decisione #2025-07-25), bordi `border-transparent` in notte
  (il bordo lo fa la pietra — decisione #20), `rounded-2xl` (16px) ovunque,
  ombre `shadow-md/lg`.
- Font: Inter / Space Grotesk / JetBrains Mono, vendorizzati (offline).

## Layout (notte)

```
p-10 (cornice 40px)                        ← la pietra del bezel vive qui
├─ header 48px  [data-crust]
├─ riga flex gap-7 (28px)                  ← solchi: pietra
│  ├─ nav 78px  [data-crust]
│  └─ PanelGroup
│     ├─ colonna sinistra (74%)
│     │  ├─ hero 62%       [data-crust]
│     │  └─ riga bottom 38%
│     │     ├─ NodalComposition [data-crust]
│     │     └─ AiDirector      [data-crust]
│     └─ right panel 26%   [data-crust]
```

I 6 marcatori `[data-crust]` sono il contratto tra layout e pietra: GelCrust li
misura (ResizeObserver) e stampa la roccia nei soli solchi (9–13 strisce, ~50%
del viewport, mai sopra il centro dell'hero).

## Possibili punti di modifica (tutti dentro il perimetro consentito)

1. `src/lib/stoneMontage.ts` — È QUI il materiale: scelta ritagli, scala bolle,
   rotazioni (= coerenza della luce), ombre di contatto, gemme, pozze agli
   incroci. Dipinto una volta, zero costo per frame.
2. `src/index.css` — token, ombre, radius, glow, sheen.
3. Classi Tailwind dei gusci pannello in `App.tsx` / `NodalComposition.tsx` /
   `AiDirector.tsx` (radius, inset shadow, bordi) — solo className, mai logica.
4. Card effetti (`EffectCardArt` in App.tsx) — solo className.
5. `GelCrust.tsx` — solo parametri geometrici (REACH, spessori passati a
   `paintStone`).

## Rischi

- **BPM / frame-cost contract**: qualunque layer animato/blended/filtrato sopra
  l'hero sballa la stima BPM di AudioEngine (misurato: 189 con blur, 124 senza).
  La pietra DEVE restare un bitmap statico. Guard: `verify-phase3` (BPM≈120) e
  `verify-ui-gel-pass` (no anim/filter/blend, strisce mai sul canvas).
- **Regola operatore**: i pannelli restano RETTANGOLI (mai mask/clip su
  `[data-crust]` — asserito dalla suite). L'irregolarità è solo della roccia.
- **Day mode**: niente pietra; ogni modifica ai gusci deve tenere il ramo
  `isDayMode` leggibile su crema (suite brand 13/13 lo verifica).
- **Testi vicino ai bordi** ("Add Node", "GEMINI PRO", "STANDBY"): la pietra può
  coprirli se sborda >12px dentro i pannelli — già successo, tarato con
  `biasPx`; ogni aumento di spessore va ricontrollato lì.
- **Suite esistenti**: 7 script di verifica passano al verde pieno; ogni step
  del restyle deve richiudere `verify-ui-gel-pass` + lint prima del commit.
