/* BodyLandmarks — shared MediaPipe Tasks-Vision face / hand / pose landmarker
 * service (AI Lab port of the blob_tracker SYNTECH-BODY section).
 *
 * Modelled on PersonMask.ts:
 *  · lazy — nothing loads until a node asks for a kind via ensure();
 *  · ONE module-level instance shared by every node (`bodyLandmarks`);
 *  · the SAME vendored files the standalone effect loads
 *    (/effects/vendor/mediapipe/tasks-vision/: vision_bundle.mjs 0.10.3, wasm/,
 *    face_landmarker.task, hand_landmarker.task, pose_landmarker_lite.task) —
 *    offline, no CDN, no npm dependency;
 *  · model creations serialised (the wasm loader hands its factory over through
 *    the globals ModuleFactory / Module, so concurrent creations would race);
 *  · strictly increasing timestamps for detectForVideo (shared by all kinds);
 *  · cutReset(): feeds one blank frame so a VIDEO-mode landmarker drops the ROI it
 *    is tracking across a hard cut;
 *  · GPU delegate with CPU fallback (software WebGL → straight to CPU; 3 inference
 *    errors or 3 inferences > 250 ms on GPU → reload on CPU), as the standalone.
 * The per-node work (scheduler, smoothing, overlays, BODY blobs) lives in the node
 * (src/engine/nodes/blob_tracker.ts), exactly like the standalone's _bodyTick etc.
 */

export type BodyKind = 'face' | 'hands' | 'pose';
export const BODY_KINDS: BodyKind[] = ['face', 'hands', 'pose'];
export type BodyLmState = 'off' | 'loading' | 'ready' | 'error';

/** flat index-pair lists (a,b,a,b,…) — the standalone's _bodyConn */
export interface BodyConn {
  pose: number[]; poseBody: number[]; poseNH: number[]; poseBodyNH: number[];
  hand: number[]; tess: number[]; cont: number[];
}

const VENDOR = '/effects/vendor/mediapipe/tasks-vision/';
const MODEL: Record<BodyKind, string> = { face: 'face_landmarker.task', hands: 'hand_landmarker.task', pose: 'pose_landmarker_lite.task' };

// Fallback topology (used only if the bundle does not expose its static connection lists) — verbatim from the standalone
const POSE_PAIRS = [0,1,1,2,2,3,3,7,0,4,4,5,5,6,6,8,9,10,11,12,11,13,13,15,15,17,15,19,15,21,17,19,12,14,14,16,16,18,16,20,16,22,18,20,11,23,12,24,23,24,23,25,24,26,25,27,26,28,27,29,28,30,29,31,30,32,27,31,28,32];
const HAND_PAIRS = [0,1,1,2,2,3,3,4,0,5,5,6,6,7,7,8,5,9,9,10,10,11,11,12,9,13,13,14,14,15,15,16,13,17,0,17,17,18,18,19,19,20];
export const BODY_FACE_OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];

interface Landmarker { detectForVideo(src: TexImageSource, ts: number): any; close(): void; }

interface KindState {
  state: BodyLmState;
  lm: Landmarker | null;
  deleg: '' | 'GPU' | 'CPU';
  errs: number;
  slow: number;
  runs: number;
  /** bumps on every successful (re)load — nodes reset their per-kind scheduler on it */
  gen: number;
  /** bumps on every failed load — nodes switch their toggle off on it (standalone: LED off) */
  fails: number;
}

const pairs = (list: any, fallback: number[] | null): number[] => {
  if (!Array.isArray(list) || !list.length) return fallback ? fallback.slice() : [];
  const out: number[] = [];
  list.forEach((c: any) => { if (c && typeof c.start === 'number') out.push(c.start, c.end); });
  return out.length ? out : (fallback ? fallback.slice() : []);
};

class BodyLandmarkService {
  conn: BodyConn | null = null;
  private mod: any = null;
  private fileset: any = null;
  private visionP: Promise<any> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private lastTs = 0;
  private cpuOnly: boolean | null = null;
  private warmCv: HTMLCanvasElement | null = null;
  // invalidates in-flight loads when the last user releases the service (the
  // AI Lab outlives React StrictMode's mount/unmount/mount, so this must be
  // reversible — a later ensure() reloads)
  private token = 0;
  private users = 0;
  private k: Record<BodyKind, KindState> = {
    face: { state: 'off', lm: null, deleg: '', errs: 0, slow: 0, runs: 0, gen: 0, fails: 0 },
    hands: { state: 'off', lm: null, deleg: '', errs: 0, slow: 0, runs: 0, gen: 0, fails: 0 },
    pose: { state: 'off', lm: null, deleg: '', errs: 0, slow: 0, runs: 0, gen: 0, fails: 0 },
  };

