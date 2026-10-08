import { ParamSchema } from '../bridge/types';

/* ═══════════════════════════════════════════════════════════════
   SYNENGINE — the shared render graph (PLAN.md phase 5)

   One WebGL2 context, one canvas. A source (video file / webcam)
   is uploaded once per frame (a still photo: once per load) and
   flows through the enabled nodes
   in order, each rendering into a ping-pong framebuffer; the last
   output is blitted to the screen. This is what iframes cannot
   do: effects composed in series at full speed, no pixel copies.
   ═══════════════════════════════════════════════════════════════ */

export interface NodeRenderContext {
  gl: WebGL2RenderingContext;
  /** texture produced by the previous node (or the source) */
  inputTex: WebGLTexture;
  width: number;
  height: number;
  time: number;
  frame: number;
  /** draws the currently bound program over the full viewport */
  drawQuad: () => void;
  /** the source element, for nodes that need CPU pixel analysis */
  source: TexImageSource | null;
  /** person-segmentation confidence mask (top-left canvas), when available */
  personMask: TexImageSource | null;
  /** bumps when personMask holds a new segmentation result — nodes gate per-arrival passes on it */
  personMaskVersion: number;
}

export interface EngineNode {
  readonly id: string;
  readonly name: string;
  enabled: boolean;
  readonly params: ParamSchema[];
  setParam(key: string, value: unknown): void;
  getParam(key: string): unknown;
  init(gl: WebGL2RenderingContext): void;
  resize(width: number, height: number): void;
  /** renders inputTex into the node's own target, returns its output texture */
  render(ctx: NodeRenderContext): WebGLTexture;
  dispose(gl: WebGL2RenderingContext): void;
}

/* ── GL helpers shared by nodes ───────────────────────────────── */

export function compileProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error('Shader compile: ' + gl.getShaderInfoLog(sh));
    }
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('Program link: ' + gl.getProgramInfoLog(prog));
  }
  return prog;
}

export const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main(){
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

export function createTarget(gl: WebGL2RenderingContext, w: number, h: number): Target {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, w, h };
}

export function destroyTarget(gl: WebGL2RenderingContext, t: Target | null): void {
  if (!t) return;
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.tex);
}

/* ── the engine ──────────────────────────────────────────────── */

