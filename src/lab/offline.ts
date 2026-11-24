/*
 * LAB OFFLINE — the Lab's frame-by-frame export machinery (docs/workflow/11-EXPORT-STILLS-LAB.md §2.3).
 *
 *   loadSharedEngines   injects the shared export engines (syn-export.js → window.SynExport, syn-still.js
 *                       → window.SynStill) into the shell document, once
 *   OfflineChain        the active nodes' SynFx, run one after the other for ONE frame: the native source
 *                       frame goes to node 1, its output to node 2, … the last output is the result
 *   decodePhotoNative   the ORIGINAL photo at its native size (never the Lab's 1920-px preview canvas)
 *   sourceBlob          the Blob behind the Lab INPUT's blob: URL (cached per URL)
 *
 * No React here, no state beyond the objects it returns: ChainLab owns the lifecycle.
 */

import type { SynFxApi, SynFxRegion } from './synlab';

/* ── window.SynExport / window.SynStill (types of the parts the Lab uses) ── */

export interface SynExportResult {
  filename?: string;
  codec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  fps?: number;
  frames?: number;
  bytes?: number;
  seconds?: number;
  renderFps?: number;
  warnings?: string[];
  savedTo?: string;
  realtime?: boolean;
  dropped?: number;
  stopped?: boolean;
  cancelled?: boolean;
  error?: string;
}

export interface SynRegion { canvas: HTMLCanvasElement; sx?: number; sy?: number; sw?: number; sh?: number }

export interface SynExportApi {
  isSupported(): boolean;
  probeFps(file: Blob | null, video?: HTMLVideoElement): Promise<{ fps: number; num: number; den: number; source?: string }>;
  render(opts: {
    video: HTMLVideoElement;
    file?: Blob | Promise<Blob | null> | null;
    audioFile?: Blob | Promise<Blob | null> | null;
    audioLoop?: boolean;
    audio?: boolean;
    quality?: 'master' | 'high';
    signal?: AbortSignal;
    useFilePicker?: boolean;
    filename?: string;
    prepare?: () => void | Promise<void>;
    ready?: (info: { fps: number; num: number; den: number; total: number; width: number; height: number; duration: number }) => void | Promise<void>;
    getFrame: (i: number, t: number) => Promise<SynRegion> | SynRegion;
    finish?: (result: SynExportResult | null) => void | Promise<void>;
    onProgress?: (i: number, total: number, phase: string, info: { speed: number; eta: number; width: number; height: number }) => void;
  }): Promise<SynExportResult>;
  recordLive(opts: {
    getCanvas: () => SynRegion | HTMLCanvasElement;
    fps?: number;
    audioStream?: MediaStream | null;
    quality?: 'master' | 'high';
    useFilePicker?: boolean;
    filename?: string;
    onProgress?: (sec: number, info: { frames: number; dropped: number; width: number; height: number }) => void;
  }): { stop(): Promise<SynExportResult>; done: Promise<SynExportResult> };
}

export interface SynStillResult {
  format?: string;
  filename?: string;
  width?: number;
  height?: number;
  alpha?: boolean;
  bytes?: number;
  seconds?: number;
  cancelled?: boolean;
  error?: string;
}

export interface SynStillApi {
  exportStill(opts: {
    format: 'png' | 'jpeg' | 'pdf';
    render: () => Promise<SynFxRegion & { alphaRect?: { x: number; y: number; w: number; h: number } }>;
    alphaSource?: Blob | null;
    alphaRect?: ((w: number, h: number) => { x: number; y: number; w: number; h: number } | null) | null;
    filename?: string;
    useFilePicker?: boolean;
    signal?: AbortSignal;
    onStatus?: (text: string) => void;
  }): Promise<SynStillResult>;
}

declare global {
  interface Window {
    SynExport?: SynExportApi;
    SynStill?: SynStillApi;
  }
}

/* ── loader ── */

const ENGINE_SRC = ['/effects/shared/syn-export.js', '/effects/shared/syn-still.js'];
let enginesPromise: Promise<void> | null = null;

const inject = (src: string) => new Promise<void>((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src;
  s.async = false;
  s.onload = () => resolve();
  s.onerror = () => reject(new Error(`could not load ${src}`));
  document.head.appendChild(s);
});

/** Loads the shared export engines into the shell once. syn-export.js finds its vendored MP4 muxer from its
 *  own <script src> (document.currentScript), so it is injected as a plain script, never inlined. */
export function loadSharedEngines(): Promise<void> {
  if (window.SynExport && window.SynStill) return Promise.resolve();
  if (!enginesPromise) {
    enginesPromise = (async () => {
      if (!window.SynExport) await inject(ENGINE_SRC[0]);
      if (!window.SynStill) await inject(ENGINE_SRC[1]);
    })().catch((e) => { enginesPromise = null; throw e; });
  }
  return enginesPromise;
}

/* ── source blobs ── */

const blobCache = new Map<string, Promise<Blob>>();

/** The Blob behind a blob: / same-origin URL. Cached per URL (one entry: the Lab works on one INPUT). */
export function sourceBlob(url: string): Promise<Blob> {
  let p = blobCache.get(url);
  if (!p) {
    blobCache.clear();
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`could not read the source (${r.status})`);
      return r.blob();
    });
    p.catch(() => { if (blobCache.get(url) === p) blobCache.delete(url); });
    blobCache.set(url, p);
  }
  return p;
}