  /** a node starts using the service (first toggle ON) */
  acquire(): void { this.users++; }
  /** a node is disposed — the last one out closes the models */
  release(): void {
    this.users = Math.max(0, this.users - 1);
    if (this.users === 0) this.dispose();
  }

  state(kind: BodyKind): BodyLmState { return this.k[kind].state; }
  generation(kind: BodyKind): number { return this.k[kind].gen; }
  failures(kind: BodyKind): number { return this.k[kind].fails; }
  delegate(kind: BodyKind): string { return this.k[kind].deleg; }

  /** Strictly increasing ms timestamps for detectForVideo (shared by all landmarkers, also for still images) */
  ts(): number {
    let t = Math.round(performance.now());
    if (t <= this.lastTs) t = this.lastTs + 1;
    this.lastTs = t;
    return t;
  }

  /** lazy load (no-op while loading / ready); an earlier failure is retried */
  ensure(kind: BodyKind): void {
    const st = this.k[kind];
    if (st.state === 'loading' || st.state === 'ready') return;
    this.load(kind);
  }

  /** one inference; null on error (3 errors on GPU → reload on CPU; GPU slower than usable → CPU) */
  detect(kind: BodyKind, src: TexImageSource): any | null {
    const st = this.k[kind];
    if (st.state !== 'ready' || !st.lm) return null;
    const t0 = performance.now();
    let res: any = null;
    try {
      res = st.lm.detectForVideo(src, this.ts());
      st.errs = 0;
    } catch (e) {
      if (++st.errs === 3) {
        console.warn('[BodyLandmarks] ' + kind + ' inference error', e);
        if (st.deleg === 'GPU') this.load(kind, 'CPU');
      }
      res = null;
    }
    const dt = performance.now() - t0;
    st.runs++;
    if (st.deleg === 'GPU' && st.runs > 4) { if (dt > 250) { if (++st.slow >= 3) this.load(kind, 'CPU'); } else st.slow = 0; }
    return res;
  }

  /** hard cut: one blank frame so the VIDEO-mode tracker drops its old ROI and re-detects */
  cutReset(kind: BodyKind): void {
    const st = this.k[kind];
    if (st.state !== 'ready' || !st.lm) return;
    try { st.lm.detectForVideo(this.warm(), this.ts()); } catch { /* ignore */ }
  }

  private warm(): HTMLCanvasElement {
    if (!this.warmCv) {
      this.warmCv = document.createElement('canvas');
      this.warmCv.width = 64; this.warmCv.height = 64;
      this.warmCv.getContext('2d')!.fillRect(0, 0, 64, 64);
    }
    return this.warmCv;
  }

  // Shared tasks-vision module + wasm fileset (same vendored bundle the standalone uses)
  private vision(): Promise<any> {
    if (!this.visionP) {
      this.visionP = (async () => {
        const url = new URL(VENDOR + 'vision_bundle.mjs', window.location.href).href;
        const mod: any = await import(/* @vite-ignore */ url);
        const fs = await mod.FilesetResolver.forVisionTasks(new URL(VENDOR + 'wasm', window.location.href).href);
        const FL = mod.FaceLandmarker || {};
        const pose = pairs(mod.PoseLandmarker && mod.PoseLandmarker.POSE_CONNECTIONS, POSE_PAIRS);
        const poseBody: number[] = [];
        for (let i = 0; i < pose.length; i += 2) if (pose[i] >= 11 && pose[i + 1] >= 11) poseBody.push(pose[i], pose[i + 1]);
        const nh = (l: number[]) => { const o: number[] = []; for (let i = 0; i < l.length; i += 2) if (!(l[i] >= 17 && l[i] <= 22) && !(l[i + 1] >= 17 && l[i + 1] <= 22)) o.push(l[i], l[i + 1]); return o; }; // without pose finger stubs
        const conn: BodyConn = {
          pose, poseBody, poseNH: nh(pose), poseBodyNH: nh(poseBody),
          hand: pairs(mod.HandLandmarker && mod.HandLandmarker.HAND_CONNECTIONS, HAND_PAIRS),
          tess: pairs(FL.FACE_LANDMARKS_TESSELATION, null),
          cont: pairs(FL.FACE_LANDMARKS_CONTOURS, null),
        };
        if (!conn.cont.length) { const o = BODY_FACE_OVAL; for (let i = 0; i < o.length; i++) conn.cont.push(o[i], o[(i + 1) % o.length]); }
        this.conn = conn; this.mod = mod; this.fileset = fs;
        return mod;
      })();
      this.visionP.catch(() => { this.visionP = null; }); // allow a retry
    }
    return this.visionP;
  }

