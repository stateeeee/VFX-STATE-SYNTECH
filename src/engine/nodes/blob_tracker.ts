import { EngineNode, NodeRenderContext } from '../SynEngine';
import { ParamSchema } from '../../bridge/types';

/* ═══════════════════════════════════════════════════════════════
   BLOB TRACKER — 1:1 port of public/effects/blob_tracker/index.html
   (Phase 8) — WORK IN PROGRESS, LAYER 1.

   The standalone is the biggest effect (~6876 lines): a Canvas-2D
   contour tracker + TWO three.js renderers (a float ping-pong ripple
   sim on `glC`, and a 3D "panels" scene on `panels-canvas`) whose
   canvases are stacked and composited (see the standalone capLoop).
   Per 04-SPEC the faithful port keeps three.js rendering to offscreen
   canvases uploaded as the node texture — the blob_reveal
   offscreen-2D→GL-texture pattern extended to three.js.

   ⚠️ NOT YET WIRED into nodes.ts — blob_tracker stays a DummyNode until
   every layer below is ported and parity-verified. This file is a
   clearly-labelled WIP foundation so the port can proceed in faithful,
   testable layers without breaking the working app.

   PORT LAYERS (■ done here / □ remaining):
   ■ L1 — tracker core: base video draw (_drawSrc) → 320×180 detect
        (processForDetect γ=1.75 → getBinary threshold+padY → findBlobs
        connected-components with the minArea + circularity<0.15 reject)
        → drawBlobMarker (square/rect/circle/corner, dashed, ID/A labels)
        → drawConnections (pairwise dist≤500, neonLine glow layers /
        drawArrow) → computeMotion (64×36 frame-diff energy) → upload.
   □ L2 — FX-in-blob system (drawFxInBlob ~260 lines: invert/thermal/
        security/liquid/glitch1(datamosh)/glitch2, bgFxMode on/off with
        the patch save/restore), drawTextFill (nums/letters/tmix).
   □ L3 — contour modes (ctMode edge/smart: _ctComputeContours,
        _ctRunSmartSeg — check if smart pulls MediaPipe) + _drawContour.
   □ L4 — optical flow (_flowUpdateGray/_flowComputeVel/_drawFlowViz).
   □ L5 — three.js ripple sim (rRenderer on glC, rRtA/rRtB float ping-
        pong, RP={disp,damp,waveC2}) — needs `three` (installed 0.128.0).
   □ L6 — three.js panels scene (panelsRenderer, panelMeshes, labels,
        panelsBg) + the stack composite (dc→panels→fxOv→glC).
   □ L7 — reactivity: audioReactiveFrame (ar-* gains → ParamBus routes,
        Phase-4 pattern) + videoReactiveFrame (vr-* → VideoAnalyzer);
        fixedPtsMode chaos engine; colours (trackerColor/connColor —
        the number/boolean ParamSchema can't hold colours: design TODO).
   □ L8 — full param table + parity suites (static/behavior/chain) +
        regression, then swap the factory and mark Phase 8 done.

   Standalone state defaults captured (index.html L1767-1788):
     P={threshold:127,brightness:31,contrast:2.15,minArea:100,
        datamosh:8,glitch:6}
     FX={blob:true,conn:true, …rest false}
     connStyle='solid',connWidth=10,connOpacity=1,connGlow=0,
     connColor='#0011ff', blobShape='square',blobDashed=false,
     padY=1.0,xyBlobScale=1.0,trackerColor='#ffffff'
   ═══════════════════════════════════════════════════════════════ */

const PW = 320, PH = 180; // fixed detection resolution (standalone proc-cv)
const SHAPES = ['square', 'rect', 'circle', 'corner'] as const;
const CONN_STYLES = ['solid', 'dashed', 'dashdot', 'arrows'] as const;

/* L1 param subset (numeric slider / enum / boolean controls the tracker
 * core reads). Later layers append their groups. Colours are fixed to the
 * standalone defaults for now — the number/boolean ParamSchema can't carry
 * them (flagged in L7). */
