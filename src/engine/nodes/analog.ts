import { EngineNode, NodeRenderContext, compileProgram, QUAD_VS, Target, createTarget, destroyTarget } from '../SynEngine';
import { ParamSchema } from '../../bridge/types';

/* ═══════════════════════════════════════════════════════════════
   ANALOG — 1:1 port of public/effects/analog/index.html (Phase 4).

   Pipeline, order and math copied from the standalone build:
     [pixel sort (odd-even transposition, N passes)] →
     feedback loop (zoom/rotate/decay/hue, ping-pong across frames) →
     CRT & glitch composite (barrel, tracking, tear, chroma, bloom,
     dropout, roll bar, noise, scanlines, phosphor, vignette, blend).
   Shaders are the standalone's GLSL translated to ES 3.00 with the
   math untouched (incl. the fixed 1920/1080/540 texel constants that
   define the CRT look). One deliberate substitution, decision-logged
   in STATE.md: the standalone's PSEUDO-AUTO reactive generator is
   replaced by the real audio signals — reactBass/Mid/High are node
   params pre-wired via ParamBus defaultRoute to bass/loud/treble, so
   u_react* uniforms carry live analysis instead of synthesized noise.
   ═══════════════════════════════════════════════════════════════ */

const FS_BLIT = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D u_tex; out vec4 o;
void main(){ o = texture(u_tex, vUV); }`;

const FS_SORT = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_tw, u_th;
uniform float u_thresh;
uniform int u_dir;
uniform int u_pass;
in vec2 vUV;
out vec4 o;
float luma(vec3 c){ return dot(c,vec3(0.299,0.587,0.114)); }
void main(){
  vec2 step2 = u_dir==0 ? vec2(1.0/u_tw,0.) : vec2(0.,1.0/u_th);
  float idx  = u_dir==0 ? vUV.x*u_tw : vUV.y*u_th;
  float pairPos = mod(idx,2.0);
  bool isLeft = (u_pass==0) ? (pairPos<0.5) : (pairPos>=0.5);
  vec4 self = texture(u_tex,vUV);
  if(luma(self.rgb)<u_thresh){ o=self; return; }
  vec2 nUV = isLeft ? clamp(vUV+step2,0.,1.) : clamp(vUV-step2,0.,1.);
  vec4 nb = texture(u_tex,nUV);
  if(luma(nb.rgb)<u_thresh){ o=self; return; }
  float sl=luma(self.rgb), nl=luma(nb.rgb);
  if(isLeft)  o = sl>nl ? nb : self;
  else        o = sl<nl ? nb : self;
}`;

const FS_SORT_DIAG = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_tw, u_th;
uniform float u_thresh;
uniform int u_pass;
in vec2 vUV;
out vec4 o;
float luma(vec3 c){ return dot(c,vec3(0.299,0.587,0.114)); }
void main(){
  vec2 step2=vec2(1./u_tw,1./u_th);
  float idx=floor(vUV.x*u_tw)+floor(vUV.y*u_th);
  float pairPos=mod(idx,2.0);
  bool isLeft=(u_pass==0)?(pairPos<0.5):(pairPos>=0.5);
  vec4 self=texture(u_tex,vUV);
  if(luma(self.rgb)<u_thresh){o=self;return;}
  vec2 nUV=isLeft?clamp(vUV+step2,0.,1.):clamp(vUV-step2,0.,1.);
  vec4 nb=texture(u_tex,nUV);
  if(luma(nb.rgb)<u_thresh){o=self;return;}
  float sl=luma(self.rgb),nl=luma(nb.rgb);
  if(isLeft) o=sl>nl?nb:self;
  else       o=sl<nl?nb:self;
}`;

const FS_FEEDBACK = `#version 300 es
precision highp float;
uniform sampler2D u_src, u_prev;
uniform float u_feedbackAmt, u_zoom, u_rot, u_decay, u_hue, u_driftX;
uniform int u_mirror;
uniform float u_reactBass, u_reactMid, u_modDepth;
in vec2 vUV;
out vec4 o;

