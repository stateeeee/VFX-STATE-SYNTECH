import * as THREE from 'three';
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
   ■ L2 — FX system: drawFxInBlob (invert/thermal/security/liquid/
        glitch1(datamosh)/glitch2, shape-masked) + drawTextFill (nums/
        letters/tmix) + applyFxBg, with the bgFxMode on/off branch (patch
        save→applyFxBg→restore). invert+thermal are deterministic (pixel-
        exact); security/liquid/glitch1/glitch2/text are time/random-seeded
        (behavioural). Colours use the standalone's built-in FX colours
        (vfxColor override is an L7 TODO — ParamSchema has no colour type).
   ◐ L3 — contour markers. EDGE DONE (radialContour ray-cast on the detection
        binary → douglasPeucker → catmull-rom spline + optional fill;
        drawBlobMarker delegates when ctMode≥1 and the contour has ≥6 pts —
        deterministic, verifiable pixel-exact). SMART (ctMode=2) still □: a NEW
        MediaPipe dep — the **Tasks-Vision ImageSegmenter** (selfie_segmenter
        .tflite via storage.googleapis.com, L4731/4886 `_ctRunSmartSeg`), NOT
        the SelfieSegmentation the shared PersonMask uses; decide per 04-SPEC
        (shared-service map vs new dep). Until then ctMode=2 falls back to edge.
   ◐ L4 — optical flow DONE (Lucas-Kanade 16×16 per blob → EMA 0.42 →
        arrows green→red + fading trails; flowUpdateGray on raw gray before
        processForDetect). Temporal ⇒ verified behaviourally. flowFeedAR
        (flow→AR signal) deferred to L7 reactivity.
   ■ L5 — three.js ripple sim DONE. rRtA/rRtB float ping-pong wave-equation
        (RIPPLE_SIM_FS) + gradient-displacement shader (RIPPLE_DISP_FS), both
        verbatim, on the node's own offscreen THREE.WebGLRenderer; its canvas
        becomes the node output when rippleOn. OPERATOR DECISION (a): the
        standalone's mouse force is replaced by the audio-reactive
        `rippleForce` param, pre-wired to `beat` — the water pulses with the
        music. With force ~0 the field is flat ⇒ clean passthrough of dc.
        rippleDisp/Damp/Wave = the standalone RP + sDisp/sDamp/sWave.
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
  // L2 — FX system
  { key: 'bgFxMode', label: 'BG FX Mode', type: 'boolean', value: 0, aiHint: '(on/off switch) On = FX fill the background (blobs stay clean video); off = FX only inside the blobs' },
  { key: 'fxOpacity', label: 'FX Opacity', type: 'number', value: 1, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Global blend of every active FX over the clean pixels' },
  { key: 'fxInvert', label: 'FX Invert', type: 'boolean', value: 0, aiHint: '(on/off switch) Colour inversion' },
  { key: 'fxThermal', label: 'FX Thermal', type: 'boolean', value: 0, aiHint: '(on/off switch) Thermal-camera false-colour map' },
  { key: 'fxSecurity', label: 'FX Security', type: 'boolean', value: 0, aiHint: '(on/off switch) CCTV look: green tint, scanlines, timestamp + CAM ID + corner brackets (time/noise seeded)' },
  { key: 'fxLiquid', label: 'FX Liquid', type: 'boolean', value: 0, aiHint: '(on/off switch) Travelling sine-wave row shift (time seeded)' },
  { key: 'fxData', label: 'FX Glitch 1', type: 'boolean', value: 0, aiHint: '(on/off switch) Datamosh block displacement (random seeded)' },
  { key: 'fxGlitch', label: 'FX Glitch 2', type: 'boolean', value: 0, aiHint: '(on/off switch) RGB-split screen smear + random slices' },
  { key: 'datamosh', label: 'Glitch 1 Amt', type: 'number', value: 8, min: 0, max: 30, step: 1, reactive: true, aiHint: 'Datamosh (Glitch 1) displacement strength' },
  { key: 'glitchAmt', label: 'Glitch 2 Amt', type: 'number', value: 6, min: 0, max: 20, step: 1, reactive: true, aiHint: 'Glitch 2 RGB-split smear strength' },
  { key: 'padX', label: 'FX Pad X', type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, aiHint: 'Background-mode glitch/datamosh strength modifier (standalone padX)' },
  { key: 'textMode', label: 'Text Fill', type: 'number', value: 0, min: 0, max: 3, step: 1, aiHint: '0 off · 1 numbers · 2 letters · 3 mixed — Matrix-style char fill (random seeded)' },
  { key: 'textPadX', label: 'Text Coverage X', type: 'number', value: 1, min: 0, max: 1, step: 0.01, aiHint: 'Text-fill block coverage, X axis' },
  { key: 'textPadY', label: 'Text Coverage Y', type: 'number', value: 1, min: 0, max: 1, step: 0.01, aiHint: 'Text-fill block coverage, Y axis' },
  // L3 — contour markers (edge mode; smart = a MediaPipe ImageSegmenter dep, L7)
  { key: 'ctMode', label: 'Contour Mode', type: 'number', value: 0, min: 0, max: 2, step: 1, aiHint: '0 off (rectangle markers) · 1 edge (organic radial contour from the detection mask) · 2 smart (MediaPipe segmentation — not yet ported)' },
  { key: 'ctExpand', label: 'Contour Expand', type: 'number', value: 0, min: -20, max: 20, step: 1, aiHint: 'Grow/shrink the contour outline along its rays (proc-space px)' },
  { key: 'ctSmooth', label: 'Contour Smooth', type: 'number', value: 5, min: 0, max: 20, step: 1, aiHint: 'Douglas-Peucker simplification ε — higher = smoother, fewer points' },
  { key: 'ctFill', label: 'Contour Fill', type: 'boolean', value: 0, aiHint: '(on/off switch) Fill the contour interior at 15% opacity' },
  // L4 — optical flow (Lucas-Kanade per blob → arrows/trails)
  { key: 'flowOn', label: 'Optical Flow', type: 'boolean', value: 0, aiHint: '(on/off switch) Lucas-Kanade motion arrows per blob (green→red by speed) + optional trails' },
  { key: 'flowScale', label: 'Arrow Scale', type: 'number', value: 3, min: 0, max: 10, step: 0.5, reactive: true, aiHint: 'Length multiplier of the flow arrows' },
  { key: 'flowTrail', label: 'Trail Length', type: 'number', value: 0, min: 0, max: 10, step: 1, aiHint: 'How many past positions each blob leaves as a fading dashed trail (0 = off)' },
  // L5 — three.js ripple sim (wave-equation displacement). Operator decision:
  // the standalone's mouse force is replaced by an audio-reactive force
  // (rippleForce, pre-wired to the beat) — the three.js sim/shaders are 1:1.
  { key: 'rippleOn', label: 'Ripple', type: 'boolean', value: 0, aiHint: '(on/off switch) Water-ripple displacement of the whole frame (three.js wave sim)' },
  { key: 'rippleForce', label: 'Ripple Force', type: 'number', value: 0, min: 0, max: 1, step: 0.01, reactive: true, defaultRoute: { source: 'beat', amount: 1 }, aiHint: 'Strength of the wave impulse injected each frame — pre-wired to the beat so the water pulses with the music (replaces the standalone mouse force)' },
  { key: 'rippleX', label: 'Ripple X', type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, aiHint: 'Horizontal position where the wave impulse is injected' },
  { key: 'rippleY', label: 'Ripple Y', type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, aiHint: 'Vertical position where the wave impulse is injected' },
  { key: 'rippleDisp', label: 'Ripple Displace', type: 'number', value: 0.013, min: 0.002, max: 0.04, step: 0.001, reactive: true, aiHint: 'How far the wave field bends the underlying image' },
  { key: 'rippleDamp', label: 'Ripple Damping', type: 'number', value: 0.988, min: 0.96, max: 0.999, step: 0.001, aiHint: 'Wave energy retention per step — higher = longer-lived ripples' },
  { key: 'rippleWave', label: 'Ripple Speed', type: 'number', value: 0.22, min: 0.05, max: 0.5, step: 0.01, aiHint: 'Wave propagation speed constant (c²)' },
];

