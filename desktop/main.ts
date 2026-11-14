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
 * Hardening (security audit DSK-03/04/05): navigation and window.open are
 * judged by strict origin comparison; only this app's own origin gets camera /
 * microphone / fullscreen, every other permission is denied; the packaged app
 * has no DevTools (unless SYNTECH_DEVTOOLS=1 is set — the owner's escape hatch).
 *
 * Why a FIXED port: presets, sessions and effect settings live in localStorage,
 * and localStorage belongs to an origin — http://127.0.0.1:<port>. A random port
 * would be a new, empty origin on every launch. Only if the fixed port is taken
 * by another program does the app fall back to a free one (it still works; the
 * saved presets just are not visible in that run).
 *
 * AI keys: nothing but the Gemini 3.8 panel needs one. Paste it in the panel,
 * or put GEMINI_API_KEY=... in a file named ".env" in the app's data folder —
 * see docs/workflow/DESKTOP.md for the path per OS.
 */
import { app, BrowserWindow, dialog, Menu, session, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";
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

/* Packaged app = no DevTools, no "Toggle Developer Tools" menu item — unless the
   owner sets SYNTECH_DEVTOOLS=1 to debug a shipped build. Unpackaged runs
   (npm run desktop, electron .) are never restricted. */
const LOCKED_DOWN = app.isPackaged && process.env.SYNTECH_DEVTOOLS !== "1";

/* Strict origin comparison. `startsWith(origin)` is bypassed by
   http://127.0.0.1:47291@evil.example/ (userinfo) — so parse, never prefix-match. */
function isOwn(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false; // unparsable = foreign
  }
}

function openExternalIfWeb(url: string) {
  try {
    const p = new URL(url).protocol;
    if (p === "http:" || p === "https:") shell.openExternal(url);
  } catch {
    /* unparsable: ignore */
  }
}

/* Guards for EVERY webContents the app ever creates (the window, and anything
   a future feature opens). The app uses no <webview>. */
function installGuards(origin: string) {
  app.on("web-contents-created", (_e, wc) => {
    wc.setWindowOpenHandler(({ url }) => {
      if (!isOwn(url, origin)) openExternalIfWeb(url);
      return { action: "deny" };
    });
    // The window never leaves the app. (A file dropped outside a drop zone would
    // otherwise replace the whole UI with that file.)
    wc.on("will-navigate", (e, url) => {
      if (isOwn(url, origin)) return;
      e.preventDefault();
      openExternalIfWeb(url);
    });
    // A server-side redirect must not carry any frame off the app either.
    wc.on("will-redirect", (e, url) => {
      if (!isOwn(url, origin)) e.preventDefault();
    });
    wc.on("will-attach-webview", (e) => e.preventDefault());
  });
}

/* Electron grants every permission to every origin by default. Only this app's
   own origin (the page and its same-origin effect iframes) gets what the app
   uses: camera + microphone (getUserMedia → "media") and fullscreen. */
const ALLOWED_PERMISSIONS = new Set<string>(["media", "fullscreen"]);

function installPermissionHandlers(origin: string) {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isOwn(details.requestingUrl, origin));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
    ALLOWED_PERMISSIONS.has(permission) && isOwn(requestingOrigin, origin),
  );
  // No USB / HID / serial / Bluetooth device is ever offered or remembered.
  ses.setDevicePermissionHandler(() => false);
}

/* Packaged app: its own minimal menu (no devtools item). The menu bar stays
   auto-hidden on Windows/Linux, the accelerators (copy/paste, F11, reload) work. */
function installMenu() {
  if (!LOCKED_DOWN) return; // unpackaged, or SYNTECH_DEVTOOLS=1: Electron's default menu
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    // macOS: the app menu (Quit, Hide) and File (Cmd+W closes the window).
    ...(isMac ? [{ role: "appMenu" }, { role: "fileMenu" }] as MenuItemConstructorOptions[] : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      // Everything the default View menu had except the DevTools item: an
      // accidental Ctrl+wheel zoom must stay undoable (Ctrl+0).
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

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
      devTools: !LOCKED_DOWN,
    },
  });

  win.once("ready-to-show", () => {
    win?.maximize();
    win?.show();
  });

  // (New-tab links go to the real browser and in-window navigation is guarded
  // by installGuards(), which covers every webContents.)

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
      const origin = `http://${HOST}:${port}`;
      installGuards(origin);
      installPermissionHandlers(origin);
      installMenu();
      createWindow(origin);
    } catch (err) {
      dialog.showErrorBox("VFX SYNTECH", `The app could not start.\n\n${String(err)}`);
      app.quit();
    }
  });
}
