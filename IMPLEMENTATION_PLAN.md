# IMPLEMENTATION_PLAN.md — restyle, un commit per area (FASE 3)

> RESTYLE, non redesign. Nessuna logica toccata: solo CSS, Tailwind,
> parametri del layer decorativo (`stoneMontage.ts` / `GelCrust.tsx`), token.
> Ogni commit: (a) motivo del miglioramento, (b) file toccati, (c) perché la
> funzionalità non cambia — poi implementazione, screenshot, suite verde,
> commit singolo. Rollback = revert di un commit.
>
> Ordine: guida le priorità dell'operatore (1 Materiale, 2 Illuminazione,
> 3 Profondità, 4 Forme, 5 Texture, 6 Colori). L'ordine "Top Bar → …" del
> workflow è rispettato dentro gli step 5–7: nei nostri pannelli neri quasi
> tutto il divario visivo vive nel layer decorativo, e partire dal chrome
> lascerebbe intatto il 90% del gap.

---

## Step 1 — MATERIALE: perle a scala reale, con gerarchia

**Perché**: gap #1 della DESIGN_ANALYSIS — le perle a 4–10px leggono come
ghiaia; la reference vive di sfere 6→40px con fuga navy scura.

**Cosa**
- Ritagli sorgente più grandi (patch 100–160px, meno rimpicciolite) così le
  perle grandi arrivano intere a ~20–35px su schermo.
- Tre famiglie di stampe: micro-grana / grappolo medio / cabochon singolo
  grande, distribuite a zone lungo la cresta (non mescolate per stampa).
- Pass "fuga": sotto le stampe, un riempimento navy quasi nero lungo la spina
  della cresta, così le perle affondano in un letto scuro.

**File**: `src/lib/stoneMontage.ts` (solo costanti/funzioni di pittura).
**Funzionalità**: invariata — il layer resta un bitmap statico dipinto una volta.
**Rischio**: peso visivo ↑ → ricontrollare che nessun testo di bordo sia coperto.

## Step 2 — ILLUMINAZIONE: una sola chiave di luce

**Perché**: gap #2 — le rotazioni/flip delle stampe ruotano la luce cotta
nella texture; la reference ha tutte le crown in alto.

**Cosa**
- Niente flip verticale; rotazione stampe limitata a ±0.12 rad.
- Le patch verticali usate solo su solchi verticali (senza ruotarle di 90°).
- Tocco speculare: micro-highlight bianchi rari ridipinti sopra le perle
  maggiori, sempre a ore 11 (coerenti con la chiave).

**File**: `stoneMontage.ts`.
**Rischio**: meno rotazione = ripetizione più visibile → compensare con più
ritagli sorgente (già Step 1).

## Step 3 — PROFONDITÀ: la roccia si stacca dai pannelli

**Perché**: gap #3 — senza ombra di contatto la roccia non "sta sopra".

**Cosa**
- Pass ombra nel montaggio: silhouette di tutte le stampe, sfocata e offset
  (+3/+6px), dipinta PRIMA delle perle → drop shadow cotta nel bitmap, zero
  costo runtime.
- Inset shadow CSS leggera sui gusci `[data-crust]` lato notte (il bordo del
  pannello si incassa sotto la roccia).

**File**: `stoneMontage.ts`, `src/index.css`, className dei gusci in
`App.tsx`/`NodalComposition.tsx`/`AiDirector.tsx` (solo stringhe di classe).
**Rischio**: ombre troppo pesanti sporcano il nero → tarare su screenshot.

## Step 4 — FORME: pozze agli incroci, angoli ricchi, cucitura esterna

**Perché**: gap #4 — la reference si gonfia dove i pannelli si incontrano e
corre una micro-grana continua sul filo esterno dello schermo.

**Cosa**
- Pozze: agli incroci a T/croce dei solchi (deducibili dai rect dei pannelli),
  grappolo extra di stampe grandi (fino a ~100px di ingombro).
- Angoli dei pannelli: +1 stampa media che gira l'angolo.
- Bezel: cucitura di micro-perline lungo il filo esterno + swell più ampio.
- Gemme: meno frequenti, più grandi (20–28px); rivetti ottone più leggibili.

**File**: `stoneMontage.ts` (+ eventuale `REACH` in `GelCrust.tsx`).
**Rischio**: pozze sopra testi dei pannelli → posizionarle solo nei solchi.

## Step 5 — TOP BAR + SIDEBAR (chrome)

**Perché**: portare il chrome al livello del nuovo materiale: oggi le barre
sono nero piatto con bordo trasparente.

**Cosa** (solo className/CSS, entrambe le modalità)
- Fondo con gradiente verticale sottilissimo (nero → #0a0a12) + inset top
  1px bianco 4% (luce d'ambiente dall'alto, coerente con la chiave).
- Radius armonizzati a 18–20px (oggi 16) per sposare gli angoli rocciosi.
- Voci nav: stato attivo con glow violetto già esistente, solo ammorbidito.

**File**: `App.tsx` (className), `index.css` (token ombra).

## Step 6 — RIGHT PANEL + CARDS

**Cosa**: card effetti con radius coerente, bordo 1px bianco 5%, hover con
lift d'ombra (niente scale/transform che tocchi il layout), search box con
inset shadow. Solo className.
**File**: `App.tsx`.

## Step 7 — BOTTOM PANELS + BUTTONS

**Cosa**: NodalComposition e AiDirector — stessi trattamenti di superficie
degli altri pannelli; bottoni (`SELECT A MODULE`, `Add Node`, transport) con
bordo/glow coerenti. Solo className.
**File**: `NodalComposition.tsx`, `AiDirector.tsx`, `App.tsx`.

---

## Impatto atteso complessivo

La roccia passa da "ghiaia colorata" a gioielleria bagnata con una sola luce
(step 1–2), si appoggia fisicamente sui pannelli (3), acquista i nodi
compositivi della reference (4); il chrome nero resta minimale ma smette di
essere piatto (5–7). I pannelli restano rettangoli neri opachi (opzione 2).

## Guard-rail su ogni commit

1. `npm run lint` pulito.
2. `verify-ui-gel-pass` verde (pannelli mai mascherati, strisce mai sul
   canvas, layer mai animato/filtrato).
3. `verify-phase3` (BPM) dopo gli step che toccano il montaggio (1–4).
4. Screenshot notte + giorno allegato al commit.
5. Un'area per commit; revert singolo sempre possibile.

## Cosa NON si tocca (dal workflow, vincolante)

Logica React/TS, hooks, stato, routing, canvas `VfxCanvas`, engine/shader,
audio, API, struttura cartelle, i 5 effetti standalone. Se uno step visivo
richiedesse logica: non si implementa, si annota qui.
