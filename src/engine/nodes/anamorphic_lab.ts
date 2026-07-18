import { EngineNode, NodeRenderContext, compileProgram, QUAD_VS, Target, createTarget, destroyTarget } from '../SynEngine';
import { ParamSchema } from '../../bridge/types';

/* ═══════════════════════════════════════════════════════════════
   ANAMORPHIC LAB — 1:1 port of public/effects/anamorphic_lab/
   index.html (Phase 6).

   Pipeline, order and math copied from the standalone build:
     [subject-aware bokeh pre-pass, only while bokehMM > 0: mask
      intake per segmentation arrival (alpha→R swizzle at 320×180,
      temporal EMA α=0.35 with 1.6× rising asymmetry, 5×5 feather)
      → 48-tap pillbox disc blur with oval ratio + background
      magnification at a FIXED 1280×720 working res → feathered
      composite (feather 0.45)] →
     single main pass: chromatic aberration → exposure → aniso
     bokeh bloom + halation → film grade (lift/contrast/filmic
     shoulder/temp/sat) → LUT (identity in this build) → VHS grain
     → elliptical vignette → auto-detected anamorphic flare →
     compare split, with anamorphic optics (squeeze, barrel,
     letterbox crop, lens breathing) shaping the sampling UVs.
   Shaders are the standalone's GLSL translated to ES 3.00 with the
   math untouched. The engine works y-up (the standalone uploads
   unflipped and flips in its vertex shader — orientation
   bookkeeping only; deterministic vertical patterns like grain
   lines mirror accordingly). The f-stop → CoC radius easing
   (~120ms time constant) and the CPU auto-flare hotspot detector
   (80×45 readback of the SOURCE every 160ms, same smoothing
   constants) are ported verbatim. ghostGlitch reproduces the
   deliberate mask-flip effect. The standalone's eager MediaPipe
   becomes the shared PersonMask service (segEnabled +
   ctx.personMask/personMaskVersion); its only AudioContext is
   export plumbing — this build has NO audio-reactive params, so no
   defaultRoutes are seeded (video-driven reactivity only).
   ═══════════════════════════════════════════════════════════════ */

/* fixed working res of the bokeh pre-pass, independent of node size */
const BK_W = 1280;
const BK_H = 720;
const SEG_SW = 320;
const SEG_SH = 180;

const FS_MAIN = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform sampler2D uLUT;
uniform float uTime;
uniform float uTemp;
uniform float uLift;
uniform float uContrast;
uniform float uSat;
uniform float uRolloff;
uniform float uRolloffKnee;
uniform float uExposure;
uniform float uHalation;
uniform float uGrain;
uniform float uBokeh;
uniform float uCA;
uniform float uBarrel;
uniform float uVignette;
uniform float uLetterbox;
uniform float uRatio;
uniform float uVideoAR;
uniform float uBreathing;
uniform float uSqueeze;
uniform float uFlare;
uniform float uFlareMaster;
uniform float uFlareAmt;
uniform float uFlareX;
uniform float uFlareActive;
uniform float uFlarePhase;
uniform float uFlareJitter;
uniform float uFlareLength;
uniform float uFlareColor;
uniform float uFlareHeight;
uniform float uCompare;
uniform float uLutMix;
uniform float uLutSize;
out vec4 fragOut;

float rng(vec2 c){return fract(sin(dot(c,vec2(12.9898,78.233)))*43758.5453);}
float hash3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}

vec2 squeezeUV(vec2 uv,float sq){
  if(sq<1.001)return uv;
  float e=0.001;
  return vec2(clamp(0.5+(uv.x-0.5)*sq,e,1.0-e),uv.y);
}

vec2 barrel(vec2 uv,float k){
  vec2 c=uv-0.5;
  float r2=dot(c,c);
  c.x+=c.x*r2*(k*0.35);
  c.y+=c.y*r2*(k*1.20);
  return c+0.5;
}

vec3 sampleLUT(sampler2D lut,vec3 c,float mixAmt,float lutSize){
  if(mixAmt<0.001)return c;
  vec3 hold=texture(lut,vec2(0.5,0.5)).rgb;
  return mix(c,c,mixAmt)+hold*0.0;
}

float luminance(vec3 c){return dot(c,vec3(0.299,0.587,0.114));}

vec3 halation(sampler2D tex,vec2 uv,float str){
  if(str<0.01)return vec3(0.);
  float r=0.010*str;
  vec3 s=vec3(0.);
  s+=texture(tex,uv+vec2( r*2.4, 0.0)).rgb;
  s+=texture(tex,uv+vec2(-r*2.4, 0.0)).rgb;
  s+=texture(tex,uv+vec2( r*1.4,  r*0.5)).rgb;
  s+=texture(tex,uv+vec2(-r*1.4,  r*0.5)).rgb;
  s+=texture(tex,uv+vec2( r*1.4, -r*0.5)).rgb;
  s+=texture(tex,uv+vec2(-r*1.4, -r*0.5)).rgb;
  s+=texture(tex,uv+vec2(0.,  r*0.8)).rgb;
  s+=texture(tex,uv+vec2(0., -r*0.8)).rgb;
  s/=8.0;
  float lum=luminance(s);
  float mask=smoothstep(0.52,0.92,lum);
  s*=vec3(1.60,0.68,0.18);
  return s*mask*str*0.52;
}