const BLIT_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 o;
void main(){ o = texture(uTex, vUV); }`;

export type SourceKind = 'none' | 'video' | 'webcam' | 'image';

/* Photos are capped on their long side before they become the source:
   the render size follows the source (fitToSource), so a 6000px still
   would make every node render 24 MP per frame — and some GPUs refuse
   textures that big outright. 2560 keeps a 4K-ish master look. */
const MAX_IMAGE_SIDE = 2560;

export class SynEngine {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  chain: EngineNode[] = [];

  private sourceEl: HTMLVideoElement | HTMLImageElement | null = null;
  private sourceKind: SourceKind = 'none';
  private webcamStream: MediaStream | null = null;
  /* a still never changes, so its pixels go to sourceTex once per load
     (this flag) instead of once per frame like video */
  private sourceDirty = false;
  /** object URL of a downscaled photo — created here, so revoked here */
  private ownedImageUrl: string | null = null;
  /* bumped by every stopSource(): a load that was overtaken by another
     load (or by dispose) while it awaited its media drops its element
     instead of clobbering the newer source */
  private loadSeq = 0;
  private sourceTex: WebGLTexture;
  private blitProg: WebGLProgram;
  private quadVao: WebGLVertexArrayObject;
  private rafId = 0;
  private frame = 0;
  private startT = 0;
  private fpsCount = 0;
  private fpsT = 0;
  fps = 0;
  onFps?: (fps: number) => void;
  /** runs at the top of every frame — audio analysis + param modulation hook */
  beforeFrame?: (now: number) => void;
  /** set by the host when a person-segmentation mask is available */
  personMaskSource: TexImageSource | null = null;
  /** host-maintained counter of fresh personMaskSource content */
  personMaskVersion = 0;

  /* ── adaptive internal resolution (PLAN §6.4): when the frame rate
        falls under budget the render size steps down, display size
        stays the same. Disabled + forced to 1 during offline export. ── */
  resScale = 1;
  adaptiveRes = true;
  onResScale?: (scale: number) => void;
  private static readonly RES_STEPS = [1, 0.75, 0.5];
  private lastResEval = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // preserveDrawingBuffer: frame stays readable after present — needed for
    // pixel verification, frame grabs and the future engine-side export
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // one oversized triangle covers the viewport with fewer edge pixels
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.quadVao = vao;

    this.blitProg = compileProgram(gl, QUAD_VS, BLIT_FS);

    this.sourceTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(16));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** the source element: a <video> (file or webcam) or an <img> (photo) */
  get source(): HTMLVideoElement | HTMLImageElement | null { return this.sourceEl; }
  /** the source as a <video> — file or webcam; null for a photo or no source */
  get video(): HTMLVideoElement | null {
    return this.sourceEl instanceof HTMLVideoElement ? this.sourceEl : null;
  }
  get kind(): SourceKind { return this.sourceKind; }

  /** true once the source has a frame to draw (video: HAVE_CURRENT_DATA,
   *  photo: decoded with a size) — the same gate renderFrame uses */
  isReady(): boolean {
    const el = this.sourceEl;
    if (!el) return false;
    if (el instanceof HTMLVideoElement) return el.readyState >= 2;
    return el.complete && el.naturalWidth > 0;
  }

  drawQuad = (): void => {
    const gl = this.gl;
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  async loadVideoFile(file: File): Promise<void> {
    return this.loadVideoUrl(URL.createObjectURL(file));
  }

  /**
   * Load a video from a URL (typically an object URL owned by the shell so
   * the same source can drive both the dashboard preview and this engine).
   * The URL is NOT revoked here — its owner is responsible for that.
   */
  async loadVideoUrl(url: string): Promise<void> {
    this.stopSource();
    const seq = this.loadSeq;
    const v = document.createElement('video');
    v.src = url;
    v.loop = true;
    v.muted = true;
    v.playsInline = true;
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error('video load failed'));
    });
    await v.play().catch(() => {});
    if (seq !== this.loadSeq) {
      // overtaken while loading — the newer source (or none) stands
      v.pause();
      v.removeAttribute('src');
      return;
    }
    this.sourceEl = v;
    this.sourceKind = 'video';
    this.fitToSource();
  }

  async startWebcam(): Promise<void> {
    this.stopSource();
    const seq = this.loadSeq;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } } });
    const v = document.createElement('video');
    v.srcObject = stream;
    v.muted = true;
    v.playsInline = true;
    await v.play();
    if (seq !== this.loadSeq) {
      // overtaken while the permission prompt / camera start was pending:
      // release the camera so its light does not stay on
      stream.getTracks().forEach((t) => t.stop());
      v.srcObject = null;
      return;
    }
    this.webcamStream = stream;
    this.sourceEl = v;
    this.sourceKind = 'webcam';
    this.fitToSource();
  }

  /**
   * Load a still photo as the source (same URL ownership rule as
   * loadVideoUrl: the caller's URL is never revoked here). Nodes see an
   * <img> through ctx.source — drawImage and THREE textures take it like
   * a video frame — and the texture is uploaded once, not per frame.
   * Every photo is flattened over black (and capped to MAX_IMAGE_SIDE)
   * once, here — see flattenImage.
   */
  async loadImageUrl(url: string): Promise<void> {
    this.stopSource();
    const seq = this.loadSeq;
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new Error('image load failed');
    }
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('image has no pixel size');
    const flat = await SynEngine.flattenImage(img);
    if (seq !== this.loadSeq) {
      // overtaken while decoding — drop this one, keep the newer source
      if (flat.url) URL.revokeObjectURL(flat.url);
      return;
    }
    this.ownedImageUrl = flat.url;
    this.sourceEl = flat.img;
    this.sourceKind = 'image';
    this.sourceDirty = true;
    this.fitToSource();
  }

  /* Every still is flattened once, here, through a 2D canvas: drawn over
     opaque black and resampled so its long side is ≤ MAX_IMAGE_SIDE. Black
     is what the JPEG grabs put under a transparent pixel (capture.ts), so
     the effects and the SOURCE frame Gemini sees agree; and every photo
     takes the same path whatever its size (an un-flattened PNG would hand
     the effects the hidden RGB under alpha 0). The result stays an <img>
     (canvas → PNG blob → object URL), so the source contract is the same
     for every still. If the canvas cannot be read back (a cross-origin URL
     without CORS taints it) the original is used as is. */
  private static async flattenImage(img: HTMLImageElement): Promise<{ img: HTMLImageElement; url: string | null }> {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(nw, nh));
    const w = Math.max(1, Math.round(nw * k));
    const h = Math.max(1, Math.round(nh * k));
    let url: string | null = null;
    try {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const c2 = c.getContext('2d', { alpha: false });
      if (!c2) return { img, url: null };
      c2.fillStyle = '#000';
      c2.fillRect(0, 0, w, h);
      c2.imageSmoothingEnabled = true;
      c2.imageSmoothingQuality = 'high';
      c2.drawImage(img, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
      c.width = c.height = 0; // release the backing store now, not at GC
      if (!blob) return { img, url: null };
      url = URL.createObjectURL(blob);
      const flat = new Image();
      flat.src = url;
      await flat.decode();
      img.removeAttribute('src');
      return { img: flat, url };
    } catch {
      if (url) URL.revokeObjectURL(url);
      return { img, url: null };
    }
  }

  stopSource(): void {
    this.loadSeq++;
    if (this.webcamStream) {
      this.webcamStream.getTracks().forEach((t) => t.stop());
      this.webcamStream = null;
    }
    const el = this.sourceEl;
    if (el instanceof HTMLVideoElement) {
      el.pause();
      el.srcObject = null;
      el.removeAttribute('src');
    } else if (el) {
      el.removeAttribute('src');
    }
    this.sourceEl = null;
    if (this.ownedImageUrl) {
      URL.revokeObjectURL(this.ownedImageUrl);
      this.ownedImageUrl = null;
    }
    this.sourceDirty = false;
    this.sourceKind = 'none';
  }

  private fitToSource(): void {
    const el = this.sourceEl;
    if (!el) return;
    const sw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
    const sh = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
    const w = Math.max(2, Math.round((sw || 1280) * this.resScale));
    const h = Math.max(2, Math.round((sh || 720) * this.resScale));
    this.canvas.width = w;
    this.canvas.height = h;
    this.chain.forEach((n) => n.resize(w, h));
  }

  /** set the internal render scale (1 = native source resolution) */
  setResScale(scale: number): void {
    if (scale === this.resScale) return;
    this.resScale = scale;
    this.fitToSource();
    this.onResScale?.(scale);
  }

  /** step the scale down when under budget, back up when comfortably over */
  private evalAdaptiveRes(now: number): void {
    if (!this.adaptiveRes || !this.sourceEl) return;
    if (now - this.lastResEval < 1500) return;
    this.lastResEval = now;
    const steps = SynEngine.RES_STEPS;
    const i = steps.indexOf(this.resScale);
    if (this.fps > 0 && this.fps < 45 && i < steps.length - 1) this.setResScale(steps[i + 1]);
    else if (this.fps > 57 && i > 0) this.setResScale(steps[i - 1]);
  }

  addNode(node: EngineNode): void {
    node.init(this.gl);
    node.resize(this.canvas.width, this.canvas.height);
    this.chain.push(node);
  }

  swapNodes(i: number, j: number): void {
    const c = this.chain;
    if (i < 0 || j < 0 || i >= c.length || j >= c.length) return;
    [c[i], c[j]] = [c[j], c[i]];
  }

  start(): void {
    if (this.rafId) return;
    this.startT = performance.now();
    this.fpsT = this.startT;
    const tick = (now: number) => {
      this.rafId = requestAnimationFrame(tick);
      this.renderFrame(now);
      // only the live loop adapts — manual renderFrame calls (offline
      // export) must never change the render size mid-encode
      this.evalAdaptiveRes(now);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  renderFrame(now: number): void {
    this.beforeFrame?.(now);
    const gl = this.gl;
    const v = this.sourceEl;
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.frame++;

    this.fpsCount++;
    if (now - this.fpsT > 700) {
      this.fps = Math.round((this.fpsCount * 1000) / (now - this.fpsT));
      this.fpsCount = 0;
      this.fpsT = now;
      this.onFps?.(this.fps);
    }

    if (!v || !this.isReady()) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0.02, 0.02, 0.02, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    // video: a fresh frame every tick; a photo: only right after it loaded
    if (v instanceof HTMLVideoElement || this.sourceDirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, v);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      this.sourceDirty = false;
    }

    const ctx: NodeRenderContext = {
      gl,
      inputTex: this.sourceTex,
      width: W,
      height: H,
      time: (now - this.startT) / 1000,
      frame: this.frame,
      drawQuad: this.drawQuad,
      source: v,
      personMask: this.personMaskSource,
      personMaskVersion: this.personMaskVersion,
    };

    let tex = this.sourceTex;
    for (const node of this.chain) {
      if (!node.enabled) continue;
      ctx.inputTex = tex;
      tex = node.render(ctx);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.blitProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(this.blitProg, 'uTex'), 0);
    this.drawQuad();
  }

  dispose(): void {
    this.stop();
    this.stopSource();
    this.chain.forEach((n) => n.dispose(this.gl));
    this.chain = [];
  }
}
