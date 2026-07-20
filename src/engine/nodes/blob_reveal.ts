import { EngineNode, NodeRenderContext } from '../SynEngine';
import { ParamSchema } from '../../bridge/types';

/* ═══════════════════════════════════════════════════════════════
   BLOB REVEAL — 1:1 port of public/effects/blob_reveal/index.html
   (Phase 7).

   The standalone is a PURE Canvas-2D rotoscope engine (no WebGL):
   black frame → bright-region "blob windows" that show the video
   clipped to detected rectangles → the segmented subject composited
   on top through a GPU-composited (eroded + feathered) mask. This
   node runs that EXACT 2D pipeline on its own offscreen canvases and
   uploads the finished frame as its output texture — 1:1 means
   identical output, not identical plumbing (04-SPEC port note).

   Faithful details preserved from the standalone:
   • detectAndDrawBlobs(): 320×180 luma threshold → square-kernel
     dilate → 4-neighbour BFS connected components (same wrap guard),
     area filter scaled by the node/proc size ratio, top-N by area,
     each grown by the audio-reactive expansion and used as a clip
     window for the full-res video.
   • drawSubject(): brightness/contrast mask conditioning, the erode
     "inset drawImage" shrink, CSS blur feather, destination-in cut of
     the video by the mask ALPHA (MediaPipe encodes person confidence
     in alpha — the same channel bokeh/anamorphic read as `.a`), then
     an opacity blit.

   Deliberate substitutions (engine architecture, decision #1):
   • The standalone's own eagerly-loaded MediaPipe becomes the shared
     PersonMask service (segEnabled + ctx.personMask/personMaskVersion).
     The service's maskCanvas carries the raw segmentationMask with the
     same alpha semantics, so the destination-in cut is identical.
     `segN` throttles how often the node refreshes the cached mask
     (every N-th arrival), reproducing the standalone's send-every-N
     staleness against the service's own ~15 Hz cadence.
   • The standalone's built-in AudioContext/analyser (video-track beat
     detection) is replaced by the real AudioEngine, the Phase-4
     pattern: the internal `beatExpand` runtime value becomes the
     reactive `beatReact` param, pre-wired to `loud` so blobs breathe
     with the music exactly as the original's loud-floor did. `audioExp`
     stays the px-scale slider it always was.

   The node draws from ctx.source (the NodeRenderContext exposes it
   "for nodes that need CPU pixel analysis" — this is the canonical
   such node), giving byte-identical input to the standalone's `vid`.
   ═══════════════════════════════════════════════════════════════ */

const PW = 320, PH = 180; // fixed blob-detection resolution (standalone cProc)

const PARAMS: ParamSchema[] = [
  { key: 'segEnabled', label: 'Person Mask', type: 'boolean', value: 1, aiHint: '(on/off switch) Reveal the segmented subject on top of the blob windows; off shows only the bright-region blob windows, like the standalone before its segmenter loads' },
  // rotoscope / seg
  { key: 'segThr', label: 'Threshold', type: 'number', value: 40, min: 5, max: 95, step: 1, aiHint: 'Mask conditioning threshold (brightness/contrast on the mask RGB before the alpha-driven cut) — matches the standalone control' },
  { key: 'erode', label: 'Erode', type: 'number', value: 4, min: 0, max: 30, step: 1, reactive: true, aiHint: 'Shrinks the subject mask inward (kills segmentation halos) via the inset-redraw trick' },
  { key: 'feather', label: 'Feather', type: 'number', value: 3, min: 0, max: 30, step: 1, reactive: true, aiHint: 'Soft blur on the subject mask edge (free GPU feather)' },
  { key: 'opacity', label: 'Opacity', type: 'number', value: 1, min: 0.1, max: 1, step: 0.01, reactive: true, aiHint: 'Opacity of the revealed subject over the blob windows' },
  { key: 'segN', label: 'Seg every N', type: 'number', value: 1, min: 1, max: 6, step: 1, aiHint: 'Refresh the person mask every Nth arrival — higher = staler mask, cheaper (reproduces the standalone send-every-N)' },
  // blob detection
  { key: 'lumThr', label: 'Lum Thresh', type: 'number', value: 170, min: 0, max: 255, step: 1, reactive: true, aiHint: 'Luminance above which a pixel is part of a bright blob' },
  { key: 'minArea', label: 'Min Area', type: 'number', value: 300, min: 20, max: 5000, step: 20, aiHint: 'Smallest blob (in full-res px²) that survives — rejects speckle' },
  { key: 'maxBlobs', label: 'Max Blobs', type: 'number', value: 14, min: 1, max: 30, step: 1, reactive: true, aiHint: 'Keep only the N largest blobs' },
  { key: 'dilate', label: 'Dilate', type: 'number', value: 4, min: 0, max: 20, step: 1, reactive: true, aiHint: 'Grow bright regions before detection so nearby specks merge into one blob' },
  // audio-reactive expansion
  { key: 'audioExp', label: 'Audio Exp', type: 'number', value: 24, min: 0, max: 60, step: 1, reactive: true, aiHint: 'Max px each blob window expands at full audio energy (scaled by Audio React)' },
  { key: 'beatReact', label: 'Audio React', type: 'number', value: 0, min: 0, max: 1, step: 0.01, reactive: true, defaultRoute: { source: 'loud', amount: 0.9 }, aiHint: 'Live audio-energy amount (0..1) driving blob expansion — pre-wired to loudness so blobs breathe with the music, like the standalone beatExpand' },
];