vec3 anisoBokehBloom(sampler2D tex,vec2 uv,float str){
  if(str<0.01)return vec3(0.);
  float w=str*0.018;
  vec3 acc=vec3(0.);
  float tw=0.;
  float t0=0.22,t1=0.18,t2=0.14,t3=0.12;
  vec2 o;
  vec3 s;float lum,hi;
  o=vec2(-3.0*w,0.);s=texture(tex,uv+o).rgb;lum=luminance(s);hi=smoothstep(0.62,0.98,lum);acc+=s*hi*t0;tw+=t0*hi;
  o=vec2(-2.0*w,0.);s=texture(tex,uv+o).rgb;lum=luminance(s);hi=smoothstep(0.62,0.98,lum);acc+=s*hi*t1;tw+=t1*hi;
  o=vec2(-1.0*w,0.);s=texture(tex,uv+o).rgb;lum=luminance(s);hi=smoothstep(0.62,0.98,lum);acc+=s*hi*t2;tw+=t2*hi;
  o=vec2(0.0,0.);s=texture(tex,uv+o).rgb;lum=luminance(s);hi=smoothstep(0.62,0.98,lum);acc+=s*hi*t3;tw+=t3*hi;
  o=vec2(1.0*w,0.);s=texture(tex,uv+o).rgb;lum=luminance(s);hi=smoothstep(0.62,0.98,lum);acc+=s*hi*t2;tw+=t2*hi;
  o=vec2(2.0*w,0.);s=texture(tex,uv+o).rgb;lum=luminance(s);hi=smoothstep(0.62,0.98,lum);acc+=s*hi*t1;tw+=t1*hi;
  o=vec2(3.0*w,0.);s=texture(tex,uv+o).rgb;lum=luminance(s);hi=smoothstep(0.62,0.98,lum);acc+=s*hi*t0;tw+=t0*hi;
  if(tw<0.0001)return vec3(0.);
  acc/=tw;
  float baseL=luminance(texture(tex,uv).rgb);
  float gate=smoothstep(0.55,0.95,baseL);
  return acc*str*0.85*gate;
}

vec3 chromAb(sampler2D tex,vec2 uv,float str){
  if(str<0.01)return texture(tex,uv).rgb;
  float dist=length(uv-0.5)*1.4;
  vec2 shift=(uv-0.5)*str*0.015*dist;
  float r=texture(tex,uv+shift).r;
  float gv=texture(tex,uv).g;
  float b=texture(tex,uv-shift).b;
  return vec3(r,gv,b);
}

vec3 instaxVhsGrain(vec2 uv,float t,float str,float lum){
  if(str<0.004)return vec3(0.);
  float frame=floor(t*18.0)/18.0;
  vec2 q=uv*vec2(1.0,1.15);
  float n1=hash3(vec3(q*vec2(420.0,380.0),frame));
  float n2=hash3(vec3(q*vec2(90.0,110.0),frame*1.7));
  float n3=hash3(vec3(q*vec2(18.0,22.0),frame*0.4));
  float blob=smoothstep(0.35,0.72,n2)*0.9+0.25;
  float line=sin(uv.y*720.0+t*3.1)*0.5+0.5;
  line=pow(line,6.0)*0.35;
  vec3 g=vec3(n1-0.5,n1-0.48,n1-0.52);
  g.r+=0.08*sin(uv.y*900.0+frame*12.0);
  g.b+=0.06*cos(uv.x*640.0-frame*9.0);
  g*=mix(0.65,blob,0.85);
  g.r*=1.12;g.g*=0.92;g.b*=1.08;
  float vhsBleed=smoothstep(0.2,0.55,n3)*0.22;
  g+=vec3(vhsBleed*0.4,vhsBleed*0.15,-vhsBleed*0.1);
  float scan=line*str*0.45;
  g+=vec3(scan*0.08,scan*0.05,scan*0.12);
  float mid=smoothstep(0.05,0.22,lum)*smoothstep(0.92,0.48,lum);
  float hiSup=1.0-smoothstep(0.78,0.98,lum);
  return g*mid*hiSup*str*0.22;
}

float shoulderCh(float x,float rolloff,float kneeShape){
  float knee=mix(0.88,0.58,rolloff);
  float a=mix(2.5,8.0,rolloff)*kneeShape;
  float b=mix(0.2,0.55,rolloff);
  float t=max(x-knee,0.0);
  float compressed=knee+t/(1.0+a*t+b*t*t);
  return mix(x,compressed,smoothstep(knee-0.08,knee+0.02,x));
}
vec3 filmicShoulder(vec3 c,float rolloff,float kneeShape){
  if(rolloff<0.001)return c;
  return vec3(
    shoulderCh(c.r,rolloff,kneeShape),
    shoulderCh(c.g,rolloff,kneeShape),
    shoulderCh(c.b,rolloff,kneeShape)
  );
}

vec3 tempGrade(vec3 c,float temp,float lift,float contrast,float sat,float rolloff,float rolloffK){
  c=mix(vec3(lift),vec3(1.0-lift*0.12),c);
  float k=contrast*0.55;
  c=c*(1.0+k)-k*0.5;
  c=clamp(c,0.,1.);
  c=filmicShoulder(c,rolloff,rolloffK);
  float lum=luminance(c);
  float absT=abs(temp);
  vec3 shTint,mdTint,hiTint;
  if(temp>=0.0){
    shTint=mix(vec3(1.),vec3(1.08,0.76,0.36),absT);
    mdTint=mix(vec3(1.),vec3(1.03,0.94,0.70),absT);
    hiTint=mix(vec3(1.),vec3(1.01,0.98,0.87),absT);
  }else{
    shTint=mix(vec3(1.),vec3(0.54,0.78,1.22),absT);
    mdTint=mix(vec3(1.),vec3(0.78,0.90,1.10),absT);
    hiTint=mix(vec3(1.),vec3(0.90,0.96,1.07),absT);
  }
  vec3 tint=lum<0.5?mix(shTint,mdTint,lum*2.0):mix(mdTint,hiTint,(lum-0.5)*2.0);
  c=mix(c,c*tint,0.55);
  float g=luminance(c);
  c=mix(vec3(g),c,sat);
  return clamp(c,0.,1.);
}

