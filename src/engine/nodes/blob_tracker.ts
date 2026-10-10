import * as THREE from 'three';
import { EngineNode, NodeRenderContext } from '../SynEngine';
import { ParamSchema } from '../../bridge/types';
import { bodyLandmarks, BodyKind, BODY_KINDS, BODY_FACE_OVAL } from '../BodyLandmarks'; // SYNTECH-BODY

/* ═══════════════════════════════════════════════════════════════
   BLOB TRACKER — 1:1 port of public/effects/blob_tracker/index.html
   (Phase 8) — COMPLETE. All layers ported + verified.

   The standalone is the biggest effect (~6876 lines): a Canvas-2D
   contour tracker + TWO three.js renderers (a float ping-pong ripple
   sim on `glC`, and a 3D "panels" scene on `panels-canvas`) whose
   canvases are stacked and composited (see the standalone capLoop).
   Per 04-SPEC the faithful port keeps three.js rendering to offscreen
   canvases uploaded as the node texture — the blob_reveal
   offscreen-2D→GL-texture pattern extended to three.js.

   WIRED into nodes.ts (factory `blob_tracker: () => new BlobTrackerNode()`).
   The full deterministic 2D pipeline (tracker core + FX + edge/smart contour +
   flow + chaos) + BOTH three.js scenes (ripple + panels) are ported and
   verified; reactivity is mapped to ParamBus routes (decision #1). See the
   per-layer STATE.md logs (2026-07-20) for the parity numbers.

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
   ■ L3 — contour markers DONE (edge + smart). EDGE: radialContour ray-cast on
        the detection binary → douglasPeucker → catmull-rom spline + optional
        fill; drawBlobMarker delegates when ctMode≥1 and the contour has ≥6 pts
        (deterministic, pixel-exact). SMART (ctMode=2, L3b): the contour
        ray-casts the shared PersonMask instead of the detection binary
        (refreshSmartMask reads the mask ALPHA at PW×PH, per personMaskVersion),
        falling back to edge until the mask arrives — the standalone's
        `_ctSmartMask ?? _ctBinMask`. DECISION: mapped to the shared PersonMask
        (SelfieSegmentation) rather than adding the standalone's distinct
        Tasks-Vision ImageSegmenter dep — same 04-SPEC substitution as
        blob_reveal/bokeh/anamorphic. segEnabled is derived from ctMode (smart
        ⇒ the shell lazy-loads the segmenter), so there is no separate control.
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
   ■ L6 — three.js panels scene DONE. A FIXED 8-panel 3D montage (PANEL_DEFS/
        PANEL_LBLS/PANEL_VS/PANEL_FS + SimplexNoise, verbatim) on the node's
        OWN offscreen THREE.WebGLRenderer (transparent); composited OVER dc in
        2D BEFORE the ripple samples dc. OPERATOR DECISION: the panel labels +
        connector lines are drawn INTO dc via Canvas-2D at the projected
        positions (functionally equivalent to the standalone's HTML p-lbl divs
        + SVG svg-lines — an accepted, non-pixel-identical deviation). The
        panels source is ctx.source (raw video, like the standalone). panelScale
        (sScale)/panelTurb (sTurb)/panelCamZ (sCamZ)/panelsBgOpacity (sBgOp)/
        panelsLabels (btn-plabels)/panelsConnLines (btn-pconnlines)/mirrorPanels
        (btn-mirror-panels) are params; panelsBgOpacity dims the tracker behind
        the panels (the standalone panels-mode #050302 backdrop). autoMode / AR /
        VR panel driving (panelsAnimate's auto branch) is deferred to L7.
   ■ L7 — reactivity + colours + chaos. L7a ROUTES DONE: the standalone's bespoke auto-driver
        (audioReactiveFrame/applyAudioToParams/videoReactiveFrame — a 7-band
        analyser modulating params) is mapped to ParamBus defaultRoutes on the
        shared AudioEngine/VideoAnalyzer signals (decision #1, the analog
        pattern). Seeded: connWidth←bass, connGlow←loud, datamosh←treble,
        glitchAmt←beat, panelScale←bass, panelTurb←motion, rippleForce←beat
        (L5). The ar-* and vr-* gain sliders + ar-on/auto + vr-on/auto/face/
        pose/flow toggles are CONSOLIDATED — the shared engines + ParamBus amount
        replace the built-in analyser (as blob_reveal consolidated beatSens/
        beatGap). L7b COLOURS DONE: trackerColor/connColor/vfxColor become
        palette-enum indices (PALETTE + pal()) — trackerColorIdx (markers/
        contours/labels), connColorIdx (tracker + panel connections), vfxColorOn
        + vfxColorIdx (FX text override); resolved into this.trackerColor/
        connColor each render. L7c fixedPtsMode DONE: the chaos engine
        (fpInitState/fpTick/fpBlobsForFrame, verbatim) replaces detection with a
        set of AUTO-PLACED points (golden-angle scatter — the chain has no mouse),
        each an animated jitter/size/shape/FX/alpha marker fed through the
        existing draw pipeline via per-blob global swaps (fpRender). CONSOLIDATED
        (decision #1): the autoMode panel driving (per-panel Z-thrust/kick from
        the bespoke onset detector) IS the auto-driver replaced by the L7a routes
        (panelTurb←motion, panelScale←bass) — the per-mesh onset choreography is
        an accepted omission. Panel-label colour override left at L6 styling.
   ■ L8 — DONE. Param table reconciled (added mirrorBg; connSat + ar-* / vr-*
        gains + panels-label colour consolidated — see STATE.md). chain-sanity +
        mirrorBg suite green; all L3b/L5/L6/L7 layer suites re-run 0-fail;
        factory made permanent. Phase 8 complete.

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
  // SYNTECH-BODY: DETECT row (standalone det-luma / det-motion / det-body). Default MOTION like the standalone;
  // presets saved before DETECT existed reopen in LUMA (ChainLab applyPresetTo), like the standalone bridge.
  { key: 'detect', label: 'Detect', type: 'number', value: 1, min: 0, max: 2, step: 1, aiHint: '0 LUMA (classic: blobs = bright zones, Threshold/Brightness/Contrast) · 1 MOTION (default: blobs follow what moves — frame difference with camera-pan compensation, sensitivity from Threshold, tracked over time) · 2 BODY (one blob per face / hand / person from the Face / Hands / Body landmarks; turns Body on if none is)' },
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
  { key: 'connWidth', label: 'Line Width', type: 'number', value: 10, min: 1, max: 20, step: 1, reactive: true, defaultRoute: { source: 'bass', amount: 0.45 }, aiHint: 'Connection line width — pre-wired to bass so the graph lines pulse with the low end (standalone auto: bass pulses connWidth)' },
  { key: 'connOpacity', label: 'Conn Opacity', type: 'number', value: 1, min: 0, max: 1, step: 0.01, aiHint: 'Connection line opacity' },
  { key: 'connGlow', label: 'Conn Glow', type: 'number', value: 0, min: 0, max: 1, step: 0.01, reactive: true, defaultRoute: { source: 'loud', amount: 0.4 }, aiHint: 'Neon glow halo on the connection lines — pre-wired to overall loudness so the glow blooms with the mix' },
  // L2 — FX system
  { key: 'bgFxMode', label: 'BG FX Mode', type: 'boolean', value: 0, aiHint: '(on/off switch) On = FX fill the background (blobs stay clean video); off = FX only inside the blobs' },
  { key: 'fxOpacity', label: 'FX Opacity', type: 'number', value: 1, min: 0, max: 1, step: 0.01, reactive: true, aiHint: 'Global blend of every active FX over the clean pixels' },
  { key: 'fxInvert', label: 'FX Invert', type: 'boolean', value: 0, aiHint: '(on/off switch) Colour inversion' },
  { key: 'fxThermal', label: 'FX Thermal', type: 'boolean', value: 0, aiHint: '(on/off switch) Thermal-camera false-colour map' },
  { key: 'fxSecurity', label: 'FX Security', type: 'boolean', value: 0, aiHint: '(on/off switch) CCTV look: green tint, scanlines, timestamp + CAM ID + corner brackets (time/noise seeded)' },
  { key: 'fxLiquid', label: 'FX Liquid', type: 'boolean', value: 0, aiHint: '(on/off switch) Travelling sine-wave row shift (time seeded)' },
  { key: 'fxData', label: 'FX Glitch 1', type: 'boolean', value: 0, aiHint: '(on/off switch) Datamosh block displacement (random seeded)' },
  { key: 'fxGlitch', label: 'FX Glitch 2', type: 'boolean', value: 0, aiHint: '(on/off switch) RGB-split screen smear + random slices' },
  { key: 'datamosh', label: 'Glitch 1 Amt', type: 'number', value: 8, min: 0, max: 30, step: 1, reactive: true, defaultRoute: { source: 'treble', amount: 0.5 }, aiHint: 'Datamosh (Glitch 1) displacement strength — pre-wired to treble (standalone auto: treble drives datamosh)' },
  { key: 'glitchAmt', label: 'Glitch 2 Amt', type: 'number', value: 6, min: 0, max: 20, step: 1, reactive: true, defaultRoute: { source: 'beat', amount: 0.5 }, aiHint: 'Glitch 2 RGB-split smear strength — pre-wired to the beat (standalone auto: onset transients spike glitch)' },
  { key: 'padX', label: 'FX Pad X', type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, aiHint: 'Background-mode glitch/datamosh strength modifier (standalone padX)' },
  { key: 'textMode', label: 'Text Fill', type: 'number', value: 0, min: 0, max: 3, step: 1, aiHint: '0 off · 1 numbers · 2 letters · 3 mixed — Matrix-style char fill (random seeded)' },
  { key: 'textPadX', label: 'Text Coverage X', type: 'number', value: 1, min: 0, max: 1, step: 0.01, aiHint: 'Text-fill block coverage, X axis' },
  { key: 'textPadY', label: 'Text Coverage Y', type: 'number', value: 1, min: 0, max: 1, step: 0.01, aiHint: 'Text-fill block coverage, Y axis' },
  // L3 — contour markers (edge mode; smart = a MediaPipe ImageSegmenter dep, L7)
  { key: 'ctMode', label: 'Contour Mode', type: 'number', value: 0, min: 0, max: 2, step: 1, aiHint: '0 off (rectangle markers) · 1 edge (organic radial contour from the detection mask) · 2 smart (contour follows the shared person-segmentation mask; loads on demand, falls back to edge until the mask arrives)' },
  { key: 'ctExpand', label: 'Contour Expand', type: 'number', value: 0, min: -20, max: 20, step: 1, aiHint: 'Grow/shrink the contour outline along its rays (proc-space px)' },
  { key: 'ctSmooth', label: 'Contour Smooth', type: 'number', value: 5, min: 0, max: 20, step: 1, aiHint: 'Douglas-Peucker simplification ε — higher = smoother, fewer points' },
  { key: 'ctFill', label: 'Contour Fill', type: 'boolean', value: 0, aiHint: '(on/off switch) Fill the contour interior at 15% opacity' },
  // L4 — optical flow (Lucas-Kanade per blob → arrows/trails)
  { key: 'flowOn', label: 'Optical Flow', type: 'boolean', value: 0, aiHint: '(on/off switch) Lucas-Kanade motion arrows per blob (green→red by speed) + optional trails' },
  { key: 'flowScale', label: 'Arrow Scale', type: 'number', value: 3, min: 0, max: 10, step: 0.5, reactive: true, aiHint: 'Length multiplier of the flow arrows' },
  { key: 'flowTrail', label: 'Trail Length', type: 'number', value: 0, min: 0, max: 10, step: 1, aiHint: 'How many past positions each blob leaves as a fading dashed trail (0 = off)' },
  // SYNTECH-BODY: Body section (standalone body-face-btn / body-hands-btn / body-pose-btn) — MediaPipe Tasks
  // landmarkers via the shared BodyLandmarks service (vendored, offline, loaded on the first ON)
  { key: 'bodyFace', label: 'Body Face', type: 'boolean', value: 0, aiHint: '(on/off switch) Face recognition: 478-point face mesh with irises drawn over the video (up to 3 faces); feeds DETECT BODY' },
  { key: 'bodyHands', label: 'Body Hands', type: 'boolean', value: 0, aiHint: '(on/off switch) Hand recognition: 21-point hands with L/R tag (up to 4 hands); feeds DETECT BODY' },
  { key: 'bodyPose', label: 'Body Skeleton', type: 'boolean', value: 0, aiHint: '(on/off switch) Body recognition: 33-point skeleton (up to 5 people); feeds DETECT BODY' },
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
  // L6 — three.js panels scene (FIXED 8-panel 3D montage overlaid on the frame)
  { key: 'panelsEnabled', label: 'Panels', type: 'boolean', value: 0, aiHint: '(on/off switch) Overlay the fixed 8-panel 3D "AI analysis" montage over the tracked frame (standalone FX.panels)' },
  { key: 'panelScale', label: 'Panel Scale', type: 'number', value: 1, min: 0.2, max: 3, step: 0.05, reactive: true, defaultRoute: { source: 'bass', amount: 0.4 }, aiHint: 'Uniform size of every floating panel (standalone sScale) — pre-wired to bass so the panels swell with the low end (standalone auto: bass = panel size)' },
  { key: 'panelTurb', label: 'Panel Turbulence', type: 'number', value: 1, min: 0, max: 3, step: 0.1, reactive: true, defaultRoute: { source: 'motion', amount: 0.6 }, aiHint: 'How strongly the panels drift and tumble (simplex-noise amplitude) — pre-wired to video motion so movement in the frame stirs the panels (standalone videoReactiveFrame: motion drives panelTurb)' },
  { key: 'panelCamZ', label: 'Panel Camera Z', type: 'number', value: 7, min: 3, max: 14, step: 0.5, aiHint: 'Distance of the perspective camera from the panel cluster — lower = closer/wider' },
  { key: 'panelsBgOpacity', label: 'Panel BG Opacity', type: 'number', value: 0.5, min: 0, max: 1, step: 0.01, aiHint: 'How much of the tracker composite stays visible behind the panels (standalone sBgOp panels-mode backdrop); 1 = full tracker, 0 = near-black' },
  { key: 'panelsLabels', label: 'Panel Labels', type: 'boolean', value: 1, aiHint: '(on/off switch) Draw the per-panel tag + score labels (standalone btn-plabels)' },
  { key: 'panelsConnLines', label: 'Panel Label Lines', type: 'boolean', value: 1, aiHint: '(on/off switch) Draw the connector line from each label to its panel (standalone btn-pconnlines)' },
  { key: 'mirrorPanels', label: 'Mirror Panels', type: 'boolean', value: 0, aiHint: '(on/off switch) Horizontally mirror the video sampled inside each panel (standalone btn-mirror-panels)' },
  { key: 'mirrorBg', label: 'Mirror Video', type: 'boolean', value: 0, aiHint: '(on/off switch) Horizontally mirror the tracked video (base + detection stay aligned) — standalone btn-mirror-bg' },
  // L7b — colours (palette-enum indices; ParamSchema can't hold hex)
  { key: 'trackerColorIdx', label: 'Tracker Color', type: 'number', value: 0, min: 0, max: 9, step: 1, aiHint: 'Colour of the blob markers, contours + ID/A labels — palette: 0 white·1 blue·2 mint·3 violet·4 cyan·5 red·6 amber·7 green·8 magenta·9 black' },
  { key: 'connColorIdx', label: 'Connection Color', type: 'number', value: 1, min: 0, max: 9, step: 1, aiHint: 'Colour of the connection lines (tracker graph + panel graph) — same palette; default 1 = blue (#0011ff)' },
  { key: 'vfxColorOn', label: 'VFX Color Override', type: 'boolean', value: 0, aiHint: '(on/off switch) Override the built-in FX text-fill colour with the palette colour below (standalone vfxColorActive)' },
  { key: 'vfxColorIdx', label: 'VFX Color', type: 'number', value: 2, min: 0, max: 9, step: 1, aiHint: 'Palette colour for the Text Fill FX when VFX Color Override is on; default 2 = mint (#00ff88)' },
  // L7c — fixed-points chaos engine (replaces standard detection)
  { key: 'fixedPtsMode', label: 'Chaos Points', type: 'boolean', value: 0, aiHint: '(on/off switch) Replace blob detection with a fixed set of auto-placed points, each an animated chaos marker (jittering size/shape, random per-point FX, alpha lifecycle) — the standalone fixedPtsMode' },
  { key: 'fixedMaxPts', label: 'Chaos Point Count', type: 'number', value: 5, min: 1, max: 10, step: 1, aiHint: 'How many chaos points to animate when Chaos Points is on (standalone sFixedMax)' },
];

/* ripple shaders — verbatim from the standalone (qV/sF/dF) */
const RIPPLE_VS = `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
const RIPPLE_SIM_FS = `precision highp float;uniform sampler2D uSt;uniform vec2 uTx;uniform vec2 uMs;uniform float uFo,uRa,uDa,uWc;varying vec2 vUv;void main(){float h=texture2D(uSt,vUv).r,hp=texture2D(uSt,vUv).g;float N=texture2D(uSt,vUv+vec2(0.,uTx.y)).r,S=texture2D(uSt,vUv-vec2(0.,uTx.y)).r,E=texture2D(uSt,vUv+vec2(uTx.x,0.)).r,W=texture2D(uSt,vUv-vec2(uTx.x,0.)).r;float next=2.*h-hp+uWc*(N+S+E+W-4.*h);next*=uDa;vec2 d=vUv-uMs;next+=uFo*exp(-dot(d,d)/(uRa*uRa));gl_FragColor=vec4(clamp(next,-1.,1.),h,0.,1.);}`;
const RIPPLE_DISP_FS = `precision highp float;uniform sampler2D uSc,uWv;uniform vec2 uTx;uniform float uSt;varying vec2 vUv;void main(){vec2 t=uTx*2.;float dx=texture2D(uWv,vUv+vec2(t.x,0.)).r-texture2D(uWv,vUv-vec2(t.x,0.)).r,dy=texture2D(uWv,vUv+vec2(0.,t.y)).r-texture2D(uWv,vUv-vec2(0.,t.y)).r;vec4 col=texture2D(uSc,vUv+vec2(dx,-dy)*uSt);float h=texture2D(uWv,vUv).r;col.rgb+=max(h,0.)*.09;col.rgb-=max(-h,0.)*.04;gl_FragColor=vec4(col.rgb,1.);}`;
const RIPPLE_SIM = 512;

const TEXT_MODES = [null, 'nums', 'letters', 'tmix'] as const;

/* L7b — colour palette. The number/boolean ParamSchema can't carry a hex, so
 * the standalone's colour pickers (trackerColor/connColor/vfxColor) become enum
 * indices into this curated palette. Index 0/1/2 are the standalone defaults
 * (#ffffff tracker · #0011ff conn · #00ff88 vfx); 3 is the app accent violet. */
const PALETTE = ['#ffffff', '#0011ff', '#00ff88', '#8b5cf6', '#22d3ee', '#ef4444', '#f59e0b', '#22c55e', '#e879f9', '#000000'] as const;
const pal = (i: number): string => PALETTE[Math.max(0, Math.min(PALETTE.length - 1, i | 0))];

/* L7c — fixed-points chaos engine per-point state (standalone _initFpState,
 * L5482). Shapes 0-4 map to SHAPES with 4='mix' (per-index); styles 0-3. */
interface FpState {
  jx: number; jy: number; jvx: number; jvy: number;
  w: number; h: number; wv: number; hv: number;
  myShape: number; myConnStyle: number;
  myFadeIn: number; myFadeOut: number; myJitterScale: number; myWobble: number;
  myInvert: boolean; myThermal: boolean; mySecurity: boolean; myLiquid: boolean; myGlitch: boolean; myData: boolean;
  alpha: number; alive: boolean; timer: number; lifeDur: number; fadeIn: number; fadeOut: number;
  shapeTimer: number; fxTimer: number;
}
interface FpBlob {
  cx: number; cy: number; x: number; y: number; w: number; h: number; area: number;
  fpAlpha: number; myShape: number;
  myInvert: boolean; myThermal: boolean; mySecurity: boolean; myLiquid: boolean; myGlitch: boolean; myData: boolean;
}

/* SYNTECH-BODY-START ── DETECT (LUMA / MOTION / BODY) + Body section (face / hands / body).
   Port of the standalone's SYNTECH-BODY block (public/effects/blob_tracker/index.html):
   _motionDetect / _trkUpdate / findBlobs(bin,minCirc) / _bodyBlobs / _bodyMask / _bodyTick /
   _bodyIngest / _bodyStep / _bodySceneCut / _bodyDraw. The landmarker models live in the shared
   BodyLandmarks service (src/engine/BodyLandmarks.ts). "Display space" — the standalone mirrors the
   webcam on screen and runs MOTION/BODY mirrored to match; the chain never mirrors the webcam, its
   display mirror is the Mirror Video param (mirrorBg), so that is the mirror used here. */
type DetMode = 'luma' | 'motion' | 'body';
interface DBlob { x: number; y: number; w: number; h: number; cx: number; cy: number; area: number; kind?: string }
interface BodySet { id: number; pts: Float32Array; tgt: Float32Array; fresh: boolean; seen: number; side: string; c: [number, number] }
interface BodySt { sets: BodySet[]; n: number; last: number; vt: number; img: unknown; imgRuns: number; wasOn: boolean; gen: number; fails: number }
interface Track { id: number; x: number; y: number; w: number; h: number; cx: number; cy: number; area: number; kind?: string; miss: number; hits: number }
const BODY_KEY: Record<BodyKind, string> = { face: 'bodyFace', hands: 'bodyHands', pose: 'bodyPose' };
const BODY_POSE_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
const BODY_TIPS = [4, 8, 12, 16, 20];
const M_N = PW * PH, G_W = PW >> 2, G_H = PH >> 2;
/* SYNTECH-BODY-END */

/* ═══ L6 — three.js PANELS scene (standalone DEFS/PLBLS/VS/FS/SimplexNoise,
   L2482-2500). A FIXED 8-panel 3D montage of the video shown as floating
   planes with fake "AI analysis" labels. Verbatim data + shaders. ═══ */
interface PanelDef { u: number; v: number; uw: number; uh: number; w: number; h: number; ox: number; oy: number; oz: number; rx: number; ry: number; rz: number; }
const PANEL_DEFS: PanelDef[] = [
  { u: .15, v: .15, uw: .5, uh: .55, w: 2.8, h: 3.2, ox: .1, oy: .3, oz: 0, rx: -.06, ry: .08, rz: .03 },
  { u: .55, v: .05, uw: .42, uh: .38, w: 2.2, h: 2.0, ox: 1.8, oy: 1.0, oz: -.6, rx: .10, ry: -.18, rz: -.04 },
  { u: .5, v: .52, uw: .48, uh: .45, w: 2.4, h: 2.3, ox: 1.5, oy: -1.2, oz: -.8, rx: -.08, ry: -.15, rz: .06 },
  { u: .02, v: .1, uw: .2, uh: .65, w: 1.1, h: 3.5, ox: -1.9, oy: 0, oz: -.5, rx: .05, ry: .20, rz: -.05 },
  { u: .05, v: .62, uw: .35, uh: .35, w: 1.8, h: 1.9, ox: -1.3, oy: -1.8, oz: -.3, rx: .12, ry: .10, rz: .08 },
  { u: .3, v: .02, uw: .28, uh: .2, w: 1.5, h: 1.1, ox: .3, oy: 2.1, oz: -1.0, rx: -.15, ry: .05, rz: -.10 },
  { u: .6, v: .58, uw: .35, uh: .38, w: 1.7, h: 1.8, ox: 2.1, oy: -.2, oz: -1.5, rx: 0, ry: -.25, rz: .03 },
  { u: .08, v: .75, uw: .55, uh: .22, w: 2.9, h: 1.2, ox: -.2, oy: -2.3, oz: -.7, rx: .20, ry: .05, rz: .02 },
];
const PANEL_LBLS: { tag: string; score: number }[] = [
  { tag: 'Fibrous Mesh', score: 93 }, { tag: 'Translucent Edges', score: 76 },
  { tag: 'Neural Density', score: 89 }, { tag: 'Surface Topology', score: 71 },
  { tag: 'Chromatic Layer', score: 84 }, { tag: 'Organic Pattern', score: 67 },
  { tag: 'Edge Detection', score: 91 }, { tag: 'Depth Channel', score: 78 },
];
const PANEL_VS = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const PANEL_FS = `uniform sampler2D map;uniform vec4 uvRect;uniform float opacity;uniform float mirrorU;varying vec2 vUv;void main(){float u=mirrorU>0.5?1.0-vUv.x:vUv.x;vec2 uv=uvRect.xy+vec2(u,vUv.y)*uvRect.zw;vec4 c=texture2D(map,uv);float vx=smoothstep(0.,.04,vUv.x)*smoothstep(1.,.96,vUv.x),vy=smoothstep(0.,.04,vUv.y)*smoothstep(1.,.96,vUv.y);c.a*=vx*vy*opacity;gl_FragColor=c;}`;

/* SimplexNoise (standalone L2482-2484, seeded from Math.random per instance) —
 * verbatim math; drives the per-panel float/rotation + the label score jitter. */
class SimplexNoise {
  private perm: number[] = [];
  private grad3 = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
  constructor() {
    const p: number[] = [];
    for (let i = 0; i < 256; i++) p[i] = Math.floor(Math.random() * 256);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  private dot(g: number[], x: number, y: number, z: number): number { return g[0] * x + g[1] * y + g[2] * z; }
  noise(xin: number, yin: number, zin: number): number {
    const G3 = 1 / 6, F3 = 1 / 3;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    let i1 = 0, j1 = 0, k1 = 0, i2 = 0, j2 = 0, k2 = 0;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    const gi0 = this.perm[ii + this.perm[jj + this.perm[kk]]] % 12;
    const gi1 = this.perm[ii + i1 + this.perm[jj + j1 + this.perm[kk + k1]]] % 12;
    const gi2 = this.perm[ii + i2 + this.perm[jj + j2 + this.perm[kk + k2]]] % 12;
    const gi3 = this.perm[ii + 1 + this.perm[jj + 1 + this.perm[kk + 1]]] % 12;
    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0; if (t0 < 0) n0 = 0; else { t0 *= t0; n0 = t0 * t0 * this.dot(this.grad3[gi0], x0, y0, z0); }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1; if (t1 < 0) n1 = 0; else { t1 *= t1; n1 = t1 * t1 * this.dot(this.grad3[gi1], x1, y1, z1); }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2; if (t2 < 0) n2 = 0; else { t2 *= t2; n2 = t2 * t2 * this.dot(this.grad3[gi2], x2, y2, z2); }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3; if (t3 < 0) n3 = 0; else { t3 *= t3; n3 = t3 * t3 * this.dot(this.grad3[gi3], x3, y3, z3); }
    return 32 * (n0 + n1 + n2 + n3);
  }
}

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
  // L3b smart-contour mask (from the shared PersonMask, downscaled to PW×PH)
  private ctSmartMask: Uint8Array | null = null;
  private ctSmartMaskV = -1;
  private ctSmartMaskMir = false; // SYNTECH-BODY: mask mirrored into display space (Mirror Video on)
  private smartMaskCv!: HTMLCanvasElement; private smartMaskCtx!: CanvasRenderingContext2D;
  // L7c fixed-points chaos engine (points auto-placed in dc space)
  private fpPoints: { x: number; y: number }[] = [];
  private fpStates: FpState[] = [];
  private fpOverlaps: { cx: number; cy: number; w: number; h: number; alpha: number; fadeOut: number; shape: number }[] = [];
  private fpGlobalPhase = 0;
  private fpW = 0; private fpH = 0;
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
  // L6 panels (three.js) — a SECOND offscreen THREE.WebGLRenderer (transparent)
  private pRenderer: THREE.WebGLRenderer | null = null;
  private pCanvas: HTMLCanvasElement | null = null;
  private pCamera: THREE.PerspectiveCamera | null = null;
  private pScene: THREE.Scene | null = null;
  private pTex: THREE.Texture | null = null;
  private pMeshes: { mesh: THREE.Mesh; bp: THREE.Vector3; br: THREE.Euler; no: THREE.Vector3; snOff: number; baseScore: number }[] = [];
  private pInited = false;
  private panelsT = 0;
  private motionEnergy = 0;
  private sn = new SimplexNoise();
  private camT = { x: 0, y: 0 };
  private camC = { x: 0, y: 0 };
  private _pv = new THREE.Vector3(); // scratch for screen projection

  // L7b: resolved each render() from the palette-enum params (trackerColorIdx /
  // connColorIdx); the standalone defaults (#ffffff / #0011ff) are the initial
  // values, used by every marker/contour/connection/panel overlay.
  private trackerColor = '#ffffff';
  private connColor = '#0011ff';

  /* SYNTECH-BODY-START — DETECT + Body state (standalone _body / _trk / _m* globals) */
  private detPrev: DetMode | '' = '';
  private bodyAcq = false;
  private body: Record<BodyKind, BodySt> = {
    face: { sets: [], n: 0, last: -99, vt: -1, img: null, imgRuns: 0, wasOn: false, gen: -1, fails: -1 },
    hands: { sets: [], n: 0, last: -99, vt: -1, img: null, imgRuns: 0, wasOn: false, gen: -1, fails: -1 },
    pose: { sets: [], n: 0, last: -99, vt: -1, img: null, imgRuns: 0, wasOn: false, gen: -1, fails: -1 },
  };
  private bodyTickN = 0;
  private bodyNextAt = 0;
  private bodyNextId = 1;
  private cutCv: HTMLCanvasElement | null = null; private cutCtx: CanvasRenderingContext2D | null = null;
  private cutPrev: { g: Float32Array; sd: number } | null = null;
  private cutSrc: string | null = null;
  private bmCv: HTMLCanvasElement | null = null; private bmCtx: CanvasRenderingContext2D | null = null;
  private bmBin = new Uint8Array(M_N);
  private detNoBin = new Uint8Array(M_N);
  // MOTION detect buffers (standalone _mG/_mH/_mCur/_mPrev/_mE/_mE2/_mBin/_mDil/_mT/_gA/_gB)
  private mG = new Uint8Array(M_N); private mH = new Uint16Array(M_N); private mCur = new Uint8Array(M_N); private mPrev = new Uint8Array(M_N);
  private mE = new Uint8Array(M_N); private mE2 = new Uint8Array(M_N); private mBin = new Uint8Array(M_N); private mDil = new Uint8Array(M_N); private mT = new Uint8Array(M_N);
  private gA = new Uint8Array(G_W * G_H); private gB = new Uint8Array(G_W * G_H);
  private mHas = false; private mKey = ''; private mLast: DBlob[] = []; private mShift: [number, number] = [0, 0]; private mFrac = 0;
  // MOTION / BODY temporal tracking (standalone _trk)
  private trk: { mode: string; key: string; tracks: Track[]; nextId: number } = { mode: '', key: '', tracks: [], nextId: 1 };
  /* SYNTECH-BODY-END */

  constructor() {
    PARAMS.forEach((p) => { this.v[p.key] = Number(p.value); });
  }

  setParam(key: string, value: unknown): void {
    const n = Number(value);
    if (isNaN(n)) return;
    // SYNTECH-BODY: switching DETECT to BODY with no detector on turns the skeleton on (standalone _detSet)
    if (key === 'detect' && Math.round(n) === 2 && Math.round(this.v.detect) !== 2 &&
        !BODY_KINDS.some((k) => this.v[BODY_KEY[k]] >= 0.5)) this.v.bodyPose = 1;
    this.v[key] = n;
  }

  getParam(key: string): unknown {
    // L3b: smart contour (ctMode=2) sources the shared PersonMask, so report
    // segEnabled ON in smart mode — the shell lazy-loads the segmenter exactly
    // as the standalone's ct-smart button triggers _loadMediaPipe. Not a
    // visible param (the standalone has no separate seg-enable control).
    if (key === 'segEnabled') return this.v.ctMode >= 1.5 ? 1 : 0;
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
    [this.smartMaskCv, this.smartMaskCtx] = mk(true);
    this.procCv.width = PW; this.procCv.height = PH;
    this.motionCv.width = 64; this.motionCv.height = 36;
    this.smartMaskCv.width = PW; this.smartMaskCv.height = PH;

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

  // SYNTECH-BODY: optional minCirc (MOTION relaxes it); LUMA calls findBlobs(bin) → 0.15 as before
  private findBlobs(bin: Uint8Array, minCirc?: number): { x: number; y: number; w: number; h: number; cx: number; cy: number; area: number }[] {
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
      if ((4 * Math.PI * area) / (per * per) < (minCirc === undefined ? 0.15 : minCirc)) continue;
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

  /* L3b: rebuild the PW×PH smart-contour binary from the shared PersonMask
   * (person confidence is in the mask ALPHA — the same channel bokeh/anamorphic
   * read), refreshed once per new segmentation arrival (personMaskVersion),
   * cached between arrivals like the standalone's send-every-N staleness.
   * Returns the cached mask, or null if none has been built yet (→ edge). */
  private refreshSmartMask(ctx: NodeRenderContext, mirror = false): Uint8Array | null {
    if (ctx.personMask && (ctx.personMaskVersion !== this.ctSmartMaskV || mirror !== this.ctSmartMaskMir)) {
      this.ctSmartMaskV = ctx.personMaskVersion;
      this.ctSmartMaskMir = mirror;
      if (!this.ctSmartMask) this.ctSmartMask = new Uint8Array(PW * PH);
      try {
        this.smartMaskCtx.clearRect(0, 0, PW, PH);
        // SYNTECH-BODY hook (standalone _bodySegMirror): detection runs in the mirrored display space → mirror the mask too
        if (mirror) { this.smartMaskCtx.save(); this.smartMaskCtx.setTransform(-1, 0, 0, 1, PW, 0); this.smartMaskCtx.drawImage(ctx.personMask as CanvasImageSource, 0, 0, PW, PH); this.smartMaskCtx.restore(); }
        else this.smartMaskCtx.drawImage(ctx.personMask as CanvasImageSource, 0, 0, PW, PH);
        const d = this.smartMaskCtx.getImageData(0, 0, PW, PH).data, m = this.ctSmartMask;
        for (let i = 0; i < PW * PH; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0;
      } catch { /* mask not ready */ }
    }
    return this.ctSmartMask;
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

  /* ── L6 panels scene (standalone initPanels/panelsAnimate, three.js). A FIXED
   *    8-panel 3D montage of the video shown as floating planes. Rendered on its
   *    own offscreen THREE.WebGLRenderer (transparent) and composited OVER dc in
   *    2D; the labels + connector lines are drawn INTO dc via Canvas-2D at the
   *    projected positions (operator decision — functionally equivalent to the
   *    standalone's HTML p-lbl divs + SVG svg-lines, not pixel-identical). The
   *    autoMode / AR / VR panel driving is deferred to L7 (non-auto branch only
   *    here). ── */
  private initPanels(): void {
    if (this.pInited) return;
    this.pInited = true;
    const cv = document.createElement('canvas');
    cv.width = Math.max(2, this.w); cv.height = Math.max(2, this.h);
    this.pCanvas = cv;
    const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1); renderer.setSize(cv.width, cv.height, false); renderer.setClearColor(0x000000, 0);
    this.pRenderer = renderer;
    this.pScene = new THREE.Scene();
    this.pCamera = new THREE.PerspectiveCamera(55, cv.width / cv.height, 0.1, 100);
    this.pCamera.position.set(0, 0, this.v.panelCamZ);
    // one THREE.Texture wraps ctx.source (updated per frame in render) — matches
    // the standalone's THREE.VideoTexture(vidEl); NPOT-safe filters, no mipmaps
    this.pTex = new THREE.Texture();
    this.pTex.minFilter = THREE.LinearFilter; this.pTex.magFilter = THREE.LinearFilter; this.pTex.generateMipmaps = false;
    PANEL_DEFS.forEach((d, i) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: this.pTex }, uvRect: { value: new THREE.Vector4(d.u, d.v, d.uw, d.uh) }, opacity: { value: 1 }, mirrorU: { value: 0 } },
        vertexShader: PANEL_VS, fragmentShader: PANEL_FS, transparent: true, side: THREE.FrontSide, depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), mat);
      mesh.position.set(d.ox, d.oy, d.oz); mesh.rotation.set(d.rx, d.ry, d.rz);
      this.pScene!.add(mesh);
      this.pMeshes.push({ mesh, bp: new THREE.Vector3(d.ox, d.oy, d.oz), br: new THREE.Euler(d.rx, d.ry, d.rz), no: new THREE.Vector3(i * 3.7, i * 2.1, i * 5.3), snOff: i * 7.31, baseScore: PANEL_LBLS[i].score });
    });
  }

  private projScreen(p: THREE.Vector3): { x: number; y: number; v: boolean } {
    this._pv.copy(p).project(this.pCamera!);
    return { x: (this._pv.x * 0.5 + 0.5) * this.w, y: (-this._pv.y * 0.5 + 0.5) * this.h, v: this._pv.z < 1 };
  }

  private lAnchor(m: THREE.Mesh): { x: number; y: number; v: boolean } {
    const geo = m.geometry as THREE.PlaneGeometry;
    const c = new THREE.Vector3(geo.parameters.width * 0.35, geo.parameters.height * 0.4, 0);
    c.applyMatrix4(m.matrixWorld);
    return this.projScreen(c);
  }

  /* renders the 3D panels scene, then returns the per-panel world centres +
   * projected label/connector screen positions (proc→dc space is 1:1 here) */
  private panelsTick(): { centers: THREE.Vector3[]; pts: { lx: number; ly: number; cx: number; cy: number; v: boolean; score: number; tag: string; idx: number }[] } {
    const r = this.pRenderer!, cam = this.pCamera!, scene = this.pScene!, sn = this.sn;
    if (this.pCanvas && (this.pCanvas.width !== this.w || this.pCanvas.height !== this.h)) {
      this.pCanvas.width = this.w; this.pCanvas.height = this.h; r.setSize(this.w, this.h, false);
      cam.aspect = this.w / this.h; cam.updateProjectionMatrix();
    }
    // motion-energy smoothing (standalone panelsAnimate) — rawEnergy from computeMotion
    this.motionEnergy += (this.rawEnergy - this.motionEnergy) * (this.rawEnergy > this.motionEnergy ? 0.25 : 0.04);
    const padX = this.v.padX, padY = this.v.padThresh;
    const chaosBoost = padX * padX, energyMult = 1 + this.motionEnergy * 7 + chaosBoost * 3;
    const turb = this.v.panelTurb;
    this.panelsT += 0.0012 * energyMult * turb;
    const PA = (0.35 + this.motionEnergy * 1.65 + chaosBoost * 0.8) * turb;
    const RA = (0.05 + this.motionEnergy * 0.12 + chaosBoost * 0.06) * turb;
    const scaleV = this.v.panelScale, mir = this.v.mirrorPanels >= 0.5 ? 1.0 : 0.0;
    for (const pm of this.pMeshes) {
      const { mesh, bp, br, no } = pm;
      mesh.position.set(
        bp.x + sn.noise(this.panelsT + no.x, 0, 0) * PA,
        bp.y + sn.noise(0, this.panelsT * 0.9 + no.y, 0) * PA * 0.8,
        bp.z + sn.noise(0, 0, this.panelsT * 0.7 + no.z) * PA * 0.3,
      );
      mesh.rotation.set(
        br.x + sn.noise(this.panelsT * 0.6 + no.x + 10, 0, 0) * RA,
        br.y + sn.noise(0, this.panelsT * 0.6 + no.y + 10, 0) * RA,
        br.z + sn.noise(0, 0, this.panelsT * 0.6 + no.z + 10) * RA * 0.5,
      );
      mesh.scale.setScalar(scaleV);
      const u = (mesh.material as THREE.ShaderMaterial).uniforms;
      u.opacity.value = padY; u.mirrorU.value = mir;
    }
    const targetZ = this.v.panelCamZ - chaosBoost * 4;
    this.camT.x = sn.noise(this.panelsT * 0.28, 0, 0) * 0.6;
    this.camT.y = sn.noise(0, this.panelsT * 0.22, 0) * 0.4;
    const cLag = 0.018 + this.motionEnergy * 0.04;
    this.camC.x += (this.camT.x - this.camC.x) * cLag; this.camC.y += (this.camT.y - this.camC.y) * cLag;
    cam.position.set(this.camC.x, this.camC.y, targetZ); cam.lookAt(0, 0, 0); scene.updateMatrixWorld();
    r.render(scene, cam);
    // projections for labels/lines (v = label-anchor visibility, standalone)
    const centers = this.pMeshes.map((pm) => new THREE.Vector3().applyMatrix4(pm.mesh.matrixWorld));
    const pts = this.pMeshes.map((pm, i) => {
      const anc = this.lAnchor(pm.mesh), ctr = this.projScreen(centers[i]);
      const score = Math.round(Math.min(99, Math.max(1, pm.baseScore + sn.noise(this.panelsT * 0.4 + pm.snOff, 0, 0) * (12 + this.motionEnergy * 18))));
      return { lx: anc.x, ly: anc.y, cx: ctr.x, cy: ctr.y, v: anc.v, score, tag: PANEL_LBLS[i].tag, idx: i };
    });
    return { centers, pts };
  }

  private rgba(hex: string, a: number): string {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  }

  /* draw the panel labels + label-connector lines + panel-to-panel connections
   * into dc (operator decision: into the texture, not HTML/SVG overlays) */
  private drawPanelOverlay(pts: { lx: number; ly: number; cx: number; cy: number; v: boolean; score: number; tag: string; idx: number }[], centers: THREE.Vector3[]): void {
    const ctx = this.dCtx;
    const labelsOn = this.v.panelsLabels >= 0.5, connLinesOn = this.v.panelsConnLines >= 0.5, padY = this.v.padThresh;
    ctx.save();
    // label → panel connector lines (only when labels + conn-lines visible)
    if (labelsOn && connLinesOn) {
      ctx.strokeStyle = 'rgba(80,120,220,0.35)'; ctx.lineWidth = 0.7; ctx.setLineDash([]);
      pts.forEach((sp) => { if (!sp.v) return; ctx.beginPath(); ctx.moveTo(sp.lx, sp.ly); ctx.lineTo(sp.cx, sp.cy); ctx.stroke(); });
    }
    // panel ↔ panel connections (always, when panels on) — reuse the tracker's
    // connColor / connStyle / connWidth / connOpacity / connGlow, at panel scale
    const cc = this.connColor, co = this.v.connOpacity, cw = this.v.connWidth * 0.08, glow = this.v.connGlow;
    const arrows = CONN_STYLES[this.v.connStyle | 0] === 'arrows';
    for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) {
      if (!pts[a].v || !pts[b].v) continue;
      const d = centers[a].distanceTo(centers[b]);
      const al = (1 - (d - 2.8) / 2.8) * 0.38 * padY;
      if (al <= 0.02) continue;
      const x1 = pts[a].cx, y1 = pts[a].cy, x2 = pts[b].cx, y2 = pts[b].cy;
      ctx.save();
      ctx.strokeStyle = this.rgba(cc, al); ctx.fillStyle = this.rgba(cc, al); ctx.lineWidth = Math.max(0.4, cw);
      if (arrows) {
        ctx.globalAlpha = 1; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        const ang = Math.atan2(y2 - y1, x2 - x1), head = 8;
        ctx.beginPath(); ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(ang - 0.4), y2 - head * Math.sin(ang - 0.4));
        ctx.lineTo(x2 - head * Math.cos(ang + 0.4), y2 - head * Math.sin(ang + 0.4));
        ctx.closePath(); ctx.fill();
      } else {
        ctx.globalAlpha = co;
        switch (CONN_STYLES[this.v.connStyle | 0]) {
          case 'dashed': ctx.setLineDash([12, 6]); break;
          case 'dashdot': ctx.setLineDash([12, 4, 2, 4]); break;
          default: ctx.setLineDash([]); break;
        }
        if (glow > 0) { ctx.shadowBlur = glow * 14; ctx.shadowColor = cc; }
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        if (glow > 0) {
          ctx.shadowBlur = 0; ctx.strokeStyle = `rgba(255,255,255,${(glow * 0.7).toFixed(2)})`;
          ctx.lineWidth = Math.max(0.4, cw * 0.18); ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        }
      }
      ctx.restore();
    }
    // labels last, over everything
    if (labelsOn) pts.forEach((sp) => { if (sp.v) this.drawPanelLabel(ctx, sp); });
    ctx.restore();
  }

  private drawPanelLabel(ctx: CanvasRenderingContext2D, sp: { lx: number; ly: number; score: number; tag: string; idx: number }): void {
    const label = `${sp.idx + 1} ${sp.tag}`, scoreTxt = `${sp.score}%`;
    ctx.save();
    ctx.font = '9px JetBrains Mono, monospace'; ctx.textBaseline = 'middle'; ctx.setLineDash([]);
    const pad = 9, gap = 8, boxH = 15;
    const labelW = ctx.measureText(label).width, scoreW = ctx.measureText(scoreTxt).width;
    const boxW = pad * 2 + labelW + gap + scoreW;
    const bx = sp.lx + 8, by = sp.ly - 18; // standalone p-lbl offset (left+8, top-18)
    ctx.fillStyle = 'rgba(8,6,20,0.88)'; ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = 'rgba(120,100,255,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1);
    const cy = by + boxH / 2;
    ctx.fillStyle = '#a0b8ff'; ctx.fillText(label, bx + pad, cy);
    ctx.fillStyle = '#70a0ff'; ctx.fillText(scoreTxt, bx + pad + labelW + gap, cy);
    ctx.restore();
  }

  /* ── L7c fixed-points chaos engine (standalone _initFpState/_tickFpStates/
   *    _fpBlobsForFrame, L5482-5554). Replaces detection with a fixed set of
   *    animated points; the chain has no mouse, so the points are AUTO-PLACED on
   *    a golden-angle scatter (stable). Each point animates its own jitter/size/
   *    shape/FX/alpha lifecycle; the synthetic blobs feed the existing draw
   *    pipeline via per-blob global swaps (like the standalone). Stochastic ⇒
   *    behavioural. ── */
  private fpInitState(): FpState {
    const startAlive = Math.random() < 0.85;
    return {
      jx: 0, jy: 0, jvx: (Math.random() - .5) * 2, jvy: (Math.random() - .5) * 2,
      w: 30 + Math.random() * 160, h: 25 + Math.random() * 140,
      wv: (Math.random() - .5) * 3, hv: (Math.random() - .5) * 2,
      myShape: Math.floor(Math.random() * 5), myConnStyle: Math.floor(Math.random() * 4),
      myFadeIn: 0.012 + Math.random() * 0.020, myFadeOut: 0.001 + Math.random() * 0.003,
      myJitterScale: 0.5 + Math.random() * 2.5, myWobble: 0.3 + Math.random() * 2.0,
      myInvert: Math.random() < 0.15, myThermal: Math.random() < 0.12,
      mySecurity: Math.random() < 0.10, myLiquid: Math.random() < 0.18,
      myGlitch: Math.random() < 0.50, myData: Math.random() < 0.40,
      alpha: startAlive ? (0.5 + Math.random() * 0.5) : 0, alive: startAlive,
      timer: startAlive ? (900 + Math.round(Math.random() * 3000)) : (Math.round(Math.random() * 120)),
      lifeDur: startAlive ? (900 + Math.round(Math.random() * 3000)) : 0,
      fadeIn: 0.012 + Math.random() * 0.018, fadeOut: 0.001 + Math.random() * 0.003,
      shapeTimer: 300 + Math.round(Math.random() * 1200), fxTimer: 200 + Math.round(Math.random() * 800),
    };
  }

  private fpEnsurePoints(n: number): void {
    if (this.fpPoints.length === n && this.fpW === this.w && this.fpH === this.h) return;
    this.fpW = this.w; this.fpH = this.h;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2.399963, r = 0.14 + 0.34 * Math.sqrt((i + 0.5) / n); // golden-angle scatter
      pts.push({ x: (0.5 + Math.cos(a) * r) * this.w, y: (0.5 + Math.sin(a) * r) * this.h });
    }
    this.fpPoints = pts;
    while (this.fpStates.length < n) this.fpStates.push(this.fpInitState());
    if (this.fpStates.length > n) this.fpStates.length = n;
  }

  private fpTick(): void {
    this.fpGlobalPhase += 0.012;
    // occasional global jolt on the shared reactive params (standalone)
    if (Math.random() < 0.006) { this.v.connWidth = 1 + Math.random() * 3; this.v.datamosh = Math.random() * 22; this.v.glitchAmt = Math.random() * 15; }
    this.v.connWidth = Math.max(1, Math.min(4, this.v.connWidth + (Math.random() - .5) * 1.5));
    this.v.datamosh = Math.max(0, this.v.datamosh + (Math.random() - .5) * 1.0);
    this.v.glitchAmt = Math.max(0, this.v.glitchAmt + (Math.random() - .5) * 0.8);
    this.fpOverlaps = this.fpOverlaps.filter((o) => { o.alpha = Math.max(0, o.alpha - o.fadeOut); return o.alpha > 0.01; });
    this.fpStates.forEach((s, i) => {
      const js = s.myJitterScale;
      s.jvx += (Math.random() - .5) * 2.0 * js; s.jvx *= 0.80; s.jvy += (Math.random() - .5) * 1.6 * js; s.jvy *= 0.80;
      const maxJ = 10 * js; s.jx = Math.max(-maxJ, Math.min(maxJ, s.jx + s.jvx)); s.jy = Math.max(-maxJ, Math.min(maxJ, s.jy + s.jvy));
      const wb = s.myWobble; s.wv += (Math.random() - .5) * 1.4 * wb; s.wv *= 0.86; s.hv += (Math.random() - .5) * 1.1 * wb; s.hv *= 0.86;
      s.w = Math.max(28, Math.min(240, s.w + s.wv)); s.h = Math.max(22, Math.min(200, s.h + s.hv));
      if (--s.shapeTimer <= 0) { s.shapeTimer = 400 + Math.round(Math.random() * 1400); s.myShape = Math.floor(Math.random() * 5); s.myConnStyle = Math.floor(Math.random() * 4); }
      if (--s.fxTimer <= 0) { s.fxTimer = 300 + Math.round(Math.random() * 900); s.myInvert = Math.random() < 0.15; s.myThermal = Math.random() < 0.12; s.mySecurity = Math.random() < 0.10; s.myLiquid = Math.random() < 0.18; s.myGlitch = Math.random() < 0.50; s.myData = Math.random() < 0.40; s.myFadeIn = 0.012 + Math.random() * 0.020; s.myFadeOut = 0.001 + Math.random() * 0.003; }
      if (--s.timer <= 0) {
        s.alive = !s.alive;
        if (s.alive) {
          s.lifeDur = 900 + Math.round(Math.random() * 3000); s.fadeIn = s.myFadeIn; if (Math.random() < 0.06) s.alpha = 0.6;
          if (Math.random() < 0.04 && this.fpPoints[i]) { const pt = this.fpPoints[i]; this.fpOverlaps.push({ cx: pt.x + (Math.random() - .5) * 20, cy: pt.y + (Math.random() - .5) * 16, w: s.w * (0.5 + Math.random() * 0.8), h: s.h * (0.5 + Math.random() * 0.8), alpha: 0.7 + Math.random() * 0.3, fadeOut: 0.003 + Math.random() * 0.006, shape: Math.floor(Math.random() * 5) }); }
        } else { s.timer = 10 + Math.round(Math.random() * 60); s.fadeOut = s.myFadeOut; if (Math.random() < 0.08) s.alpha = 0; }
      }
      if (s.alive) { s.alpha = Math.min(1, s.alpha + s.fadeIn); if (--s.lifeDur <= 0) { s.alive = false; s.timer = 15 + Math.round(Math.random() * 60); } }
      else s.alpha = Math.max(0, s.alpha - s.fadeOut);
    });
  }

  private fpBlobsForFrame(): FpBlob[] {
    const blobs: FpBlob[] = [];
    this.fpStates.forEach((s, i) => {
      if (s.alpha <= 0.001) return;
      const pt = this.fpPoints[i]; if (!pt) return;
      blobs.push({ cx: pt.x + s.jx, cy: pt.y + s.jy, x: pt.x + s.jx - s.w / 2, y: pt.y + s.jy - s.h / 2, w: s.w, h: s.h, area: Math.round(s.w * s.h * 0.78), fpAlpha: s.alpha, myShape: s.myShape, myInvert: s.myInvert, myThermal: s.myThermal, mySecurity: s.mySecurity, myLiquid: s.myLiquid, myGlitch: s.myGlitch, myData: s.myData });
    });
    this.fpOverlaps.forEach((o) => blobs.push({ cx: o.cx, cy: o.cy, x: o.cx - o.w / 2, y: o.cy - o.h / 2, w: o.w, h: o.h, area: Math.round(o.w * o.h * 0.78), fpAlpha: o.alpha, myShape: o.shape, myInvert: false, myThermal: false, mySecurity: false, myLiquid: false, myGlitch: true, myData: false }));
    return blobs;
  }

  /* draws the chaos blobs through the existing pipeline via per-blob global
   * swaps (standalone trackerFrame fixedPtsMode branch). */
  private fpRender(src: TexImageSource): void {
    this.fpEnsurePoints(Math.max(1, Math.min(10, this.v.fixedMaxPts | 0)));
    this.fpTick();
    this.ctContours = []; // no contours in chaos mode → markers stay rectangles
    const fpBlobs = this.fpBlobsForFrame();
    const bScale = this.v.blobScale, bShape = this.v.blobShape, bInv = this.v.fxInvert, bTh = this.v.fxThermal, bSec = this.v.fxSecurity, bLiq = this.v.fxLiquid, bGl = this.v.fxGlitch, bData = this.v.fxData;
    fpBlobs.forEach((b, i) => {
      this.v.blobShape = b.myShape; this.v.blobScale = bScale * b.fpAlpha;
      this.v.fxInvert = b.myInvert ? 1 : 0; this.v.fxThermal = b.myThermal ? 1 : 0; this.v.fxSecurity = b.mySecurity ? 1 : 0;
      this.v.fxLiquid = b.myLiquid ? 1 : 0; this.v.fxGlitch = b.myGlitch ? 1 : 0; this.v.fxData = b.myData ? 1 : 0;
      this.drawFxInBlob(b, 1, 1, i); this.drawTextFill(b, 1, 1, i); this.drawBlobMarker(b, 1, 1, i);
    });
    this.v.blobShape = bShape; this.v.blobScale = bScale; this.v.fxInvert = bInv; this.v.fxThermal = bTh; this.v.fxSecurity = bSec; this.v.fxLiquid = bLiq; this.v.fxGlitch = bGl; this.v.fxData = bData;
    const cw = this.v.connWidth; this.v.connWidth = Math.min(this.v.connWidth, 4);
    this.drawConnections(fpBlobs); this.v.connWidth = cw;
    this.computeMotion(src);
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
    dCtx.fillStyle = this.v.vfxColorOn >= 0.5 ? pal(this.v.vfxColorIdx) : (colMap[textFillMode] || '#ffffff');
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
      dCtx.fillStyle = this.v.vfxColorOn >= 0.5 ? pal(this.v.vfxColorIdx) : (colMap[textFillMode] || '#ffffff');
      dCtx.globalAlpha = 0.6 * op; dCtx.globalCompositeOperation = 'screen';
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++)
        dCtx.fillText(chars[Math.floor(Math.random() * chars.length)], col * cw, (row + 1) * fs);
      dCtx.restore();
    }
  }

  /* SYNTECH-BODY-START ═══════════════════════════════════════════════════════
     DETECT (LUMA / MOTION / BODY) + Body section — 1:1 port of the standalone's
     SYNTECH-BODY block. LUMA = the original processForDetect/getBinary/findBlobs
     path, untouched. MOTION = blobs on moving pixels (frame difference, camera-pan
     compensated). BODY = one blob per face / hand / person box from the landmarks.
     MOTION and BODY blobs are tracked over time (nearest-centre match, EMA, short
     hold). The face / hands / skeleton overlays are drawn into dc.
     ═══════════════════════════════════════════════════════════════════════════ */
  private bodyOn(k: BodyKind): boolean { return this.v[BODY_KEY[k]] >= 0.5; }
  private static isImg(src: TexImageSource): boolean { return typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement; }
  private static isCam(src: TexImageSource): boolean { return src instanceof HTMLVideoElement && !!src.srcObject; }
  /** source identity — the standalone's srcMode + current file/image/webcam key */
  private srcKey(src: TexImageSource): string {
    if (BlobTrackerNode.isImg(src)) return 'image|' + (src as HTMLImageElement).src;
    if (src instanceof HTMLVideoElement) return src.srcObject ? 'webcam|cam' : 'video|' + src.currentSrc;
    return 'other|';
  }
  private detMode(): DetMode { const d = Math.round(this.v.detect); return d <= 0 ? 'luma' : d >= 2 ? 'body' : 'motion'; }
  // still image: no motion → LUMA (standalone _detEffMode)
  private detEffMode(src: TexImageSource): DetMode { const m = this.detMode(); return (m === 'motion' && BlobTrackerNode.isImg(src)) ? 'luma' : m; }

  /* ── Body: per-frame scheduler (standalone _bodyTick): pose every frame alone / every 2nd,
        hands every 2nd, face every 3rd — most-overdue first, ~10 ms budget, duty cycle ≤ ~60% ── */
  private bodyTick(src: TexImageSource): void {
    const svc = bodyLandmarks;
    for (const k of BODY_KINDS) {
      const st = this.body[k], on = this.bodyOn(k);
      if (on !== st.wasOn) { // toggle edge (standalone _bodySetOn)
        st.wasOn = on; st.img = null; st.imgRuns = 0; st.vt = -1;
        if (!on) { st.sets = []; st.n = 0; st.fails = -1; }
      }
      if (!on) continue;
      if (!this.bodyAcq) { svc.acquire(); this.bodyAcq = true; }
      const f = svc.failures(k);
      if (st.fails >= 0 && f > st.fails) { // load failed → toggle back off (standalone: LED off)
        this.v[BODY_KEY[k]] = 0; st.wasOn = false; st.sets = []; st.n = 0; st.fails = -1;
        continue;
      }
      if (st.fails < 0) st.fails = f;
      svc.ensure(k);
      const g = svc.generation(k);
      if (g !== st.gen) { st.gen = g; st.last = -99; st.vt = -1; st.img = null; st.imgRuns = 0; } // (re)loaded model
    }
    const act = BODY_KINDS.filter((k) => this.bodyOn(k) && svc.state(k) === 'ready');
    if (!act.length) return;
    this.bodyTickN++;
    const now = performance.now();
    const isImg = BlobTrackerNode.isImg(src);
    if (this.bodySceneCut(src)) {
      // VIDEO-mode landmarkers keep tracking the old ROI across a cut (loop, seek, new source) → feed one blank
      // frame so they drop it and re-detect on the next real frame; forget the old sets too.
      for (const k of act) { const st = this.body[k]; svc.cutReset(k); st.sets = []; st.n = 0; st.last = -99; st.vt = -1; st.img = null; }
    }
    if (now >= this.bodyNextAt) {
      const vt = (!isImg && src instanceof HTMLVideoElement && !src.srcObject) ? src.currentTime : -1, alone = act.length === 1;
      const cand: [number, BodyKind][] = [];
      for (const k of act) {
        const st = this.body[k];
        if (isImg) { if (st.img !== src) { st.img = src; st.imgRuns = 0; } if (st.imgRuns >= 3) continue; } // a still image converges in 3 runs → hold
        else { st.img = null; if (vt >= 0 && vt === st.vt) continue; }                                     // same video frame already analysed
        const iv = alone ? 1 : (k === 'face' ? 3 : 2), due = (this.bodyTickN - st.last) / iv;
        if (due >= 1) cand.push([due + (k === 'pose' ? 0.02 : k === 'hands' ? 0.01 : 0), k]);
      }
      cand.sort((a, b) => b[0] - a[0]);
      let spent = 0;
      for (const [, k] of cand) {
        if (spent > 10) break;
        const st = this.body[k], t0 = performance.now();
        const r = svc.detect(k, src);
        if (r) this.bodyIngest(k, r, isImg);
        spent += performance.now() - t0;
        st.last = this.bodyTickN; st.vt = vt; if (isImg) st.imgRuns++;
      }
      if (spent > 0) this.bodyNextAt = performance.now() + spent * 0.6;
    }
    this.bodyStep(isImg);
  }

  // Results → landmark sets matched to the previous ones (stable order, smoothed in bodyStep) — standalone _bodyIngest
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw tasks-vision result
  private bodyIngest(kind: BodyKind, r: any, snap: boolean): void {
    type E = { pts: { x: number; y: number; z?: number; visibility?: number }[]; side?: string; c?: [number, number] };
    let list: E[] = [];
    if (kind === 'pose') list = ((r && r.landmarks) || []).map((p: E['pts']) => ({ pts: p }));
    else if (kind === 'face') list = ((r && r.faceLandmarks) || []).map((p: E['pts']) => ({ pts: p }));
    else {
      const hd = (r && (r.handedness || r.handednesses)) || [];
      // MediaPipe labels handedness for a mirrored (selfie) input; we feed the raw frame → swap to the performer's real side
      const W = this.w || 16, H = this.h || 9;
      list = ((r && r.landmarks) || []).map((p: E['pts'], i: number) => {
        const c = hd[i] && hd[i][0]; const nm = c ? (c.categoryName || c.displayName || '') : '';
        return { pts: p, side: nm === 'Left' ? 'R' : nm === 'Right' ? 'L' : '' };
      }).filter((e: E) => {
        const p = e.pts; if (p.length < 21) return false;
        let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
        for (const q of p) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
        return Math.hypot((p[0].x - p[9].x) * W, (p[0].y - p[9].y) * H) >= 0.2 * Math.max((x1 - x0) * W, (y1 - y0) * H); // collapsed (degenerate) hand → drop
      });
    }
    if (kind === 'pose' && list.length) list = this.bodyPoseFilter(list);
    const st = this.body[kind]; st.n = list.length;
    const prev = st.sets, used = new Uint8Array(prev.length), pairs: [number, number, number][] = [];
    list.forEach((e, i) => {
      let sx = 0, sy = 0; for (const p of e.pts) { sx += p.x; sy += p.y; } e.c = [sx / e.pts.length, sy / e.pts.length];
      prev.forEach((s, j) => { const d = Math.hypot(e.c![0] - s.c[0], e.c![1] - s.c[1]); if (d < 0.25) pairs.push([d, i, j]); });
    });
    pairs.sort((a, b) => a[0] - b[0]);
    const li = new Array(list.length).fill(-1);
    for (const [, i, j] of pairs) { if (li[i] >= 0 || used[j]) continue; li[i] = j; used[j] = 1; }
    const out: BodySet[] = [];
    list.forEach((e, i) => {
      const n = e.pts.length; let s: BodySet | null = li[i] >= 0 ? prev[li[i]] : null;
      if (!s || s.pts.length !== n * 3) s = { id: this.bodyNextId++, pts: new Float32Array(n * 3), tgt: new Float32Array(n * 3), fresh: true, seen: 0, side: '', c: [0, 0] };
      s.seen = performance.now(); s.side = e.side || ''; s.c = e.c!;
      for (let q = 0; q < n; q++) {
        const p = e.pts[q]; s.tgt[q * 3] = p.x; s.tgt[q * 3 + 1] = p.y;
        // tasks-vision 0.10.3 gives pose points no visibility → a point predicted outside the frame counts as hidden
        let v = 1; if (kind === 'pose') { if (p.x < -0.02 || p.x > 1.02 || p.y < -0.02 || p.y > 1.02) v = 0; else if (typeof p.visibility === 'number') v = p.visibility; }
        s.tgt[q * 3 + 2] = v;
      }
      if (kind === 'pose' && n >= 33) { // hips collapsed onto the shoulders = hallucinated lower body (half-body framing) → hide 23..32
        const t = s.tgt, sw = Math.hypot(t[33] - t[36], t[34] - t[37]), tl = Math.hypot((t[33] + t[36] - t[69] - t[72]) / 2, (t[34] + t[37] - t[70] - t[73]) / 2);
        if (tl < 0.6 * sw) for (let q = 23; q < 33; q++) t[q * 3 + 2] = 0;
      }
      if (s.fresh || snap) { s.pts.set(s.tgt); s.fresh = false; }
      out.push(s);
    });
    const now = performance.now(); prev.forEach((s, j) => { if (!used[j] && now - s.seen < 160) out.push(s); }); // bridge a missed inference (no flicker), never a scene change
    out.sort((a, b) => a.id - b.id);
    st.sets = out;
  }

  // The lite pose model sometimes "sees" tiny bodies inside a close-up hand, or the same person twice:
  // drop duplicates (bbox IoU > .45, keep the larger) and bodies no bigger than a detected hand lying on it.
  private bodyPoseFilter<T extends { pts: { x: number; y: number }[] }>(list: T[]): T[] {
    const bb = (e: T): number[] | null => {
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (const p of e.pts) { if (p.x < -0.02 || p.x > 1.02 || p.y < -0.02 || p.y > 1.02) continue; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
    };
    const area = (b: number[]) => (b[2] - b[0]) * (b[3] - b[1]);
    const inter = (a: number[], b: number[]) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const hands = this.bodyOn('hands') ? this.body.hands.sets.map((s) => this.bodyBox(s, 0)).filter((b): b is number[] => !!b) : [];
    const L = list.map((e) => ({ e, b: bb(e) })).filter((o): o is { e: T; b: number[] } => !!o.b).sort((p, q) => area(q.b) - area(p.b)), keep: { e: T; b: number[] }[] = [];
    for (const o of L) {
      const a = area(o.b);
      if (keep.some((k) => { const i = inter(o.b, k.b); return i / (a + area(k.b) - i) > 0.45; })) continue;
      if (hands.some((h) => a <= 1.5 * area(h) && inter(o.b, h) > 0.6 * a)) continue;
      keep.push(o);
    }
    return keep.map((o) => o.e);
  }

  private bodyStep(isImg: boolean): void {
    const a = isImg ? 1 : 0.6;
    for (const k of BODY_KINDS) {
      if (!this.bodyOn(k)) continue;
      for (const s of this.body[k].sets) { const p = s.pts, t = s.tgt; for (let i = 0; i < p.length; i++) p[i] += (t[i] - p[i]) * a; }
    }
  }

  // Hard-cut detector on a 32×18 thumbnail. It looks at STRUCTURE, not brightness: Pearson correlation of the
  // mean-centred frame with the last structured one (gain/offset-invariant → strobes, flashes and exposure pumps are
  // not cuts); a flat frame (white flash / black) carries no structure → never a cut and never the new reference.
  private bodySceneCut(src: TexImageSource): boolean {
    if (!this.cutCv) { this.cutCv = document.createElement('canvas'); this.cutCv.width = 32; this.cutCv.height = 18; this.cutCtx = this.cutCv.getContext('2d', { willReadFrequently: true }); }
    const cx = this.cutCtx!;
    try { cx.drawImage(src as CanvasImageSource, 0, 0, 32, 18); } catch { return false; }
    const d = cx.getImageData(0, 0, 32, 18).data, g = new Float32Array(576);
    let m = 0; for (let i = 0; i < 576; i++) { g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; m += g[i]; } m /= 576;
    let v = 0; for (let i = 0; i < 576; i++) { g[i] -= m; v += g[i] * g[i]; } const sd = Math.sqrt(v / 576);
    const key = this.srcKey(src);
    const switched = (this.cutSrc !== null && this.cutSrc !== key); this.cutSrc = key; // video ↔ webcam, new image or new video file
    if (switched) { this.cutPrev = sd >= 6 ? { g, sd } : null; return true; }
    if (sd < 6) return false;
    let cut = false;
    if (this.cutPrev) { let c = 0; const p = this.cutPrev.g; for (let i = 0; i < 576; i++) c += g[i] * p[i]; cut = c / (576 * sd * this.cutPrev.sd) < 0.35; }
    this.cutPrev = { g, sd }; return cut;
  }

  // ── Landmark geometry helpers ──
  private bodyBox(s: BodySet, minV: number): number[] | null { // normalised bbox [x0,y0,x1,y1] of a landmark set (source frame, un-mirrored)
    const p = s.pts; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, n = 0;
    for (let i = 0; i < p.length; i += 3) { if (minV && p[i + 2] < minV) continue; const x = p[i], y = p[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; n++; }
    return n ? [x0, y0, x1, y1] : null;
  }
  private bodyPoseBox(s: BodySet): number[] | null {
    const b = this.bodyBox(s, 0.5); if (!b) return null; const p = s.pts;
    if (p[2] > 0.5 && p[11 * 3 + 2] > 0.5 && p[12 * 3 + 2] > 0.5) { // extend up to the top of the head (pose stops at the eyes)
      const neck = (p[11 * 3 + 1] + p[12 * 3 + 1]) / 2; b[1] = Math.min(b[1], p[1] - 0.7 * Math.abs(neck - p[1]));
    }
    return b;
  }
  // BODY detect → proc-space blobs {x,y,w,h,cx,cy,area} in display space (mirrored like the base video)
  private bodyBlobs(): DBlob[] {
    const out: DBlob[] = [], mir = this.v.mirrorBg >= 0.5;
    const push = (b: number[] | null, pad: number, kind: string) => {
      if (!b) return; const pw = (b[2] - b[0]) * pad, ph = (b[3] - b[1]) * pad;
      let x0 = Math.max(0, b[0] - pw), x1 = Math.min(1, b[2] + pw); const y0 = Math.max(0, b[1] - ph), y1 = Math.min(1, b[3] + ph);
      if (x1 - x0 < 0.004 || y1 - y0 < 0.004) return;
      if (mir) { const t = x0; x0 = 1 - x1; x1 = 1 - t; }
      const X = x0 * PW, Y = y0 * PH, w = (x1 - x0) * PW, h = (y1 - y0) * PH;
      out.push({ x: X, y: Y, w, h, cx: X + w / 2, cy: Y + h / 2, area: Math.round(w * h), kind });
    };
    if (this.bodyOn('face')) this.body.face.sets.forEach((s) => push(this.bodyBox(s, 0), 0.06, 'face'));
    if (this.bodyOn('hands')) this.body.hands.sets.forEach((s) => push(this.bodyBox(s, 0), 0.12, 'hand'));
    if (this.bodyOn('pose')) this.body.pose.sets.forEach((s) => push(this.bodyPoseBox(s), 0.05, 'pose'));
    return out;
  }
  // BODY detect + Contour mode: silhouette-ish mask painted from the landmarks (so contours hug face/hands/body)
  private bodyMask(): Uint8Array {
    if (!this.bmCv) { this.bmCv = document.createElement('canvas'); this.bmCv.width = PW; this.bmCv.height = PH; this.bmCtx = this.bmCv.getContext('2d', { willReadFrequently: true }); }
    const c = this.bmCtx!, C = bodyLandmarks.conn;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, PW, PH);
    if (this.v.mirrorBg >= 0.5) c.setTransform(-PW, 0, 0, PH, PW, 0); else c.setTransform(PW, 0, 0, PH, 0, 0); // draw in normalised coords
    c.fillStyle = c.strokeStyle = '#fff'; c.lineCap = c.lineJoin = 'round';
    const poly = (p: Float32Array, idx: number[]) => { c.beginPath(); idx.forEach((i, n) => { if (n) c.lineTo(p[i * 3], p[i * 3 + 1]); else c.moveTo(p[i * 3], p[i * 3 + 1]); }); c.closePath(); c.fill(); };
    const limbs = (p: Float32Array, pairs: number[], w: number, minV?: number) => { c.lineWidth = w; c.beginPath(); for (let i = 0; i < pairs.length; i += 2) { const a = pairs[i] * 3, b = pairs[i + 1] * 3; if (minV && (p[a + 2] < minV || p[b + 2] < minV)) continue; c.moveTo(p[a], p[a + 1]); c.lineTo(p[b], p[b + 1]); } c.stroke(); };
    if (this.bodyOn('face')) this.body.face.sets.forEach((s) => { if (s.pts.length >= 468 * 3) poly(s.pts, BODY_FACE_OVAL); });
    if (this.bodyOn('hands') && C) this.body.hands.sets.forEach((s) => { const p = s.pts; poly(p, [0, 1, 2, 5, 9, 13, 17]);
      limbs(p, C.hand, Math.hypot(p[0] - p[9 * 3], p[1] - p[9 * 3 + 1]) * 0.28); });
    if (this.bodyOn('pose') && C) this.body.pose.sets.forEach((s) => { const p = s.pts;
      const sw = Math.max(0.01, Math.hypot(p[11 * 3] - p[12 * 3], p[11 * 3 + 1] - p[12 * 3 + 1]));
      if (p[11 * 3 + 2] > 0.5 && p[12 * 3 + 2] > 0.5 && p[23 * 3 + 2] > 0.3 && p[24 * 3 + 2] > 0.3) poly(p, [11, 12, 24, 23]);
      limbs(p, C.poseBody, sw * 0.3, 0.5);
      if (p[2] > 0.5) { c.beginPath(); c.arc(p[0], p[1], sw * 0.33, 0, Math.PI * 2); c.fill(); } });
    c.setTransform(1, 0, 0, 1, 0, 0);
    const d = c.getImageData(0, 0, PW, PH).data, bin = this.bmBin;
    for (let i = 0; i < bin.length; i++) bin[i] = d[i * 4 + 3] > 64 ? 1 : 0;
    return bin;
  }

  // ── MOTION detect (standalone _motionDetect) ──
  private motionReset(): void { this.mHas = false; this.mE.fill(0); this.mDil.fill(0); this.mLast = []; this.mShift = [0, 0]; this.mFrac = 0; }
  private mDown(src: Uint8Array, dst: Uint8Array): void {
    for (let gy = 0; gy < G_H; gy++) for (let gx = 0; gx < G_W; gx++) {
      let s = 0; const x0 = gx << 2, y0 = gy << 2;
      for (let y = 0; y < 4; y++) { const r = (y0 + y) * PW + x0; s += src[r] + src[r + 1] + src[r + 2] + src[r + 3]; }
      dst[gy * G_W + gx] = s >> 4;
    }
  }
  // Mean abs difference cur(x,y) vs prev(x-dx,y-dy) over the frame border ring (performers are usually centred,
  // the ring mostly sees background → estimates the camera pan, not the person)
  private mRingSAD(A: Uint8Array, B: Uint8Array, W: number, H: number, dx: number, dy: number, step: number): number {
    let s = 0, n = 0; const xl = (W * 0.3) | 0, xr = (W * 0.7) | 0, yt = (H * 0.15) | 0;
    for (let y = 0; y < H; y += step) {
      const py = y - dy; if (py < 0 || py >= H) continue;
      for (let x = 0; x < W; x += step) {
        if (x >= xl && x < xr && y >= yt) continue; const px = x - dx; if (px < 0 || px >= W) continue;
        const d = A[y * W + x] - B[py * W + px]; s += d < 0 ? -d : d; n++;
      }
    }
    return n > 50 ? s / n : 1e9;
  }
  private mEstimateShift(): [number, number] {
    this.mDown(this.mCur, this.gA); this.mDown(this.mPrev, this.gB);
    const z = this.mRingSAD(this.gA, this.gB, G_W, G_H, 0, 0, 1); let best = z, bx = 0, by = 0;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) { if (!dx && !dy) continue; const v = this.mRingSAD(this.gA, this.gB, G_W, G_H, dx, dy, 1); if (v < best) { best = v; bx = dx; by = dy; } }
    if (best >= z * 0.8) return [0, 0];                    // no clear global motion → static camera
    let fb = 1e9, fx = bx * 4, fy = by * 4; const cx = fx, cy = fy; // refine at full resolution (sparse)
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const v = this.mRingSAD(this.mCur, this.mPrev, PW, PH, cx + dx, cy + dy, 2); if (v < fb) { fb = v; fx = cx + dx; fy = cy + dy; } }
    return [fx, fy];
  }
  private motionDetect(data: Uint8ClampedArray, key: string): { bin: Uint8Array; blobs: DBlob[]; fresh: boolean } {
    if (key !== this.mKey) { this.mKey = key; this.motionReset(); }
    const G = this.mG, Hh = this.mH, Cur = this.mCur, Prev = this.mPrev, E = this.mE, Bin = this.mBin, Dil = this.mDil, T = this.mT;
    // 1) luma + 3×3 box blur (kills sensor / codec speckle)
    for (let i = 0; i < M_N; i++) { const j = i << 2; G[i] = (77 * data[j] + 150 * data[j + 1] + 29 * data[j + 2]) >> 8; }
    for (let y = 0; y < PH; y++) { const r = y * PW; for (let x = 0; x < PW; x++) { const i = r + x; Hh[i] = G[i] + G[x > 0 ? i - 1 : i] + G[x < PW - 1 ? i + 1 : i]; } }
    for (let y = 0; y < PH; y++) { const up = y > 0 ? -PW : 0, dn = y < PH - 1 ? PW : 0, r = y * PW; for (let x = 0; x < PW; x++) { const i = r + x; Cur[i] = ((Hh[i + up] + Hh[i] + Hh[i + dn]) * 7282) >> 16; } }
    if (!this.mHas) { Prev.set(Cur); this.mHas = true; return { bin: Dil, blobs: [], fresh: false }; }
    // 2) same frame again (render faster than the video) → keep last result, don't age the tracks
    let same = true; for (let i = 0; i < M_N; i += 13) { if (Cur[i] !== Prev[i]) { same = false; break; } }
    if (same) return { bin: Dil, blobs: this.mLast, fresh: false };
    // 3) camera-pan compensation + frame difference, threshold from the Threshold slider (same knob as LUMA)
    const sh = this.mEstimateShift(), dx = sh[0], dy = sh[1]; this.mShift = sh;
    const thrL = this.v.threshold + Math.round((1 - this.v.padThresh) * (255 - this.v.threshold));
    const mThr = 6 + thrL * 0.12; // 0→6 · 127→21 · 255→37 grey levels of change
    if (dx || dy) { // move the motion history with the camera
      const E2 = this.mE2; E2.fill(0);
      for (let y = 0; y < PH; y++) { const py = y - dy; if (py < 0 || py >= PH) continue; for (let x = 0; x < PW; x++) { const px = x - dx; if (px >= 0 && px < PW) E2[y * PW + x] = E[py * PW + px]; } }
      E.set(E2);
    }
    let moving = 0;
    for (let y = 0; y < PH; y++) {
      const py = y - dy, r = y * PW;
      for (let x = 0; x < PW; x++) {
        const i = r + x, px = x - dx; let d = 0;
        if (py >= 0 && py < PH && px >= 0 && px < PW) { d = Cur[i] - Prev[py * PW + px]; if (d < 0) d = -d; }
        if (d > mThr) { E[i] = 255; moving++; } else { const e = E[i]; E[i] = e > 80 ? e - 80 : 0; }
      }
    }
    Prev.set(Cur);
    this.mFrac = moving / M_N;
    if (this.mFrac > 0.5) { E.fill(0); Dil.fill(0); this.mLast = []; return { bin: Dil, blobs: [], fresh: true }; } // scene cut / flash / zoom
    // 4) motion history (current + 1 frame: bridges dropped frames, little trail) → binary → dilate r=3 so a moving arm / head becomes one blob
    for (let i = 0; i < M_N; i++) Bin[i] = E[i] >= 128 ? 1 : 0;
    const R = 3;
    for (let y = 0; y < PH; y++) { const r = y * PW; for (let x = 0; x < PW; x++) { let v = 0; const a = Math.max(0, x - R), b = Math.min(PW - 1, x + R); for (let k = a; k <= b; k++) if (Bin[r + k]) { v = 1; break; } T[r + x] = v; } }
    for (let x = 0; x < PW; x++) { for (let y = 0; y < PH; y++) { let v = 0; const a = Math.max(0, y - R), b = Math.min(PH - 1, y + R); for (let k = a; k <= b; k++) if (T[k * PW + x]) { v = 1; break; } Dil[y * PW + x] = v; } }
    // 5) connected components via the tracker's own findBlobs (circularity relaxed: motion shapes are outlines)
    let bl: DBlob[] = this.findBlobs(Dil, 0.04);
    if (bl.length > 16) bl = bl.sort((a, b) => b.area - a.area).slice(0, 16);
    this.mLast = bl;
    return { bin: Dil, blobs: bl, fresh: true };
  }

  // ── Temporal tracking for MOTION / BODY blobs (LUMA stays frame-by-frame like the original) — standalone _trkUpdate ──
  private trkReset(): void { this.trk.tracks = []; this.trk.mode = ''; }
  private trkUpdate(list: DBlob[], mode: string, fresh: boolean): DBlob[] {
    if (this.trk.mode !== mode) { this.trk.tracks = []; this.trk.mode = mode; }
    const T = this.trk.tracks;
    if (fresh) {
      const A = mode === 'motion' ? 0.5 : 0.55, HOLD = mode === 'motion' ? 4 : 3;
      const used = new Uint8Array(T.length), taken = new Uint8Array(list.length), pairs: [number, number, number][] = [];
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        for (let j = 0; j < T.length; j++) {
          const t = T[j]; if (t.kind !== b.kind) continue;
          const d = Math.hypot(b.cx - t.cx, b.cy - t.cy), gate = Math.max(18, 0.6 * Math.max(t.w, t.h, b.w, b.h));
          if (d <= gate) pairs.push([d, i, j]);
        }
      }
      pairs.sort((a, b) => a[0] - b[0]);
      for (const [, i, j] of pairs) {
        if (taken[i] || used[j]) continue; taken[i] = 1; used[j] = 1; const t = T[j], b = list[i];
        t.x += (b.x - t.x) * A; t.y += (b.y - t.y) * A; t.w += (b.w - t.w) * A; t.h += (b.h - t.h) * A; t.cx += (b.cx - t.cx) * A; t.cy += (b.cy - t.cy) * A;
        t.area = b.area; t.miss = 0; t.hits++;
      }
      for (let j = T.length - 1; j >= 0; j--) if (!used[j] && ++T[j].miss > HOLD) T.splice(j, 1); // held (not faded) a few frames
      for (let i = 0; i < list.length; i++) if (!taken[i]) {
        const b = list[i];
        T.push({ id: this.trk.nextId++, x: b.x, y: b.y, w: b.w, h: b.h, cx: b.cx, cy: b.cy, area: b.area, kind: b.kind, miss: 0, hits: 1 });
      }
    }
    const minHits = mode === 'motion' ? 2 : 1; // a motion blob must survive 2 frames → no single-frame noise
    return T.filter((t) => t.hits >= minHits).map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h, cx: t.cx, cy: t.cy, area: Math.round(t.area) }));
  }

  // DETECT switch (standalone _detRun): MOTION / BODY → {bin (contour mask), tracked blobs}
  private detRun(dm: DetMode, data: Uint8ClampedArray, src: TexImageSource): { bin: Uint8Array; blobs: DBlob[] } {
    const key = this.srcKey(src) + '|' + (this.v.mirrorBg >= 0.5 ? 'm' : '');
    if (key !== this.trk.key) { this.trk.key = key; this.trkReset(); }
    if (dm === 'motion') { const r = this.motionDetect(data, key); return { bin: r.bin, blobs: this.trkUpdate(r.blobs, 'motion', r.fresh) }; }
    return { bin: this.v.ctMode >= 0.5 ? this.bodyMask() : this.detNoBin, blobs: this.trkUpdate(this.bodyBlobs(), 'body', true) };
  }

  // ── Overlay: face mesh · hands · skeleton on dc (same stretch + mirror as the base video) — standalone _bodyTag/_bodyDraw ──
  private bodyTag(ctx: CanvasRenderingContext2D, x: number, y: number, txt: string, col: string, k: number, align?: string): void {
    const fs = Math.max(9, Math.round(9 * k)); ctx.font = fs + 'px JetBrains Mono,monospace';
    const w = ctx.measureText(txt).width + fs * 0.9, h = fs + 5; let x0 = align === 'left' ? x : x - w / 2;
    x0 = Math.max(2, Math.min(this.w - w - 2, x0)); const y0 = Math.max(2, y - h);
    ctx.globalAlpha = 0.72; ctx.fillStyle = '#04020a'; ctx.fillRect(x0, y0, w, h);
    ctx.globalAlpha = 0.9; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
    ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.textBaseline = 'middle'; ctx.fillText(txt, x0 + fs * 0.45, y0 + h / 2 + 0.5); ctx.textBaseline = 'alphabetic';
  }
  private bodyDraw(dW: number, dH: number): void {
    const C = bodyLandmarks.conn, ctx = this.dCtx;
    const Fon = this.bodyOn('face'), Hon = this.bodyOn('hands'), Qon = this.bodyOn('pose');
    const F = this.body.face.sets, Hs = this.body.hands.sets, Q = this.body.pose.sets;
    if (!C || !((Fon && F.length) || (Hon && Hs.length) || (Qon && Q.length))) return;
    const mir = this.v.mirrorBg >= 0.5, sx = mir ? -dW : dW, ox = mir ? dW : 0; // x = ox + nx·sx , y = ny·dH
    const k = Math.max(1, Math.min(dW, dH) / 600);
    // standalone: trackerColorActive ? trackerColor : white / amber / teal — palette index 0 (white) = not active
    const tAct = (this.v.trackerColorIdx | 0) !== 0;
    const main = tAct ? this.trackerColor : '#ffffff', acc = tAct ? this.trackerColor : '#e8c000', hcol = tAct ? this.trackerColor : '#00e0c0';
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const path = (p: Float32Array, pairs: number[], minV?: number) => {
      ctx.beginPath();
      for (let i = 0; i < pairs.length; i += 2) { const a = pairs[i] * 3, b = pairs[i + 1] * 3; if (minV && (p[a + 2] < minV || p[b + 2] < minV)) continue; ctx.moveTo(ox + p[a] * sx, p[a + 1] * dH); ctx.lineTo(ox + p[b] * sx, p[b + 1] * dH); }
    };
    const line = (col: string, w: number) => { // dark under-stroke keeps it readable on bright skin/clothes, then coloured core with a soft glow
      ctx.shadowBlur = 0; ctx.globalAlpha = 0.32; ctx.strokeStyle = '#000'; ctx.lineWidth = w + 2.2 * k; ctx.stroke();
      ctx.globalAlpha = 0.92; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.shadowColor = col; ctx.shadowBlur = 7 * k; ctx.stroke(); ctx.shadowBlur = 0;
    };
    const dot = (x: number, y: number, r: number, col: string) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); };
    ctx.save(); ctx.setLineDash([]); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalCompositeOperation = 'source-over';
    // FACE — hairline tesselation + glowing contours (oval, eyes, brows, lips) + irises
    if (Fon) F.forEach((s, i) => {
      const p = s.pts;
      if (C.tess.length) { path(p, C.tess); ctx.globalAlpha = 0.14; ctx.strokeStyle = main; ctx.lineWidth = 0.6 * k; ctx.stroke(); }
      path(p, C.cont); line(main, 1.1 * k);
      if (p.length >= 478 * 3) [[468, 469], [473, 474]].forEach(([c, e]) => {
        const x = ox + p[c * 3] * sx, y = p[c * 3 + 1] * dH;
        const r = Math.max(1.5 * k, Math.hypot(ox + p[e * 3] * sx - x, p[e * 3 + 1] * dH - y));
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.globalAlpha = 0.95; ctx.strokeStyle = acc; ctx.lineWidth = 1.1 * k; ctx.stroke(); dot(x, y, 1.2 * k, acc);
      });
      const b = this.bodyBox(s, 0); if (b) this.bodyTag(ctx, ox + ((b[0] + b[2]) / 2) * sx, b[1] * dH - 6 * k, 'FACE ' + pad2(i + 1), acc, k);
    });
    // BODY — 33-kp skeleton (face lines left to the mesh when FACE is on) + glowing joints
    if (Qon) Q.forEach((s, i) => {
      const p = s.pts;
      path(p, Fon ? (Hon ? C.poseBodyNH : C.poseBody) : (Hon ? C.poseNH : C.pose), 0.5); line(main, 1.6 * k); // mesh/hands own the face & fingers when ON
      ctx.globalAlpha = 1;
      const J = Fon ? BODY_POSE_JOINTS : [0].concat(BODY_POSE_JOINTS);
      J.forEach((j) => {
        if (p[j * 3 + 2] < 0.5) return; if (Hon && j >= 15 && j <= 22) return; const x = ox + p[j * 3] * sx, y = p[j * 3 + 1] * dH;
        ctx.globalAlpha = 0.35; dot(x, y, 4.2 * k, acc); ctx.globalAlpha = 1; dot(x, y, 2.2 * k, acc); dot(x, y, 0.9 * k, '#ffffff');
      });
      const b = this.bodyPoseBox(s);
      if (b) { // tag above the head; beside the box when the FACE tag already sits there
        if (!Fon && p[2] > 0.5) this.bodyTag(ctx, ox + p[0] * sx, b[1] * dH - 4 * k, 'BODY ' + pad2(i + 1), main, k);
        else { const xl = mir ? 1 - b[2] : b[0]; this.bodyTag(ctx, xl * dW, b[1] * dH - 4 * k, 'BODY ' + pad2(i + 1), main, k, 'left'); }
      }
    });
    // HANDS — 21-kp per hand, fingertips emphasised, L/R tag at the wrist
    if (Hon) Hs.forEach((s) => {
      const p = s.pts;
      path(p, C.hand); line(hcol, 1.3 * k);
      ctx.globalAlpha = 1;
      for (let j = 0; j < 21; j++) {
        const x = ox + p[j * 3] * sx, y = p[j * 3 + 1] * dH;
        if (BODY_TIPS.indexOf(j) >= 0) { ctx.beginPath(); ctx.arc(x, y, 3.4 * k, 0, Math.PI * 2); ctx.strokeStyle = acc; ctx.lineWidth = 1.2 * k; ctx.stroke(); dot(x, y, 1.3 * k, '#ffffff'); }
        else dot(x, y, (j === 0 ? 2.2 : 1.3) * k, j === 0 ? acc : '#ffffff');
      }
      if (s.side) { const wy = p[1] * dH, my = p[9 * 3 + 1] * dH, below = wy >= my; this.bodyTag(ctx, ox + p[0] * sx, below ? wy + 20 * k : wy - 6 * k, s.side, hcol, k); }
    });
    ctx.restore();
  }
  /* SYNTECH-BODY-END ═════════════════════════════════════════════════════════ */

  render(ctx: NodeRenderContext): WebGLTexture {
    const gl = ctx.gl;
    const src = ctx.source;
    if (!src || !this.outTex || this.w < 2) return ctx.inputTex;
    const dW = this.w, dH = this.h;

    // L7b: resolve the palette-enum colours for every overlay this frame
    this.trackerColor = pal(this.v.trackerColorIdx);
    this.connColor = pal(this.v.connColorIdx);

    // 1) raw colour video base (mirrorBg flips it; detection is flipped to match)
    const mir = this.v.mirrorBg >= 0.5;
    if (mir) { this.dCtx.save(); this.dCtx.translate(dW, 0); this.dCtx.scale(-1, 1); this.dCtx.drawImage(src as CanvasImageSource, 0, 0, dW, dH); this.dCtx.restore(); }
    else this.dCtx.drawImage(src as CanvasImageSource, 0, 0, dW, dH);

    // L7c: chaos-points mode replaces detection entirely; else the normal
    // detect → contour → FX → markers → flow pipeline (steps 2-4)
    if (this.v.fixedPtsMode >= 0.5) {
      this.fpRender(src);
      this.bodyTick(src); this.bodyDraw(dW, dH); /* SYNTECH-BODY hook: face/hands/body overlay also over the chaos points */
    } else {
    /* SYNTECH-BODY hook: face/hands/body inference (no-op while all OFF) + DETECT switch.
       LUMA runs exactly the original sequence; MOTION/BODY live in the SYNTECH-BODY block. */
    this.bodyTick(src);
    const dm = this.detEffMode(src);
    if (dm !== this.detPrev) { this.detPrev = dm; this.trkReset(); this.motionReset(); } // standalone _detSet
    /* /SYNTECH-BODY hook */
    // 2) detect on the 320×180 processing canvas (flipped to match mirrorBg — the display space)
    if (mir) { this.pCtx.save(); this.pCtx.translate(PW, 0); this.pCtx.scale(-1, 1); this.pCtx.drawImage(src as CanvasImageSource, 0, 0, PW, PH); this.pCtx.restore(); }
    else this.pCtx.drawImage(src as CanvasImageSource, 0, 0, PW, PH);
    const id = this.pCtx.getImageData(0, 0, PW, PH);
    if (this.v.flowOn >= 0.5) this.flowUpdateGray(id.data); // raw gray BEFORE processForDetect
    let bin: Uint8Array, blobs: DBlob[];
    if (dm === 'luma') { this.processForDetect(id.data); bin = this.getBinary(id.data); blobs = this.findBlobs(bin); }
    else { const dr = this.detRun(dm, id.data, src); bin = dr.bin; blobs = dr.blobs; } /* SYNTECH-BODY hook */
    if (this.v.flowOn >= 0.5) this.flowComputeVel(blobs);
    const scX = dW / PW, scY = dH / PH;
    const sc = blobs.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, cx: b.cx * scX, cy: b.cy * scY, area: b.area }));

    // L3: compute contours — edge (ctMode=1) ray-casts the detection binary;
    // smart (ctMode=2, L3b) ray-casts the shared PersonMask (mapped to the
    // standalone's _ctSmartMask), falling back to the binary until the mask
    // arrives — exactly the standalone's `_ctSmartMask ?? _ctBinMask` choice.
    if (this.v.ctMode >= 0.5) {
      let mask = bin;
      if (this.v.ctMode >= 1.5 && ctx.personMask) {
        const sm = this.refreshSmartMask(ctx, mir); // SYNTECH-BODY: detection runs in display space in every DETECT mode
        if (sm) mask = sm;
      }
      this.computeContours(blobs, mask);
    } else this.ctContours = [];

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
    this.bodyDraw(dW, dH); /* SYNTECH-BODY hook: face mesh / hands / skeleton overlay on dc */
    this.computeMotion(src);
    }

    // L6: panels — the fixed 8-panel 3D montage composited OVER dc (before the
    // ripple samples dc). The scene renders on its own offscreen three canvas;
    // labels + connector lines are drawn into dc at the projected positions.
    if (this.v.panelsEnabled >= 0.5) {
      if (!this.pInited) this.initPanels();
      if (this.pInited && this.pTex && this.pCanvas) {
        // dim the tracker composite behind the panels (standalone panels-mode
        // #050302 backdrop bleeding through by 1-panelsBgOpacity)
        const bgOp = this.v.panelsBgOpacity;
        if (bgOp < 0.999) {
          this.dCtx.save(); this.dCtx.globalAlpha = 1 - bgOp; this.dCtx.fillStyle = '#050302';
          this.dCtx.fillRect(0, 0, dW, dH); this.dCtx.restore();
        }
        this.pTex.image = src as unknown as HTMLVideoElement; this.pTex.needsUpdate = true;
        const { centers, pts } = this.panelsTick();
        this.dCtx.drawImage(this.pCanvas, 0, 0, dW, dH);
        this.drawPanelOverlay(pts, centers);
      }
    }

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
    // L6 panels renderer
    this.pMeshes.forEach((pm) => { pm.mesh.geometry.dispose(); (pm.mesh.material as THREE.Material).dispose(); });
    this.pMeshes = [];
    this.pTex?.dispose(); this.pRenderer?.dispose();
    this.pRenderer = null; this.pTex = null; this.pScene = null; this.pCamera = null; this.pCanvas = null; this.pInited = false;
    // SYNTECH-BODY: the last node using the shared landmark service closes its models
    if (this.bodyAcq) { this.bodyAcq = false; bodyLandmarks.release(); }
  }
}
