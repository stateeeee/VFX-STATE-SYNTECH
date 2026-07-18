import { EngineNode, NodeRenderContext, compileProgram, QUAD_VS, Target, createTarget, destroyTarget } from '../SynEngine';
import { ParamSchema } from '../../bridge/types';

/* ═══════════════════════════════════════════════════════════════
   BOKEH — 1:1 port of public/effects/bokeh/index.html (Phase 5).

   Pipeline, order and math copied from the standalone build:
     mask intake (per segmentation arrival: temporal EMA ping-pong →
     spatial gaussian blur) → STAGE 1 bokeh blur (5 kernel styles,
     mask-guided CoC) → STAGE 1.5 post-blur distort (swirl/explosive/
     anamorphic) → STAGE 2 background FX (datamosh / CPU pixel sort /
     liquid / morph / lava, mask-gated, ping-pong) → STAGE 3 composite
     (feathered sharp-subject blend + Optics vignette + Anamorphic
     Optics: squeeze, barrel, letterbox, breathing, elliptical vignette).
   Shaders are the standalone's GLSL translated to ES 3.00 with the
   math untouched (incl. the fixed 16/9 tap-aspect constants that are
   part of the look). The standalone's eager MediaPipe segmenter is
   replaced by the shared PersonMask service (segEnabled + the
   ctx.personMask/personMaskVersion plumbing); until a mask has
   arrived the node passes the frame through — exactly the
   standalone's maskReady gate.
   ═══════════════════════════════════════════════════════════════ */

const FS_PASS = `#version 300 es
precision highp float;
in vec2 vUV; uniform sampler2D u_tex; out vec4 o;
void main(){ o = texture(u_tex, vUV); }`;

/* Shared noise (liquid + morph + lava) — verbatim */
const GLSL_NOISE = `
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),
             mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);
}
float fbm(vec2 p){
  float v=0.0,a=0.5;
  for(int i=0;i<4;i++){v+=a*noise(p);p*=2.1;a*=0.5;}
  return v;
}`;

const FS_MASK_TEMPORAL = `#version 300 es
precision highp float;
uniform sampler2D u_new;
uniform sampler2D u_prev;
uniform float u_alpha;
in vec2 vUV;
out vec4 o;
void main(){
  float n = texture(u_new,  vUV).a;
  float p = texture(u_prev, vUV).r;
  float a = n > p ? u_alpha * 1.6 : u_alpha;
  a = clamp(a, 0.0, 1.0);
  o = vec4(mix(p, n, a), 0.0, 0.0, 1.0);
}`;

const FS_MASK_BLUR = `#version 300 es
precision highp float;
uniform sampler2D u_mask;
uniform vec2 u_px;
in vec2 vUV;
out vec4 o;
void main(){
  float sum = 0.0;
  float wsum = 0.0;
  vec2 s = u_px * 2.5;
  float offsets[5];
  offsets[0] = -2.0; offsets[1] = -1.0; offsets[2] = 0.0;
  offsets[3] =  1.0; offsets[4] =  2.0;
  float weights[5];
  weights[0] = 0.06; weights[1] = 0.24; weights[2] = 0.40;
  weights[3] = 0.24; weights[4] = 0.06;
  for(int i=0;i<5;i++){
    for(int j=0;j<5;j++){
      vec2 uvo = clamp(vUV + vec2(offsets[i]*s.x, offsets[j]*s.y), 0.0, 1.0);
      float m = texture(u_mask, uvo).r;
      float w = weights[i] * weights[j];
      sum  += m * w;
      wsum += w;
    }
  }
  o = vec4(sum / wsum, 0.0, 0.0, 1.0);
}`;

const FS_BOKEH = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform sampler2D u_mask;
uniform float u_radius;
uniform float u_bloom;
uniform int   u_style;
uniform vec2  u_bshapeXY;
uniform vec2  u_px;
uniform float u_time;
in vec2  vUV;
out vec4 o;

vec3 toLinear(vec3 c){ return c*c; }
vec3 toSRGB(vec3 c)  { return sqrt(max(c,0.0)); }

float gold(vec2 p, float seed){
  return fract(tan(distance(p*vec2(1.61803398874989,1.41421356237),p+seed))*p.x);
}

void tap(vec2 uv, float mgate, float bloomK, inout vec3 acc, inout float wt){
  uv = clamp(uv, 0.0, 1.0);
  float tm = texture(u_mask, uv).r;
  vec3  lin = toLinear(texture(u_tex, uv).rgb);
  float lum = dot(lin, vec3(0.299,0.587,0.114));
  float w   = (1.0 + lum*lum*bloomK) * (1.0 - tm*0.88) * mgate;
  acc += lin * w; wt += w;
}

