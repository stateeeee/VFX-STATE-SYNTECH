import { ParamSchema } from '../bridge/types';

/* ═══════════════════════════════════════════════════════════════
   SYNENGINE — the shared render graph (PLAN.md phase 5)

   One WebGL2 context, one canvas. A source (video file / webcam)
   is uploaded once per frame and flows through the enabled nodes
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

export type SourceKind = 'none' | 'video' | 'webcam';

export class SynEngine {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  chain: EngineNode[] = [];

  private sourceEl: HTMLVideoElement | null = null;
  private sourceKind: SourceKind = 'none';
  private webcamStream: MediaStream | null = null;
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

  get source(): HTMLVideoElement | null { return this.sourceEl; }
  get kind(): SourceKind { return this.sourceKind; }

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
    this.sourceEl = v;
    this.sourceKind = 'video';
    this.fitToSource();
  }

  async startWebcam(): Promise<void> {
    this.stopSource();
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } } });
    const v = document.createElement('video');
    v.srcObject = stream;
    v.muted = true;
    v.playsInline = true;
    await v.play();
    this.webcamStream = stream;
    this.sourceEl = v;
    this.sourceKind = 'webcam';
    this.fitToSource();
  }

  stopSource(): void {
    if (this.webcamStream) {
      this.webcamStream.getTracks().forEach((t) => t.stop());
      this.webcamStream = null;
    }
    if (this.sourceEl) {
      this.sourceEl.pause();
      this.sourceEl.srcObject = null;
      this.sourceEl.removeAttribute('src');
      this.sourceEl = null;
    }
    this.sourceKind = 'none';
  }

  private fitToSource(): void {
    const v = this.sourceEl;
    if (!v) return;
    const w = Math.max(2, Math.round((v.videoWidth || 1280) * this.resScale));
    const h = Math.max(2, Math.round((v.videoHeight || 720) * this.resScale));
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

    if (!v || v.readyState < 2) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0.02, 0.02, 0.02, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    gl.bindTexture(gl.TEXTURE_2D, this.sourceTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, v);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

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
