# DESKTOP — VFX SYNTECH come app da doppio clic

> Aggiunta il 2026-09-28 per la consegna della tesi a Brera: l'app deve arrivare
> alla segreteria come un file che si apre con un doppio clic su qualsiasi PC o
> Mac, senza terminale, senza `npm`, senza localhost, senza internet.

## In una frase

L'app desktop **è la web app, identica**, dentro una finestra sua (Electron).
Non c'è una seconda versione da tenere allineata: ogni modifica fatta all'app
finisce nella prossima build desktop da sola.

## Per l'operatore

### Scaricare l'app aggiornata

Ogni push su GitHub (su `main` o su un branch `claude/...`) costruisce l'app su
macchine Windows e Mac vere, la **apre e la testa**, e lascia un solo pacchetto:

- **Il modo più semplice — pagina Releases:** GitHub → repo → **Releases** (colonna
  a destra) → `VFX SYNTECH <versione>` → clic sui file. Link diretti: non serve
  essere loggati, funziona anche dal telefono, non scadono.
- **Oppure dagli Artifacts:** tab **Actions** → workflow **Desktop app** →
  l'ultima run con la spunta verde → in fondo, **Artifacts** →
  **VFX-SYNTECH-<versione>**. Si scarica **solo da loggati**: senza login il nome
  compare come testo semplice con un codice `sha256` accanto, non come link.

Gira su **Mac con macOS 10.15 Catalina o successivo** (Apple Silicon e Intel) e
su **Windows 10/11 a 64 bit**.

I file sono:
   - `VFX-SYNTECH-<versione>-Windows.exe` — un file, doppio clic, niente installazione;
   - `VFX-SYNTECH-<versione>-Mac.zip` — per Mac Apple Silicon **e** Intel:
     doppio clic sullo zip, compare l'app, doppio clic sull'app;
   - `LEGGIMI.txt` — come aprirla, per chi la riceve (i prof).

Questi tre file sono ciò che si manda alla segreteria insieme alla tesi. Gli
artifact restano scaricabili 90 giorni, la Release finché non la cancelli: in
ogni caso, una volta scaricati, conservali tu.

### Consegna

- Mandare **tutti e tre i file**: non si sa se il prof ha Windows o Mac.
- Pesano circa 90 MB (Windows) e 205 MB (Mac, perché contiene entrambe le
  architetture): serve WeTransfer/Drive/chiavetta, non un allegato email.
- Prima di consegnare: scarica i file e **aprili tu** su un Mac e, se puoi, su un
  PC Windows. È la prova che conta.

### Perché compaiono gli avvisi di sicurezza

L'app non è firmata con un certificato commerciale (Apple Developer ID, 99 $/anno;
certificato Windows, a pagamento). Quindi alla **prima** apertura:
- Windows mostra "Windows ha protetto il PC" → *Ulteriori informazioni* → *Esegui comunque*;
- macOS dice che non può verificare lo sviluppatore → *Impostazioni di Sistema →
  Privacy e sicurezza → Apri comunque* (su macOS 14 e precedenti: tasto destro → Apri).

È tutto scritto in `LEGGIMI.txt`. Se un giorno servisse l'apertura senza avvisi
sul Mac, la strada è l'account Apple Developer + notarizzazione: si aggiunge al
workflow senza toccare l'app.

### L'AI nella versione desktop

L'app non ha bisogno di nessuna chiave: senza, i pannelli AI rispondono con i
preset integrati (come in browser). Per accenderla sul **tuo** computer, crea un
file di testo chiamato `.env` con dentro `GROQ_API_KEY=...` (o `GEMINI_API_KEY=...`)
nella cartella dati dell'app:
- Mac: `~/Library/Application Support/VFX SYNTECH/.env`
- Windows: `%APPDATA%\VFX SYNTECH\.env`

La chiave **non** va mai dentro la build: chi riceve l'app la vedrebbe.

### Provarla sul tuo Mac senza aspettare GitHub

```bash
npm install
npm run desktop        # build + apre l'app desktop (non impacchettata)
npm run desktop:dist   # crea lo .zip in release/ (sul Mac) o l'.exe (su Windows)
```

## Per le sessioni di sviluppo

### Com'è fatta

| File | Cosa fa |
|---|---|
| `desktop/main.ts` | Processo principale Electron: avvia `server.ts` dentro l'app su `127.0.0.1:47291`, apre la finestra, gestisce link esterni, istanza singola, fallback di porta |
| `server.ts` | Lo stesso server di `npm start`. Esporta `startServer({ port, host, distPath })`; si avvia da solo su :3000 **solo** se `SYNTECH_DESKTOP` non è impostata |
| `electron-builder.yml` | Packaging: Windows `portable` x64, macOS `zip` universal con firma ad-hoc, Linux AppImage (solo test) |
| `desktop/icon.png` | Icona 1024², generata da `tools/gen/gen-app-icon.cjs` da `desktop/icon-source.webp` (l'artwork dell'operatore) |
| `desktop/LEGGIMI.txt` | Istruzioni per chi riceve l'app; il workflow la mette nel pacchetto |
| `.github/workflows/desktop.yml` | Build + test su `windows-latest` e `macos-latest`, poi un artifact unico e la Release `v<versione>` (ricreata a ogni push) |
| `tools/verify/verify-desktop.cjs` | Apre la build impacchettata con Playwright/Electron e la verifica (24 controlli) |