void main(){
  float selfMask = texture(u_mask, vUV).r;
  float coc = pow(clamp(1.0 - selfMask, 0.0, 1.0), 1.35) * u_radius;
  if(coc < 0.6){ o = texture(u_tex, vUV); return; }

  vec2 px = vec2(u_px.x, u_px.y);

  vec3 acc = vec3(0.0); float wt = 0.0;
  float mgate = 1.0 - selfMask * 0.88;
  float bloomK = u_bloom;

  tap(vUV, mgate, bloomK, acc, wt);

  if(u_style==0){
    float rr; float a; vec2 t;
    rr=coc*0.20;
    for(int i=0;i<6;i++){
      a=float(i)*1.0472+gold(vUV,float(i)*0.3+u_time*0.01)*0.25;
      t=vUV+vec2(cos(a)*rr*px.x, sin(a)*rr*px.y*(16.0/9.0));
      tap(t,mgate,bloomK,acc,wt);
    }
    rr=coc*0.40;
    for(int i=0;i<8;i++){
      a=float(i)*0.7854+gold(vUV,float(i)*0.7+u_time*0.013)*0.2;
      t=vUV+vec2(cos(a)*rr*px.x, sin(a)*rr*px.y*(16.0/9.0));
      tap(t,mgate,bloomK,acc,wt);
    }
    rr=coc*0.60;
    for(int i=0;i<8;i++){
      a=float(i)*0.7854+0.39+gold(vUV,float(i)*1.1+u_time*0.017)*0.18;
      t=vUV+vec2(cos(a)*rr*px.x, sin(a)*rr*px.y*(16.0/9.0));
      tap(t,mgate,bloomK,acc,wt);
    }
    rr=coc*0.80;
    for(int i=0;i<8;i++){
      a=float(i)*0.7854+0.19+gold(vUV,float(i)*1.5+u_time*0.021)*0.15;
      t=vUV+vec2(cos(a)*rr*px.x, sin(a)*rr*px.y*(16.0/9.0));
      tap(t,mgate,bloomK,acc,wt);
    }
    rr=coc*1.00;
    for(int i=0;i<7;i++){
      a=float(i)*0.8976+0.44+gold(vUV,float(i)*2.1+u_time*0.011)*0.12;
      t=vUV+vec2(cos(a)*rr*px.x, sin(a)*rr*px.y*(16.0/9.0));
      tap(t,mgate,bloomK*1.3,acc,wt);
    }
  }

  else if(u_style==1){
    float swirlK = 1.8;
    for(int i=0;i<30;i++){
      float fi   = float(i)/30.0;
      float r    = (0.2+fi*0.8)*coc;
      float base = fi*6.2832*2.5;
      float jit  = gold(vUV, fi*3.7+u_time*0.009)*0.3;
      float a    = base + jit + r*swirlK;
      vec2 t = vUV + vec2(cos(a)*r*px.x, sin(a)*r*px.y*(16.0/9.0));
      tap(t,mgate,bloomK,acc,wt);
    }
  }

  else if(u_style==2){
    for(int i=0;i<12;i++){
      float a=float(i)*0.5236;
      float r=coc*(0.3+gold(vUV,float(i)*1.3+u_time*0.008)*0.25);
      tap(vUV+vec2(cos(a)*r*px.x,sin(a)*r*px.y*(16.0/9.0)),mgate,bloomK,acc,wt);
    }
    for(int i=0;i<8;i++){
      float a   = float(i)*0.7854+gold(vUV,float(i)*2.2+u_time*0.013)*0.1;
      float rIn = coc*0.9;
      float rOut= coc*2.0;
      for(int k=0;k<4;k++){
        float r = mix(rIn,rOut,float(k)/3.0);
        tap(vUV+vec2(cos(a)*r*px.x,sin(a)*r*px.y*(16.0/9.0)),mgate,bloomK*(1.0+float(k)*0.4),acc,wt);
      }
    }
  }

  else if(u_style==3){
    float aX = 2.39;
    float aY = 1.0;
    float eRadii[4]; eRadii[0]=0.25;eRadii[1]=0.50;eRadii[2]=0.75;eRadii[3]=1.00;
    for(int ri=0;ri<4;ri++){
      float er=eRadii[ri]*coc;
      int nTaps = ri==0?6:(ri==1?8:(ri==2?10:12));
      for(int i=0;i<12;i++){
        if(i>=nTaps) break;
        float a=float(i)*6.2832/float(nTaps)+gold(vUV,float(ri*12+i)*1.7+u_time*0.008)*0.15;
        vec2 t=vUV+vec2(cos(a)*er*aX*px.x, sin(a)*er*aY*px.y*(16.0/9.0));
        tap(t,mgate,bloomK,acc,wt);
      }
    }
    for(int i=1;i<=8;i++){
      float xOff = float(i)*coc*0.45*px.x*aX;
      float lum1 = dot(toLinear(texture(u_tex,clamp(vUV+vec2(xOff,0.0),0.0,1.0)).rgb),vec3(0.299,0.587,0.114));
      float lum2 = dot(toLinear(texture(u_tex,clamp(vUV-vec2(xOff,0.0),0.0,1.0)).rgb),vec3(0.299,0.587,0.114));
      float fw = lum1*lum1*u_bloom*0.6*(1.0-float(i)/9.0);
      float fw2= lum2*lum2*u_bloom*0.6*(1.0-float(i)/9.0);
      tap(vUV+vec2( xOff,0.0),mgate*fw, bloomK,acc,wt);
      tap(vUV+vec2(-xOff,0.0),mgate*fw2,bloomK,acc,wt);
    }
  }

  else if(u_style==4){
    float bx=clamp(u_bshapeXY.x,-1.0,1.0);
    float by=clamp(u_bshapeXY.y,-1.0,1.0);
    float wTL=max(0.0,-bx)*max(0.0, by);
    float wTR=max(0.0, bx)*max(0.0, by);
    float wBR=max(0.0, bx)*max(0.0,-by);
    float wBL=max(0.0,-bx)*max(0.0,-by);
    float wC =max(0.0, 1.0-abs(bx)-abs(by));
    float wS =wTL+wTR+wBR+wBL+wC+0.0001;
    wTL/=wS; wTR/=wS; wBR/=wS; wBL/=wS; wC/=wS;
    float asp=16.0/9.0;
    for(int i=0;i<40;i++){
      float fi=float(i);
      float rr=0.0, a=0.0, bk2=u_bloom;
      if(i<6){
        rr=coc*0.20; a=fi/6.0*6.2832; bk2=u_bloom;
      } else if(i<14){
        rr=coc*0.40; a=(fi-6.0)/8.0*6.2832; bk2=u_bloom;
      } else if(i<22){
        rr=coc*0.60; a=(fi-14.0)/8.0*6.2832; bk2=u_bloom;
      } else if(i<31){
        rr=coc*0.80; a=(fi-22.0)/9.0*6.2832; bk2=u_bloom;
      } else {
        rr=coc*1.00; a=(fi-31.0)/9.0*6.2832; bk2=u_bloom*1.3;
      }
      a += gold(vUV, fi*1.7+u_time*0.011)*0.18;
      float ca=cos(a), sa=sin(a);

      vec2 dC=vec2(ca*rr*px.x, sa*rr*px.y*asp);

      vec2 dOval=vec2(ca*rr*0.42*px.x, sa*rr*px.y*asp);

      float rotP=a+0.7854; float rotN=a-0.7854;
      float catSel=step(1.0,mod(fi,2.0));
      vec2 dCatP=vec2(cos(rotP)*rr*1.5*px.x, sin(rotP)*rr*0.42*px.y*asp);
      vec2 dCatN=vec2(cos(rotN)*rr*1.5*px.x, sin(rotN)*rr*0.42*px.y*asp);
      vec2 dCat=mix(dCatP, dCatN, catSel);

      float eps=0.0001;
      float sqF=rr/max(max(abs(ca),abs(sa)),eps);
      vec2 dSq=vec2(ca*sqF*px.x, sa*sqF*px.y*asp);

      float ar=a+0.7854;
      float f1=rr/max(max(abs(ca),abs(sa)),eps);
      float f2=rr/max(max(abs(cos(ar)),abs(sin(ar))),eps);
      vec2 dStar=vec2(ca*max(f1,f2)*0.78*px.x, sa*max(f1,f2)*0.78*px.y*asp);

      vec2 d=dC*wC+dOval*wTL+dCat*wTR+dSq*wBR+dStar*wBL;
      tap(vUV+d, mgate, bk2, acc, wt);
    }
  }

  vec3 result = toSRGB(acc / max(wt, 0.001));
  o = vec4(result, 1.0);
}`;

const FS_DISTORT = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform sampler2D u_mask;
uniform int   u_dmode;
uniform float u_swirl;
uniform float u_falloff;
uniform float u_explosive;
uniform float u_squeeze;
uniform vec2  u_center;
uniform float u_time;
in vec2  vUV;
out vec4 o;

void main(){
  float m   = texture(u_mask, vUV).r;
  float bgW = 1.0 - smoothstep(0.35, 0.75, m);

  vec2 sampleUV = vUV;
  vec2 delta = vUV - u_center;
  float asp  = 16.0 / 9.0;
  float r    = length(vec2(delta.x * asp, delta.y));

  if(u_dmode == 1){
    float angle = u_swirl * exp(-r * r * u_falloff);
    float s = sin(angle); float c = cos(angle);
    sampleUV = u_center + vec2(delta.x*c - delta.y*s, delta.x*s + delta.y*c);
  }
  else if(u_dmode == 2){
    vec2 dir   = delta / max(r, 0.001);
    float push = u_explosive * r * 0.5;
    sampleUV   = vUV + dir * push;
  }
  else if(u_dmode == 3){
    sampleUV.x = u_center.x + delta.x * u_squeeze;
  }

  vec2 finalUV = mix(vUV, sampleUV, bgW);
  finalUV = clamp(finalUV, 0.001, 0.999);
  o = texture(u_tex, finalUV);
}`;

