# DESIGN_ANALYSIS.md — app attuale vs reference (FASE 2, nessun codice)

> Immagine A = screenshot dell'app (notte, 1600×1000, commit `cc7e89f`).
> Immagine B = reference dell'operatore (1619×971).
> Confronto fatto su crop ingranditi degli stessi punti (solco orizzontale
> hero→bottom, angolo basso-sinistra, colonna destra).
> Vincolo già deciso dall'operatore: **opzione 2 — le sezioni restano nere
> opache**. Quindi la trasparenza dei pannelli della reference NON va copiata;
> tutto il resto del suo linguaggio sì.

## Materiali

**Reference**
- La roccia è fatta di **perle singole leggibili**: sfere bagnate da ~6 fino a
  ~40px, ognuna con la sua crown speculare bianca e la sua ombra propria.
- Tra le perle c'è **fuga scura blu-navy**: è quella che dà il 3D, ogni perla
  "affonda" in un letto scuro.
- Gerarchia di taglie: campi di micro-grana (6–10px) → grappoli medi (12–20px)
  → **cabochon grandi isolati** (25–40px, anche turchesi/rosa) → gemme rosse
  rare. La taglia varia lungo la cresta, a zone, non per singola perla.
- Materiale continuo: la cresta è UN organismo che scorre attorno ai pannelli.

**App**
- Le perle sono quasi tutte 4–10px: il materiale legge come **ghiaia/spugna**,
  non come gioielli. Nessun cabochon grande, nessuna zona di taglia.
- La fuga tra le perle è un mezzotono fangoso, non navy scuro → poco rilievo.
- Si percepiscono le stampe: chiazze ellittiche ripetute, non un organismo.

→ **Gap #1 (priorità Materiale): scala e gerarchia delle perle + fuga scura.**

## Illuminazione

**Reference**
- **Una sola chiave di luce**, alta e frontale: TUTTE le crown speculari
  stanno in alto sulla perla, ovunque nella UI. È questo che rende la roccia
  un oggetto fisico unico.
- Speculari bianchi puri, piccoli e duri (materiale bagnato), più un riflesso
  ambiente freddo azzurro sui fianchi.

**App**
- Le stampe vengono **ruotate per seguire il bordo** (fino a ±0.3 rad, più i
  flip verticali): la luce cotta nella texture ruota con loro → crown a ore
  sparse, il cervello smette di leggere volume. È il singolo errore di
  illuminazione più grave.

→ **Gap #2 (priorità Illuminazione): coerenza della chiave — niente flip
verticale, rotazione quasi nulla, luce sempre dall'alto.**

## Profondità

**Reference**
- La roccia **proietta un'ombra di contatto** sul nero dei pannelli: un alone
  scuro morbido di 6–10px lungo ogni bordo interno. È quello che la fa stare
  SOPRA i pannelli invece che accanto.
- Dentro la cresta: 3 piani (perle in luce / perle in penombra / fuga) — non
  un piano solo.

**App**
- Zero ombra di contatto: la roccia e il pannello sono complanari, l'effetto
  "appoggiata sopra" si perde.
- Cresta a un piano solo: tutte le perle alla stessa esposizione.

→ **Gap #3 (priorità Profondità): drop shadow della roccia sui pannelli +
due esposizioni dentro la cresta.**

## Spessori

**Reference** (misure sui crop, viewport ~1600)
- Solchi interni: cresta **~36–70px**, con colli sottili e pance larghe.
- **Pozze agli incroci**: dove tre pannelli si incontrano la roccia si gonfia
  fino a ~90–110px — sono i "nodi" visivi della composizione.
- Bezel esterno: ~28–60px, con la micro-grana fine che corre sul filo esterno
  dello schermo (una "cucitura" di perline minuscole quasi continua).
- Sborda sui pannelli ~8–14px, mai di più: i controlli restano tutti leggibili.

**App**
- Cresta ~26–40px quasi costante: mancano le pance e soprattutto le pozze
  agli incroci; il bezel non ha la cucitura fine esterna.

→ **Gap #4 (priorità Forme): swell più ampio + pozze agli incroci + cucitura
di micro-perline sul filo esterno.**

## Forme

**Reference**
- Angoli dei pannelli molto arrotondati (~22–28px) e la roccia li abbraccia
  con grappoli che girano l'angolo — gli angoli sono i punti più ricchi.
- Gemme rosse: **rare e grandi** (~6–8 in tutto lo schermo, 20–28px), sedute
  nella cresta come castoni. Rivetti ottone solo agli angoli esterni.

**App**
- Angoli trattati come il resto del perimetro (stessa densità), gemme più
  piccole e un po' troppo frequenti, rivetti presenti ma poco leggibili.

## Texture

- La texture sorgente è GIÀ giusta (è la stessa opera): il problema non è
  quale texture ma **quali ritagli e a che scala**. Ritagli più grandi, meno
  rimpiccioliti, con perle grandi intere dentro; evitare che una stessa vena
  riappaia riconoscibile a distanza ravvicinata.

## Colori

- Reference: dominante **argento-azzurra fredda**, accenti teal/rosa/rosso,
  ottone solo nei rivetti. App: già vicina (le vene blu sono pesate ×2), ma la
  fanghiglia mauve delle stampe sovrapposte sporca la dominante.
- I colori si sistemano da soli risolvendo materiale+luce; NON è il punto di
  partenza (priorità #6).

## Gerarchia visiva / leggibilità

- Reference: la roccia è protagonista SOLO nei solchi; dentro i pannelli il
  nero è pulito e i controlli respirano. Nessun testo tocca la roccia.
- App: già corretto (bias in pixel assoluti), da preservare in ogni step.

## Sintesi dei gap, in ordine di priorità del workflow

| # | Priorità | Gap | Dove si interviene |
|---|---|---|---|
| 1 | Materiale | perle troppo piccole, niente gerarchia di taglia, fuga chiara | `stoneMontage.ts` (ritagli + scala) |
| 2 | Illuminazione | chiave di luce ruotata a caso dalle stampe | `stoneMontage.ts` (rotazioni/flip) |
| 3 | Profondità | niente ombra di contatto, cresta a un piano | `stoneMontage.ts` (pass ombra) + inset shadow CSS sui gusci |
| 4 | Forme | niente pozze agli incroci, swell timido, angoli poveri | `stoneMontage.ts` (pozze) |
| 5 | Texture | ripetizione percepibile delle stampe | `stoneMontage.ts` (ritagli più grandi/numerosi) |
| 6 | Colori | fanghiglia mauve da sovrapposizione | conseguenza dei punti 1–2 |

Fuori scope (deciso): pannelli traslucidi della reference → restano neri.