vec3 rotHue(vec3 c,float a){
  float ca=cos(a),sa=sin(a);
  return vec3(
    c.r*(0.299+0.701*ca+0.168*sa)+c.g*(0.587-0.587*ca+0.330*sa)+c.b*(0.114-0.114*ca-0.497*sa),
    c.r*(0.299-0.299*ca-0.328*sa)+c.g*(0.587+0.413*ca+0.035*sa)+c.b*(0.114-0.114*ca+0.292*sa),
    c.r*(0.299-0.300*ca+1.250*sa)+c.g*(0.587-0.588*ca-1.050*sa)+c.b*(0.114+0.886*ca-0.203*sa)
  );
}
void main(){
  vec4 src=texture(u_src,vUV);
  float zf=1.0+u_zoom*0.18*(1.0+u_reactBass*u_modDepth);
  float ra=u_rot*0.05*(1.0+u_reactMid*u_modDepth*0.5);
  vec2 c=vUV-0.5;
  float cr=cos(ra),sr2=sin(ra);
  c=vec2(c.x*cr-c.y*sr2, c.x*sr2+c.y*cr);
  c/=max(zf,0.01);
  c+=vec2(u_driftX,0.)*0.0008;
  vec2 fUV=c+0.5;
  if(u_mirror==1) fUV=abs(fract(fUV*0.5)*2.0-1.0);
  else fUV=clamp(fUV,0.0,1.0);
  vec4 prev=texture(u_prev,fUV);
  float hrad=u_hue*3.14159;
  if(abs(hrad)>0.001) prev.rgb=rotHue(prev.rgb,hrad);
  float dk=u_decay*0.03+0.003;
  prev.rgb=mix(prev.rgb,vec3(0.5),dk);
  float gm=1.0+u_decay*0.15;
  prev.rgb=pow(clamp(prev.rgb,0.0,1.0),vec3(gm));
  float fa=clamp(u_feedbackAmt*(1.0+u_reactMid*u_modDepth*0.25),0.0,0.98);
  o=mix(src,prev,fa);
}`;

const FS_CRT = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_time, u_seed;
uniform float u_barrel, u_scanlines, u_phosphor, u_bloom, u_vignette, u_blend;
uniform float u_tear, u_dropout, u_chroma, u_noise, u_rollBar, u_tracking;
uniform float u_reactBass, u_reactMid, u_reactHigh, u_modDepth;
in vec2 vUV;
out vec4 fragOut;

float h11(float p){ return fract(sin(p*127.1+311.7)*43758.5453); }
float h12(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float h21(float p){ return fract(sin(p*269.5+183.3)*29441.7432); }

void main(){
  vec2 uv=vUV;

  if(u_barrel>0.001){
    vec2 cv=uv*2.-1.;
    float r2=dot(cv,cv);
    cv*=1.0+u_barrel*0.6*r2*(1.0+u_barrel*0.4*r2);
    uv=cv*.5+.5;
    if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.){fragOut=vec4(0.,0.,0.,1.);return;}
  }

  float trackD=0.;
  if(u_tracking>0.001){
    float roll=fract(uv.y+u_time*0.06);
    float bw=0.06+h11(floor(u_seed*0.1))*0.10;
    float inBand=smoothstep(0.,0.015,roll)*smoothstep(0.,0.015,bw-roll);
    float bn=h12(vec2(floor(uv.y*80.),floor(u_seed*0.3)));
    trackD=inBand*(bn-0.5)*u_tracking*0.18;
    trackD+=(h21(floor(uv.y*200.)+floor(u_seed*0.5))-0.5)*u_tracking*0.018;
  }

  float syncD=0.;
  float tearStr=u_tear*(1.0+u_reactBass*u_modDepth);
  if(tearStr>0.001){
    float ly=floor(uv.y*540.);
    float lr=h12(vec2(ly,floor(u_seed)));
    float on=step(1.-tearStr*0.32,lr);
    syncD=(h12(vec2(ly+.7,floor(u_seed+1.)))-0.5)*0.10*tearStr*on;
    float bigTear=step(0.97,h11(floor(u_seed*0.07)+floor(ly*0.02)));
    syncD+=bigTear*(h21(floor(u_seed*0.13))-0.5)*0.18*tearStr;
  }

  vec2 baseUV=clamp(vec2(uv.x+syncD+trackD,uv.y),0.,1.);

  float cStr=u_chroma*0.022*(1.+u_reactHigh*u_modDepth);
  vec2 uvR=clamp(baseUV+vec2( cStr,  cStr*0.15),0.,1.);
  vec2 uvG=baseUV;
  vec2 uvB=clamp(baseUV+vec2(-cStr, -cStr*0.08),0.,1.);

  vec3 bloomCol=vec3(0.);
  if(u_bloom>0.001){
    float bs=0.0045;
    vec3 b0=texture(u_tex,clamp(uvG+vec2(bs,0.),0.,1.)).rgb;
    vec3 b1=texture(u_tex,clamp(uvG-vec2(bs,0.),0.,1.)).rgb;
    vec3 b2=texture(u_tex,clamp(uvG+vec2(0.,bs),0.,1.)).rgb;
    vec3 b3=texture(u_tex,clamp(uvG-vec2(0.,bs),0.,1.)).rgb;
    vec3 b4=texture(u_tex,clamp(uvG+vec2(bs,bs)*.7,0.,1.)).rgb;
    vec3 b5=texture(u_tex,clamp(uvG-vec2(bs,bs)*.7,0.,1.)).rgb;
    bloomCol=(b0+b1+b2+b3+b4+b5)/6.0;
    float bl=dot(bloomCol,vec3(.299,.587,.114));
    bloomCol*=bl*bl;
  }

  float r=texture(u_tex,uvR).r;
  float g=texture(u_tex,uvG).g;
  float b=texture(u_tex,uvB).b;
  vec3 col=vec3(r,g,b)+bloomCol*u_bloom*0.55;

  if(u_dropout>0.001){
    float ly=floor(uv.y*1080.);
    float lr=h12(vec2(ly*0.025,floor(u_seed*0.7)));
    float lineOut=step(1.-u_dropout*0.13,lr);
    float bx=floor(uv.x*18.);
    float br=h12(vec2(bx*.08,ly*.006+floor(u_seed*.4)));
    float blockOut=step(1.-u_dropout*.08,br);
    col*=(1.-lineOut*.97)*(1.-blockOut*.75);
  }

  if(u_rollBar>0.001){
    float phase=fract(u_time*0.11);
    float bY=fract(uv.y-phase);
    float bar=exp(-bY*bY*50.)*0.5+exp(-(bY-.5)*(bY-.5)*120.)*.2;
    col*=1.-u_rollBar*0.4+u_rollBar*bar;
    col.r*=1.+u_rollBar*bar*0.08;
  }

  if(u_noise>0.001){
    float grain=h12(vUV*vec2(1920.,1080.)+u_seed*0.117)*2.-1.;
    float tempoN=h11(floor(uv.y*540.)+u_seed*31.)*2.-1.;
    col+=grain*u_noise*(0.5+0.5*abs(tempoN))*(1.+u_reactHigh*u_modDepth*0.7);
    col=clamp(col,0.,1.);
  }

  if(u_scanlines>0.001){
    float fl=fract(uv.y*540.);
    float fm=1.-u_scanlines*0.5*step(0.5,fl);
    float iShim=sin(uv.y*1080.*3.14159)*.5+.5;
    col*=fm*(1.-u_scanlines*0.08*(1.-iShim));
  }

  if(u_phosphor>0.001){
    float px=mod(vUV.x*1920.,3.);
    vec3 mask;
    if(px<1.)      mask=vec3(1.0,0.28,0.28);
    else if(px<2.) mask=vec3(0.28,1.0,0.28);
    else           mask=vec3(0.28,0.28,1.0);
    col*=mix(vec3(1.),mask,u_phosphor*0.75);
    col*=1.+u_phosphor*0.15;
  }

  if(u_vignette>0.001){
    vec2 vc=vUV*2.-1.;
    float vr=dot(vc,vc);
    float vig=1.-vr*vr*u_vignette*0.75;
    float corners=pow(abs(vc.x*vc.y),0.45);
    vig*=1.-corners*u_vignette*0.35;
    col*=max(vig,0.);
  }

  vec3 clean=texture(u_tex,uvG).rgb;
  col=mix(clean,clamp(col,0.,1.),u_blend);

  fragOut=vec4(col,1.);
}`;