const FS_DATAMOSH = `#version 300 es
precision highp float;
uniform sampler2D u_cur;
uniform sampler2D u_prev;
uniform sampler2D u_feedback;
uniform sampler2D u_mask;
uniform vec2  u_res;
uniform float u_time;
uniform float u_drift;
uniform float u_isiframe;
uniform float u_block;
uniform float u_glitch;
uniform float u_decay;
uniform float u_color;
in vec2 vUV;
out vec4 o;

float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }

vec2 blockUV(vec2 uv, float bs){
  return (floor(uv*u_res/bs)*bs+bs*0.5)/u_res;
}

vec2 motionVec(vec2 uv){
  float bs  = max(1.0, u_block);
  vec2  bUV = blockUV(uv, bs);
  vec3  cN  = texture(u_cur,  bUV).rgb;
  vec3  cP  = texture(u_prev, bUV).rgb;
  vec3  d   = cN - cP;
  float luma= dot(d, vec3(0.299,0.587,0.114));
  float Cb  = d.b - luma;
  float Cr  = d.r - luma;
  return vec2(Cr - Cb*0.3, Cb - Cr*0.15) * u_drift;
}

void main(){
  float m   = texture(u_mask, vUV).r;
  vec4  cur = texture(u_cur,  vUV);

  if(m > 0.75){ o = cur; return; }
  float bgW = 1.0 - smoothstep(0.4, 0.75, m);

  vec2  motion      = motionVec(vUV);
  vec2  dispUV      = fract(vUV + motion);
  vec4  feedback    = texture(u_feedback, dispUV);
  feedback.rgb     *= u_decay;

  vec4 result = mix(feedback, cur, u_isiframe);

  if(u_glitch > 0.001){
    float fSlot    = floor(u_time * 20.0);
    float motionMag= length(motion);

    float lineY = floor(vUV.y * 60.0);
    float lh    = hash(vec2(lineY, fSlot));
    if(lh > 1.0 - u_glitch*0.16){
      float shift = (hash(vec2(lineY+3.7,fSlot))-0.5)*u_glitch*0.22;
      result = texture(u_feedback, vec2(fract(vUV.x+shift), vUV.y));
      result.rgb *= u_decay;
    }

    float mbs = max(4.0, u_block*5.0);
    float mbx = floor(vUV.x*u_res.x/mbs);
    float mby = floor(vUV.y*u_res.y/mbs);
    float mbh = hash(vec2(mbx*0.031,mby*0.027)+floor(u_time*4.0)*0.09);
    if(mbh > 1.0 - u_glitch*0.055){
      vec2 frozenUV = vec2(hash(vec2(mbx+0.3,mby+0.1)), hash(vec2(mbx+0.7,mby+0.4)))*0.8+0.1;
      result.rgb = texture(u_feedback, frozenUV).rgb;
    }

    float split = motionMag*u_glitch*0.055;
    if(split > 0.0008){
      result.r = texture(u_feedback, fract(dispUV+vec2( split,0.0))).r;
      result.b = texture(u_feedback, fract(dispUV+vec2(-split,0.0))).b;
      result.g = texture(u_feedback, fract(dispUV+vec2(0.0,split*0.4))).g;
    }

    float snowP = motionMag*u_glitch*0.18;
    if(hash(vUV*7.3+fSlot*0.007) < snowP){
      result.rgb = mix(result.rgb, vec3(hash(vUV*19.0+fSlot)), 0.65);
    }

    float rowH = hash(vec2(floor(vUV.y*200.0), fSlot*0.3));
    if(rowH > 1.0 - u_glitch*0.012){
      result.rgb = vec3(hash(vec2(vUV.x*0.7,fSlot)), 0.0,
                        hash(vec2(vUV.x+0.5,fSlot)))*1.4;
    }
  }

  vec3  origRgb  = cur.rgb;
  float moshLuma = dot(result.rgb, vec3(0.299,0.587,0.114));
  float origLuma = dot(origRgb,    vec3(0.299,0.587,0.114));
  vec3  recolored= origRgb * (moshLuma / max(origLuma,0.001));
  result.rgb = mix(recolored, result.rgb, u_color);

  result.rgb = mix(cur.rgb, clamp(result.rgb,0.0,3.5), bgW);
  o = vec4(result.rgb, 1.0);
}`;

const FS_PIXSORT = `#version 300 es
precision highp float;
uniform sampler2D u_sorted;
uniform sampler2D u_orig;
uniform sampler2D u_mask;
uniform float u_blend;
in vec2 vUV;
out vec4 o;
void main(){
  float m   = texture(u_mask, vUV).r;
  vec4 orig = texture(u_orig,   vUV);
  if(m > 0.75){ o = orig; return; }
  float bgW = 1.0 - smoothstep(0.3, 0.75, m);
  vec4 sorted = texture(u_sorted, vUV);
  o = mix(orig, sorted, bgW * u_blend);
}`;

