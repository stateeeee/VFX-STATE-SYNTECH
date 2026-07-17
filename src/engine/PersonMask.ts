/* PersonMask — shared MediaPipe SelfieSegmentation service (Phase 3).
 *
 * Lazy: nothing loads until a node with segEnabled asks via enable().
 * States: off → loading → ready (a failure falls back to off with a
 * cooldown so per-frame enable() calls don't hammer the network).
 * The segmentation mask is drawn into maskCanvas, which the engine
 * consumes through engine.personMaskSource. The same CDN family the
 * standalone effects use — vendored locally in Phase 10.
 */

const CDN_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation';
const TICK_MS = 66;
const RETRY_COOLDOWN_MS = 5000;

export type PersonMaskState = 'off' | 'ready' | 'loading';

interface SelfieSegmentationLike {
  setOptions(o: { modelSelection: number; selfieMode?: boolean }): void;
  onResults(cb: (res: { segmentationMask: CanvasImageSource & { width: number; height: number } }) => void): void;
  initialize(): Promise<void>;
  send(input: { image: HTMLVideoElement }): Promise<void>;
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

  private seg: SelfieSegmentationLike | null = null;
  private maskCtx: CanvasRenderingContext2D | null = null;
  private busy = false;
  private lastAt = 0;
  private failedAt = 0;
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
        this.maskCtx?.drawImage(mask, 0, 0, w, h);
        this.ready = true;
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

  tick(source: HTMLVideoElement | null, now: number): void {
    if (this.state !== 'ready' || !this.seg || this.busy) return;
    if (!source || !(source instanceof HTMLVideoElement) || source.readyState < 2 || !source.videoWidth) return;
    if (now - this.lastAt < TICK_MS) return;
    this.lastAt = now;
    this.busy = true;
    this.seg.send({ image: source }).catch(() => { this.busy = false; });
  }

  /** Stop and release the segmenter. Reversible: a later enable() reloads. */
  dispose(): void {
    this.loadToken++;
    this.ready = false;
    this.state = 'off';
    this.busy = false;
    const seg = this.seg;
    this.seg = null;
    void seg?.close().catch(() => { /* already gone */ });
  }
}