const PARAMS: ParamSchema[] = [
  // tracking
  { key: 'threshold', label: 'Threshold', type: 'number', value: 127, min: 0, max: 255, step: 1, reactive: true, aiHint: 'Luma threshold above which a pixel joins a tracked blob' },
  { key: 'brightness', label: 'Brightness', type: 'number', value: 31, min: -100, max: 100, step: 1, reactive: true, aiHint: 'Pre-detection brightness offset on the grayscale' },
  { key: 'contrast', label: 'Contrast', type: 'number', value: 2.15, min: 0.5, max: 5, step: 0.05, reactive: true, aiHint: 'Pre-detection contrast around mid-grey (before the γ=1.75 curve)' },
  { key: 'minArea', label: 'Min Area', type: 'number', value: 100, min: 10, max: 2000, step: 10, aiHint: 'Smallest connected component (in 320×180 px²) kept as a blob' },
  { key: 'blobScale', label: 'Blob Scale', type: 'number', value: 1, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Scales each blob marker size (xyBlobScale); 0 hides markers' },
  { key: 'padThresh', label: 'Threshold Pad', type: 'number', value: 1, min: 0, max: 1, step: 0.01, aiHint: 'Raises the effective threshold toward white as it drops from 1 (standalone padY)' },
  // markers
  { key: 'blobEnabled', label: 'Markers', type: 'boolean', value: 1, aiHint: '(on/off switch) Draw the blob tracking markers (FX.blob)' },
  { key: 'blobShape', label: 'Marker Shape', type: 'number', value: 0, min: 0, max: 3, step: 1, aiHint: '0 square · 1 rect · 2 circle · 3 corner-brackets' },
  { key: 'blobDashed', label: 'Dashed', type: 'boolean', value: 0, aiHint: '(on/off switch) Dashed marker outline' },
  // connections
  { key: 'connEnabled', label: 'Connections', type: 'boolean', value: 1, aiHint: '(on/off switch) Draw graph lines between nearby blobs (FX.conn)' },
  { key: 'connStyle', label: 'Conn Style', type: 'number', value: 0, min: 0, max: 3, step: 1, aiHint: '0 solid · 1 dashed · 2 dash-dot · 3 arrows' },
  { key: 'connWidth', label: 'Line Width', type: 'number', value: 10, min: 1, max: 20, step: 1, reactive: true, aiHint: 'Connection line width' },
  { key: 'connOpacity', label: 'Conn Opacity', type: 'number', value: 1, min: 0, max: 1, step: 0.01, aiHint: 'Connection line opacity' },
  { key: 'connGlow', label: 'Conn Glow', type: 'number', value: 0, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Neon glow halo on the connection lines' },
];

export class BlobTrackerNode implements EngineNode {
  readonly id = 'blob_tracker';
  readonly name = 'Blob Tracker';
  enabled = true;
  readonly params = PARAMS;

  private v: Record<string, number> = {};
  private gl: WebGL2RenderingContext | null = null;
  private outTex: WebGLTexture | null = null;
  private w = 0;
  private h = 0;

  // offscreen 2D canvases (dc = composite output, proc = 320×180 detect,
  // motion = 64×36 energy)
  private dc!: HTMLCanvasElement;      private dCtx!: CanvasRenderingContext2D;
  private procCv!: HTMLCanvasElement;  private pCtx!: CanvasRenderingContext2D;
  private motionCv!: HTMLCanvasElement; private motionCtx!: CanvasRenderingContext2D;
  private prevMotion: Uint8ClampedArray | null = null;
  private rawEnergy = 0;

  // fixed colours until L7 (ParamSchema can't hold colours)
  private trackerColor = '#ffffff';
  private connColor = '#0011ff';

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
    const mk = (rf = false): [HTMLCanvasElement, CanvasRenderingContext2D] => {
      const c = document.createElement('canvas');
      return [c, c.getContext('2d', rf ? { willReadFrequently: true } : undefined)!];
    };
    [this.dc, this.dCtx] = mk();
    [this.procCv, this.pCtx] = mk(true);
    [this.motionCv, this.motionCtx] = mk(true);
    this.procCv.width = PW; this.procCv.height = PH;
    this.motionCv.width = 64; this.motionCv.height = 36;

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
    this.dc.width = width; this.dc.height = height;
  }

  /* ── detection (standalone processForDetect / getBinary / findBlobs) ── */
  private processForDetect(data: Uint8ClampedArray): void {
    const brightness = this.v.brightness, contrast = this.v.contrast, gamma = 1.75;
    for (let i = 0; i < data.length; i += 4) {
      let g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      g += brightness; g = (g - 128) * contrast + 128;
      g = 255 * Math.pow(Math.max(0, Math.min(255, g)) / 255, 1 / gamma);
      data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, g));
    }
  }

  private getBinary(data: Uint8ClampedArray): Uint8Array {
    const bin = new Uint8Array(PW * PH);
    const threshold = this.v.threshold;
    const thr = threshold + Math.round((1 - this.v.padThresh) * (255 - threshold));
    for (let i = 0; i < bin.length; i++) bin[i] = data[i * 4] > thr ? 1 : 0;
    return bin;
  }

  private findBlobs(bin: Uint8Array): { x: number; y: number; w: number; h: number; cx: number; cy: number; area: number }[] {
    const vis = new Uint8Array(PW * PH);
    const blobs = [];
    const minArea = this.v.minArea;
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
      const idx = y * PW + x;
      if (!bin[idx] || vis[idx]) continue;
      const stack = [idx]; vis[idx] = 1;
      let mnX = x, mxX = x, mnY = y, mxY = y, sx = 0, sy = 0, area = 0;
      while (stack.length) {
        const ci = stack.pop()!, cx2 = ci % PW, cy2 = (ci / PW) | 0;
        sx += cx2; sy += cy2; area++;
        if (cx2 < mnX) mnX = cx2; if (cx2 > mxX) mxX = cx2;
        if (cy2 < mnY) mnY = cy2; if (cy2 > mxY) mxY = cy2;
        for (const ni of [ci - 1, ci + 1, ci - PW, ci + PW]) {
          if (ni < 0 || ni >= bin.length || vis[ni] || !bin[ni]) continue;
          if (Math.abs((ni % PW) - cx2) > 1) continue;
          vis[ni] = 1; stack.push(ni);
        }
      }
      if (area < minArea) continue;
      const bw = mxX - mnX + 1, bh = mxY - mnY + 1, per = 2 * (bw + bh);
      if ((4 * Math.PI * area) / (per * per) < 0.15) continue;
      blobs.push({ x: mnX, y: mnY, w: bw, h: bh, cx: sx / area, cy: sy / area, area });
    }
    return blobs;
  }

  /* ── connection rendering (standalone neonLine / drawArrow / applyConnStyle) ── */
  private applyConnStyle(ctx: CanvasRenderingContext2D): void {
    switch (CONN_STYLES[this.v.connStyle | 0]) {
      case 'dashed': ctx.setLineDash([20, 8]); break;
      case 'dashdot': ctx.setLineDash([20, 6, 4, 6]); break;
      default: ctx.setLineDash([]); break;
    }
  }

  private neonLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, al: number): void {
    const g = this.v.connGlow, cw = this.v.connWidth, co = this.v.connOpacity, cc = this.connColor;
    if (g > 0) {
      ctx.save();
      ctx.globalAlpha = al * co * 0.12; ctx.strokeStyle = cc;
      ctx.lineWidth = cw + g * 48; ctx.shadowBlur = g * 80; ctx.shadowColor = cc;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.globalAlpha = al * co * 0.3; ctx.lineWidth = cw + g * 22; ctx.shadowBlur = g * 45;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.globalAlpha = al * co * 0.75; ctx.lineWidth = cw + g * 8; ctx.shadowBlur = g * 20;
      this.applyConnStyle(ctx);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.globalAlpha = al * co * g; ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = Math.max(0.6, cw * 0.22); ctx.shadowBlur = 0; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalAlpha = al * co; ctx.strokeStyle = cc; ctx.lineWidth = cw;
      this.applyConnStyle(ctx);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.restore();
    }
  }

  private drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, alpha: number): void {
    const ang = Math.atan2(y2 - y1, x2 - x1), dist = Math.hypot(x2 - x1, y2 - y1);
    if (dist < 2) return;
    const head = Math.min(18, dist * 0.22);
    const g = this.v.connGlow, cw = this.v.connWidth, co = this.v.connOpacity, cc = this.connColor;
    ctx.save();
    if (g > 0) {
      ctx.globalAlpha = alpha * co * 0.12; ctx.strokeStyle = cc; ctx.lineWidth = cw + g * 48;
      ctx.shadowBlur = g * 80; ctx.shadowColor = cc; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.globalAlpha = alpha * co * 0.35; ctx.lineWidth = cw + g * 20; ctx.shadowBlur = g * 40;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.globalAlpha = alpha * co; ctx.strokeStyle = cc; ctx.fillStyle = cc; ctx.lineWidth = cw;
    if (g > 0) { ctx.shadowBlur = g * 15; ctx.shadowColor = cc; }
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 6), y2 - head * Math.sin(ang - Math.PI / 6));
    ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 6), y2 - head * Math.sin(ang + Math.PI / 6));
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  private drawConnections(blobs: { cx: number; cy: number }[]): void {
    if (this.v.connEnabled < 0.5) return;
    const ctx = this.dCtx;
    const arrows = CONN_STYLES[this.v.connStyle | 0] === 'arrows';
    for (let i = 0; i < blobs.length; i++) for (let j = i + 1; j < blobs.length; j++) {
      const a = blobs[i], b = blobs[j], dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      if (dist <= 500) {
        const al = (1 - dist / 500) * 0.85;
        if (arrows) this.drawArrow(ctx, a.cx, a.cy, b.cx, b.cy, al);
        else this.neonLine(ctx, a.cx, a.cy, b.cx, b.cy, al);
      }
    }
  }

  private getShape(idx: number): typeof SHAPES[number] {
    return SHAPES[this.v.blobShape | 0] ?? SHAPES[idx % 4];
  }

  private drawBlobMarker(b: { cx: number; cy: number; w: number; h: number; area: number }, scX: number, scY: number, idx: number): void {
    const scale = this.v.blobScale;
    if (this.v.blobEnabled < 0.5 || scale < 0.02) return;
    const ctx = this.dCtx;
    const cx = b.cx, cy = b.cy, bw = b.w * scX * scale, bh = b.h * scY * scale;
    const shape = this.getShape(idx);
    const sq = Math.max(bw, bh) / 2, r = Math.max(bw, bh) / 2;
    const cornerLen = Math.min(bw, bh) * 0.3;
    const tCol = this.trackerColor;
    ctx.save(); ctx.strokeStyle = tCol; ctx.lineWidth = 2; ctx.globalAlpha = 1.0;
    if (this.v.blobDashed >= 0.5) ctx.setLineDash([6, 4]); else ctx.setLineDash([]);
    ctx.beginPath();
    switch (shape) {
      case 'square': ctx.rect(cx - sq, cy - sq, sq * 2, sq * 2); break;
      case 'rect': ctx.rect(cx - bw / 2, cy - bh / 2, bw, bh); break;
      case 'circle': ctx.arc(cx, cy, r, 0, Math.PI * 2); break;
      case 'corner': {
        const x = cx - bw / 2, y = cy - bh / 2, w = bw, h = bh;
        ctx.moveTo(x + cornerLen, y); ctx.lineTo(x, y); ctx.lineTo(x, y + cornerLen);
        ctx.moveTo(x + w - cornerLen, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerLen);
        ctx.moveTo(x, y + h - cornerLen); ctx.lineTo(x, y + h); ctx.lineTo(x + cornerLen, y + h);
        ctx.moveTo(x + w - cornerLen, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cornerLen);
        break;
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fillStyle = tCol; ctx.fill(); ctx.strokeStyle = tCol; ctx.stroke();
    ctx.font = '10px JetBrains Mono,monospace'; ctx.fillStyle = tCol; ctx.globalAlpha = 0.85;
    ctx.fillText('ID:' + (idx + 1), cx + 22, cy - 12); ctx.fillText('A:' + b.area, cx + 22, cy + 1);
    ctx.restore();
  }

  private computeMotion(src: TexImageSource): void {
    try {
      this.motionCtx.drawImage(src as CanvasImageSource, 0, 0, 64, 36);
      const curr = this.motionCtx.getImageData(0, 0, 64, 36).data;
      if (this.prevMotion) {
        let d = 0;
        for (let i = 0; i < curr.length; i += 4) {
          d += Math.abs(curr[i] - this.prevMotion[i]) + Math.abs(curr[i + 1] - this.prevMotion[i + 1]) + Math.abs(curr[i + 2] - this.prevMotion[i + 2]);
        }
        this.rawEnergy = Math.min(d / (64 * 36 * 255 * 3 * 0.15), 1);
      }
      this.prevMotion = new Uint8ClampedArray(curr);
    } catch { /* source not ready */ }
  }

  render(ctx: NodeRenderContext): WebGLTexture {
    const gl = ctx.gl;
    const src = ctx.source;
    if (!src || !this.outTex || this.w < 2) return ctx.inputTex;
    const dW = this.w, dH = this.h;

    // 1) raw colour video base
    this.dCtx.drawImage(src as CanvasImageSource, 0, 0, dW, dH);

    // 2) detect on the 320×180 processing canvas
    this.pCtx.drawImage(src as CanvasImageSource, 0, 0, PW, PH);
    const id = this.pCtx.getImageData(0, 0, PW, PH);
    this.processForDetect(id.data);
    const bin = this.getBinary(id.data);
    const blobs = this.findBlobs(bin);
    const scX = dW / PW, scY = dH / PH;
    const sc = blobs.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, cx: b.cx * scX, cy: b.cy * scY, area: b.area }));

    // 3) tracker overlays (L2–L4 FX/flow/contour still to come)
    this.drawConnections(sc);
    sc.forEach((b, i) => this.drawBlobMarker(b, scX, scY, i));
    this.computeMotion(src);

    // upload composite (FLIP_Y — engine convention)
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
