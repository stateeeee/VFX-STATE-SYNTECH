# 09 — MODEL ROUTING (quale modello fa cosa)

> Workflow chiesto dall'operatore il 2026-10-09: *"crea workflow scegliendo per
> ogni compito il modello migliore tra Opus, Sonnet e Haiku; Opus deve ovviamente
> controllare che il lavoro svolto sia corretto e non abbia creato errori o bug."*
> Vincola ogni sessione che lavora su più di un compito.

## L'idea in una riga

La sessione principale fa da **regista**: legge `STATE.md`, spezza la richiesta
in compiti, dà ogni compito al modello giusto, e **niente viene committato
finché Opus non l'ha revisionato** e ha detto PASS.

## I quattro ruoli

Sono definiti come agenti di Claude Code in `.claude/agents/` (il modello è
scritto nel file, non va scelto a mano ogni volta):

| Agente | Modello | Per cosa | Esempi in questo repo |
|---|---|---|---|
| `syn-scout` | **Haiku 5.5** | Lavoro meccanico, di sola lettura o ripetitivo: cercare, contare, controllare, audit nel browser, lint/build, scaricare e controllare file vendor | "quali sezioni sono aperte all'avvio nei 5 effetti?", "ogni effetto ha una sezione Source?", `npm run lint && npm run build` |
| `syn-builder` | **Sonnet 5.5** | Implementazioni con un perimetro chiaro (1–3 file, comportamento già specificato) | bottone fullscreen della shell, una sezione UI in un effetto, un fix di layout, un nuovo controllo collegato a logica esistente |
| `syn-architect` | **Opus 5.5** | Lavoro difficile o trasversale: motori, ML, shader, port 1:1 nell'AI Lab, file da migliaia di righe dove un errore rompe tutto | tracking reattivo + riconoscimento faccia/mani/corpo nel blob tracker, port SynEngine, export MP4 |
| `syn-reviewer` | **Opus 5.5** | **Cancello obbligatorio** prima di ogni commit: rilegge il diff, cerca bug e regressioni, controlla le regole di `CLAUDE.md`, esegue lint/build e prova nel browser | sempre, su tutto quello che i builder hanno toccato |

### Come si sceglie

1. **Serve solo guardare/contare/verificare?** → Haiku.
2. **Si sa già esattamente cosa costruire e dove?** → Sonnet.
3. **Bisogna capire un sistema grande, inventare il design, o un errore costa
   caro (motore, ML, parità 1:1, export)?** → Opus.
4. **Dubbio tra due livelli** → quello più alto. Costa meno un modello più
   forte che un giro di bug.
5. **Revisione** → sempre Opus, mai lo stesso agente che ha scritto il codice.

## Il ciclo di una sessione

```
regista (sessione principale)
  ├─ legge CLAUDE.md + STATE.md, spezza la richiesta in compiti
  ├─ lancia i builder IN PARALLELO quando i file non si sovrappongono
  │     Sonnet ──► compiti chiari        Opus ──► compiti difficili
  ├─ Haiku: audit meccanici / lint / build
  ├─ syn-reviewer (Opus): revisione del diff completo
  │     FAIL ──► il regista corregge (o rimanda al builder) ──► nuova revisione
  │     PASS ──► avanti
  └─ regista: STATE.md + commit + push + resoconto all'operatore
```

## Regole per i builder (valgono per tutti e tre i modelli)

- Ogni agente riceve **una lista chiusa di file** che può toccare. Due agenti
  in parallelo non toccano mai lo stesso file.
- Nessun agente fa `git checkout/reset/stash/clean`, commit o push: lo fa solo
  il regista, dopo il PASS della revisione.
- Nessun agente modifica `STATE.md`: lo aggiorna il regista.
- Script di prova e screenshot vanno nello scratchpad, mai nel repo.
- Verifica nel browser vero (Playwright + Chromium preinstallato) prima di
  dichiarare finito, come chiede `06-VERIFICATION.md`.
- Il resoconto di ogni agente dice: file e righe toccati, come ha verificato
  (numeri + screenshot), cosa non ha potuto fare.

## Cosa controlla la revisione Opus (checklist)

1. **Correttezza**: il diff fa quello che l'operatore ha chiesto, tutto.
2. **Bug**: errori di logica, ID rimossi ma ancora letti dal JS, listener
   doppi, stati non sincronizzati, eccezioni non gestite, perdite di memoria
   in loop di rendering.
3. **Regressioni**: le funzioni vicine continuano a funzionare (gli altri
   effetti, Save/restore del bridge, AI Lab, tema giorno/notte).
4. **Regole di `CLAUDE.md`**: `ModuleId` intatti, token `--syn-*`, niente
   dipendenze nuove, niente CDN (app offline), modifiche agli HTML degli
   effetti solo se chieste e in blocchi delimitati, `npm run lint` pulito.
5. **Prova**: lint + build + controllo nel browser dei punti a rischio.
6. **Verdetto**: `PASS` oppure `FAIL` con l'elenco dei problemi (file:riga,
   scenario che lo rompe, correzione proposta).

## Come usarlo

Il prompt dell'operatore non cambia (vedi `08-PROMPTS.md`). La sessione
principale applica questo routing da sola: lancia gli agenti per nome
(`syn-scout`, `syn-builder`, `syn-architect`, `syn-reviewer`), oppure — se la
sessione è partita prima che gli agenti esistessero — lancia un agente generico
indicando il modello (`haiku` / `sonnet` / `opus`) secondo la tabella sopra.