/* ripple shaders — verbatim from the standalone (qV/sF/dF) */
const RIPPLE_VS = `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
const RIPPLE_SIM_FS = `precision highp float;uniform sampler2D uSt;uniform vec2 uTx;uniform vec2 uMs;uniform float uFo,uRa,uDa,uWc;varying vec2 vUv;void main(){float h=texture2D(uSt,vUv).r,hp=texture2D(uSt,vUv).g;float N=texture2D(uSt,vUv+vec2(0.,uTx.y)).r,S=texture2D(uSt,vUv-vec2(0.,uTx.y)).r,E=texture2D(uSt,vUv+vec2(uTx.x,0.)).r,W=texture2D(uSt,vUv-vec2(uTx.x,0.)).r;float next=2.*h-hp+uWc*(N+S+E+W-4.*h);next*=uDa;vec2 d=vUv-uMs;next+=uFo*exp(-dot(d,d)/(uRa*uRa));gl_FragColor=vec4(clamp(next,-1.,1.),h,0.,1.);}`;
const RIPPLE_DISP_FS = `precision highp float;uniform sampler2D uSc,uWv;uniform vec2 uTx;uniform float uSt;varying vec2 vUv;void main(){vec2 t=uTx*2.;float dx=texture2D(uWv,vUv+vec2(t.x,0.)).r-texture2D(uWv,vUv-vec2(t.x,0.)).r,dy=texture2D(uWv,vUv+vec2(0.,t.y)).r-texture2D(uWv,vUv-vec2(0.,t.y)).r;vec4 col=texture2D(uSc,vUv+vec2(dx,-dy)*uSt);float h=texture2D(uWv,vUv).r;col.rgb+=max(h,0.)*.09;col.rgb-=max(-h,0.)*.04;gl_FragColor=vec4(col.rgb,1.);}`;
const RIPPLE_SIM = 512;

const TEXT_MODES = [null, 'nums', 'letters', 'tmix'] as const;

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
  private ctContours: { x: number; y: number }[][] = []; // per-blob contour, proc coords
  // L4 optical-flow state
  private flowCurrGray: Uint8Array | null = null;
  private flowPrevGray: Uint8Array | null = null;
  private flowVel: { dx: number; dy: number; mag: number }[] = [];
  private flowTrails: { x: number; y: number }[][] = [];
  // L5 ripple (three.js) — separate GL context on an offscreen canvas
  private rRenderer: THREE.WebGLRenderer | null = null;
  private rCanvas: HTMLCanvasElement | null = null;
  private rCam: THREE.OrthographicCamera | null = null;
  private rSimScene: THREE.Scene | null = null;
  private rDispScene: THREE.Scene | null = null;
  private rRtA: THREE.WebGLRenderTarget | null = null;
  private rRtB: THREE.WebGLRenderTarget | null = null;
  private rSimUni: Record<string, { value: unknown }> | null = null;
  private rDispUni: Record<string, { value: unknown }> | null = null;
  private rSceneTex: THREE.CanvasTexture | null = null;
  private rForce = 0;
  private rTargetForce = 0;
  private rInited = false;

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
    // FX.invert also flips the detection binary (standalone getBinary): with
    // invert on, blobs form on the DARK regions
    const inv = this.v.fxInvert >= 0.5;
    for (let i = 0; i < bin.length; i++) { const v = data[i * 4] > thr ? 1 : 0; bin[i] = inv ? 1 - v : v; }
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

  /* ── L3 contour (edge): radial ray-cast on the detection mask → DP simplify
   *    → catmull-rom spline (standalone _radialContour/_douglasPeucker/
   *    _catmullRomPath/_ctComputeContours/_drawContour). Deterministic. ── */
  private radialContour(mask: Uint8Array, W: number, H: number, cx: number, cy: number, maxR: number, expand: number): { x: number; y: number }[] {
    const N = 64, pts: { x: number; y: number }[] = [];
    const mr = maxR + Math.abs(expand) + 2;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, cos = Math.cos(a), sin = Math.sin(a);
      let lx = cx | 0, ly = cy | 0, found = false;
      for (let r = 1; r <= mr; r++) {
        const x = Math.round(cx + cos * r), y = Math.round(cy + sin * r);
        if (x < 0 || x >= W || y < 0 || y >= H) break;
        if (mask[y * W + x]) { lx = x; ly = y; found = true; }
        else if (found) break;
      }
      pts.push({ x: lx + cos * expand, y: ly + sin * expand });
    }
    return pts;
  }

  private dpDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
    return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
  }

  private dp(pts: { x: number; y: number }[], eps: number, s: number, e: number, keep: Uint8Array): void {
    if (e <= s + 1) return;
    let mx = 0, mi = s + 1;
    for (let i = s + 1; i < e; i++) { const d = this.dpDist(pts[i], pts[s], pts[e]); if (d > mx) { mx = d; mi = i; } }
    if (mx > eps) { keep[mi] = 1; this.dp(pts, eps, s, mi, keep); this.dp(pts, eps, mi, e, keep); }
  }

  private douglasPeucker(pts: { x: number; y: number }[], eps: number): { x: number; y: number }[] {
    if (pts.length < 4) return pts;
    const n = pts.length, keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
    this.dp(pts, eps, 0, n - 1, keep);
    return pts.filter((_, i) => keep[i]);
  }

  private catmullRomPath(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]): void {
    const n = pts.length;
    if (n < 3) return;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const cp1x = p1.x + (p2.x - p0.x) / 6, cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6, cp2y = p2.y - (p3.y - p1.y) / 6;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
  }

  private computeContours(blobs: { cx: number; cy: number; w: number; h: number }[], bin: Uint8Array): void {
    const expand = this.v.ctExpand, smooth = this.v.ctSmooth;
    this.ctContours = blobs.map((b) => {
      const maxR = (Math.max(b.w, b.h) * 0.55) + Math.abs(expand) + 4;
      let pts = this.radialContour(bin, PW, PH, b.cx, b.cy, maxR, expand);
      if (smooth > 0) pts = this.douglasPeucker(pts, smooth);
      return pts;
    });
  }

  private drawContour(b: { cx: number; cy: number; area: number }, scX: number, scY: number, idx: number): void {
    const raw = this.ctContours[idx];
    if (!raw || raw.length < 3) return;
    const ctx = this.dCtx, tCol = this.trackerColor;
    const pts = raw.map((p) => ({ x: p.x * scX, y: p.y * scY }));
    ctx.save();
    ctx.strokeStyle = tCol; ctx.lineWidth = 1.5; ctx.globalAlpha = 1.0;
    if (this.v.blobDashed >= 0.5) ctx.setLineDash([5, 3]); else ctx.setLineDash([]);
    ctx.beginPath(); this.catmullRomPath(ctx, pts); ctx.closePath(); ctx.stroke();
    if (this.v.ctFill >= 0.5) {
      ctx.beginPath(); this.catmullRomPath(ctx, pts); ctx.closePath();
      ctx.fillStyle = tCol; ctx.globalAlpha = 0.15; ctx.fill();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1.0;
    ctx.beginPath(); ctx.arc(b.cx, b.cy, 5, 0, Math.PI * 2); ctx.fillStyle = tCol; ctx.fill(); ctx.strokeStyle = tCol; ctx.stroke();
    ctx.font = '10px JetBrains Mono,monospace'; ctx.fillStyle = tCol; ctx.globalAlpha = 0.85;
    ctx.fillText('ID:' + (idx + 1), b.cx + 22, b.cy - 12);
    ctx.fillText('A:' + b.area, b.cx + 22, b.cy + 1);
    ctx.restore();
  }

  private drawBlobMarker(b: { cx: number; cy: number; w: number; h: number; area: number }, scX: number, scY: number, idx: number): void {
    const scale = this.v.blobScale;
    if (this.v.blobEnabled < 0.5 || scale < 0.02) return;
    // contour mode replaces the rectangle with an organic polygon
    if (this.v.ctMode >= 0.5 && this.ctContours[idx] && this.ctContours[idx].length >= 6) {
      this.drawContour(b, scX, scY, idx); return;
    }
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

  /* ── L4 optical flow (standalone _flowUpdateGray/_flowLK/_flowComputeVel/
   *    _drawFlowViz). Temporal (frame-pair Lucas-Kanade) — verified
   *    behaviourally. flowFeedAR is deferred to L7 (reactivity). ── */
  private flowUpdateGray(data: Uint8ClampedArray): void {
    if (!this.flowCurrGray) { this.flowCurrGray = new Uint8Array(PW * PH); this.flowPrevGray = new Uint8Array(PW * PH); }
    const tmp = this.flowPrevGray!; this.flowPrevGray = this.flowCurrGray; this.flowCurrGray = tmp;
    const g = this.flowCurrGray;
    for (let i = 0; i < PW * PH; i++) { const j = i << 2; g[i] = (77 * data[j] + 150 * data[j + 1] + 29 * data[j + 2]) >> 8; }
  }

  private flowLK(prev: Uint8Array, curr: Uint8Array, cx: number, cy: number): { dx: number; dy: number; mag: number } {
    const W = PW, R = 8;
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0, n = 0;
    const x0 = (cx - R) | 0, y0 = (cy - R) | 0;
    for (let dy = 0; dy < R * 2; dy++) {
      const y = y0 + dy; if (y < 1 || y >= PH - 1) continue;
      for (let dx = 0; dx < R * 2; dx++) {
        const x = x0 + dx; if (x < 1 || x >= W - 1) continue;
        const Ix = (curr[y * W + x + 1] - curr[y * W + x - 1]) >> 1;
        const Iy = (curr[(y + 1) * W + x] - curr[(y - 1) * W + x]) >> 1;
        const It = curr[y * W + x] - prev[y * W + x];
        a11 += Ix * Ix; a12 += Ix * Iy; a22 += Iy * Iy;
        b1 -= Ix * It; b2 -= Iy * It; n++;
      }
    }
    if (n < 4) return { dx: 0, dy: 0, mag: 0 };
    const det = a11 * a22 - a12 * a12;
    if (Math.abs(det) < 0.5) return { dx: 0, dy: 0, mag: 0 };
    const u = Math.max(-20, Math.min(20, (a22 * b1 - a12 * b2) / det));
    const v = Math.max(-20, Math.min(20, (a11 * b2 - a12 * b1) / det));
    return { dx: u, dy: v, mag: Math.sqrt(u * u + v * v) };
  }

  private flowComputeVel(blobs: { cx: number; cy: number }[]): void {
    if (!this.flowPrevGray || !this.flowCurrGray) { this.flowVel = []; return; }
    const n = blobs.length;
    if (this.flowVel.length !== n) {
      this.flowVel = Array.from({ length: n }, () => ({ dx: 0, dy: 0, mag: 0 }));
      this.flowTrails = Array.from({ length: n }, () => []);
    }
    const EMA = 0.42, trailLen = this.v.flowTrail | 0;
    blobs.forEach((b, i) => {
      const raw = this.flowLK(this.flowPrevGray!, this.flowCurrGray!, b.cx | 0, b.cy | 0);
      const p = this.flowVel[i];
      p.dx += (raw.dx - p.dx) * EMA; p.dy += (raw.dy - p.dy) * EMA; p.mag += (raw.mag - p.mag) * EMA;
      if (trailLen > 0) { this.flowTrails[i].unshift({ x: b.cx, y: b.cy }); if (this.flowTrails[i].length > trailLen) this.flowTrails[i].length = trailLen; }
      else this.flowTrails[i] = [];
    });
  }

  private drawFlowViz(sc: { cx: number; cy: number }[], scX: number, scY: number): void {
    if (!this.flowVel.length) return;
    const ctx = this.dCtx, arrowScale = this.v.flowScale;
    ctx.save();
    sc.forEach((b, i) => {
      const vel = this.flowVel[i]; if (!vel) return;
      const cx = b.cx, cy = b.cy;
      const adx = vel.dx * scX * arrowScale, ady = vel.dy * scY * arrowScale, mag = vel.mag;
      const t = Math.min(1, mag / 10);
      const R = t > 0.5 ? 255 : Math.round(t * 2 * 255);
      const G = t > 0.5 ? Math.round((1 - t) * 2 * 255) : 255;
      const col = `rgb(${R},${G},0)`;
      const trail = this.flowTrails[i];
      if (trail && trail.length > 1) {
        ctx.beginPath(); ctx.moveTo(trail[0].x * scX, trail[0].y * scY);
        for (let k = 1; k < trail.length; k++) { ctx.globalAlpha = (1 - k / trail.length) * 0.55; ctx.lineTo(trail[k].x * scX, trail[k].y * scY); }
        ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]);
      }
      if (mag < 0.3) return;
      ctx.globalAlpha = 0.88; ctx.strokeStyle = col; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + adx, cy + ady); ctx.stroke();
      const tipX = cx + adx, tipY = cy + ady, len = Math.sqrt(adx * adx + ady * ady);
      if (len > 4) {
        const angle = Math.atan2(ady, adx), hlen = Math.min(10, len * 0.38), spread = 0.42;
        ctx.fillStyle = col; ctx.globalAlpha = 0.92;
        ctx.beginPath(); ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - hlen * Math.cos(angle - spread), tipY - hlen * Math.sin(angle - spread));
        ctx.lineTo(tipX - hlen * Math.cos(angle + spread), tipY - hlen * Math.sin(angle + spread));
        ctx.closePath(); ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ── L5 ripple sim (standalone initRipple/rippleTick, three.js). The
   *    wave sim + display shaders are verbatim; the mouse force is replaced
   *    by the audio-reactive rippleForce param (operator decision). Renders
   *    on its own offscreen canvas (its own GL context) that we upload as the
   *    node texture — the offscreen-three→texture pattern (04-SPEC). ── */
  private initRipple(): void {
    if (this.rInited) return;
    this.rInited = true;
    const cv = document.createElement('canvas');
    cv.width = Math.max(2, this.w); cv.height = Math.max(2, this.h);
    this.rCanvas = cv;
    const renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: false, antialias: false, powerPreference: 'high-performance' });
    renderer.autoClear = false; renderer.setPixelRatio(1); renderer.setSize(cv.width, cv.height, false);
    this.rRenderer = renderer;
    this.rCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const rtT = renderer.capabilities.isWebGL2 ? THREE.FloatType : THREE.HalfFloatType;
    const rtO = { type: rtT, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false };
    this.rRtA = new THREE.WebGLRenderTarget(RIPPLE_SIM, RIPPLE_SIM, rtO);
    this.rRtB = new THREE.WebGLRenderTarget(RIPPLE_SIM, RIPPLE_SIM, rtO);
    const geo = new THREE.PlaneGeometry(2, 2);
    this.rSimUni = { uSt: { value: this.rRtA.texture }, uTx: { value: new THREE.Vector2(1 / RIPPLE_SIM, 1 / RIPPLE_SIM) }, uMs: { value: new THREE.Vector2(-5, -5) }, uFo: { value: 0 }, uRa: { value: 0.048 }, uDa: { value: this.v.rippleDamp }, uWc: { value: this.v.rippleWave } };
    this.rSimScene = new THREE.Scene();
    this.rSimScene.add(new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: RIPPLE_VS, fragmentShader: RIPPLE_SIM_FS, uniforms: this.rSimUni as never, depthTest: false, depthWrite: false })));
    this.rSceneTex = new THREE.CanvasTexture(this.dc); this.rSceneTex.minFilter = THREE.LinearFilter;
    this.rDispUni = { uSc: { value: this.rSceneTex }, uWv: { value: this.rRtA.texture }, uTx: { value: new THREE.Vector2(1 / RIPPLE_SIM, 1 / RIPPLE_SIM) }, uSt: { value: this.v.rippleDisp } };
    this.rDispScene = new THREE.Scene();
    this.rDispScene.add(new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: RIPPLE_VS, fragmentShader: RIPPLE_DISP_FS, uniforms: this.rDispUni as never, depthTest: false, depthWrite: false })));
  }

  private rippleTick(): void {
    const r = this.rRenderer, sim = this.rSimUni, disp = this.rDispUni;
    if (!r || !sim || !disp || !this.rRtA || !this.rRtB || !this.rSimScene || !this.rDispScene || !this.rCam) return;
    if (this.rCanvas && (this.rCanvas.width !== this.w || this.rCanvas.height !== this.h)) {
      this.rCanvas.width = this.w; this.rCanvas.height = this.h; r.setSize(this.w, this.h, false);
    }
    // audio-reactive force: rippleForce (beat-routed) replaces the mouse speed
    this.rTargetForce = Math.max(this.rTargetForce, this.v.rippleForce * 0.85);
    this.rForce += (this.rTargetForce - this.rForce) * 0.28; this.rTargetForce *= 0.78;
    if (this.rSceneTex) this.rSceneTex.needsUpdate = true;
    (sim.uSt.value as THREE.Texture) = this.rRtA.texture;
    (sim.uMs.value as THREE.Vector2).set(this.v.rippleX, this.v.rippleY);
    sim.uFo.value = this.rForce; sim.uDa.value = this.v.rippleDamp; sim.uWc.value = this.v.rippleWave;
    disp.uSt.value = this.v.rippleDisp;
    r.setRenderTarget(this.rRtB); r.render(this.rSimScene, this.rCam);
    const tmp = this.rRtA; this.rRtA = this.rRtB; this.rRtB = tmp;
    disp.uWv.value = this.rRtA.texture;
    r.setRenderTarget(null); r.render(this.rDispScene, this.rCam);
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

  /* ── L2 FX system (standalone drawFxInBlob / drawTextFill / _applyFxBg) ──
   * invert + thermal are deterministic (pixel-exact parity); security,
   * liquid, glitch1(data), glitch2 and text fill are time/Math.random-seeded
   * (behavioural, like bokeh's stochastic bgfx). */
  private fxOn(): { invert: boolean; thermal: boolean; security: boolean; liquid: boolean; data: boolean; glitch: boolean } {
    return {
      invert: this.v.fxInvert >= 0.5, thermal: this.v.fxThermal >= 0.5,
      security: this.v.fxSecurity >= 0.5, liquid: this.v.fxLiquid >= 0.5,
      data: this.v.fxData >= 0.5, glitch: this.v.fxGlitch >= 0.5,
    };
  }

  private shapeInside(shape: string, px: number, py: number, w: number, h: number, x: number, y: number, cx: number, cy: number, r: number, sq: number, cornerLen: number): boolean {
    switch (shape) {
      case 'circle': return ((px + x - cx) ** 2 + (py + y - cy) ** 2) <= r * r;
      case 'square': return Math.abs(px + x - cx) <= sq && Math.abs(py + y - cy) <= sq;
      case 'rect': return true;
      case 'corner': {
        const iT = px < cornerLen && py < cornerLen, iR = px > w - cornerLen && py < cornerLen;
        const iB = px < cornerLen && py > h - cornerLen, iBR = px > w - cornerLen && py > h - cornerLen;
        return iT || iR || iB || iBR;
      }
      default: return true;
    }
  }

  private drawFxInBlob(b: { cx: number; cy: number; w: number; h: number }, scX: number, scY: number, idx: number): void {
    const FX = this.fxOn();
    if (!FX.invert && !FX.thermal && !FX.security && !FX.liquid && !FX.data && !FX.glitch) return;
    const dc = this.dc, dCtx = this.dCtx, fxOpacity = this.v.fxOpacity, scale = this.v.blobScale;
    const cx = b.cx, cy = b.cy, bw = b.w * scX * scale, bh = b.h * scY * scale;
    const x = Math.max(0, Math.round(cx - bw / 2));
    const y = Math.max(0, Math.round(cy - bh / 2));
    const w = Math.min(dc.width - x, Math.ceil(bw));
    const h = Math.min(dc.height - y, Math.ceil(bh));
    if (w < 2 || h < 2) return;
    const shape = this.getShape(idx);
    const r = Math.max(bw, bh) / 2, sq = Math.max(bw, bh) / 2, cornerLen = Math.min(bw, bh) * 0.3;

    if (FX.liquid) {
      try {
        const t = performance.now() * 0.001, amp = Math.min(w, h) * 0.06, freq = 3.5;
        const src = dCtx.getImageData(x, y, w, h), dst = dCtx.createImageData(w, h);
        const sd = src.data, dd = dst.data;
        for (let py = 0; py < h; py++) {
          const phase = (py / h) * Math.PI * 2 * freq - t * 2.8;
          const shift = Math.round(Math.sin(phase) * amp);
          for (let px = 0; px < w; px++) {
            if (!this.shapeInside(shape, px, py, w, h, x, y, cx, cy, r, sq, cornerLen)) {
              const i = (py * w + px) * 4; dd[i] = sd[i]; dd[i + 1] = sd[i + 1]; dd[i + 2] = sd[i + 2]; dd[i + 3] = sd[i + 3]; continue;
            }
            const srcPx = Math.max(0, Math.min(w - 1, px + shift));
            const si = (py * w + srcPx) * 4, di = (py * w + px) * 4;
            dd[di] = sd[si]; dd[di + 1] = sd[si + 1]; dd[di + 2] = sd[si + 2]; dd[di + 3] = sd[si + 3];
          }
        }
        dCtx.putImageData(dst, x, y);
      } catch { /* source not ready */ }
    }

    if (FX.thermal || FX.invert || FX.security) {
      try {
        const id = dCtx.getImageData(x, y, w, h), d = id.data;
        const noiseAmp = 18, scanGap = Math.max(3, Math.round(h / 22));
        for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
          if (!this.shapeInside(shape, px, py, w, h, x, y, cx, cy, r, sq, cornerLen)) continue;
          const i = (py * w + px) * 4;
          const ro = d[i], go = d[i + 1], bo = d[i + 2];
          let rv = ro, gv = go, bv = bo;
          if (FX.thermal) { const gray = 0.299 * ro + 0.587 * go + 0.114 * bo; rv = Math.min(255, gray * 2); gv = Math.max(0, gray - 100); bv = Math.max(0, 128 - gray); }
          if (FX.invert) { rv = 255 - rv; gv = 255 - gv; bv = 255 - bv; }
          if (FX.security) {
            const gray = 0.299 * ro + 0.587 * go + 0.114 * bo;
            const noise = (Math.random() - 0.5) * noiseAmp;
            const g2 = Math.max(0, Math.min(255, gray + noise));
            const scanDim = (py % scanGap === 0) ? 0.55 : 1.0;
            rv = Math.round(g2 * 0.25 * scanDim); gv = Math.round(g2 * scanDim); bv = Math.round(g2 * 0.35 * scanDim);
          }
          d[i] = Math.round(ro + (rv - ro) * fxOpacity); d[i + 1] = Math.round(go + (gv - go) * fxOpacity); d[i + 2] = Math.round(bo + (bv - bo) * fxOpacity);
        }
        dCtx.putImageData(id, x, y);
      } catch { /* source not ready */ }
    }

    if (FX.security) {
      try {
        dCtx.save();
        dCtx.beginPath();
        if (shape === 'circle') dCtx.arc(cx, cy, r, 0, Math.PI * 2);
        else if (shape === 'square') dCtx.rect(cx - sq, cy - sq, sq * 2, sq * 2);
        else dCtx.rect(x, y, w, h);
        dCtx.clip();
        const vg = dCtx.createRadialGradient(cx, cy, Math.min(w, h) * 0.2, cx, cy, Math.max(w, h) * 0.72);
        vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,20,0,0.55)');
        dCtx.fillStyle = vg; dCtx.fillRect(x, y, w, h);
        const now = new Date();
        const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        const camId = `CAM ${(idx + 1).toString().padStart(2, '0')}`;
        dCtx.font = `bold ${Math.max(8, Math.round(w * 0.085))}px JetBrains Mono,monospace`;
        dCtx.fillStyle = 'rgba(0,255,60,0.85)';
        dCtx.fillText(camId, x + 4, y + Math.round(w * 0.1) + 4);
        dCtx.fillText(ts, x + 4, y + h - 6);
        const bk = Math.min(w, h) * 0.12;
        dCtx.strokeStyle = 'rgba(0,255,60,0.55)'; dCtx.lineWidth = 1.5;
        dCtx.beginPath();
        dCtx.moveTo(x + bk, y + 2); dCtx.lineTo(x + 2, y + 2); dCtx.lineTo(x + 2, y + bk);
        dCtx.moveTo(x + w - bk, y + 2); dCtx.lineTo(x + w - 2, y + 2); dCtx.lineTo(x + w - 2, y + bk);
        dCtx.moveTo(x + 2, y + h - bk); dCtx.lineTo(x + 2, y + h - 2); dCtx.lineTo(x + bk, y + h - 2);
        dCtx.moveTo(x + w - 2, y + h - bk); dCtx.lineTo(x + w - 2, y + h - 2); dCtx.lineTo(x + w - bk, y + h - 2);
        dCtx.stroke();
        dCtx.restore();
      } catch { /* ignore */ }
    }

    if (FX.data) {
      const str = this.v.datamosh * (1 + Math.max(bw, bh) * 0.015);
      const bW = Math.max(8, bw / 6), bH = Math.max(8, bh / 4);
      dCtx.save(); dCtx.globalAlpha = fxOpacity;
      dCtx.beginPath();
      if (shape === 'circle') dCtx.arc(cx, cy, r, 0, Math.PI * 2);
      else if (shape === 'square') dCtx.rect(cx - sq, cy - sq, sq * 2, sq * 2);
      else dCtx.rect(x, y, w, h);
      dCtx.clip();
      for (let bkx = x; bkx < x + w; bkx += bW) for (let bky = y; bky < y + h; bky += bH) {
        if (Math.random() < 0.4) {
          const oX = (Math.random() - 0.5) * str * 2, oY = (Math.random() - 0.5) * str;
          const bwi = Math.min(bW, x + w - bkx), bhi = Math.min(bH, y + h - bky);
          if (bwi > 0 && bhi > 0) dCtx.drawImage(dc, bkx, bky, bwi, bhi, bkx + oX, bky + oY, bwi, bhi);
        }
      }
      if (Math.random() < 0.3) {
        const ly = y + Math.random() * h, lh = Math.random() * 4 + 1;
        dCtx.drawImage(dc, x, ly, w, lh, x + (Math.random() - 0.5) * str * 3, ly, w, lh);
      }
      dCtx.restore();
    }

    if (FX.glitch) {
      const str = this.v.glitchAmt * (1 + Math.max(bw, bh) * 0.01);
      dCtx.save();
      dCtx.beginPath();
      if (shape === 'circle') dCtx.arc(cx, cy, r, 0, Math.PI * 2);
      else if (shape === 'square') dCtx.rect(cx - sq, cy - sq, sq * 2, sq * 2);
      else dCtx.rect(x, y, w, h);
      dCtx.clip();
      dCtx.globalCompositeOperation = 'screen';
      dCtx.globalAlpha = 0.5 * fxOpacity;
      dCtx.drawImage(dc, x, y, w, h, x - str, y, w, h);
      dCtx.globalAlpha = 0.4 * fxOpacity;
      dCtx.drawImage(dc, x, y, w, h, x + str * 0.5, y + 1, w, h);
      if (Math.random() < 0.4) {
        const sY = y + Math.random() * h, sH = Math.random() * 6 + 2;
        dCtx.drawImage(dc, x, sY, w, sH, x + (Math.random() - 0.5) * str * 4, sY, w, sH);
      }
      dCtx.restore();
    }
  }

  private drawTextFill(b: { cx: number; cy: number; w: number; h: number }, scX: number, scY: number, idx: number): void {
    const textFillMode = TEXT_MODES[this.v.textMode | 0];
    if (!textFillMode) return;
    const dCtx = this.dCtx, fxOpacity = this.v.fxOpacity, scale = this.v.blobScale;
    const cx = b.cx, cy = b.cy, bw = b.w * scX * scale, bh = b.h * scY * scale;
    const x = cx - bw / 2, y = cy - bh / 2;
    const shape = this.getShape(idx);
    const r = Math.max(bw, bh) / 2, sq = Math.max(bw, bh) / 2;
    const chars = textFillMode === 'nums' ? '0123456789' : textFillMode === 'letters' ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' :
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg!@#$%&*+-=<>{}[]';
    const colMap: Record<string, string> = { nums: '#00ff44', letters: '#44aaff', tmix: '#ffaa00' };
    const fs = Math.max(9, Math.min(22, Math.min(bw, bh) * 0.18));
    const cw = fs * 0.62;
    const coverage = Math.max(0, Math.min(1, (this.v.textPadX + this.v.textPadY) / 2));
    const blkW = Math.max(cw * 3, bw * 0.18), blkH = Math.max(fs * 3, bh * 0.18);
    dCtx.save();
    dCtx.beginPath();
    if (shape === 'circle') dCtx.arc(cx, cy, r, 0, Math.PI * 2);
    else if (shape === 'square') dCtx.rect(cx - sq, cy - sq, sq * 2, sq * 2);
    else dCtx.rect(x, y, bw, bh);
    dCtx.clip();
    dCtx.font = `bold ${fs}px JetBrains Mono,monospace`;
    dCtx.fillStyle = colMap[textFillMode] || '#ffffff';
    dCtx.globalAlpha = 0.75 * fxOpacity;
    dCtx.globalCompositeOperation = 'screen';
    for (let bky = y; bky < y + bh; bky += blkH) {
      for (let bkx = x; bkx < x + bw; bkx += blkW) {
        if (Math.random() >= coverage) continue;
        const cols = Math.ceil(blkW / cw) + 1, rows = Math.ceil(blkH / fs) + 1;
        for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++)
          dCtx.fillText(chars[Math.floor(Math.random() * chars.length)], bkx + col * cw, bky + (row + 1) * fs);
      }
    }
    dCtx.restore();
  }

  /* FX on the whole background (bgFxMode off); blobs are saved clean by the
   * caller and restored after. Standalone _applyFxBg. */
  private applyFxBg(dW: number, dH: number): void {
    const FX = this.fxOn(), op = this.v.fxOpacity, dc = this.dc, dCtx = this.dCtx;
    if (FX.invert || FX.thermal || FX.security) {
      const id = dCtx.getImageData(0, 0, dW, dH); const d = id.data;
      const noiseAmp = 18, scanGap = Math.max(3, Math.round(dH / 22));
      for (let i = 0; i < d.length; i += 4) {
        const ro = d[i], go = d[i + 1], bo = d[i + 2];
        let r = ro, g = go, b = bo;
        if (FX.thermal) { const gv = 0.299 * ro + 0.587 * go + 0.114 * bo; r = Math.min(255, gv * 2); g = Math.max(0, gv - 100); b = Math.max(0, 128 - gv); }
        if (FX.invert) { r = 255 - r; g = 255 - g; b = 255 - b; }
        if (FX.security) { const gray = 0.299 * ro + 0.587 * go + 0.114 * bo; const noise = (Math.random() - 0.5) * noiseAmp; const g2 = Math.max(0, Math.min(255, gray + noise)); const row = Math.floor(i / 4 / dW); const scanDim = (row % scanGap === 0) ? 0.55 : 1.0; r = Math.round(g2 * 0.25 * scanDim); g = Math.round(g2 * scanDim); b = Math.round(g2 * 0.35 * scanDim); }
        d[i] = Math.round(ro + (r - ro) * op); d[i + 1] = Math.round(go + (g - go) * op); d[i + 2] = Math.round(bo + (b - bo) * op);
      }
      dCtx.putImageData(id, 0, 0);
    }
    if (FX.liquid) {
      try {
        const t = performance.now() * 0.001, amp = Math.min(dW, dH) * 0.025, freq = 3.5;
        const src = dCtx.getImageData(0, 0, dW, dH), dst = dCtx.createImageData(dW, dH);
        const sd = src.data, dd = dst.data;
        for (let py = 0; py < dH; py++) { const phase = (py / dH) * Math.PI * 2 * freq - t * 2.8; const shift = Math.round(Math.sin(phase) * amp); for (let px = 0; px < dW; px++) { const srcPx = Math.max(0, Math.min(dW - 1, px + shift)); const si = (py * dW + srcPx) * 4, di = (py * dW + px) * 4; dd[di] = Math.round(sd[di] + (sd[si] - sd[di]) * op); dd[di + 1] = Math.round(sd[di + 1] + (sd[si + 1] - sd[di + 1]) * op); dd[di + 2] = Math.round(sd[di + 2] + (sd[si + 2] - sd[di + 2]) * op); dd[di + 3] = sd[si + 3]; } }
        dCtx.putImageData(dst, 0, 0);
      } catch { /* ignore */ }
    }
    if (FX.data) {
      const str = this.v.datamosh * this.v.padThresh * (1 + this.v.padX);
      const bW = Math.max(8, dW / 6), bH = Math.max(8, dH / 4);
      dCtx.save(); dCtx.globalAlpha = op;
      for (let bx = 0; bx < dW; bx += bW) for (let by = 0; by < dH; by += bH) if (Math.random() < 0.4) { const oX = (Math.random() - 0.5) * str * 2, oY = (Math.random() - 0.5) * str, bwi = Math.min(bW, dW - bx), bhi = Math.min(bH, dH - by); dCtx.drawImage(dc, bx, by, bwi, bhi, bx + oX, by + oY, bwi, bhi); }
      if (Math.random() < 0.3) { const ly = Math.random() * dH, lh = Math.random() * 4 + 1; dCtx.drawImage(dc, 0, ly, dW, lh, (Math.random() - 0.5) * str * 3, ly, dW, lh); }
      dCtx.restore();
    }
    if (FX.glitch) {
      const str = this.v.glitchAmt * this.v.padThresh * (1 + this.v.padX * 0.5);
      dCtx.save(); dCtx.globalCompositeOperation = 'screen';
      dCtx.globalAlpha = 0.5 * op; dCtx.drawImage(dc, 0, 0, dW, dH, -str, 0, dW, dH);
      dCtx.globalAlpha = 0.4 * op; dCtx.drawImage(dc, 0, 0, dW, dH, str * 0.5, 1, dW, dH);
      dCtx.restore();
      if (Math.random() < 0.4) { const sY = Math.random() * dH, sH = Math.random() * 6 + 2; dCtx.drawImage(dc, 0, sY, dW, sH, (Math.random() - 0.5) * str * 4, sY, dW, sH); }
    }
    // text fill covering the whole background in BG mode
    const textFillMode = TEXT_MODES[this.v.textMode | 0];
    if (textFillMode) {
      const chars = textFillMode === 'nums' ? '0123456789' : textFillMode === 'letters' ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' :
        '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg!@#$%&*+-=<>{}[]';
      const colMap: Record<string, string> = { nums: '#00ff44', letters: '#44aaff', tmix: '#ffaa00' };
      const fs = Math.max(10, Math.min(22, Math.min(dW, dH) * 0.028));
      const cw = fs * 0.62, cols = Math.ceil(dW / cw) + 2, rows = Math.ceil(dH / fs) + 2;
      dCtx.save();
      dCtx.font = `bold ${fs}px JetBrains Mono,monospace`;
      dCtx.fillStyle = colMap[textFillMode] || '#ffffff';
      dCtx.globalAlpha = 0.6 * op; dCtx.globalCompositeOperation = 'screen';
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++)
        dCtx.fillText(chars[Math.floor(Math.random() * chars.length)], col * cw, (row + 1) * fs);
      dCtx.restore();
    }
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
    if (this.v.flowOn >= 0.5) this.flowUpdateGray(id.data); // raw gray BEFORE processForDetect
    this.processForDetect(id.data);
    const bin = this.getBinary(id.data);
    const blobs = this.findBlobs(bin);
    if (this.v.flowOn >= 0.5) this.flowComputeVel(blobs);
    const scX = dW / PW, scY = dH / PH;
    const sc = blobs.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, cx: b.cx * scX, cy: b.cy * scY, area: b.area }));

    // L3: compute contours from the detection binary (edge mode) — smart mode
    // (MediaPipe ImageSegmenter) is not ported yet, treated as edge here
    if (this.v.ctMode >= 0.5) this.computeContours(blobs, bin); else this.ctContours = [];

    // 3) FX — bgFxMode ON: FX inside the blobs | OFF: FX on the background,
    //    blobs kept clean (patch save/restore around applyFxBg)
    if (this.v.bgFxMode >= 0.5) {
      sc.forEach((b, i) => this.drawFxInBlob(b, scX, scY, i));
      sc.forEach((b, i) => this.drawTextFill(b, scX, scY, i));
    } else {
      const scale = this.v.blobScale;
      const patches = sc.map((b) => {
        const bw = b.w * scX * scale, bh = b.h * scY * scale;
        const px = Math.max(0, Math.round(b.cx - bw / 2)), py = Math.max(0, Math.round(b.cy - bh / 2));
        const pw = Math.min(dW - px, Math.ceil(bw)), ph = Math.min(dH - py, Math.ceil(bh));
        if (pw < 2 || ph < 2) return null;
        return { x: px, y: py, data: this.dCtx.getImageData(px, py, pw, ph) };
      });
      this.applyFxBg(dW, dH);
      patches.forEach((p) => { if (p) this.dCtx.putImageData(p.data, p.x, p.y); });
    }

    // 4) tracker overlays
    this.drawConnections(sc);
    sc.forEach((b, i) => this.drawBlobMarker(b, scX, scY, i));
    if (this.v.flowOn >= 0.5) this.drawFlowViz(sc, scX, scY);
    this.computeMotion(src);

    // L5: ripple displaces the whole 2D composite (three.js, own GL context).
    // Its canvas becomes the node output when on; with force ~0 (no beat) the
    // wave field is flat and it is a clean passthrough of dc.
    let outSrc: TexImageSource = this.dc;
    if (this.v.rippleOn >= 0.5) {
      if (!this.rInited) this.initRipple();
      this.rippleTick();
      if (this.rCanvas) outSrc = this.rCanvas;
    }

    // upload composite (FLIP_Y — engine convention)
    gl.bindTexture(gl.TEXTURE_2D, this.outTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, outSrc);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return this.outTex;
  }

  dispose(gl: WebGL2RenderingContext): void {
    if (this.outTex) { gl.deleteTexture(this.outTex); this.outTex = null; }
    this.rRtA?.dispose(); this.rRtB?.dispose(); this.rSceneTex?.dispose();
    this.rRenderer?.dispose();
    this.rRenderer = null; this.rInited = false;
  }
}