  // Software WebGL (SwiftShader / llvmpipe) makes the GPU delegate 10-20× slower than CPU → go straight to CPU there
  private preferCPU(): boolean {
    if (this.cpuOnly !== null) return this.cpuOnly;
    let r = '';
    try {
      const c = document.createElement('canvas');
      const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        r = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
        const lc = gl.getExtension('WEBGL_lose_context'); if (lc) lc.loseContext();
      } else r = 'none';
    } catch { r = 'none'; }
    this.cpuOnly = /swiftshader|llvmpipe|softpipe|software|basic render|^none$/i.test(r);
    return this.cpuOnly;
  }

  private create(kind: BodyKind, deleg: 'GPU' | 'CPU'): Promise<Landmarker> {
    const mod = this.mod, fs = this.fileset;
    const base = { baseOptions: { modelAssetPath: new URL(VENDOR + MODEL[kind], window.location.href).href, delegate: deleg }, runningMode: 'VIDEO' };
    if (kind === 'pose') return mod.PoseLandmarker.createFromOptions(fs, Object.assign(base, { numPoses: 5,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5, outputSegmentationMasks: false }));
    if (kind === 'hands') return mod.HandLandmarker.createFromOptions(fs, Object.assign(base, { numHands: 4,
      minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 }));
    return mod.FaceLandmarker.createFromOptions(fs, Object.assign(base, { numFaces: 3,
      minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false }));
  }

  // Lazy load, serialised (one createFromOptions at a time on the page)
  private load(kind: BodyKind, forceDeleg?: 'CPU'): void {
    const st = this.k[kind];
    if (st.state === 'loading') return;
    if (st.lm) { try { st.lm.close(); } catch { /* already gone */ } st.lm = null; }
    st.state = 'loading';
    const token = this.token;
    this.chain = this.chain.then(async () => {
      if (token !== this.token) return; // released while queued
      try {
        await this.vision();
        const prefs: ('GPU' | 'CPU')[] = forceDeleg ? [forceDeleg] : (this.preferCPU() ? ['CPU'] : ['GPU', 'CPU']);
        let lm: Landmarker | null = null, deleg: '' | 'GPU' | 'CPU' = '', err: unknown = null;
        for (const d of prefs) {
          try { lm = await this.create(kind, d); deleg = d; } catch (e) { err = e; }
          if (lm) break;
        }
        if (!lm) throw err || new Error('createFromOptions failed');
        if (token !== this.token) { try { lm.close(); } catch { /* ignore */ } return; }
        try { lm.detectForVideo(this.warm(), this.ts()); } catch { /* compile/allocate now, not mid-performance */ }
        Object.assign(st, { lm, deleg, state: 'ready', errs: 0, slow: 0, runs: 0, gen: st.gen + 1 });
      } catch (e) {
        console.warn('[BodyLandmarks] ' + kind + ' load failed', e);
        if (token !== this.token) return;
        st.state = 'error'; st.lm = null; st.fails++;
      }
    });
  }

  /** close every model; reversible (a later ensure() reloads) */
  dispose(): void {
    this.token++;
    for (const kind of BODY_KINDS) {
      const st = this.k[kind];
      if (st.lm) { try { st.lm.close(); } catch { /* already gone */ } }
      st.lm = null; st.state = 'off'; st.deleg = ''; st.errs = 0; st.slow = 0; st.runs = 0;
    }
  }
}

/** the one shared instance (all nodes, all AI Lab mounts) */
export const bodyLandmarks = new BodyLandmarkService();
