# 10 — SECURITY WORKFLOW (controllo di sicurezza prima del lancio pubblico)

> Chiesto dall'operatore il 2026-11-13: *"sei l'orchestratore, crea un workflow e
> cura la verifica finale, usa Opus / Sonnet / Haiku; prima di dare per scontato
> un lavoro devi controllarlo … analizza la mia app, trova tutte le falle di
> sicurezza … deve essere pronta per essere pubblicata"* (abbonamento, codice
> chiuso; login e pagamenti arrivano dopo).
> Si aggiunge a `09-MODEL-ROUTING.md` (ruoli e cancello Opus restano quelli).

## L'idea in una riga

Il regista non si fida di nessun resoconto: **ogni falla segnalata viene
riprodotta o riletta sul codice dal regista prima di entrare nel registro, e
ogni correzione viene riprovata dal regista dopo il PASS di Opus.**

## Le fasi

| Fase | Chi | Cosa | Esce con |
|---|---|---|---|
| **S0 Ricognizione** | Haiku | Segreti nella storia di git, dati personali, `npm audit`, URL esterni, inventario dei file tracciati | fatti e numeri |
| **S1 Audit** | Opus ×2 + Sonnet | In parallelo, sola lettura, perimetri separati: **server/API** (Opus) · **Electron + CI + riservatezza del codice** (Opus) · **client: shell React + effetti** (Sonnet) | un rapporto per perimetro: ID, gravità, file:riga, scenario d'attacco concreto, correzione minima |
| **S2 Verifica del regista** | sessione principale | Ogni voce: riprodotta (curl / Playwright / build) o riletta sul codice. I falsi positivi si scartano, le gravità gonfiate si abbassano | registro delle falle confermate |
| **S3 Correzioni** | Sonnet (perimetro chiaro) · Opus (trasversali) | Lista chiusa di file per agente, mai lo stesso file a due agenti. Additive, niente dipendenze nuove, regole di `CLAUDE.md` | diff non committato |
| **S4 Cancello Opus** | `syn-reviewer` | Diff completo: bug, regressioni, regole. FAIL → si corregge e si rifà | PASS |
| **S5 Verifica finale del regista** | sessione principale | `npm run lint` + `npm run build`; ogni falla corretta **riprovata con lo stesso attacco** (deve fallire); l'app usata nel browser vero (10 effetti, LAB, pannello Gemini bloccato senza chiave); suite `tools/verify` toccate dal diff | numeri nel log di `STATE.md` |
| **S6 Chiusura** | sessione principale | `STATE.md` + commit + push; rapporto all'operatore in italiano semplice, con quello che **solo lui** può fare | — |

Gravità: **Critica** (rubano la chiave o il codice del server da remoto) ·
**Alta** (chiunque può buttare giù o usare a sbafo il servizio) · **Media**
(serve una condizione in più: un link cliccato, un file aperto) · **Bassa**
(indurimento) · **Info**.

## Riservatezza del registro

Finché il repository è **pubblico**, nel repo entrano solo: le correzioni, questo
documento, e in `STATE.md` l'elenco di ciò che è stato **chiuso**. I dettagli di
una falla **ancora aperta** (come si sfrutta) non si committano: stanno nel
rapporto privato consegnato all'operatore e nel passaggio di consegne alla chat
successiva. Una volta chiusa, la voce si può documentare.

## Cambio chat a un quarto del contesto

L'operatore non vuole pagare contesto inutile. Il regista:

1. delega le letture pesanti agli agenti (che rispondono con un riassunto e
   scrivono il rapporto completo su file), e tiene per sé verifica e decisioni;
2. quando stima di essere vicino a **1/4 del contesto**, chiude il giro in corso
   (niente lavoro a metà non committato), aggiorna `STATE.md` → "Next step",
   committa e fa push, poi apre una **nuova sessione** sullo stesso branch con
   un prompt di consegna che contiene: obiettivo dell'operatore (parole sue),
   questo workflow, il registro completo (chiuse / aperte / da decidere), cosa è
   stato verificato e come, cosa manca, in che ordine;
3. la nuova chat parte da `CLAUDE.md` + `STATE.md` + quel prompt, senza
   rileggere l'audit da capo.

## Cancello di sicurezza per ogni rilascio (da rifare prima di ogni versione pubblica)

- [ ] `npm audit --omit=dev`: nessuna vulnerabilità alta o critica aperta.
- [ ] Storia di git: nessun segreto (chiavi `AIza…`, token, `.env`).
- [ ] Build di produzione: il server web restituisce solo l'app — mai sorgenti,
      mappe, file di configurazione o documenti interni: `GET /server.cjs`,
      `/server.cjs.map`, `/*.map`, `/server.ts`, `/src/App.tsx` → 404 o la pagina
      dell'app, mai codice. Il bundle del server sta in `dist-server/`, fuori da `dist/`.
- [ ] Intestazioni di sicurezza presenti su `/` e su `/effects/*`.
- [ ] `/api/*` rifiuta un `Host` sconosciuto e una `Origin` estranea; la chiave
      del server non è mai usabile da fuori dalla macchina.
- [ ] Limiti: corpo JSON, upload, richieste contemporanee, frequenza.
- [ ] App desktop: finestra bloccata sulla propria origine, permessi solo
      camera/microfono, nessuna mappa o documento interno nel pacchetto.
- [ ] Nessun URL esterno caricato a runtime (app 100% offline, AI a parte).

## Pubblicare il sito (versione web) senza riaprire le falle

- **Mai `npm run dev` su un server pubblico**: è la modalità di sviluppo e mostra tutto il progetto. Online si
  usa `npm run build` e poi `npm start` (un bundle compilato è sempre in produzione, qualunque sia `NODE_ENV`).
- **La chiave Gemini dell'operatore non va sul server pubblico.** `npm start` la ignora comunque: ogni utente
  incolla la propria finché non ci sono login e abbonamenti.
- **Nome del sito**: va in `ALLOWED_HOSTS` (l'API risponde solo ai nomi elencati, a `localhost`, agli IP e ai `.local`).
- **Dietro un proxy** (nginx, Cloudflare, la piattaforma di hosting): il proxy deve passare il nome che il browser
  ha usato (`proxy_set_header Host $host;`) oppure si imposta `TRUST_PROXY` e si inoltra `X-Forwarded-Host`;
  altrimenti l'API rifiuta ogni richiesta del pannello con 403 e lo scrive una volta nel log. Con `TRUST_PROXY`
  i limiti contano l'indirizzo vero del visitatore (senza, tutti i visitatori sembrano il proxy).
- **Limiti** (`.env.example`): `SYNTECH_MAX_UPLOADS` (6), `SYNTECH_MAX_ROLE_CALLS` (16), `SYNTECH_ROLE_BYTES_MB`
  (160). Caso peggiore: 3 GB di disco temporaneo e circa 0,5 GB di memoria. HTTPS lo fornisce il proxy.
- Le protezioni vivono in `security.ts` (intestazioni + CSP, richieste da altri siti, limiti, velocità minima)
  e in `ai-provider.ts` (chiave provata con Google prima di ogni lavoro costoso).

## Cose che può fare solo l'operatore (fuori dal codice)

Elenco aggiornato nel rapporto di ogni giro; le fisse sono: visibilità del
repository su GitHub, certificati di firma del codice (Windows / Apple),
marchio, termini d'uso e licenza, scelta dell'hosting, e — quando ci saranno —
login e pagamenti (senza i quali l'app non può essere "solo per abbonati").
