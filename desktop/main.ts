/*
 * VFX SYNTECH — the desktop shell (Electron main process).
 *
 * The desktop app is the web app, unchanged. This file does three things:
 *
 *   1. Starts the same Express server that `npm start` runs (server.ts), inside
 *      the app, bound to 127.0.0.1 only — nothing is exposed to the network and
 *      no firewall prompt appears. It serves the built dist/ and the AI
 *      endpoints, exactly as in the browser.
 *   2. Opens one window on it. The person double-clicking the app never sees a
 *      terminal, a URL or a browser.
 *   3. Keeps the platform out of the way: camera/mic are granted (Electron's
 *      default; macOS still asks once, with the texts in electron-builder.yml),
 *      external links open in the real browser, a second launch focuses the
 *      window that is already open.
 *
 * Why a FIXED port: presets, sessions and effect settings live in localStorage,
 * and localStorage belongs to an origin — http://127.0.0.1:<port>. A random port
 * would be a new, empty origin on every launch. Only if the fixed port is taken
 * by another program does the app fall back to a free one (it still works; the
 * saved presets just are not visible in that run).
 *
 * AI keys: the app never needs one. To switch the AI panels on in the desktop
 * build, put GROQ_API_KEY=... (or GEMINI_API_KEY=...) in a file named ".env" in
 * the app's data folder — see docs/workflow/DESKTOP.md for the path per OS.
 */
import { app, BrowserWindow, dialog, shell } from "electron";
import path from "path";
import net from "net";
import dotenv from "dotenv";

const PORT = 47291;
const HOST = "127.0.0.1";

/* Laptops with two GPUs: ask for the discrete one. The effects are WebGL2
   shaders; the integrated GPU is where the frame rate goes to die. */
app.commandLine.appendSwitch("force_high_performance_gpu");
/* No usable GPU at all (a blocklisted driver, a VM, remote desktop): newer
   Chromium no longer falls back to its software WebGL on its own, and every
   effect would show "no webgl" (seen with Electron 44). With this it renders on
   the CPU instead — slowly, but it renders. Kept on the pinned Electron 32 too,
   so a future upgrade cannot silently bring the blank effects back. It only ever runs this app's own pages, so the "unsafe" (untrusted
   web content reaching a JIT) does not apply. A real GPU is always preferred. */
app.commandLine.appendSwitch("enable-unsafe-swiftshader");

let win: BrowserWindow | null = null;

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, HOST, () => probe.close(() => resolve(true)));
  });
}

async function startBackend(): Promise<number> {
  dotenv.config({ path: path.join(app.getPath("userData"), ".env"), quiet: true });
  process.env.SYNTECH_DESKTOP = "1";
  process.env.NODE_ENV = "production";
  // Loaded only now, so server.ts sees the flag above and does not self-start on :3000.
  const { startServer } = await import("../server");
  const port = (await portIsFree(PORT)) ? PORT : 0;
  return startServer({ port, host: HOST, distPath: path.join(app.getAppPath(), "dist") });
}

function createWindow(origin: string) {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    title: "VFX SYNTECH",
    backgroundColor: "#000000",
    show: false,
    autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), "desktop/icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // Keep rendering when the window is behind another one — a recording or
      // an export must not slow down because the operator switched app.
      backgroundThrottling: false,
    },
  });

  win.once("ready-to-show", () => {
    win?.maximize();
    win?.show();
  });

  // Links meant for a new tab go to the real browser; the app never opens a second window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(origin)) shell.openExternal(url);
    return { action: "deny" };
  });

  // The window never leaves the app. (A file dropped outside a drop zone would
  // otherwise replace the whole UI with that file.)
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith(origin)) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });

  win.on("closed", () => {
    win = null;
  });

  win.loadURL(origin + "/");
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.on("window-all-closed", () => app.quit());

  app.whenReady().then(async () => {
    try {
      const port = await startBackend();
      createWindow(`http://${HOST}:${port}`);
    } catch (err) {
      dialog.showErrorBox("VFX SYNTECH", `The app could not start.\n\n${String(err)}`);
      app.quit();
    }
  });
}
