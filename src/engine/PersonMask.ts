/* PersonMask — shared MediaPipe SelfieSegmentation service (Phase 3).
 *
 * Lazy: nothing loads until a node with segEnabled asks via enable().
 * States: off → loading → ready (a failure falls back to off with a
 * cooldown so per-frame enable() calls don't hammer the network).
 * The segmentation mask is drawn into maskCanvas, which the engine
 * consumes through engine.personMaskSource. The same CDN family the
 * standalone effects use — vendored locally in Phase 10.
 *
 * Sources: a <video> (file / webcam) is segmented every TICK_MS. A still
 * <img> is segmented once per image; afterwards the cached mask is
 * re-announced (version bump, no inference) on the same cadence, because
 * consumers smooth the mask over arrivals (bokeh's temporal pass blends
 * each one in at 0.28) and would otherwise stay stuck on a faint first
 * result. Same pixels in, same mask out — the model would only burn GPU.
 */

// Phase-10: vendored locally under public/ (served at /effects/vendor/...) for
// offline resilience — was https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation
const CDN_BASE = '/effects/vendor/mediapipe/selfie_segmentation';
const TICK_MS = 66;
const RETRY_COOLDOWN_MS = 5000;

export type PersonMaskState = 'off' | 'ready' | 'loading';

interface SelfieSegmentationLike {
  setOptions(o: { modelSelection: number; selfieMode?: boolean }): void;
  onResults(cb: (res: { segmentationMask: CanvasImageSource & { width: number; height: number } }) => void): void;
  initialize(): Promise<void>;
  send(input: { image: HTMLVideoElement | HTMLImageElement }): Promise<void>;
  close(): Promise<void>;
}

let scriptPromise: Promise<void> | null = null;
const loadScript = (): Promise<void> => {
  if ((window as any).SelfieSegmentation) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${CDN_BASE}/selfie_segmentation.js`;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => { scriptPromise = null; reject(new Error('selfie_segmentation.js failed to load')); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
};

export class PersonMask {
  state: PersonMaskState = 'off';
  ready = false;
  maskCanvas: HTMLCanvasElement | null = null;
  /** bumps once per fresh segmentation result — consumers gate per-arrival work on it */
  version = 0;

  private seg: SelfieSegmentationLike | null = null;
  private maskCtx: CanvasRenderingContext2D | null = null;
  private busy = false;
  private lastAt = 0;
  private failedAt = 0;
  // the still whose mask sits in maskCanvas (element + URL), and whether
  // its segmentation has come back yet
  private stillEl: HTMLImageElement | null = null;
  private stillSrc = '';
  private stillDone = false;
  // invalidates in-flight loads when dispose() lands mid-initialize — the
  // instance outlives React StrictMode's dev mount/unmount/mount cycle, so
  // dispose must be reversible, never a one-way latch
  private loadToken = 0;

  enable(): void {
    if (this.state !== 'off') return;
    if (performance.now() - this.failedAt < RETRY_COOLDOWN_MS && this.failedAt > 0) return;
    this.state = 'loading';
    void this.load(++this.loadToken);
  }

  private async load(token: number): Promise<void> {
    try {
      await loadScript();
      const SS = (window as any).SelfieSegmentation;
      const seg: SelfieSegmentationLike = new SS({ locateFile: (f: string) => `${CDN_BASE}/${f}` });
      seg.setOptions({ modelSelection: 1, selfieMode: false });
      seg.onResults((res) => {
        this.busy = false;
        const mask = res.segmentationMask;
        if (!mask) return;
        if (this.stillEl) this.stillDone = true;
        if (!this.maskCanvas) {
          this.maskCanvas = document.createElement('canvas');
          this.maskCtx = this.maskCanvas.getContext('2d');
        }
        const w = Number(mask.width) || 256;
        const h = Number(mask.height) || 256;
        if (this.maskCanvas.width !== w || this.maskCanvas.height !== h) {
          this.maskCanvas.width = w;
          this.maskCanvas.height = h;
        }
        // the mask's background is transparent — without a clear, person
        // pixels from earlier frames survive source-over and the mask can
        // only ever grow
        this.maskCtx?.clearRect(0, 0, w, h);
        this.maskCtx?.drawImage(mask, 0, 0, w, h);
        this.ready = true;
        this.version++;
      });
      await seg.initialize();
      if (token !== this.loadToken || this.state !== 'loading') { void seg.close(); return; }
      this.seg = seg;
      this.state = 'ready';
    } catch (e) {
      console.warn('PersonMask: SelfieSegmentation unavailable —', (e as Error)?.message ?? e);
      if (token === this.loadToken) {
        this.state = 'off';
        this.ready = false;
        this.failedAt = performance.now();
      }
    }
  }

  tick(source: HTMLVideoElement | HTMLImageElement | null, now: number): void {
    if (this.state !== 'ready' || !this.seg || this.busy) return;
    if (source instanceof HTMLImageElement) {
      this.tickStill(source, now);
      return;
    }
    if (!source || !(source instanceof HTMLVideoElement) || source.readyState < 2 || !source.videoWidth) return;
    if (now - this.lastAt < TICK_MS) return;
    this.lastAt = now;
    this.stillEl = null; // a video owns the mask now
    this.busy = true;
    this.seg.send({ image: source }).catch(() => { this.busy = false; });
  }

  private tickStill(img: HTMLImageElement, now: number): void {
    if (!img.complete || !img.naturalWidth) return;
    if (now - this.lastAt < TICK_MS) return;
    this.lastAt = now;
    const src = img.currentSrc || img.src;
    if (img === this.stillEl && src === this.stillSrc) {
      // already segmented: re-announce the cached result (see header)
      if (this.stillDone) this.version++;
      return;
    }
    this.stillEl = img;
    this.stillSrc = src;
    this.stillDone = false;
    this.busy = true;
    this.seg!.send({ image: img }).catch(() => {
      this.busy = false;
      this.stillEl = null; // failed — try this still again next tick
    });
  }

  /** Stop and release the segmenter. Reversible: a later enable() reloads. */
  dispose(): void {
    this.loadToken++;
    this.ready = false;
    this.state = 'off';
    this.busy = false;
    this.stillEl = null; // a reloaded segmenter segments the still afresh
    const seg = this.seg;
    this.seg = null;
    void seg?.close().catch(() => { /* already gone */ });
  }
}