const FS_LIQUID = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform sampler2D u_mask;
uniform float u_amount;
uniform float u_speed;
uniform float u_scale;
uniform float u_time;
in vec2 vUV;
out vec4 o;
${GLSL_NOISE}
void main(){
  float m=texture(u_mask,vUV).r;
  vec4 src=texture(u_tex,vUV);
  if(m>0.75){o=src;return;}
  float bgW=1.0-smoothstep(0.4,0.75,m);

  float t=u_time*u_speed*0.25;
  float wave=sin(vUV.y*u_scale*6.2832+t*3.0)*0.06
            +sin(vUV.y*u_scale*12.56 +t*5.1)*0.02;
  float front=vUV.x+wave;
  float prog=u_amount*1.1-0.05;
  float wipe=smoothstep(prog-0.04,prog+0.04,front);

  float nx=fbm(vUV*u_scale+vec2(t*0.4,0.0))-0.5;
  float ny=fbm(vUV*u_scale+vec2(0.0,t*0.5+2.7))-0.5;
  vec2 wUV=clamp(vUV+vec2(nx,ny)*0.06*bgW*(1.0-wipe),0.0,1.0);
  vec4 warped=texture(u_tex,wUV);

  vec4 result=mix(warped,src,wipe);
  o=mix(src,result,bgW);
}`;

const FS_MORPH = `#version 300 es
precision highp float;
uniform sampler2D u_cur;
uniform sampler2D u_prev;
uniform sampler2D u_mask;
uniform float u_amount;
uniform float u_freq;
uniform float u_decay;
uniform float u_time;
in vec2 vUV;
out vec4 o;
${GLSL_NOISE}
void main(){
  float m=texture(u_mask,vUV).r;
  vec4 cur=texture(u_cur,vUV);
  if(m>0.75){o=cur;return;}
  float bgW=1.0-smoothstep(0.4,0.75,m);

  float t=u_time*0.3;
  vec2 sc=vUV*u_freq;
  float wx=fbm(sc+vec2(t,0.0))-0.5;
  float wy=fbm(sc+vec2(0.0,t+2.1))-0.5;
  vec2 warp=vec2(wx,wy)*u_amount*0.06*bgW;

  vec4 prev=texture(u_prev,clamp(vUV+warp,0.0,1.0));
  prev.rgb*=u_decay;
  o=mix(cur,mix(cur,prev,u_amount*bgW),bgW);
}`;

const FS_LAVA = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform sampler2D u_feedback;
uniform sampler2D u_mask;
uniform float u_heat;
uniform float u_speed;
uniform float u_viscosity;
uniform float u_time;
uniform vec2  u_px;
in vec2 vUV;
out vec4 o;
${GLSL_NOISE}
void main(){
  float m=texture(u_mask,vUV).r;
  vec4 cur=texture(u_tex,vUV);
  if(m>0.75){o=cur;return;}
  float bgW=1.0-smoothstep(0.35,0.75,m);

  float luma=dot(cur.rgb,vec3(0.299,0.587,0.114));
  float meltability=pow(luma,1.0-u_heat*0.6+0.1)*bgW;

  float dripNoise=fbm(vUV*3.0+vec2(0.0,u_time*u_speed*0.15))-0.5;
  float dripX=dripNoise*(1.0-u_viscosity)*0.04;
  float dripY=u_speed*u_px.y*18.0*meltability;
  vec2 srcUV=clamp(vUV+vec2(dripX,-dripY),0.0,1.0);

  vec4 prev=texture(u_feedback,srcUV);

  float heatGlow=meltability*u_heat;
  vec3 lavaColor=vec3(1.0,0.38+heatGlow*0.2,0.05)*heatGlow;

  float blendAmt=clamp(meltability*(1.0-u_viscosity*0.5),0.0,1.0);
  vec3 result=mix(cur.rgb, prev.rgb, blendAmt*u_heat);
  result+=lavaColor*blendAmt*0.45;

  o=mix(cur,vec4(clamp(result,0.0,1.8),1.0),bgW);
}`;

const FS_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D u_sharp;
uniform sampler2D u_blurred;
uniform sampler2D u_mask;
uniform float u_feather;
uniform float u_vignette;
uniform float u_squeeze;
uniform float u_barrel;
uniform float u_letterbox;
uniform float u_ratio;
uniform float u_videoAR;
uniform float u_breathing;
uniform float u_anamVignette;
uniform float u_time;
in vec2 vUV;
out vec4 fragOut;

vec2 squeezeUV(vec2 uv, float sq){
  if(sq <= 1.001) return uv;
  float e = 0.001;
  return vec2(clamp(0.5 + (uv.x-0.5)*sq, e, 1.0-e), uv.y);
}

vec2 barrel(vec2 uv, float k){
  vec2 c = uv-0.5;
  float r2 = dot(c,c);
  c.x += c.x*r2*(k*0.35);
  c.y += c.y*r2*(k*1.20);
  return c+0.5;
}

float anamVig(vec2 uv, float str){
  vec2 d = (uv-0.5)*vec2(0.82,1.18);
  return clamp(1.0 - dot(d,d)*str*2.8, 0., 1.);
}

vec2 breathe(vec2 uv, float en, float t){
  if(en<0.5) return uv;
  float b = 1.0+sin(t*0.52)*0.004;
  return (uv-0.5)*b+0.5;
}

