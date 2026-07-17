# 04 — EFFECTS INVENTORY

The five standalone HTMLs in `public/effects/<id>/index.html` are the official,
finished builds delivered by the operator (2026-07-17). **They are ground
truth**: for any porting question, open and read the HTML itself — this file is
the map, not the territory.

Common to all five: own dark UI, video-file input, webcam mode, MediaRecorder
export, and their own hotkeys. Ids below are the `ModuleId`s.

---

## `analog` — ANALOG STATE — Video Synthesizer  (~130 KB)

- **Tech**: raw WebGL fragment shaders (no libraries). The simplest port
  target — port this one FIRST.
- **Controls**: sliders `sl-modDepth`, `sl-reactSens`, `sl-sortPasses`,
  `sl-sortThresh`; buttons `btn-play`, `btn-loop`, `btn-mirror`, `btn-react`,
  `btn-sort`, `btn-webcam`; plus mode selectors in its UI (CRT / sync / pixel
  sort family of looks).
- **Reactive**: AudioContext analysis drives modulation (`reactSens`,
  `modDepth`).
- **Note**: already has its own `btn-save-preset` / `btn-save-session` —
  bridge must map onto the same underlying state.

## `bokeh` — BOKEH STATE — Cinematic Depth of Field  (~183 KB)

- **Tech**: WebGL shader pipeline + 2D canvases + **MediaPipe
  SelfieSegmentation** (person/background separation for depth).
- **Controls**: `sl-bokehRadius`, `sl-anamRatio`, `sl-anamSqueeze`,
  `sl-anamBarrel`, `sl-anamVignette`, `sl-distortExplosive`,
  `sl-distortFalloff`, `sl-distortSqueeze`, `sl-distortSwirl`.
- **Reactive**: video-driven (no AudioContext found in this build).

## `anamorphic_lab` — Anamorphic Lab  (~155 KB)

- **Tech**: WebGL shaders + 2D canvases + MediaPipe SelfieSegmentation.
- **Controls**: full cinema-lens rig — `s-fStop`, `s-bokeh`, `s-bokehMM`,
  `s-ratio`, `s-squeeze`, `s-barrel`, `s-ovalFineTune`, `s-riccardoBlur`,
  flare group (`s-flareAmt`, `s-flareColor`, `s-flareLength`,
  `s-flareHeight`), grade group (`s-exposure`, `s-contrast`, `s-lift`,
  `s-rolloff`, `s-sat`, `s-temp`, `s-lutMix`), texture group (`s-grain`,
  `s-halation`, `s-vignette`, `s-ca`), camera sims (`cam-exp-sl`,
  `cam-iso-sl`, `cam-wb-sl`, `cam-zoom-sl`).
- **Reactive**: AudioContext present.

## `blob_reveal` — BLOB REVEAL — Rotoscope Engine  (~89 KB)

- **Tech**: pure Canvas 2D + MediaPipe SelfieSegmentation. Negative-mask /
  rotoscope reveal of the subject.
- **Controls**: `sl-thr`, `sl-lum`, `sl-segn`, `sl-feather`, `sl-erode`,
  `sl-dil`, `sl-minarea`, `sl-maxblobs`, `sl-bgap`, `sl-bsens`, `sl-opacity`,
  `sl-audioexp`.
- **Reactive**: AudioContext (`sl-audioexp` = audio-driven expansion,
  `sl-bsens` = beat sensitivity).
- **Port note**: 2D-canvas logic can render offscreen and upload to the node's
  GL texture per frame; the mask comes from the shared PersonMask service.

## `blob_tracker` — BLOB STATE TRACKER  (~367 KB, the largest)

- **Tech**: **three.js r128** + multiple 2D canvases. Contour tracking,
  optical flow, connection lines/graph visuals over tracked blobs. Hardest
  port — do it LAST.
- **Controls**: tracking (`sThr`, `sMin`, `sScale`, `ct-expand-sl`,
  `ct-smooth-sl`), optical flow (`flow-scale-sl`, `flow-trail-sl`), dynamics
  (`sDisp`, `sTurb`, `sWave`, `sDamp`, `sDmx`, `sFixedMax`), look (`sBri`,
  `sCon`, `sBgOp`, `sFxOp`, `sConnGlow`, `sConnOp`, `sConnSat`, `sLW`,
  `sGlx`, `sCamZ`), audio-reactive gains (`ar-bass-gain`, `ar-mid-gain`,
  `ar-hi-gain`, `ar-onset-sens`), video-reactive (`vr-mot-sens`,
  `vr-cut-thr`, `vr-smooth`, `vr-srate`), camera sims (`cam-exp-sl`,
  `cam-iso-sl`, `cam-wb-sl`, `cam-zoom-sl`).
- **Reactive**: heaviest of all — dedicated audio-reactive AND video-reactive
  control groups.
- **Port note**: a 1:1 port may keep three.js rendering to an offscreen canvas
  whose output is uploaded as the node's texture, rather than translating
  every three.js pass to raw GL. 1:1 means identical output, not identical
  plumbing. (three.js would become a real npm dependency for the engine —
  allowed by the roadmap in that phase.)

---

## Porting order (easiest → hardest, locked)

1. `analog` (pure shader, small param set)
2. `bokeh` (shader + segmentation)
3. `anamorphic_lab` (large param set, shader + segmentation)
4. `blob_reveal` (2D pipeline + segmentation)
5. `blob_tracker` (three.js hybrid, biggest file)

## What "1:1 port" means (operator decision — binding)

Every parameter in the HTML exists in the node's `ParamSchema` with the same
range, default, and behavior; every visual detail matches; audio/video
reactive behaviors are reproduced through AudioEngine/VideoAnalyzer/ParamBus
(same perceived response). Parity is proven per the protocol in
06-VERIFICATION.md before a port phase is marked done. The standalone HTML
remains available and untouched in single-effect mode.