export class BlobRevealNode implements EngineNode {
  readonly id = 'blob_reveal';
  readonly name = 'Blob Reveal';
  enabled = true;
  readonly params = PARAMS;

  private v: Record<string, number> = {};
  private gl: WebGL2RenderingContext | null = null;
  private outTex: WebGLTexture | null = null;

  private w = 0;
  private h = 0;

  // offscreen 2D pipeline canvases (mirror the standalone's dc/cBlob/cMask/
  // cSub/cErode/cProc)
  private dc!: HTMLCanvasElement;    private dCtx!: CanvasRenderingContext2D;
  private cBlob!: HTMLCanvasElement; private blobCtx!: CanvasRenderingContext2D;
  private cMask!: HTMLCanvasElement; private maskCtx!: CanvasRenderingContext2D;
  private cSub!: HTMLCanvasElement;  private subCtx!: CanvasRenderingContext2D;
  private cErode!: HTMLCanvasElement; private erodeCtx!: CanvasRenderingContext2D;
  private cProc!: HTMLCanvasElement; private procCtx!: CanvasRenderingContext2D;
  private cTmp!: HTMLCanvasElement;  private tmpCtx!: CanvasRenderingContext2D; // no-erode feather scratch

  // shared-mask consumption
  private curMask: TexImageSource | null = null;
  private lastMaskV = -1;
  private maskArrivals = 0;

  // BFS scratch (reused to avoid per-frame allocation churn)
  private bin = new Uint8Array(PW * PH);
  private dil2 = new Uint8Array(PW * PH);
  private vis = new Uint8Array(PW * PH);
  private queue = new Int32Array(PW * PH);

  constructor() {
    PARAMS.forEach((p) => { this.v[p.key] = Number(p.value); });
  }

  setParam(key: string, value: unknown): void {
    const n = Number(value);
    if (!isNaN(n)) this.v[key] = n;
  }