vec3 anamFlare(vec2 uv,float amt,float fx,float act,float t,float phase,float jx,float lenP,float colP,float hgtP){
  if(amt<0.01||act<0.5)return vec3(0.);
  float n1=hash3(vec3(uv.x*40.0+uv.y*40.0,t*2.7,phase));
  float n2=hash3(vec3(uv.x*120.0+uv.y*120.0,t*5.1,phase*0.3));
  float flick=0.88+0.14*sin(t*6.2+phase*12.0)+0.08*(n1-0.5);
  float micro=0.97+0.06*sin(uv.y*180.0+t*3.0)+0.04*(n2-0.5);
  float fxw=fx+jx*0.012;
  float dy=uv.y-0.5;
  float dx=uv.x-fxw;
  float wobble=sin(t*1.1+uv.y*25.0)*0.004;
  dy+=wobble;
  float decayS1=mix(1.4,0.1,lenP);
  float decayS2=mix(0.5,0.06,lenP);
  float vDecayS1=mix(160.0,30.0,hgtP);
  float vDecayS2=mix(34.0,6.0,hgtP);
  float s1=exp(-dy*dy*vDecayS1)*exp(-abs(dx)*decayS1);
  float s2=exp(-dy*dy*vDecayS2)*exp(-abs(dx)*decayS2);
  float dirt=smoothstep(0.35,0.85,rng(uv*3.7+t*0.2));
  vec3 coreCol=mix(vec3(1.0,0.80,0.30),vec3(0.35,0.55,1.0),colP);
  vec3 haloCol=mix(vec3(0.20,0.40,1.0),vec3(0.10,0.20,0.55),colP);
  vec3 col=vec3(0.);
  col+=coreCol*s1*0.95*flick*micro;
  col+=haloCol*s2*0.28*flick;
  col*=mix(0.85,1.15,dirt);
  vec3 ghostA=mix(vec3(1.0,0.5,0.15),vec3(0.35,0.55,1.0),colP);
  vec3 ghostB=mix(vec3(0.25,0.50,1.0),vec3(0.15,0.30,0.75),colP);
  for(float i=1.0;i<=5.0;i++){
    float ox=fxw-(fxw-0.5)*(i*0.22);
    float oy=0.5+0.02*sin(t*0.9+i*1.7)+0.015*(hash3(vec3(i,t,uv.x))-0.5);
    vec2 d=vec2((uv.x-ox)*3.0,(uv.y-oy)*6.0);
    float sp=smoothstep(0.17,0.0,length(d))*0.32;
    float gn=hash3(vec3(i*7.1,uv.y*50.0,t*4.0));
    sp*=0.9+0.2*gn;
    col+=mix(ghostA,ghostB,mod(i,2.0))*sp*flick;
  }
  return col*amt;
}

float anamVig(vec2 uv,float str){
  vec2 d=(uv-0.5)*vec2(0.82,1.18);
  return clamp(1.0-dot(d,d)*str*2.8,0.,1.);
}

vec2 breathe(vec2 uv,float en,float t){
  if(en<0.5)return uv;
  float b=1.0+sin(t*0.52)*0.004;
  return (uv-0.5)*b+0.5;
}