`npm run desktop:bundle` compila `desktop/main.ts` + `server.ts` (con express,
dotenv e i client AI) in un solo `dist-desktop/main.cjs`. L'app impacchettata
contiene **solo** `dist/`, `dist-desktop/`, l'icona e `package.json`: niente
`node_modules`.

### Decisioni (e perché)

- **Electron bloccato a 32.3.3 → gira da macOS 10.15 Catalina e Windows 10.**
  La prima build usava Electron 44 (Chromium 152), che richiede **macOS 13**: sul
  MacBook Pro M1 dell'operatore, fermo a macOS 12.2.1, l'app si rifiutava di
  partire ("richiede macOS 13.0 o versione successiva"). I prof avranno computer
  di ogni età. Minimi misurati negli `Info.plist` delle release Electron:
  44 → 13.0, 37 → 11.0, **32 → 10.15** (ultima linea che supporta Catalina, cioè
  i Mac dal 2012 in poi). Scelta la 32 (Chromium 128) dopo aver verificato che
  basta: il CSS compilato usa `color-mix`, `oklch`, `@property`, `@layer` (tutti
  Chromium ≤ 111) e nessuna API JS più recente di Chromium 128; stessa
  `verify-desktop.cjs` 24/24; screenshot confrontati pixel per pixel con la 44:
  differenze **solo** nelle parti animate (grafo, gradiente del brand, orologio,
  FPS). La versione è **esatta** in `package.json` (niente `^`), c'è
  `mac.minimumSystemVersion: "10.15"` in `electron-builder.yml`, e il workflow
  **fallisce** se l'app impacchettata dichiara un minimo diverso.
  Prezzo: Electron 32 non riceve più patch di sicurezza. L'app carica solo le
  proprie pagine locali e non naviga mai fuori (vedi `will-navigate`), quindi il
  rischio è minimo. **Non aggiornare Electron** senza rifare questa verifica e
  senza accettare di perdere i Mac più vecchi.
- **Icona = l'artwork dell'operatore** (`desktop/icon-source.webp`, la tessera di
  vetro con la stella). `tools/gen/gen-app-icon.cjs` non la ridisegna: rende
  trasparente il nero **fuori** dalla tessera (altrimenti nel Dock è un quadrato
  nero con angoli vivi) e la porta sulla griglia Apple (~824 px in 1024). Il
  taglio sta fuori dal bagliore: lo script fallisce se toglierebbe un pixel acceso.

- **Server interno invece di un protocollo custom.** L'app gira esattamente come
  in `npm start` — stesso server, stessi endpoint AI, stessa origine `http://` —
  quindi niente comportamenti diversi tra browser e desktop, e nessun endpoint da
  duplicare. Bind su `127.0.0.1`: niente rete esposta, niente prompt del firewall.
- **Porta fissa 47291.** Preset, sessioni e impostazioni degli effetti stanno in
  `localStorage`, che appartiene a un'origine (`http://127.0.0.1:<porta>`): una
  porta casuale sarebbe un archivio vuoto a ogni avvio. **Non cambiarla**: chi ha
  già usato l'app perderebbe i propri preset. Se è occupata da un altro programma
  l'app si apre lo stesso su una porta libera (senza i preset salvati in quella run).
- **`enable-unsafe-swiftshader`.** Senza GPU utilizzabile (driver in blocklist, VM,
  desktop remoto) Chromium non ripiega più da solo sul WebGL software e ogni effetto
  mostrerebbe "no webgl". Con lo switch rende sulla CPU, lento ma visibile. L'app
  carica solo le proprie pagine, quindi il rischio "unsafe" non si applica.
- **`force_high_performance_gpu`.** Sui portatili con due GPU chiede la discreta.
- **Firma ad-hoc su Mac (`identity: "-"`, `hardenedRuntime: false`).** Senza
  alcuna firma un Mac Apple Silicon dichiara l'app "danneggiata"; con la firma
  ad-hoc chiede solo la conferma in Privacy e sicurezza. Nessun account Apple.
- **Mac in `.zip`, non `.dmg`.** Il primo tentativo era un `.dmg`: l'operatore,
  al primo colpo, ha visto il 🚫 trascinando l'app (il disco del dmg è in sola
  lettura: il cursore diventa "+" solo esattamente sopra la cartella Applicazioni)
  e l'icona del disco sulla scrivania riapriva la stessa finestra, in loop. Lo
  `.zip` si apre con un doppio clic e mostra direttamente l'app. electron-builder
  lo crea con `zip -y` nativo di macOS, che preserva i symlink dei framework —
  senza, la firma si rompe. Il workflow lo scompatta con `ditto` (come il Finder),
  fa `codesign --verify --deep --strict` e testa **quell'**app.
- **Windows `portable`.** Un file unico, nessuna installazione — è ciò che serve
  a un prof. Il prezzo è qualche secondo in più al primo avvio (si scompatta).
- **`.env.local` ora viene letto davvero.** `server.ts` faceva `dotenv.config()`,
  che legge solo `.env`, mentre tutta la documentazione dice `.env.local`: una
  chiave Groq messa lì veniva ignorata. Ora legge `.env.local` e poi `.env`.

### Verifica

```bash
npm run build && npm run desktop:bundle && npx electron-builder --linux dir
NODE_PATH=/opt/node22/lib/node_modules xvfb-run -a node tools/verify/verify-desktop.cjs <scratch>
```

Nel sandbox si possono costruire anche l'`.exe` Windows
(`npx electron-builder --win portable`) ma non eseguirlo; lo `.zip` Mac universal
solo su macOS (serve `lipo`).
Per questo il workflow esegue la stessa verifica su Windows e Mac veri.