  getParam(key: string): unknown {
    return this.v[key] ?? 0;
  }

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    const mk = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
      const c = document.createElement('canvas');
      return [c, c.getContext('2d')!];
    };
    const mkRF = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
      const c = document.createElement('canvas');
      return [c, c.getContext('2d', { willReadFrequently: true })!];
    };
    [this.dc, this.dCtx] = mk();
    [this.cBlob, this.blobCtx] = mk();
    [this.cMask, this.maskCtx] = mk();
    [this.cSub, this.subCtx] = mk();
    [this.cErode, this.erodeCtx] = mk();
    [this.cProc, this.procCtx] = mkRF();
    [this.cTmp, this.tmpCtx] = mk();
    this.cProc.width = PW; this.cProc.height = PH;

    this.outTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.outTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(16));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  resize(width: number, height: number): void {
    if (width < 2 || height < 2 || (width === this.w && height === this.h)) return;
    this.w = width; this.h = height;
    [this.dc, this.cBlob, this.cMask, this.cSub, this.cErode, this.cTmp].forEach((c) => {
      c.width = width; c.height = height;
    });
  }

  /* ── blob detection + draw (standalone detectAndDrawBlobs, verbatim) ── */
  private detectAndDrawBlobs(src: TexImageSource): void {
    const W = this.w, H = this.h;
    this.procCtx.drawImage(src as CanvasImageSource, 0, 0, PW, PH);
    const px = this.procCtx.getImageData(0, 0, PW, PH).data;

    const be = Math.max(0, Math.min(1, this.v.beatReact));
    const audioExp = this.v.audioExp;
    const audioBoost = Math.round(be * audioExp / 10);
    const dil = Math.min(this.v.dilate + audioBoost, 22);
    const thr = this.v.lumThr;

    const bin = this.bin;
    for (let i = 0; i < bin.length; i++) {
      const lum = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
      bin[i] = lum > thr ? 1 : 0;
    }

    if (dil > 0) {
      const d2 = this.dil2; d2.set(bin);
      for (let y = 0; y < PH; y++) {
        for (let x = 0; x < PW; x++) {
          if (bin[y * PW + x]) continue;
          let hit = false;
          const y0 = Math.max(0, y - dil), y1 = Math.min(PH - 1, y + dil);
          const x0 = Math.max(0, x - dil), x1 = Math.min(PW - 1, x + dil);
          outer: for (let ny = y0; ny <= y1; ny++) {
            for (let nx = x0; nx <= x1; nx++) {
              if (bin[ny * PW + nx]) { hit = true; break outer; }
            }
          }
          if (hit) d2[y * PW + x] = 1;
        }
      }
      bin.set(d2);
    }

    const vis = this.vis; vis.fill(0);
    const q = this.queue;
    const blobs: { x: number; y: number; w: number; h: number; area: number }[] = [];
    const sf = (W * H) / (PW * PH);
    const minPx = this.v.minArea / sf;

    for (let y = 0; y < PH; y++) {
      for (let x = 0; x < PW; x++) {
        const idx = y * PW + x;
        if (!bin[idx] || vis[idx]) continue;
        q[0] = idx; vis[idx] = 1;
        let x0 = x, x1 = x, y0 = y, y1 = y, area = 0, qi = 0, qlen = 1;
        while (qi < qlen) {
          const ci = q[qi++]; area++;
          const cx = ci % PW, cy = (ci / PW) | 0;
          if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
          if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
          const neigh = [ci - 1, ci + 1, ci - PW, ci + PW];
          for (let k = 0; k < 4; k++) {
            const ni = neigh[k];
            if (ni < 0 || ni >= bin.length || vis[ni] || !bin[ni]) continue;
            if (Math.abs((ni % PW) - cx) > 1) continue;
            vis[ni] = 1; q[qlen++] = ni;
          }
        }
        if (area >= minPx) blobs.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area });
      }
    }
    blobs.sort((a, b) => b.area - a.area);
    const top = blobs.slice(0, Math.max(1, Math.round(this.v.maxBlobs)));

    const scX = W / PW, scY = H / PH;
    const expand = be * audioExp;
    this.blobCtx.clearRect(0, 0, W, H);
    top.forEach((b) => {
      const rx = Math.round(b.x * scX - expand);
      const ry = Math.round(b.y * scY - expand);
      const rw = Math.round(b.w * scX + expand * 2);
      const rh = Math.round(b.h * scY + expand * 2);
      this.blobCtx.save();
      this.blobCtx.beginPath();
      this.blobCtx.rect(rx, ry, rw, rh);
      this.blobCtx.clip();
      this.blobCtx.drawImage(src as CanvasImageSource, 0, 0, W, H);
      this.blobCtx.restore();
    });
  }

  /* ── subject reveal (standalone drawSubject, verbatim) ── */
  private drawSubject(src: TexImageSource): void {
    if (this.v.segEnabled < 0.5 || !this.curMask) return;
    const W = this.w, H = this.h;
    const mask = this.curMask as CanvasImageSource;

    // step 1 — condition the raw mask (brightness/contrast on RGB; the cut
    // downstream is alpha-driven, so this matches the standalone exactly,
    // quirk included)
    this.maskCtx.clearRect(0, 0, W, H);
    const thr = this.v.segThr;
    const contrastF = Math.max(1.5, 20 - (thr - 5) * 0.2);
    const briF = 0.5 / Math.max(0.01, thr / 100);
    this.maskCtx.filter = `brightness(${briF.toFixed(2)}) contrast(${contrastF.toFixed(1)})`;
    this.maskCtx.drawImage(mask, 0, 0, W, H);
    this.maskCtx.filter = 'none';

    // step 2 — erode (inset redraw shrinks the mask alpha inward) + feather
    const erode = this.v.erode;
    const feather = this.v.feather;
    if (erode > 0) {
      this.erodeCtx.clearRect(0, 0, W, H);
      this.erodeCtx.drawImage(this.cMask, erode, erode, W - erode * 2, H - erode * 2);
      this.maskCtx.clearRect(0, 0, W, H);
      if (feather > 0) {
        this.maskCtx.filter = `blur(${feather}px)`;
        this.maskCtx.drawImage(this.cErode, 0, 0);
        this.maskCtx.filter = 'none';
      } else {
        this.maskCtx.drawImage(this.cErode, 0, 0);
      }
    } else if (feather > 0) {
      this.tmpCtx.clearRect(0, 0, W, H);
      this.tmpCtx.drawImage(this.cMask, 0, 0);
      this.maskCtx.clearRect(0, 0, W, H);
      this.maskCtx.filter = `blur(${feather}px)`;
      this.maskCtx.drawImage(this.cTmp, 0, 0);
      this.maskCtx.filter = 'none';
    }

    // step 3 — cut the video through the mask alpha
    this.subCtx.clearRect(0, 0, W, H);
    this.subCtx.drawImage(src as CanvasImageSource, 0, 0, W, H);
    this.subCtx.globalCompositeOperation = 'destination-in';
    this.subCtx.drawImage(this.cMask, 0, 0);
    this.subCtx.globalCompositeOperation = 'source-over';

    // step 4 — blit the subject over the blob windows at the set opacity
    this.dCtx.globalAlpha = this.v.opacity;
    this.dCtx.drawImage(this.cSub, 0, 0);
    this.dCtx.globalAlpha = 1;
  }

  render(ctx: NodeRenderContext): WebGLTexture {
    const gl = ctx.gl;
    const src = ctx.source;
    // nothing to draw yet — pass the incoming frame through
    if (!src || !this.outTex || this.w < 2) return ctx.inputTex;

    // mask intake: consume every Nth fresh arrival (staleness = standalone
    // send-every-N); keep the previously cached mask between refreshes
    if (this.v.segEnabled >= 0.5 && ctx.personMask && ctx.personMaskVersion !== this.lastMaskV) {
      this.lastMaskV = ctx.personMaskVersion;
      this.maskArrivals++;
      const segN = Math.max(1, Math.round(this.v.segN));
      if (!this.curMask || this.maskArrivals % segN === 0) this.curMask = ctx.personMask;
    }
    if (this.v.segEnabled < 0.5) this.curMask = null;

    // detect + draw the bright-region blob windows
    this.detectAndDrawBlobs(src);

    // composite: black → blob windows → revealed subject
    const W = this.w, H = this.h;
    this.dCtx.fillStyle = '#000';
    this.dCtx.fillRect(0, 0, W, H);
    this.dCtx.drawImage(this.cBlob, 0, 0);
    this.drawSubject(src);

    // upload the finished 2D frame as this node's output texture (FLIP_Y to
    // match the engine's source-upload orientation, so downstream nodes and
    // the final blit see it upright)
    gl.bindTexture(gl.TEXTURE_2D, this.outTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.dc);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return this.outTex;
  }

  dispose(gl: WebGL2RenderingContext): void {
    if (this.outTex) { gl.deleteTexture(this.outTex); this.outTex = null; }
  }
}