/* Chromium's canvas limits: the engine refuses beyond them with a clear error, the shell checks first */
const MAX_SIDE = 32767;
const MAX_AREA = 268435456;

/** The ORIGINAL photo at its native size, on a black canvas (the effects compute the colour on the photo over
 *  black; SynStill re-applies the photo's own alpha afterwards). EXIF orientation applied. */
export async function decodePhotoNative(blob: Blob): Promise<HTMLCanvasElement> {
  let w = 0;
  let h = 0;
  let draw: (g: CanvasRenderingContext2D) => void;
  let close = () => {};
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(blob);
    w = bmp.width; h = bmp.height;
    draw = (g) => g.drawImage(bmp, 0, 0);
    close = () => bmp.close();
  } else {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    try { await img.decode(); } finally { URL.revokeObjectURL(url); }
    w = img.naturalWidth; h = img.naturalHeight;
    draw = (g) => g.drawImage(img, 0, 0);
  }
  try {
    if (!w || !h) throw new Error('the photo has no size');
    if (w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_AREA) {
      throw new Error(`the photo (${w}×${h}) is larger than this browser can handle — nothing was saved; the size is never reduced`);
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g || c.width !== w || c.height !== h) throw new Error(`could not allocate a ${w}×${h} canvas`);
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    draw(g);
    return c;
  } finally {
    close();
  }
}

/* ── the chain, one frame at a time ── */

export interface OfflineNode { id: string; name: string; fx: SynFxApi }

export class OfflineChain {
  /** nodes that began (end() runs on exactly these) */
  private began: OfflineNode[] = [];
  /** the input size each node was begun with */
  private sizes: { w: number; h: number }[] = [];
  private hops: HTMLCanvasElement[] = [];
  /** the size of the chain's output */
  outW = 0;
  outH = 0;

  constructor(private nodes: OfflineNode[]) {}

  get length() { return this.nodes.length; }

  /** begins every node: node 1 at (width × height), the next ones at the previous node's outSize.
   *  A throw leaves the nodes that began recorded: the caller's finally calls end(). */
  async begin(mode: 'still' | 'lab', width: number, height: number, fps: number | undefined, audioFile: Blob | null): Promise<void> {
    let w = width;
    let h = height;
    for (const n of this.nodes) {
      const opts: { mode: 'still' | 'lab'; width: number; height: number; fps?: number; audioFile?: Blob | null } = { mode, width: w, height: h };
      if (mode === 'lab') { opts.fps = fps; opts.audioFile = audioFile; }
      this.began.push(n); // recorded BEFORE the call: a begin that threw half-way still gets its end()
      await n.fx.begin(opts);
      this.sizes.push({ w, h });
      const o = n.fx.outSize(w, h);
      w = Math.max(1, Math.round(o.w));
      h = Math.max(1, Math.round(o.h));
    }
    this.outW = w;
    this.outH = h;
  }

  /** Draws frame i (time t) through the chain. `src` = the native source frame (width × height). The result is
   *  the last node's region (with its alphaRect); an empty chain returns `src` itself. */
  async frame(src: HTMLCanvasElement, i: number, t: number): Promise<SynFxRegion> {
    let cur: SynFxRegion = { canvas: src };
    for (let k = 0; k < this.began.length; k++) {
      const need = this.sizes[k];
      const c = cur.canvas;
      const sx = cur.sx ?? 0;
      const sy = cur.sy ?? 0;
      const sw = cur.sw ?? c.width;
      const sh = cur.sh ?? c.height;
      let input = c;
      if (k > 0 && !(sx === 0 && sy === 0 && sw === c.width && sh === c.height && c.width === need.w && c.height === need.h)) {
        /* the previous node's region is not exactly the next node's input: copy it (scaled only if the two
           nodes disagree about the size — they should not) */
        let hop = this.hops[k];
        if (!hop) { hop = document.createElement('canvas'); this.hops[k] = hop; }
        if (hop.width !== need.w || hop.height !== need.h) { hop.width = need.w; hop.height = need.h; }
        const g = hop.getContext('2d');
        if (!g) throw new Error('could not allocate a hop canvas');
        g.drawImage(c, sx, sy, sw, sh, 0, 0, need.w, need.h);
        input = hop;
      }
      const r = await this.began[k].fx.frame(input, i, t);
      if (!r || !r.canvas) throw new Error(`${this.began[k].name} returned no frame`);
      cur = { canvas: r.canvas, sx: r.sx, sy: r.sy, sw: r.sw, sh: r.sh, alphaRect: r.alphaRect };
    }
    return cur;
  }

  /** ALWAYS: end() on every node that began; every error is swallowed so all of them get their turn */
  async end(): Promise<void> {
    const list = this.began.splice(0);
    this.sizes = [];
    for (const n of list) {
      try { await n.fx.end(); } catch { /* the page is gone: nothing to restore */ }
    }
    this.hops.forEach((h) => { h.width = h.height = 0; });
    this.hops = [];
  }
}