/* Param table — 100% of the standalone's controls (see STATE.md log for
 * the diff table). Defaults match the P object in the HTML. */
const PARAMS: ParamSchema[] = [
  // feedback loop knobs
  { key: 'feedbackAmt', label: 'Feedback Amount', type: 'number', value: 0, min: 0, max: 0.98, step: 0.01, reactive: true, aiHint: 'Video-feedback trail strength; near 1 the image smears into itself' },
  { key: 'feedbackZoom', label: 'Feedback Zoom', type: 'number', value: 0, min: -1, max: 1, step: 0.01, reactive: true, aiHint: 'Feedback zoom drift; negative pulls in, positive pushes out' },
  { key: 'feedbackRot', label: 'Feedback Rotate', type: 'number', value: 0, min: -1, max: 1, step: 0.01, reactive: true, aiHint: 'Feedback rotation drift per frame' },
  { key: 'feedbackDecay', label: 'Feedback Decay', type: 'number', value: 0.3, min: 0, max: 1, step: 0.01, aiHint: 'How fast trails fade to grey' },
  { key: 'hueShift', label: 'Hue Drift', type: 'number', value: 0, min: -1, max: 1, step: 0.01, aiHint: 'Hue rotation applied to the trail each frame' },
  { key: 'feedbackDriftX', label: 'Feedback Drift', type: 'number', value: 0, min: -1, max: 1, step: 0.01, aiHint: 'Horizontal drift of the feedback buffer' },
  { key: 'feedbackMirror', label: 'Feedback Mirror', type: 'boolean', value: 0, aiHint: '(on/off switch) Kaleidoscope-mirror the feedback wrap' },
  // analog glitch knobs
  { key: 'tearAmt', label: 'H-Tear', type: 'number', value: 0.1, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Horizontal sync-tear amount (bass-reactive in the original)' },
  { key: 'dropoutAmt', label: 'Dropout', type: 'number', value: 0, min: 0, max: 1, step: 0.01, aiHint: 'Tape dropout: dark lines and missing blocks' },
  { key: 'chromaAmt', label: 'Chroma', type: 'number', value: 0.1, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'RGB channel separation (treble-reactive in the original)' },
  { key: 'noiseAmt', label: 'Noise', type: 'number', value: 0.08, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Film/VHS grain (treble-reactive in the original)' },
  { key: 'rollBar', label: 'Roll Bar', type: 'number', value: 0, min: 0, max: 1, step: 0.01, aiHint: 'Vertical rolling brightness bar' },
  { key: 'trackingErr', label: 'Tracking', type: 'number', value: 0, min: 0, max: 1, step: 0.01, aiHint: 'VHS tracking-error band displacement' },
  // CRT monitor knobs
  { key: 'barrelAmt', label: 'Barrel', type: 'number', value: 0.3, min: 0, max: 1, step: 0.01, aiHint: 'CRT barrel distortion of the tube' },
  { key: 'scanlinesAmt', label: 'Scanlines', type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, aiHint: 'Scanline darkness' },
  { key: 'phosphorAmt', label: 'Phosphor', type: 'number', value: 0.3, min: 0, max: 1, step: 0.01, aiHint: 'RGB phosphor-triad mask strength' },
  { key: 'bloomAmt', label: 'Bloom', type: 'number', value: 0.3, min: 0, max: 1, step: 0.01, aiHint: 'Bright-area glow bleed' },
  { key: 'vignetteAmt', label: 'Vignette', type: 'number', value: 0.4, min: 0, max: 1, step: 0.01, aiHint: 'Corner darkening of the tube' },
  { key: 'crtBlend', label: 'CRT Blend', type: 'number', value: 1.0, min: 0, max: 1, step: 0.01, aiHint: 'Dry/wet between clean frame and the full CRT look' },
  // pixel sort
  { key: 'sortEnabled', label: 'Pixel Sort', type: 'boolean', value: 0, aiHint: '(on/off switch) Enable the luminance pixel-sort stage' },
  { key: 'sortThresh', label: 'Sort Threshold', type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, aiHint: 'Only pixels brighter than this take part in the sort' },
  { key: 'sortPasses', label: 'Sort Passes', type: 'number', value: 3, min: 1, max: 12, step: 1, aiHint: 'Odd-even transposition passes per frame; more = longer streaks' },
  { key: 'sortDir', label: 'Sort Direction', type: 'number', value: 0, min: 0, max: 2, step: 1, aiHint: '0 horizontal, 1 vertical, 2 diagonal (the standalone seg buttons)' },
  // reactivity — the standalone's PSEUDO-AUTO generator becomes real signals
  { key: 'reactEnabled', label: 'Reactive', type: 'boolean', value: 1, aiHint: '(on/off switch) Gate the audio-reactive modulation channels' },
  { key: 'reactSens', label: 'React Sens', type: 'number', value: 1.0, min: 0.1, max: 2.0, step: 0.05, aiHint: 'Gain applied to the reactive channels' },
  { key: 'modDepth', label: 'Mod Depth', type: 'number', value: 0.4, min: 0, max: 1, step: 0.01, aiHint: 'How hard the reactive channels push tear/chroma/noise/feedback' },
  { key: 'reactBass', label: 'React Bass', type: 'number', value: 0, min: 0, max: 1, step: 0.01, reactive: true, defaultRoute: { source: 'bass', amount: 1 }, aiHint: 'Live bass channel driving tear + feedback zoom (auto-routed)' },
  { key: 'reactMid', label: 'React Mid', type: 'number', value: 0, min: 0, max: 1, step: 0.01, reactive: true, defaultRoute: { source: 'loud', amount: 1 }, aiHint: 'Live mid/loudness channel driving feedback amount + rotation (auto-routed)' },
  { key: 'reactHigh', label: 'React High', type: 'number', value: 0, min: 0, max: 1, step: 0.01, reactive: true, defaultRoute: { source: 'treble', amount: 1 }, aiHint: 'Live treble channel driving chroma + noise (auto-routed)' },
];

interface Progs {
  blit: WebGLProgram;
  sort: WebGLProgram;
  sortDiag: WebGLProgram;
  feedback: WebGLProgram;
  crt: WebGLProgram;
}

export class AnalogNode implements EngineNode {
  readonly id = 'analog';
  readonly name = 'Analog';
  enabled = true;
  readonly params = PARAMS;

  private v: Record<string, number> = {};
  private gl: WebGL2RenderingContext | null = null;
  private progs: Progs | null = null;
  private uni: Record<string, Record<string, WebGLUniformLocation | null>> = {};
  private sortT: [Target, Target] | null = null;
  private fbkT: [Target, Target] | null = null;
  private crtT: Target | null = null;
  private w = 0;
  private h = 0;
  private sortEven = 0;
  private fbkR = 0;
  private fbkNeedsClear = true;

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
    const mk = (fs: string) => compileProgram(gl, QUAD_VS, fs);
    this.progs = {
      blit: mk(FS_BLIT),
      sort: mk(FS_SORT),
      sortDiag: mk(FS_SORT_DIAG),
      feedback: mk(FS_FEEDBACK),
      crt: mk(FS_CRT),
    };
    const locs = (p: WebGLProgram, names: string[]) => {
      const out: Record<string, WebGLUniformLocation | null> = {};
      names.forEach((n) => { out[n] = gl.getUniformLocation(p, n); });
      return out;
    };
    this.uni = {
      blit: locs(this.progs.blit, ['u_tex']),
      sort: locs(this.progs.sort, ['u_tex', 'u_tw', 'u_th', 'u_thresh', 'u_dir', 'u_pass']),
      sortDiag: locs(this.progs.sortDiag, ['u_tex', 'u_tw', 'u_th', 'u_thresh', 'u_pass']),
      feedback: locs(this.progs.feedback, ['u_src', 'u_prev', 'u_feedbackAmt', 'u_zoom', 'u_rot', 'u_decay', 'u_hue', 'u_driftX', 'u_mirror', 'u_reactBass', 'u_reactMid', 'u_modDepth']),
      crt: locs(this.progs.crt, ['u_tex', 'u_time', 'u_seed', 'u_barrel', 'u_scanlines', 'u_phosphor', 'u_bloom', 'u_vignette', 'u_blend', 'u_tear', 'u_dropout', 'u_chroma', 'u_noise', 'u_rollBar', 'u_tracking', 'u_reactBass', 'u_reactMid', 'u_reactHigh', 'u_modDepth']),
    };
  }

  resize(width: number, height: number): void {
    const gl = this.gl;
    if (!gl || width < 2 || height < 2) return;
    if (width === this.w && height === this.h) return;
    this.w = width;
    this.h = height;
    this.destroyTargets(gl);
    this.sortT = [createTarget(gl, width, height), createTarget(gl, width, height)];
    this.fbkT = [createTarget(gl, width, height), createTarget(gl, width, height)];
    this.crtT = createTarget(gl, width, height);
    this.fbkNeedsClear = true;
  }

  private destroyTargets(gl: WebGL2RenderingContext): void {
    this.sortT?.forEach((t) => destroyTarget(gl, t));
    this.fbkT?.forEach((t) => destroyTarget(gl, t));
    destroyTarget(gl, this.crtT);
    this.sortT = null;
    this.fbkT = null;
    this.crtT = null;
  }

  render(ctx: NodeRenderContext): WebGLTexture {
    const gl = ctx.gl;
    if (!this.progs || !this.sortT || !this.fbkT || !this.crtT) return ctx.inputTex;
    const P = this.v;
    const react = P.reactEnabled >= 0.5 ? {
      bass: Math.min(1, P.reactBass * P.reactSens),
      mid: Math.min(1, P.reactMid * P.reactSens),
      high: Math.min(1, P.reactHigh * P.reactSens),
    } : { bass: 0, mid: 0, high: 0 };

    if (this.fbkNeedsClear) {
      this.fbkT.forEach((t) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
        gl.viewport(0, 0, this.w, this.h);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      });
      this.fbkNeedsClear = false;
    }

    const bindTex = (unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc, unit);
    };

    /* 1 — pixel sort (optional) */
    let stageTex = ctx.inputTex;
    if (P.sortEnabled >= 0.5) {
      let r = 0;
      let w = 1;
      // seed the ping-pong with the input frame
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sortT[r].fbo);
      gl.viewport(0, 0, this.w, this.h);
      gl.useProgram(this.progs.blit);
      bindTex(0, stageTex, this.uni.blit.u_tex);
      ctx.drawQuad();
      const passes = Math.max(1, Math.round(P.sortPasses));
      const dir = Math.max(0, Math.min(2, Math.round(P.sortDir)));
      for (let i = 0; i < passes; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.sortT[w].fbo);
        gl.viewport(0, 0, this.w, this.h);
        if (dir === 2) {
          gl.useProgram(this.progs.sortDiag);
          bindTex(0, this.sortT[r].tex, this.uni.sortDiag.u_tex);
          gl.uniform1f(this.uni.sortDiag.u_tw, this.w);
          gl.uniform1f(this.uni.sortDiag.u_th, this.h);
          gl.uniform1f(this.uni.sortDiag.u_thresh, P.sortThresh);
          gl.uniform1i(this.uni.sortDiag.u_pass, this.sortEven);
        } else {
          gl.useProgram(this.progs.sort);
          bindTex(0, this.sortT[r].tex, this.uni.sort.u_tex);
          gl.uniform1f(this.uni.sort.u_tw, this.w);
          gl.uniform1f(this.uni.sort.u_th, this.h);
          gl.uniform1f(this.uni.sort.u_thresh, P.sortThresh);
          gl.uniform1i(this.uni.sort.u_dir, dir);
          gl.uniform1i(this.uni.sort.u_pass, this.sortEven);
        }
        ctx.drawQuad();
        r ^= 1;
        w ^= 1;
        this.sortEven ^= 1;
      }
      stageTex = this.sortT[r].tex;
    }

    /* 2 — feedback loop (ping-pong across frames) */
    const read = this.fbkT[this.fbkR];
    const write = this.fbkT[this.fbkR ^ 1];
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.progs.feedback);
    bindTex(0, stageTex, this.uni.feedback.u_src);
    bindTex(1, read.tex, this.uni.feedback.u_prev);
    gl.uniform1f(this.uni.feedback.u_feedbackAmt, P.feedbackAmt);
    gl.uniform1f(this.uni.feedback.u_zoom, P.feedbackZoom);
    gl.uniform1f(this.uni.feedback.u_rot, P.feedbackRot);
    gl.uniform1f(this.uni.feedback.u_decay, P.feedbackDecay);
    gl.uniform1f(this.uni.feedback.u_hue, P.hueShift);
    gl.uniform1f(this.uni.feedback.u_driftX, P.feedbackDriftX);
    gl.uniform1i(this.uni.feedback.u_mirror, P.feedbackMirror >= 0.5 ? 1 : 0);
    gl.uniform1f(this.uni.feedback.u_reactBass, react.bass);
    gl.uniform1f(this.uni.feedback.u_reactMid, react.mid);
    gl.uniform1f(this.uni.feedback.u_modDepth, P.modDepth);
    ctx.drawQuad();
    this.fbkR ^= 1;

    /* 3 — CRT & glitch composite */
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.crtT.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.progs.crt);
    bindTex(0, write.tex, this.uni.crt.u_tex);
    gl.uniform1f(this.uni.crt.u_time, ctx.time);
    gl.uniform1f(this.uni.crt.u_seed, ctx.time * 13.73 + ctx.frame * 0.07);
    gl.uniform1f(this.uni.crt.u_barrel, P.barrelAmt);
    gl.uniform1f(this.uni.crt.u_scanlines, P.scanlinesAmt);
    gl.uniform1f(this.uni.crt.u_phosphor, P.phosphorAmt);
    gl.uniform1f(this.uni.crt.u_bloom, P.bloomAmt);
    gl.uniform1f(this.uni.crt.u_vignette, P.vignetteAmt);
    gl.uniform1f(this.uni.crt.u_blend, P.crtBlend);
    gl.uniform1f(this.uni.crt.u_tear, P.tearAmt);
    gl.uniform1f(this.uni.crt.u_dropout, P.dropoutAmt);
    gl.uniform1f(this.uni.crt.u_chroma, P.chromaAmt);
    gl.uniform1f(this.uni.crt.u_noise, P.noiseAmt);
    gl.uniform1f(this.uni.crt.u_rollBar, P.rollBar);
    gl.uniform1f(this.uni.crt.u_tracking, P.trackingErr);
    gl.uniform1f(this.uni.crt.u_reactBass, react.bass);
    gl.uniform1f(this.uni.crt.u_reactMid, react.mid);
    gl.uniform1f(this.uni.crt.u_reactHigh, react.high);
    gl.uniform1f(this.uni.crt.u_modDepth, P.modDepth);
    ctx.drawQuad();

    return this.crtT.tex;
  }

  dispose(gl: WebGL2RenderingContext): void {
    if (this.progs) {
      Object.values(this.progs).forEach((p) => gl.deleteProgram(p));
      this.progs = null;
    }
    this.destroyTargets(gl);
  }
}