void main(){
  vec2 uv = vUV;
  vec2 uvScr = uv;

  if(u_letterbox>0.5 && u_videoAR>0.1){
    float cropF = clamp(u_videoAR/u_ratio, 0.05, 1.0);
    float top = (1.0-cropF)*0.5;
    float bot = 1.0-top;
    if(uv.y<top || uv.y>bot){
      fragOut = vec4(0.,0.,0.,1.);
      return;
    }
    uv.y = (uv.y-top)/cropF;
    uvScr = uv;
  }

  uv = breathe(uv, u_breathing, u_time);
  uv = clamp(uv, 0.001, 0.999);
  vec2 uvTex = squeezeUV(uv, u_squeeze);
  uvTex = barrel(uvTex, u_barrel);
  uvTex = clamp(uvTex, 0.001, 0.999);

  vec4 sharp   = texture(u_sharp,   uvTex);
  vec4 blurred = texture(u_blurred, uvTex);
  float m = texture(u_mask, uvTex).r;

  float lo = 0.38 - u_feather*0.28;
  float hi = 0.62 + u_feather*0.28;
  float blend = smoothstep(lo, hi, m);

  float edgeLeak = smoothstep(0.60, 0.92, m);
  vec4 out_ = mix(blurred, sharp, blend);
  out_ = mix(out_, sharp, edgeLeak*0.35 + 0.65*step(0.95, m));

  if(u_vignette > 0.001){
    vec2 vc = uvTex*2.0-1.0;
    float vr = dot(vc,vc);
    float vig = 1.0 - vr*vr*u_vignette*0.7;
    out_.rgb *= max(vig, 0.0);
  }

  if(u_anamVignette > 0.001){
    out_.rgb *= anamVig(uvScr, u_anamVignette);
  }

  fragOut = vec4(out_.rgb, 1.0);
}`;

/* Param table — 100% of the standalone's parameter surface (see the
 * STATE.md Phase 5 log for the control-by-control diff). Defaults match
 * the knob/slider data-vals the standalone initialises P from. The
 * original has no audio modulation (video-driven only), so no
 * defaultRoutes are seeded; reactive marks routable look params. */
const PARAMS: ParamSchema[] = [
  { key: 'segEnabled', label: 'Person Mask', type: 'boolean', value: 1, aiHint: '(on/off switch) Depth mask from person segmentation; without it the node passes the frame through, exactly like the standalone before its segmenter is ready' },
  // bokeh core
  { key: 'bokehRadius', label: 'Radius', type: 'number', value: 18, min: 2, max: 50, step: 0.5, reactive: true, aiHint: 'Background circle-of-confusion radius in px — the focal-length feel (8=35mm … 40=200mm)' },
  { key: 'bokehStyle', label: 'Style', type: 'number', value: 0, min: 0, max: 4, step: 1, aiHint: 'Bokeh kernel: 0 normal Poisson disc, 1 swirly Helios, 2 explosive coma, 3 anamorphic oval+streaks, 4 shape-pad blend' },
  { key: 'bokehBloom', label: 'Bloom', type: 'number', value: 1.2, min: 0, max: 3, step: 0.01, reactive: true, aiHint: 'Highlight boost inside the blur discs — creamy speculars' },
  { key: 'bokehFeather', label: 'Feather', type: 'number', value: 0.42, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Subject/background edge softness of the composite' },
  { key: 'bokehVignette', label: 'Vignette', type: 'number', value: 0.35, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Radial lens falloff on the final composite (Optics knob)' },
  { key: 'bshapeX', label: 'Shape Pad X', type: 'number', value: 0, min: -1, max: 1, step: 0.01, aiHint: 'Style-4 kernel morph X: left=tall oval, right=cat-eye X' },
  { key: 'bshapeY', label: 'Shape Pad Y', type: 'number', value: 0, min: -1, max: 1, step: 0.01, aiHint: 'Style-4 kernel morph Y: top=oval/cat-eye, bottom=8-star/square, centre=circle' },
  // anamorphic optics
  { key: 'anamSqueeze', label: 'Anam Squeeze', type: 'number', value: 1, min: 1, max: 2.2, step: 0.02, reactive: true, aiHint: 'Pre-effects horizontal squeeze — real anamorphic-glass capture character (1=off, ~2=2×)' },
  { key: 'anamRatio', label: 'Anam Ratio', type: 'number', value: 2.39, min: 1.78, max: 2.8, step: 0.01, aiHint: 'Target widescreen aspect ratio for the letterbox crop' },
  { key: 'anamBarrel', label: 'Anam Barrel', type: 'number', value: 0.22, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Oval-lens radial distortion, stronger on the vertical axis' },
  { key: 'anamVignette', label: 'Anam Vignette', type: 'number', value: 0.4, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Elliptical anamorphic lens vignette layered on the Optics one' },
  { key: 'anamLetterbox', label: 'Letterbox', type: 'boolean', value: 1, aiHint: '(on/off switch) Crop toward centre to the target ratio — no black bars, every pixel stays image' },
  { key: 'anamBreathing', label: 'Breathing', type: 'boolean', value: 0, aiHint: '(on/off switch) Subtle live lens-breathing zoom oscillation' },
  // post-blur distort
  { key: 'distortMode', label: 'Distort Mode', type: 'number', value: 0, min: 0, max: 3, step: 1, aiHint: 'Post-blur background warp: 0 off, 1 swirl, 2 explosive push, 3 anamorphic squeeze (the standalone couples it to Style)' },
  { key: 'distortSwirl', label: 'Swirl', type: 'number', value: 1.8, min: 0.1, max: 3.14, step: 0.01, reactive: true, aiHint: 'Max swirl angle in radians (mode 1)' },
  { key: 'distortFalloff', label: 'Swirl Falloff', type: 'number', value: 2.5, min: 0.5, max: 10, step: 0.1, aiHint: 'Gaussian falloff of the swirl from centre (mode 1)' },
  { key: 'distortExplosive', label: 'Explosive', type: 'number', value: 0.4, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Radial push-out strength — coma aberration (mode 2)' },
  { key: 'distortSqueeze', label: 'Distort Squeeze', type: 'number', value: 1.5, min: 1, max: 2, step: 0.05, reactive: true, aiHint: 'Horizontal background squeeze (mode 3)' },
  // background FX
  { key: 'bgfxStyle', label: 'BG FX', type: 'number', value: 0, min: 0, max: 5, step: 1, aiHint: 'Background effect: 0 off, 1 datamosh, 2 pixel sort, 3 liquid, 4 morph, 5 lava — masked to the background only' },
  { key: 'dmDrift', label: 'DM Drift', type: 'number', value: 1.8, min: 0, max: 5, step: 0.01, reactive: true, aiHint: 'Datamosh motion-vector scale — how far pixels bleed' },
  { key: 'dmDecay', label: 'DM Decay', type: 'number', value: 0.88, min: 0.7, max: 0.99, step: 0.01, aiHint: 'Datamosh feedback persistence per frame' },
  { key: 'dmBlock', label: 'DM Block', type: 'number', value: 8, min: 2, max: 48, step: 1, aiHint: 'Datamosh macroblock size in px' },
  { key: 'dmGlitch', label: 'DM Glitch', type: 'number', value: 0.35, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Datamosh glitch layer: scanline shifts, stuck blocks, RGB split, snow' },
  { key: 'dmColor', label: 'DM Color', type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, reactive: true, aiHint: '0 keeps original hue, 1 full chromatic mosh' },
  { key: 'dmIframe', label: 'DM I-Frame', type: 'number', value: 0.05, min: 0.01, max: 2, step: 0.01, aiHint: 'I-frame injection rate in Hz — how often the mosh snaps back to clean video' },
  { key: 'psThresh', label: 'Sort Threshold', type: 'number', value: 0.4, min: 0, max: 1, step: 0.01, aiHint: 'Pixel sort: only pixels brighter than this join a sort run' },
  { key: 'psBlend', label: 'Sort Blend', type: 'number', value: 1, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Pixel sort dry/wet on the background' },
  { key: 'psAngle', label: 'Sort Direction', type: 'number', value: 0, min: 0, max: 3, step: 1, aiHint: 'Pixel sort direction: 0 H, 1 V, 2 both, 3 H reversed (the standalone H/V/D+/D- switch)' },
  { key: 'lqAmount', label: 'Liquid Amount', type: 'number', value: 0.025, min: 0, max: 0.08, step: 0.001, reactive: true, aiHint: 'Liquid wave-wipe progress across the background' },
  { key: 'lqSpeed', label: 'Liquid Speed', type: 'number', value: 0.4, min: 0, max: 2, step: 0.01, aiHint: 'Liquid wave travel speed' },
  { key: 'lqScale', label: 'Liquid Scale', type: 'number', value: 2.5, min: 0.5, max: 8, step: 0.1, aiHint: 'Liquid wave frequency' },
  { key: 'mrAmount', label: 'Morph Amount', type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Cross-frame dissolve warp strength on the background' },
  { key: 'mrFreq', label: 'Morph Freq', type: 'number', value: 2, min: 0.5, max: 8, step: 0.1, aiHint: 'Morph warp noise frequency' },
  { key: 'mrDecay', label: 'Morph Decay', type: 'number', value: 0.88, min: 0.7, max: 0.99, step: 0.01, aiHint: 'Morph feedback persistence per frame' },
  { key: 'lvHeat', label: 'Lava Heat', type: 'number', value: 0.7, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Lava melt intensity — bright pixels melt and glow first' },
  { key: 'lvSpeed', label: 'Lava Speed', type: 'number', value: 0.5, min: 0, max: 2, step: 0.01, aiHint: 'Lava drip speed' },
  { key: 'lvViscosity', label: 'Lava Viscosity', type: 'number', value: 0.35, min: 0, max: 1, step: 0.01, aiHint: '0 runny drips, 1 thick slow melt' },
];

/* CPU pixel sort — verbatim port of the standalone's runPixelSort/_sortSeg
 * (fixed 480×270 working res, luma-threshold runs, every 2nd frame). */
const SORT_W = 480;
const SORT_H = 270;
const SORT_MAXRUN = Math.max(SORT_W, SORT_H);

interface Progs {
  pass: WebGLProgram;
  maskTemporal: WebGLProgram;
  maskBlur: WebGLProgram;
  bokeh: WebGLProgram;
  distort: WebGLProgram;
  datamosh: WebGLProgram;
  pixsort: WebGLProgram;
  liquid: WebGLProgram;
  morph: WebGLProgram;
  lava: WebGLProgram;
  composite: WebGLProgram;
}

export class BokehNode implements EngineNode {
  readonly id = 'bokeh';
  readonly name = 'Bokeh';
  enabled = true;
  readonly params = PARAMS;

  private v: Record<string, number> = {};
  private gl: WebGL2RenderingContext | null = null;
  private progs: Progs | null = null;
  private uni: Record<string, Record<string, WebGLUniformLocation | null>> = {};

  private bokehT: Target | null = null;
  private distortT: Target | null = null;
  private compT: Target | null = null;
  private bgfxT: [Target, Target] | null = null;
  private keyframeT: Target | null = null;
  private maskTemporalT: [Target, Target] | null = null;
  private maskBlurT: Target | null = null;
  private sortMiniT: Target | null = null;
  private rawMaskTex: WebGLTexture | null = null;
  private sortedTex: WebGLTexture | null = null;

  private w = 0;
  private h = 0;
  private bgfxR = 0;
  private maskTR = 0;
  private maskReady = false;
  private lastMaskV = -1;
  private prevBgfx = 0;
  // datamosh I-frame engine state — timer advances 1/60 per rendered frame,
  // exactly the standalone's frame-based clock
  private dmTimer = 0;
  private dmIsIframe = 1;

  private sortTick = 0;
  private sortRead = new Uint8Array(SORT_W * SORT_H * 4);
  private sortFlip = new Uint8ClampedArray(SORT_W * SORT_H * 4);
  private sortLuma = new Float64Array(SORT_MAXRUN);
  private sortOrder = new Int32Array(SORT_MAXRUN);
  private sortTmpR = new Uint8ClampedArray(SORT_MAXRUN);
  private sortTmpG = new Uint8ClampedArray(SORT_MAXRUN);
  private sortTmpB = new Uint8ClampedArray(SORT_MAXRUN);
  private hRunIdx = new Int32Array(SORT_W);
  private vRunIdx = new Int32Array(SORT_H);

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
      pass: mk(FS_PASS),
      maskTemporal: mk(FS_MASK_TEMPORAL),
      maskBlur: mk(FS_MASK_BLUR),
      bokeh: mk(FS_BOKEH),
      distort: mk(FS_DISTORT),
      datamosh: mk(FS_DATAMOSH),
      pixsort: mk(FS_PIXSORT),
      liquid: mk(FS_LIQUID),
      morph: mk(FS_MORPH),
      lava: mk(FS_LAVA),
      composite: mk(FS_COMPOSITE),
    };
    const locs = (p: WebGLProgram, names: string[]) => {
      const out: Record<string, WebGLUniformLocation | null> = {};
      names.forEach((n) => { out[n] = gl.getUniformLocation(p, n); });
      return out;
    };
    this.uni = {
      pass: locs(this.progs.pass, ['u_tex']),
      maskTemporal: locs(this.progs.maskTemporal, ['u_new', 'u_prev', 'u_alpha']),
      maskBlur: locs(this.progs.maskBlur, ['u_mask', 'u_px']),
      bokeh: locs(this.progs.bokeh, ['u_tex', 'u_mask', 'u_radius', 'u_bloom', 'u_style', 'u_bshapeXY', 'u_px', 'u_time']),
      distort: locs(this.progs.distort, ['u_tex', 'u_mask', 'u_dmode', 'u_swirl', 'u_falloff', 'u_explosive', 'u_squeeze', 'u_center', 'u_time']),
      datamosh: locs(this.progs.datamosh, ['u_cur', 'u_prev', 'u_feedback', 'u_mask', 'u_res', 'u_time', 'u_drift', 'u_isiframe', 'u_block', 'u_glitch', 'u_decay', 'u_color']),
      pixsort: locs(this.progs.pixsort, ['u_sorted', 'u_orig', 'u_mask', 'u_blend']),
      liquid: locs(this.progs.liquid, ['u_tex', 'u_mask', 'u_amount', 'u_speed', 'u_scale', 'u_time']),
      morph: locs(this.progs.morph, ['u_cur', 'u_prev', 'u_mask', 'u_amount', 'u_freq', 'u_decay', 'u_time']),
      lava: locs(this.progs.lava, ['u_tex', 'u_feedback', 'u_mask', 'u_heat', 'u_speed', 'u_viscosity', 'u_time', 'u_px']),
      composite: locs(this.progs.composite, ['u_sharp', 'u_blurred', 'u_mask', 'u_feather', 'u_vignette', 'u_squeeze', 'u_barrel', 'u_letterbox', 'u_ratio', 'u_videoAR', 'u_breathing', 'u_anamVignette', 'u_time']),
    };

    const mkTex = () => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.rawMaskTex = mkTex();
    this.sortedTex = mkTex();
    this.sortMiniT = createTarget(gl, SORT_W, SORT_H);
  }

  resize(width: number, height: number): void {
    const gl = this.gl;
    if (!gl || width < 2 || height < 2) return;
    if (width === this.w && height === this.h) return;
    this.w = width;
    this.h = height;
    this.destroyTargets(gl);
    this.bokehT = createTarget(gl, width, height);
    this.distortT = createTarget(gl, width, height);
    this.compT = createTarget(gl, width, height);
    this.bgfxT = [createTarget(gl, width, height), createTarget(gl, width, height)];
    this.keyframeT = createTarget(gl, width, height);
    this.maskTemporalT = [createTarget(gl, width, height), createTarget(gl, width, height)];
    this.maskBlurT = createTarget(gl, width, height);
    [this.bgfxT[0], this.bgfxT[1], this.maskTemporalT[0], this.maskTemporalT[1], this.maskBlurT].forEach((t) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.dmTimer = 0;
    this.dmIsIframe = 1;
    // force the next mask arrival to rebuild the temporal/blur chain at the new size
    this.lastMaskV = -1;
  }

  private destroyTargets(gl: WebGL2RenderingContext): void {
    destroyTarget(gl, this.bokehT);
    destroyTarget(gl, this.distortT);
    destroyTarget(gl, this.compT);
    this.bgfxT?.forEach((t) => destroyTarget(gl, t));
    destroyTarget(gl, this.keyframeT);
    this.maskTemporalT?.forEach((t) => destroyTarget(gl, t));
    destroyTarget(gl, this.maskBlurT);
    this.bokehT = this.distortT = this.compT = this.keyframeT = this.maskBlurT = null;
    this.bgfxT = this.maskTemporalT = null;
  }

  private bindTex(gl: WebGL2RenderingContext, unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null): void {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  /* mask intake — runs once per segmentation arrival, like the standalone's
   * onSegResults: upload raw mask, temporal EMA ping-pong, spatial blur */
  private intakeMask(ctx: NodeRenderContext): void {
    const gl = ctx.gl;
    if (!this.progs || !this.maskTemporalT || !this.maskBlurT) return;

    gl.bindTexture(gl.TEXTURE_2D, this.rawMaskTex!);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, ctx.personMask!);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    const read = this.maskTemporalT[this.maskTR];
    const write = this.maskTemporalT[this.maskTR ^ 1];
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.progs.maskTemporal);
    this.bindTex(gl, 0, this.rawMaskTex!, this.uni.maskTemporal.u_new);
    this.bindTex(gl, 1, read.tex, this.uni.maskTemporal.u_prev);
    gl.uniform1f(this.uni.maskTemporal.u_alpha, 0.28);
    ctx.drawQuad();
    this.maskTR ^= 1;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskBlurT.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.progs.maskBlur);
    this.bindTex(gl, 0, this.maskTemporalT[this.maskTR].tex, this.uni.maskBlur.u_mask);
    gl.uniform2f(this.uni.maskBlur.u_px, 1 / this.w, 1 / this.h);
    ctx.drawQuad();

    this.maskReady = true;
  }

  private sortSeg(d: Uint8ClampedArray, idxs: Int32Array, len: number): void {
    for (let k = 0; k < len; k++) {
      const i = idxs[k];
      const r = d[i], g = d[i + 1], b = d[i + 2];
      this.sortTmpR[k] = r; this.sortTmpG[k] = g; this.sortTmpB[k] = b;
      this.sortLuma[k] = 0.299 * r + 0.587 * g + 0.114 * b;
      this.sortOrder[k] = k;
    }
    this.sortOrder.subarray(0, len).sort((a, b) => this.sortLuma[a] - this.sortLuma[b]);
    for (let k = 0; k < len; k++) {
      const srcPos = this.sortOrder[k];
      const i = idxs[k];
      d[i] = this.sortTmpR[srcPos]; d[i + 1] = this.sortTmpG[srcPos]; d[i + 2] = this.sortTmpB[srcPos];
    }
  }

  /* CPU pixel sort of the PREVIOUS composite output (the standalone samples
   * its display canvas before the new frame is drawn) at 480×270, every 2nd
   * frame — identical runs/threshold/order to the standalone. */
  private runPixelSort(ctx: NodeRenderContext): void {
    const gl = ctx.gl;
    if (!this.progs || !this.compT || !this.sortMiniT) return;
    this.sortTick++;
    if (this.sortTick % 2 !== 0) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sortMiniT.fbo);
    gl.viewport(0, 0, SORT_W, SORT_H);
    gl.useProgram(this.progs.pass);
    this.bindTex(gl, 0, this.compT.tex, this.uni.pass.u_tex);
    ctx.drawQuad();
    gl.readPixels(0, 0, SORT_W, SORT_H, gl.RGBA, gl.UNSIGNED_BYTE, this.sortRead);

    // readback rows are bottom-up; the standalone's algorithm runs in canvas
    // (top-down) orientation, which matters for vertical run order
    const rowBytes = SORT_W * 4;
    for (let y = 0; y < SORT_H; y++) {
      this.sortFlip.set(this.sortRead.subarray((SORT_H - 1 - y) * rowBytes, (SORT_H - y) * rowBytes), y * rowBytes);
    }

    const d = this.sortFlip;
    const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
    const thr = Math.round(this.v.psThresh * 255);
    const dir = Math.round(this.v.psAngle);
    if (dir === 0 || dir === 2 || dir === 3) {
      for (let y = 0; y < SORT_H; y++) {
        let runLen = 0;
        for (let x = 0; x < SORT_W; x++) {
          const xi = dir === 3 ? SORT_W - 1 - x : x;
          const i = (y * SORT_W + xi) * 4;
          if (luma(d[i], d[i + 1], d[i + 2]) >= thr) { this.hRunIdx[runLen++] = i; }
          else { if (runLen > 1) this.sortSeg(d, this.hRunIdx, runLen); runLen = 0; }
        }
        if (runLen > 1) this.sortSeg(d, this.hRunIdx, runLen);
      }
    }
    if (dir === 1 || dir === 2) {
      for (let x = 0; x < SORT_W; x++) {
        let runLen = 0;
        for (let y = 0; y < SORT_H; y++) {
          const i = (y * SORT_W + x) * 4;
          if (luma(d[i], d[i + 1], d[i + 2]) >= thr) { this.vRunIdx[runLen++] = i; }
          else { if (runLen > 1) this.sortSeg(d, this.vRunIdx, runLen); runLen = 0; }
        }
        if (runLen > 1) this.sortSeg(d, this.vRunIdx, runLen);
      }
    }

    // back to bottom-up for the (flip-free) raw upload
    for (let y = 0; y < SORT_H; y++) {
      this.sortRead.set(this.sortFlip.subarray((SORT_H - 1 - y) * rowBytes, (SORT_H - y) * rowBytes), y * rowBytes);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.sortedTex!);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, SORT_W, SORT_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.sortRead);
  }

  render(ctx: NodeRenderContext): WebGLTexture {
    const gl = ctx.gl;
    if (!this.progs || !this.bokehT || !this.distortT || !this.compT || !this.bgfxT || !this.keyframeT || !this.maskBlurT) {
      return ctx.inputTex;
    }
    const P = this.v;

    if (P.segEnabled < 0.5) return ctx.inputTex;

    if (ctx.personMask && ctx.personMaskVersion !== this.lastMaskV) {
      this.lastMaskV = ctx.personMaskVersion;
      this.intakeMask(ctx);
    }
    // the standalone blits raw video until the first mask has arrived
    if (!this.maskReady) return ctx.inputTex;

    const bgfx = Math.max(0, Math.min(5, Math.round(P.bgfxStyle)));
    if (bgfx !== this.prevBgfx) {
      this.prevBgfx = bgfx;
      if (bgfx === 1 || bgfx === 4 || bgfx === 5) {
        this.bgfxT.forEach((t) => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
          gl.viewport(0, 0, this.w, this.h);
          gl.clearColor(0, 0, 0, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
        });
        this.dmTimer = 0;
        this.dmIsIframe = 1;
      }
    }

    if (bgfx === 2) this.runPixelSort(ctx);

    const t = ctx.time;

    /* STAGE 1 — bokeh blur guided by the smoothed mask */
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bokehT.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.progs.bokeh);
    this.bindTex(gl, 0, ctx.inputTex, this.uni.bokeh.u_tex);
    this.bindTex(gl, 1, this.maskBlurT.tex, this.uni.bokeh.u_mask);
    gl.uniform1f(this.uni.bokeh.u_radius, P.bokehRadius);
    gl.uniform1f(this.uni.bokeh.u_bloom, P.bokehBloom);
    gl.uniform1i(this.uni.bokeh.u_style, Math.max(0, Math.min(4, Math.round(P.bokehStyle))));
    gl.uniform2f(this.uni.bokeh.u_bshapeXY, P.bshapeX, P.bshapeY);
    gl.uniform2f(this.uni.bokeh.u_px, 1 / this.w, 1 / this.h);
    gl.uniform1f(this.uni.bokeh.u_time, t);
    ctx.drawQuad();

    /* STAGE 1.5 — post-blur distortion (bypassed at mode 0, like drawDistort) */
    let stageTex: WebGLTexture = this.bokehT.tex;
    const dmode = Math.max(0, Math.min(3, Math.round(P.distortMode)));
    if (dmode !== 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.distortT.fbo);
      gl.viewport(0, 0, this.w, this.h);
      gl.useProgram(this.progs.distort);
      this.bindTex(gl, 0, this.bokehT.tex, this.uni.distort.u_tex);
      this.bindTex(gl, 1, this.maskBlurT.tex, this.uni.distort.u_mask);
      gl.uniform1i(this.uni.distort.u_dmode, dmode);
      gl.uniform1f(this.uni.distort.u_swirl, P.distortSwirl);
      gl.uniform1f(this.uni.distort.u_falloff, P.distortFalloff);
      gl.uniform1f(this.uni.distort.u_explosive, P.distortExplosive);
      gl.uniform1f(this.uni.distort.u_squeeze, P.distortSqueeze);
      gl.uniform2f(this.uni.distort.u_center, 0.5, 0.5);
      gl.uniform1f(this.uni.distort.u_time, t);
      ctx.drawQuad();
      stageTex = this.distortT.tex;
    }

    /* STAGE 2 — background FX (mask-gated, ping-pong across frames) */
    let bgTex = stageTex;
    if (bgfx !== 0) {
      const read = this.bgfxT[this.bgfxR];
      const write = this.bgfxT[this.bgfxR ^ 1];

      if (bgfx === 1) {
        // frame-based I-frame clock, exactly the standalone's DM engine
        this.dmTimer += 1 / 60;
        this.dmIsIframe = 0;
        if (this.dmTimer >= 1 / Math.max(P.dmIframe, 0.01)) {
          this.dmTimer = 0;
          this.dmIsIframe = 1;
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.keyframeT.fbo);
          gl.viewport(0, 0, this.w, this.h);
          gl.useProgram(this.progs.pass);
          this.bindTex(gl, 0, stageTex, this.uni.pass.u_tex);
          ctx.drawQuad();
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
        gl.viewport(0, 0, this.w, this.h);
        gl.useProgram(this.progs.datamosh);
        this.bindTex(gl, 0, stageTex, this.uni.datamosh.u_cur);
        this.bindTex(gl, 1, this.keyframeT.tex, this.uni.datamosh.u_prev);
        this.bindTex(gl, 2, read.tex, this.uni.datamosh.u_feedback);
        this.bindTex(gl, 3, this.maskBlurT.tex, this.uni.datamosh.u_mask);
        gl.uniform2f(this.uni.datamosh.u_res, this.w, this.h);
        gl.uniform1f(this.uni.datamosh.u_time, t);
        gl.uniform1f(this.uni.datamosh.u_drift, P.dmDrift);
        gl.uniform1f(this.uni.datamosh.u_isiframe, this.dmIsIframe);
        gl.uniform1f(this.uni.datamosh.u_block, P.dmBlock);
        gl.uniform1f(this.uni.datamosh.u_glitch, P.dmGlitch);
        gl.uniform1f(this.uni.datamosh.u_decay, P.dmDecay);
        gl.uniform1f(this.uni.datamosh.u_color, P.dmColor);
      } else if (bgfx === 2) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
        gl.viewport(0, 0, this.w, this.h);
        gl.useProgram(this.progs.pixsort);
        this.bindTex(gl, 0, this.sortedTex!, this.uni.pixsort.u_sorted);
        this.bindTex(gl, 1, stageTex, this.uni.pixsort.u_orig);
        this.bindTex(gl, 2, this.maskBlurT.tex, this.uni.pixsort.u_mask);
        gl.uniform1f(this.uni.pixsort.u_blend, P.psBlend);
      } else if (bgfx === 3) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
        gl.viewport(0, 0, this.w, this.h);
        gl.useProgram(this.progs.liquid);
        this.bindTex(gl, 0, stageTex, this.uni.liquid.u_tex);
        this.bindTex(gl, 1, this.maskBlurT.tex, this.uni.liquid.u_mask);
        gl.uniform1f(this.uni.liquid.u_amount, P.lqAmount);
        gl.uniform1f(this.uni.liquid.u_speed, P.lqSpeed);
        gl.uniform1f(this.uni.liquid.u_scale, P.lqScale);
        gl.uniform1f(this.uni.liquid.u_time, t);
      } else if (bgfx === 4) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
        gl.viewport(0, 0, this.w, this.h);
        gl.useProgram(this.progs.morph);
        this.bindTex(gl, 0, stageTex, this.uni.morph.u_cur);
        this.bindTex(gl, 1, read.tex, this.uni.morph.u_prev);
        this.bindTex(gl, 2, this.maskBlurT.tex, this.uni.morph.u_mask);
        gl.uniform1f(this.uni.morph.u_amount, P.mrAmount);
        gl.uniform1f(this.uni.morph.u_freq, P.mrFreq);
        gl.uniform1f(this.uni.morph.u_decay, P.mrDecay);
        gl.uniform1f(this.uni.morph.u_time, t);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
        gl.viewport(0, 0, this.w, this.h);
        gl.useProgram(this.progs.lava);
        this.bindTex(gl, 0, stageTex, this.uni.lava.u_tex);
        this.bindTex(gl, 1, read.tex, this.uni.lava.u_feedback);
        this.bindTex(gl, 2, this.maskBlurT.tex, this.uni.lava.u_mask);
        gl.uniform1f(this.uni.lava.u_heat, P.lvHeat);
        gl.uniform1f(this.uni.lava.u_speed, P.lvSpeed);
        gl.uniform1f(this.uni.lava.u_viscosity, P.lvViscosity);
        gl.uniform1f(this.uni.lava.u_time, t);
        gl.uniform2f(this.uni.lava.u_px, 1 / this.w, 1 / this.h);
      }
      ctx.drawQuad();
      this.bgfxR ^= 1;
      bgTex = this.bgfxT[this.bgfxR].tex;
    }

    /* STAGE 3 — composite sharp subject over the processed background */
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.compT.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.progs.composite);
    this.bindTex(gl, 0, ctx.inputTex, this.uni.composite.u_sharp);
    this.bindTex(gl, 1, bgTex, this.uni.composite.u_blurred);
    this.bindTex(gl, 2, this.maskBlurT.tex, this.uni.composite.u_mask);
    gl.uniform1f(this.uni.composite.u_feather, P.bokehFeather);
    gl.uniform1f(this.uni.composite.u_vignette, P.bokehVignette);
    const nativeAR = this.w / this.h;
    gl.uniform1f(this.uni.composite.u_squeeze, P.anamSqueeze);
    gl.uniform1f(this.uni.composite.u_barrel, P.anamBarrel);
    gl.uniform1f(this.uni.composite.u_letterbox, P.anamLetterbox >= 0.5 ? 1 : 0);
    gl.uniform1f(this.uni.composite.u_ratio, P.anamRatio || nativeAR);
    gl.uniform1f(this.uni.composite.u_videoAR, nativeAR);
    gl.uniform1f(this.uni.composite.u_breathing, P.anamBreathing >= 0.5 ? 1 : 0);
    gl.uniform1f(this.uni.composite.u_anamVignette, P.anamVignette);
    gl.uniform1f(this.uni.composite.u_time, t);
    ctx.drawQuad();

    return this.compT.tex;
  }

  dispose(gl: WebGL2RenderingContext): void {
    if (this.progs) {
      Object.values(this.progs).forEach((p) => gl.deleteProgram(p));
      this.progs = null;
    }
    this.destroyTargets(gl);
    destroyTarget(gl, this.sortMiniT);
    this.sortMiniT = null;
    if (this.rawMaskTex) { gl.deleteTexture(this.rawMaskTex); this.rawMaskTex = null; }
    if (this.sortedTex) { gl.deleteTexture(this.sortedTex); this.sortedTex = null; }
  }
}