void main(){
  vec2 uv=vUV;
  vec2 uvScr=uv;

  if(uLetterbox>0.5&&uVideoAR>0.1){
    float cropF=clamp(uVideoAR/uRatio,0.05,1.0);
    float top=(1.0-cropF)*0.5;
    float bot=1.0-top;
    if(uv.y<top||uv.y>bot){
      fragOut=vec4(0.,0.,0.,1.);
      return;
    }
    uv.y=(uv.y-top)/cropF;
    uvScr=uv;
  }

  if(uCompare>0.5&&uvScr.x<0.5){
    vec2 uvc=vec2(uvScr.x*2.0,uvScr.y);
    uvc=squeezeUV(uvc,uSqueeze);
    vec3 raw=texture(uTex,uvc).rgb;
    fragOut=vec4(clamp(raw,0.,1.),1.);
    return;
  }
  if(uCompare>0.5) uvScr.x=(uvScr.x-0.5)*2.0;

  uv=uvScr;
  uv=breathe(uv,uBreathing,uTime);
  uv=clamp(uv,0.001,0.999);
  vec2 uvTex=squeezeUV(uv,uSqueeze);
  vec2 dUV=barrel(uvTex,uBarrel);
  dUV=clamp(dUV,0.001,0.999);

  vec3 base=chromAb(uTex,dUV,uCA);
  float preLum=luminance(base);
  float expLin=pow(2.0,uExposure);
  base*=expLin;
  base=clamp(base,0.,1.);

  vec3 blo=anisoBokehBloom(uTex,dUV,uBokeh);
  vec3 hal=halation(uTex,dUV,uHalation);
  vec3 col=base+blo+hal;

  col=tempGrade(col,uTemp,uLift,uContrast,uSat,uRolloff,uRolloffKnee);
  col=sampleLUT(uLUT,col,uLutMix,uLutSize);

  col+=instaxVhsGrain(uvScr,uTime,uGrain,preLum);
  col*=anamVig(uvScr,uVignette);

  float flareOn=uFlareMaster*uFlare;
  col+=anamFlare(vec2(vUV.x,uvScr.y),uFlareAmt*flareOn,uFlareX,uFlareActive,uTime,uFlarePhase,uFlareJitter,uFlareLength,uFlareColor,uFlareHeight);

  if(uCompare>0.5){
    float div=abs(uvScr.x-0.5);
    col*=1.0-smoothstep(0.0,0.004,div)*0.35;
  }

  fragOut=vec4(clamp(col,0.,1.),1.);
}`;

/* BK pre-pass shaders — u_glitch flips the sampling like the standalone's
 * vertex-shader flip (fragment-side here; mathematically identical) */
const BK_FLIP = `vec2 bkUV(vec2 uv,float g){ return vec2(uv.x, mix(uv.y, 1.0-uv.y, g)); }`;

const FS_BK_MASK_TEMPORAL = `#version 300 es
precision highp float;
uniform sampler2D u_new;
uniform sampler2D u_prev;
uniform float u_alpha;
uniform float u_glitch;
in vec2 vUV;
out vec4 o;
${BK_FLIP}
void main(){
  vec2 uv=bkUV(vUV,u_glitch);
  float n=texture(u_new,uv).r;
  float p=texture(u_prev,uv).r;
  float a=n>p?u_alpha*1.6:u_alpha;
  a=clamp(a,0.0,1.0);
  o=vec4(mix(p,n,a),0.0,0.0,1.0);
}`;

const FS_BK_MASK_BLUR = `#version 300 es
precision highp float;
uniform sampler2D u_mask;
uniform vec2 u_px;
uniform float u_glitch;
in vec2 vUV;
out vec4 o;
${BK_FLIP}
void main(){
  vec2 v_uv=bkUV(vUV,u_glitch);
  float sum=0.0,wsum=0.0;
  vec2 s=u_px*2.5;
  float offs[5];
  offs[0]=-2.0; offs[1]=-1.0; offs[2]=0.0; offs[3]=1.0; offs[4]=2.0;
  float wts[5];
  wts[0]=0.06; wts[1]=0.24; wts[2]=0.40; wts[3]=0.24; wts[4]=0.06;
  for(int i=0;i<5;i++){
    for(int j=0;j<5;j++){
      vec2 uvo=clamp(v_uv+vec2(offs[i]*s.x,offs[j]*s.y),0.0,1.0);
      float m=texture(u_mask,uvo).r;
      float w=wts[i]*wts[j];
      sum+=m*w; wsum+=w;
    }
  }
  o=vec4(sum/wsum,0.0,0.0,1.0);
}`;

const FS_BK_BLUR = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform sampler2D u_mask;
uniform float u_radius;
uniform float u_bloom;
uniform float u_ovalRatio;
uniform float u_zoom;
uniform vec2  u_px;
uniform float u_time;
uniform float u_glitch;
in vec2  vUV;
out vec4 o;
${BK_FLIP}

vec3 toLinear(vec3 c){ return c*c; }
vec3 toSRGB(vec3 c){ return sqrt(max(c,0.0)); }
float gold(vec2 p,float seed){ return fract(tan(distance(p*vec2(1.61803398874989,1.41421356237),p+seed))*p.x); }

void tap(vec2 uv, float mgate, float bloomK, float edgeBoost,
         inout vec3 acc, inout float wt){
  uv=clamp(uv,0.0,1.0);
  float tm=texture(u_mask,uv).r;
  vec3 lin=toLinear(texture(u_tex,uv).rgb);
  float lum=dot(lin,vec3(0.299,0.587,0.114));
  float edgeK=mix(0.0, bloomK*1.6, edgeBoost);
  float subjGate=1.0-smoothstep(0.12,0.45,tm);
  float w=(1.0 + lum*lum*edgeK)*subjGate*mgate;
  acc+=lin*w; wt+=w;
}

void main(){
  vec2 v_uv=bkUV(vUV,u_glitch);
  float selfMask=texture(u_mask,v_uv).r;
  float coc=pow(clamp(1.0-selfMask,0.0,1.0),1.35)*u_radius;
  if(coc<0.6){ o=texture(u_tex,v_uv); return; }

  vec2 px=u_px;
  vec3 acc=vec3(0.0); float wt=0.0;
  float mgate=1.0-selfMask*0.88;
  float bloomK=u_bloom;

  vec2 zoomCenter=vec2(0.5,0.5);
  vec2 zUV=clamp(zoomCenter+(v_uv-zoomCenter)/max(u_zoom,1.0),0.001,0.999);
  float tmAtZoom=texture(u_mask,zUV).r;
  float zoomSafe=1.0-smoothstep(0.03,0.18,tmAtZoom);
  float bgAmt=pow(clamp(1.0-selfMask,0.0,1.0),1.5)*zoomSafe;
  vec2 sampleBase=mix(v_uv,zUV,bgAmt);

  tap(sampleBase, mgate, bloomK, 0.0, acc, wt);

  float ar=16.0/9.0;
  float ow=1.0/max(u_ovalRatio,1.0);
  float oh=u_ovalRatio;

  float rr; float a; vec2 d; vec2 t; float jitter;

  rr=coc*0.20;
  for(int i=0;i<6;i++){
    jitter=gold(v_uv,float(i)*0.3+u_time*0.01)*0.28;
    a=float(i)*1.0472+jitter;
    d=vec2(cos(a)*ow, sin(a)*oh);
    t=sampleBase+vec2(d.x*rr*px.x, d.y*rr*px.y*ar);
    tap(t,mgate,bloomK,0.0,acc,wt);
  }

  rr=coc*0.40;
  for(int i=0;i<10;i++){
    jitter=gold(v_uv,float(i)*0.7+u_time*0.013)*0.22;
    a=float(i)*0.6283+jitter;
    d=vec2(cos(a)*ow, sin(a)*oh);
    t=sampleBase+vec2(d.x*rr*px.x, d.y*rr*px.y*ar);
    tap(t,mgate,bloomK,0.0,acc,wt);
  }

  rr=coc*0.60;
  for(int i=0;i<12;i++){
    jitter=gold(v_uv,float(i)*1.1+u_time*0.017)*0.18;
    a=float(i)*0.5236+jitter;
    d=vec2(cos(a)*ow, sin(a)*oh);
    t=sampleBase+vec2(d.x*rr*px.x, d.y*rr*px.y*ar);
    tap(t,mgate,bloomK,0.0,acc,wt);
  }

  rr=coc*0.80;
  for(int i=0;i<12;i++){
    jitter=gold(v_uv,float(i)*1.5+u_time*0.021)*0.15;
    a=float(i)*0.5236+0.26+jitter;
    d=vec2(cos(a)*ow, sin(a)*oh);
    t=sampleBase+vec2(d.x*rr*px.x, d.y*rr*px.y*ar);
    tap(t,mgate,bloomK,0.0,acc,wt);
  }

  rr=coc*1.00;
  for(int i=0;i<8;i++){
    jitter=gold(v_uv,float(i)*2.1+u_time*0.011)*0.12;
    a=float(i)*0.7854+0.39+jitter;
    d=vec2(cos(a)*ow, sin(a)*oh);
    t=sampleBase+vec2(d.x*rr*px.x, d.y*rr*px.y*ar);
    tap(t,mgate,bloomK,1.0,acc,wt);
  }

  vec3 result=toSRGB(acc/max(wt,0.001));
  o=vec4(result,1.0);
}`;

const FS_BK_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D u_sharp;
uniform sampler2D u_blurred;
uniform sampler2D u_mask;
uniform float u_feather;
uniform float u_glitch;
in vec2 vUV;
out vec4 o;
${BK_FLIP}
void main(){
  vec2 v_uv=bkUV(vUV,u_glitch);
  vec4 sharp=texture(u_sharp,v_uv);
  vec4 blurred=texture(u_blurred,v_uv);
  float m=texture(u_mask,v_uv).r;
  float lo=0.38-u_feather*0.28;
  float hi=0.62+u_feather*0.28;
  float blend=smoothstep(lo,hi,m);
  float edgeLeak=smoothstep(0.60,0.92,m);
  vec4 out_=mix(blurred,sharp,blend);
  out_=mix(out_,sharp,edgeLeak*0.35+0.65*step(0.95,m));
  o=vec4(out_.rgb,1.0);
}`;

/* mm/f-stop → blur maps, verbatim */
const bkRadiusFromFStop = (fStop: number) => 76.0 / Math.max(fStop, 0.95);
const bkBloomFromMM = (mm: number) => (mm / 135) * 1.5;
const bkZoomFromMM = (mm: number) => 1.0 + (mm / 200) * 0.6;

const jsSmoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/* Param table — 100% of the standalone's parameter surface (see the
 * STATE.md Phase 6 log for the control-by-control diff). Defaults are the
 * standalone's BOOT state: the P literals overlaid with the `isco` preset
 * it applies on load. No audio reactivity exists in the original (its one
 * AudioContext is REC export plumbing) → no defaultRoutes. */
const PARAMS: ParamSchema[] = [
  { key: 'segEnabled', label: 'Person Mask', type: 'boolean', value: 1, aiHint: '(on/off switch) Subject segmentation for the background-blur pre-pass; without it (or at 0mm) the pre-pass is skipped, like the standalone before its detector loads' },
  // grade
  { key: 'exposure', label: 'Exposure', type: 'number', value: 0.05, min: -2, max: 2, step: 0.02, reactive: true, aiHint: 'Stops of exposure applied before the grade (2^x gain)' },
  { key: 'temp', label: 'Temperature', type: 'number', value: 0.58, min: -1, max: 1, step: 0.01, reactive: true, aiHint: 'Warm/cool split-tone grade: + = golden shadows, − = cool blue' },
  { key: 'lift', label: 'Lift', type: 'number', value: 0.05, min: 0, max: 0.15, step: 0.002, aiHint: 'Black lift — raises shadows toward a milky film base' },
  { key: 'contrast', label: 'Contrast', type: 'number', value: 0.32, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'S-curve contrast around mid grey' },
  { key: 'sat', label: 'Saturation', type: 'number', value: 0.8, min: 0, max: 1.8, step: 0.01, reactive: true, aiHint: 'Color saturation; >1 oversaturates' },
  { key: 'rolloff', label: 'Rolloff', type: 'number', value: 0.58, min: 0, max: 1, step: 0.01, aiHint: 'Filmic highlight shoulder — compresses highlights like print film' },
  { key: 'lutMix', label: 'LUT Mix', type: 'number', value: 0, min: 0, max: 1, step: 0.01, aiHint: 'LUT blend (identity in this build — the sampleLUT path is a pass-through)' },
  // texture
  { key: 'grain', label: 'Grain', type: 'number', value: 0.08, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Instax/VHS grain: mid-tone noise, scan shimmer, chroma bleed' },
  { key: 'bokeh', label: 'Bokeh Bloom', type: 'number', value: 0.42, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Horizontal anisotropic highlight bloom — anamorphic streak glow' },
  { key: 'halation', label: 'Halation', type: 'number', value: 0.52, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Warm red-orange glow bleeding around bright areas, film halation' },
  { key: 'ca', label: 'Chromatic Ab.', type: 'number', value: 0.28, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Radial RGB fringe growing toward the frame edges' },
  // optics
  { key: 'barrel', label: 'Barrel', type: 'number', value: 0.26, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Oval-lens radial distortion, stronger on the vertical axis' },
  { key: 'vignette', label: 'Vignette', type: 'number', value: 0.44, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Elliptical anamorphic lens vignette' },
  { key: 'squeeze', label: 'Squeeze', type: 'number', value: 1.15, min: 1, max: 2.2, step: 0.02, reactive: true, aiHint: 'Horizontal anamorphic squeeze of the sampled frame (1=off, ~2=2×); also drives the oval bokeh ratio' },
  { key: 'ratio', label: 'Ratio', type: 'number', value: 2.39, min: 1.78, max: 2.8, step: 0.01, aiHint: 'Target widescreen aspect ratio for the letterbox crop' },
  { key: 'letterbox', label: 'Letterbox', type: 'boolean', value: 1, aiHint: '(on/off switch) Crop toward centre to the target ratio (black bands outside)' },
  { key: 'breathing', label: 'Breathing', type: 'boolean', value: 0, aiHint: '(on/off switch) Subtle live lens-breathing zoom oscillation' },
  // flare
  { key: 'flareMaster', label: 'Flare Master', type: 'boolean', value: 0, aiHint: '(on/off switch) Master gate for the auto-detected anamorphic flare' },
  { key: 'flare', label: 'Flare', type: 'boolean', value: 0, aiHint: '(on/off switch) Flare stage on/off (needs Flare Master too, like the standalone)' },
  { key: 'flareAmt', label: 'Flare Amount', type: 'number', value: 0.65, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Intensity of the horizontal blue/gold flare streak at the auto-detected hotspot' },
  { key: 'flareLength', label: 'Flare Length', type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, aiHint: '0 short beam, 1 full-width streak' },
  { key: 'flareColor', label: 'Flare Color', type: 'number', value: 0, min: 0, max: 1, step: 0.01, aiHint: '0 classic gold core, 1 cold blue' },
  { key: 'flareHeight', label: 'Flare Height', type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, aiHint: '0 razor-thin line, 1 thick beam' },
  // subject-aware bokeh pre-pass
  { key: 'bokehMM', label: 'Bokeh mm', type: 'number', value: 0, min: 0, max: 200, step: 1, reactive: true, aiHint: 'Focal length of the subject-aware background blur (0 = off, zero cost); drives bloom + background magnification' },
  { key: 'fStop', label: 'F-Stop', type: 'number', value: 4, min: 0.95, max: 22, step: 0.05, reactive: true, aiHint: 'Aperture driving the background CoC radius (f/0.95 ≈ 80px … f/22 ≈ 3.5px), eased ~120ms like a focus rack' },
  { key: 'ovalFineTune', label: 'Oval Fine Tune', type: 'number', value: 0, min: -0.3, max: 0.5, step: 0.01, aiHint: 'Manual trim on the oval bokeh-disc ratio (squeeze + trim, floor 1.0)' },
  { key: 'ghostGlitch', label: 'Ghost FX', type: 'boolean', value: 0, aiHint: '(on/off switch) Deliberate mask flip — the ghosted double-exposure segmentation look' },
  // compare
  { key: 'compare', label: 'Compare Split', type: 'boolean', value: 0, aiHint: '(on/off switch) A/B split: raw left half, graded right half' },
];

interface Progs {
  main: WebGLProgram;
  maskTemporal: WebGLProgram;
  maskBlur: WebGLProgram;
  blur: WebGLProgram;
  composite: WebGLProgram;
}

export class AnamorphicLabNode implements EngineNode {
  readonly id = 'anamorphic_lab';
  readonly name = 'Anamorphic Lab';
  enabled = true;
  readonly params = PARAMS;

  private v: Record<string, number> = {};
  private gl: WebGL2RenderingContext | null = null;
  private progs: Progs | null = null;
  private uni: Record<string, Record<string, WebGLUniformLocation | null>> = {};

  private outT: Target | null = null;
  private maskTemporalT: [Target, Target] | null = null;
  private maskBlurT: Target | null = null;
  private blurT: Target | null = null;
  private compositeT: Target | null = null;
  private rawMaskTex: WebGLTexture | null = null;
  private lutTex: WebGLTexture | null = null;

  private w = 0;
  private h = 0;
  private maskCur = 0;
  private maskReady = false;
  private lastMaskV = -1;

  // seg swizzle scratch (alpha → R, exactly the standalone's path)
  private segCv: HTMLCanvasElement | null = null;
  private segCtx: CanvasRenderingContext2D | null = null;
  private segBuf = new Uint8Array(SEG_SW * SEG_SH * 4);

  // f-stop → radius easing (time-based, ~120ms, verbatim)
  private radiusSmoothed: number | null = null;
  private radiusSmoothedT = 0;

  // auto-flare detector state (verbatim constants)
  private flareCv: HTMLCanvasElement | null = null;
  private flareCtx: CanvasRenderingContext2D | null = null;
  private autoFlareX = 0.5;
  private autoFlareActive = 0;
  private flarePhase = 0;
  private targetFlareX = 0.5;
  private flareJitter = 0;
  private smoothFlareX = 0.5;
  private lastFlareT = -1;

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
      main: mk(FS_MAIN),
      maskTemporal: mk(FS_BK_MASK_TEMPORAL),
      maskBlur: mk(FS_BK_MASK_BLUR),
      blur: mk(FS_BK_BLUR),
      composite: mk(FS_BK_COMPOSITE),
    };
    const locs = (p: WebGLProgram, names: string[]) => {
      const out: Record<string, WebGLUniformLocation | null> = {};
      names.forEach((n) => { out[n] = gl.getUniformLocation(p, n); });
      return out;
    };
    this.uni = {
      main: locs(this.progs.main, ['uTex', 'uLUT', 'uTime', 'uTemp', 'uLift', 'uContrast', 'uSat', 'uRolloff', 'uRolloffKnee', 'uExposure', 'uHalation', 'uGrain', 'uBokeh', 'uCA', 'uBarrel', 'uVignette', 'uLetterbox', 'uRatio', 'uVideoAR', 'uBreathing', 'uSqueeze', 'uFlare', 'uFlareMaster', 'uFlareAmt', 'uFlareX', 'uFlareActive', 'uFlarePhase', 'uFlareJitter', 'uFlareLength', 'uFlareColor', 'uFlareHeight', 'uCompare', 'uLutMix', 'uLutSize']),
      maskTemporal: locs(this.progs.maskTemporal, ['u_new', 'u_prev', 'u_alpha', 'u_glitch']),
      maskBlur: locs(this.progs.maskBlur, ['u_mask', 'u_px', 'u_glitch']),
      blur: locs(this.progs.blur, ['u_tex', 'u_mask', 'u_radius', 'u_bloom', 'u_ovalRatio', 'u_zoom', 'u_px', 'u_time', 'u_glitch']),
      composite: locs(this.progs.composite, ['u_sharp', 'u_blurred', 'u_mask', 'u_feather', 'u_glitch']),
    };

    const mkTex = (data: Uint8Array, w: number, h: number, nearest = false) => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      const f = nearest ? gl.NEAREST : gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.rawMaskTex = mkTex(new Uint8Array(SEG_SW * SEG_SH * 4), SEG_SW, SEG_SH);
    // identity LUT: the standalone's 1×1 mid-grey placeholder
    this.lutTex = mkTex(new Uint8Array([128, 128, 128, 255]), 1, 1, true);

    // BK working targets are a FIXED 1280×720, independent of node size
    this.maskTemporalT = [createTarget(gl, BK_W, BK_H), createTarget(gl, BK_W, BK_H)];
    this.maskBlurT = createTarget(gl, BK_W, BK_H);
    this.blurT = createTarget(gl, BK_W, BK_H);
    this.compositeT = createTarget(gl, BK_W, BK_H);
    this.maskTemporalT.forEach((t) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, BK_W, BK_H);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resize(width: number, height: number): void {
    const gl = this.gl;
    if (!gl || width < 2 || height < 2) return;
    if (width === this.w && height === this.h) return;
    this.w = width;
    this.h = height;
    destroyTarget(gl, this.outT);
    this.outT = createTarget(gl, width, height);
  }

  private bindTex(gl: WebGL2RenderingContext, unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null): void {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  /* mask intake — once per segmentation arrival: the standalone's 320×180
   * alpha→R swizzle upload, temporal EMA (α=0.35), spatial feather */
  private intakeMask(ctx: NodeRenderContext): void {
    const gl = ctx.gl;
    if (!this.progs || !this.maskTemporalT || !this.maskBlurT) return;
    if (!this.segCv) {
      this.segCv = document.createElement('canvas');
      this.segCv.width = SEG_SW;
      this.segCv.height = SEG_SH;
      this.segCtx = this.segCv.getContext('2d', { willReadFrequently: true });
    }
    const c2 = this.segCtx;
    if (!c2) return;
    c2.clearRect(0, 0, SEG_SW, SEG_SH);
    c2.drawImage(ctx.personMask as CanvasImageSource, 0, 0, SEG_SW, SEG_SH);
    const d = c2.getImageData(0, 0, SEG_SW, SEG_SH).data;
    const b = this.segBuf;
    for (let i = 0, j = 0; i < d.length; i += 4, j += 4) { b[j] = d[i + 3]; b[j + 1] = 0; b[j + 2] = 0; b[j + 3] = 255; }
    const glitch = this.v.ghostGlitch >= 0.5;
    gl.bindTexture(gl.TEXTURE_2D, this.rawMaskTex!);
    // baseline: FLIP_Y aligns the top-down swizzle buffer with the engine's
    // y-up frames; ghostGlitch drops the flip → mask mirrored vs frame,
    // exactly the standalone's deliberate double-flip ghost
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !glitch);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, SEG_SW, SEG_SH, 0, gl.RGBA, gl.UNSIGNED_BYTE, b);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    const g = glitch ? 1 : 0;
    const prev = this.maskTemporalT[this.maskCur];
    const next = this.maskTemporalT[1 - this.maskCur];
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.fbo);
    gl.viewport(0, 0, BK_W, BK_H);
    gl.useProgram(this.progs.maskTemporal);
    this.bindTex(gl, 0, this.rawMaskTex!, this.uni.maskTemporal.u_new);
    this.bindTex(gl, 1, prev.tex, this.uni.maskTemporal.u_prev);
    gl.uniform1f(this.uni.maskTemporal.u_alpha, 0.35);
    gl.uniform1f(this.uni.maskTemporal.u_glitch, g);
    ctx.drawQuad();
    this.maskCur = 1 - this.maskCur;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskBlurT.fbo);
    gl.viewport(0, 0, BK_W, BK_H);
    gl.useProgram(this.progs.maskBlur);
    this.bindTex(gl, 0, this.maskTemporalT[this.maskCur].tex, this.uni.maskBlur.u_mask);
    gl.uniform2f(this.uni.maskBlur.u_px, 1 / BK_W, 1 / BK_H);
    gl.uniform1f(this.uni.maskBlur.u_glitch, g);
    ctx.drawQuad();

    this.maskReady = true;
  }

  private smoothedRadius(timeSec: number): number {
    const target = bkRadiusFromFStop(this.v.fStop);
    if (this.radiusSmoothed === null) { this.radiusSmoothed = target; this.radiusSmoothedT = timeSec; return target; }
    let dt = timeSec - this.radiusSmoothedT;
    this.radiusSmoothedT = timeSec;
    if (!(dt > 0) || dt > 0.25) dt = 1 / 60;
    const k = 1 - Math.exp(-dt / 0.12);
    this.radiusSmoothed += (target - this.radiusSmoothed) * k;
    return this.radiusSmoothed;
  }

  /* auto-flare hotspot detector — the standalone's detectFlare() verbatim,
   * on its own ~160ms cadence, reading the RAW source like the original */
  private detectFlare(ctx: NodeRenderContext): void {
    if (ctx.time - this.lastFlareT < 0.16 && this.lastFlareT >= 0) return;
    this.lastFlareT = ctx.time;
    const src = ctx.source;
    if (!src) return;
    if (!this.flareCv) {
      this.flareCv = document.createElement('canvas');
      this.flareCv.width = 80;
      this.flareCv.height = 45;
      this.flareCtx = this.flareCv.getContext('2d', { willReadFrequently: true });
    }
    const c2 = this.flareCtx;
    if (!c2) return;
    try {
      c2.drawImage(src as CanvasImageSource, 0, 0, 80, 45);
      const d = c2.getImageData(0, 0, 80, 45).data;
      const th = 185;
      let sumX = 0, sumW = 0, maxL = 0, second = 0;
      for (let y = 0; y < 45; y++) {
        for (let x = 0; x < 80; x++) {
          const i = (y * 80 + x) * 4;
          const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (l > maxL) { second = maxL; maxL = l; }
          else if (l > second) second = l;
          if (l > th) { const w = (l - th) / 70; sumX += (x + 0.5) * w; sumW += w; }
        }
      }
      const spread = (maxL - second) / 255;
      const confidence = Math.min(1, sumW / 120) * (0.5 + 0.5 * jsSmoothstep(0, 0.25, spread));
      if (sumW > 8 && maxL > th) { this.targetFlareX = (sumX / sumW) / 80; this.autoFlareActive = confidence; }
      else { this.autoFlareActive = 0; }
      this.flarePhase += 0.07 + this.autoFlareActive * 0.12;
      this.smoothFlareX += (this.targetFlareX - this.smoothFlareX) * 0.18;
      this.autoFlareX = this.smoothFlareX;
      this.flareJitter += (Math.random() - 0.5) * 0.08;
      this.flareJitter *= 0.82;
    } catch { /* readback can fail on tainted/starved sources — keep last state */ }
  }

  render(ctx: NodeRenderContext): WebGLTexture {
    const gl = ctx.gl;
    if (!this.progs || !this.outT || !this.maskBlurT || !this.blurT || !this.compositeT) return ctx.inputTex;
    const P = this.v;

    this.detectFlare(ctx);

    /* ── bokeh pre-pass, only while bokehMM > 0 (zero cost at 0) ── */
    let mainTex = ctx.inputTex;
    if (P.bokehMM > 0 && P.segEnabled >= 0.5) {
      if (ctx.personMask && ctx.personMaskVersion !== this.lastMaskV) {
        this.lastMaskV = ctx.personMaskVersion;
        this.intakeMask(ctx);
      }
      if (this.maskReady) {
        const g = P.ghostGlitch >= 0.5 ? 1 : 0;
        const ovalRatio = Math.max(1.0, P.squeeze + P.ovalFineTune);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurT.fbo);
        gl.viewport(0, 0, BK_W, BK_H);
        gl.useProgram(this.progs.blur);
        this.bindTex(gl, 0, ctx.inputTex, this.uni.blur.u_tex);
        this.bindTex(gl, 1, this.maskBlurT.tex, this.uni.blur.u_mask);
        gl.uniform1f(this.uni.blur.u_radius, this.smoothedRadius(ctx.time));
        gl.uniform1f(this.uni.blur.u_bloom, bkBloomFromMM(P.bokehMM));
        gl.uniform1f(this.uni.blur.u_ovalRatio, ovalRatio);
        gl.uniform1f(this.uni.blur.u_zoom, bkZoomFromMM(P.bokehMM));
        gl.uniform2f(this.uni.blur.u_px, 1 / BK_W, 1 / BK_H);
        gl.uniform1f(this.uni.blur.u_time, ctx.time);
        gl.uniform1f(this.uni.blur.u_glitch, g);
        ctx.drawQuad();

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.compositeT.fbo);
        gl.viewport(0, 0, BK_W, BK_H);
        gl.useProgram(this.progs.composite);
        this.bindTex(gl, 0, ctx.inputTex, this.uni.composite.u_sharp);
        this.bindTex(gl, 1, this.blurT.tex, this.uni.composite.u_blurred);
        this.bindTex(gl, 2, this.maskBlurT.tex, this.uni.composite.u_mask);
        gl.uniform1f(this.uni.composite.u_feather, 0.45);
        gl.uniform1f(this.uni.composite.u_glitch, g);
        ctx.drawQuad();
        mainTex = this.compositeT.tex;
      }
    } else if (P.bokehMM <= 0) {
      // re-enabling after off restarts the aperture easing at the target,
      // exactly the standalone's setBokehMM(0→mm) reset
      this.radiusSmoothed = null;
    }

    /* ── main anamorphic pass ── */
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outT.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.progs.main);
    this.bindTex(gl, 0, mainTex, this.uni.main.uTex);
    this.bindTex(gl, 1, this.lutTex!, this.uni.main.uLUT);
    const U = this.uni.main;
    gl.uniform1f(U.uTime, ctx.time);
    gl.uniform1f(U.uTemp, P.temp);
    gl.uniform1f(U.uLift, P.lift);
    gl.uniform1f(U.uContrast, P.contrast);
    gl.uniform1f(U.uSat, P.sat);
    gl.uniform1f(U.uRolloff, P.rolloff);
    gl.uniform1f(U.uRolloffKnee, 0.85);
    gl.uniform1f(U.uExposure, P.exposure);
    gl.uniform1f(U.uHalation, P.halation);
    gl.uniform1f(U.uGrain, P.grain);
    gl.uniform1f(U.uBokeh, P.bokeh);
    gl.uniform1f(U.uCA, P.ca);
    gl.uniform1f(U.uBarrel, P.barrel);
    gl.uniform1f(U.uVignette, P.vignette);
    gl.uniform1f(U.uLetterbox, P.letterbox >= 0.5 ? 1 : 0);
    gl.uniform1f(U.uRatio, P.ratio);
    gl.uniform1f(U.uVideoAR, this.w / this.h);
    gl.uniform1f(U.uBreathing, P.breathing >= 0.5 ? 1 : 0);
    gl.uniform1f(U.uSqueeze, P.squeeze);
    gl.uniform1f(U.uFlare, P.flare >= 0.5 ? 1 : 0);
    gl.uniform1f(U.uFlareMaster, P.flareMaster >= 0.5 ? 1 : 0);
    gl.uniform1f(U.uFlareAmt, P.flareAmt);
    gl.uniform1f(U.uFlareX, this.autoFlareX);
    gl.uniform1f(U.uFlareActive, this.autoFlareActive);
    gl.uniform1f(U.uFlarePhase, this.flarePhase);
    gl.uniform1f(U.uFlareJitter, this.flareJitter);
    gl.uniform1f(U.uFlareLength, P.flareLength);
    gl.uniform1f(U.uFlareColor, P.flareColor);
    gl.uniform1f(U.uFlareHeight, P.flareHeight);
    gl.uniform1f(U.uCompare, P.compare >= 0.5 ? 1 : 0);
    gl.uniform1f(U.uLutMix, P.lutMix);
    gl.uniform1f(U.uLutSize, 16);
    ctx.drawQuad();

    return this.outT.tex;
  }

  dispose(gl: WebGL2RenderingContext): void {
    if (this.progs) {
      Object.values(this.progs).forEach((p) => gl.deleteProgram(p));
      this.progs = null;
    }
    destroyTarget(gl, this.outT);
    this.maskTemporalT?.forEach((t) => destroyTarget(gl, t));
    destroyTarget(gl, this.maskBlurT);
    destroyTarget(gl, this.blurT);
    destroyTarget(gl, this.compositeT);
    this.outT = this.maskBlurT = this.blurT = this.compositeT = null;
    this.maskTemporalT = null;
    if (this.rawMaskTex) { gl.deleteTexture(this.rawMaskTex); this.rawMaskTex = null; }
    if (this.lutTex) { gl.deleteTexture(this.lutTex); this.lutTex = null; }
  }
}
