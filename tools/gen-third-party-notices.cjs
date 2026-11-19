#!/usr/bin/env node
/* Generates THIRD-PARTY-NOTICES.txt (no dependencies, Node only).
 *
 *   node tools/gen-third-party-notices.cjs
 *
 * Writes the SAME text to:
 *   public/THIRD-PARTY-NOTICES.txt   (source of truth; Vite copies it to dist/ -> served at
 *                                     /THIRD-PARTY-NOTICES.txt and shipped in the desktop asar)
 *   THIRD-PARTY-NOTICES.txt          (repo root copy, also what electron-builder.yml puts
 *                                     next to the desktop app via extraFiles)
 * Never edit the .txt files by hand: edit this script and re-run it.
 *
 * Inputs: node_modules/<pkg>/LICENSE* (npm packages, authoritative) and
 * public/effects/vendor/LICENSES/* (official texts for the vendored files).
 *
 * REFRESH WHEN DEPENDENCIES CHANGE: re-derive NPM_DESKTOP / NPM_WEB below.
 *   desktop list: esbuild desktop/main.ts (same flags as "desktop:bundle") + --metafile=meta.json,
 *                 then collect every node_modules/<pkg> that appears in meta.inputs.
 *   web list:     vite build --sourcemap, then the node_modules/<pkg> entries of dist/assets/*.map
 *                 (plus tailwindcss: its licence header is in the built CSS).
 * Missing licence file => the script aborts, so a gap can never ship silently.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');
const LIC = path.join(ROOT, 'public/effects/vendor/LICENSES');

// Packages bundled into dist-desktop/main.cjs (the server inside the desktop app) — esbuild metafile.
const NPM_DESKTOP = ['@google/genai', 'accepts', 'agent-base', 'array-flatten', 'base64-js', 'bignumber.js', 'body-parser', 'buffer-equal-constant-time', 'bytes', 'call-bind-apply-helpers', 'call-bound', 'content-disposition', 'content-type', 'cookie', 'cookie-signature', 'data-uri-to-buffer', 'debug', 'depd', 'destroy', 'dotenv', 'dunder-proto', 'ecdsa-sig-formatter', 'ee-first', 'encodeurl', 'es-define-property', 'es-errors', 'es-object-atoms', 'escape-html', 'etag', 'express', 'extend', 'fetch-blob', 'finalhandler', 'formdata-polyfill', 'forwarded', 'fresh', 'function-bind', 'gaxios', 'gcp-metadata', 'get-intrinsic', 'get-proto', 'google-auth-library', 'google-logging-utils', 'gopd', 'has-flag', 'has-symbols', 'hasown', 'http-errors', 'https-proxy-agent', 'iconv-lite', 'inherits', 'ipaddr.js', 'json-bigint', 'jwa', 'jws', 'math-intrinsics', 'media-typer', 'merge-descriptors', 'methods', 'mime', 'mime-db', 'mime-types', 'ms', 'negotiator', 'node-domexception', 'node-fetch', 'object-inspect', 'on-finished', 'p-retry', 'parseurl', 'path-to-regexp', 'proxy-addr', 'qs', 'range-parser', 'raw-body', 'retry', 'safe-buffer', 'safer-buffer', 'send', 'serve-static', 'setprototypeof', 'side-channel', 'side-channel-list', 'side-channel-map', 'side-channel-weakmap', 'statuses', 'supports-color', 'toidentifier', 'type-is', 'unpipe', 'utils-merge', 'vary', 'web-streams-polyfill', 'ws',
  // older copies nested under the express stack (express, body-parser, finalhandler, send bundle these)
  'express/node_modules/debug', 'express/node_modules/ms'];
// Packages bundled into dist/assets/*.js and *.css (the web app) — Vite sourcemaps.
const NPM_WEB = ['react', 'react-dom', 'scheduler', 'lucide-react', 'react-resizable-panels', 'three', 'tailwindcss'];

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
const rule = (c) => c.repeat(78) + '\n';
let out = '';
const w = (s) => { out += s; };

function licenceFile(dir) {
  const f = fs.readdirSync(dir).find((n) => /^(licen[sc]e|copying)(\.(md|txt))?$/i.test(n));
  if (f) return read(path.join(dir, f));
  // Two packages ship no licence file: their licence text sits at the end of the README.
  const rd = fs.readdirSync(dir).find((n) => /^readme\.md$/i.test(n));
  if (rd) {
    const t = read(path.join(dir, rd));
    const i = t.indexOf('(The MIT License)');
    if (i >= 0) return t.slice(i).replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }
  throw new Error('no licence text for ' + dir);
}

function npmSection(title, list, usedIn) {
  w(rule('=') + title + '\n' + usedIn + '\n' + rule('=') + '\n');
  const groups = new Map(); // licence text -> [entries]
  for (const name of [...new Set(list)].sort()) {
    const dir = path.join(NM, name);
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const text = licenceFile(dir);
    const repo = (typeof j.repository === 'string' ? j.repository : (j.repository && j.repository.url) || j.homepage || 'https://www.npmjs.com/package/' + name)
      .replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/')
      .replace(/^([\w.-]+\/[\w.-]+)$/, 'https://github.com/$1');
    const lic = typeof j.license === 'string' ? j.license : JSON.stringify(j.license || j.licenses);
    if (!groups.has(text)) groups.set(text, []);
    groups.get(text).push(`${j.name} ${j.version}  [${lic}]  ${repo}`);
  }
  for (const [text, entries] of groups) {
    w(entries.map((e) => '* ' + e).join('\n') + '\n\n' + text + '\n' + rule('-') + '\n');
  }
}

// ── header ──────────────────────────────────────────────────────────────────
w(`VFX SYNTECH — THIRD-PARTY NOTICES
${rule('=')}
VFX SYNTECH is proprietary software (see LICENSE). It includes the third-party
components listed below, each under its own licence. Their copyright notices and
licence texts are reproduced here as those licences require. Nothing in this
file changes the licence of VFX SYNTECH itself.

Contents
  1. Components vendored inside the app (public/effects/vendor/)
  2. npm packages in the web app bundle (dist/assets)
  3. npm packages in the desktop app's built-in server (dist-desktop/main.cjs)
  4. Electron and Chromium (desktop app only)

First-party (not third-party): public/effects/vendor/syntech-export.js (the Master
MP4 exporter, written for VFX SYNTECH; it calls mp4-muxer, see 1.3), all effect
pages in public/effects/, public/effects/shared/, and the artwork in
public/assets/.

`);

// ── 1. vendored ─────────────────────────────────────────────────────────────
w(rule('=') + '1. COMPONENTS VENDORED INSIDE THE APP  (public/effects/vendor/)\n' + rule('=') + '\n');
w(`Verbatim copies of the licence texts below are also shipped as files in
effects/vendor/LICENSES/ (and three160/LICENSE).

1.1  three.js r128  (vendor/three.min.js)
     Used by: the BLOB TRACKER effect (the web app shell also bundles three.js
     0.128.0 from npm, see section 2).
     Copyright 2010-2021 Three.js Authors  (file header); licence text below
     "Copyright © 2010-2021 three.js authors".  Licence: MIT.
     Source: https://github.com/mrdoob/three.js  (npm: three@0.128.0)

`);
w(read(path.join(LIC, 'three-r128.LICENSE.txt')) + '\n');
w(`1.2  three.js r160 + addons  (vendor/three160/three.module.js, vendor/three160/addons/*:
     EffectComposer, MaskPass, Pass, RenderPass, ShaderPass, UnrealBloomPass,
     CopyShader, LuminosityHighPassShader)
     Used by: the PAINTING and POINTCLOUD effects.
     Copyright 2010-2023 Three.js Authors.  Licence: MIT.
     Source: https://github.com/mrdoob/three.js  (npm: three@0.160.0; the vendored
     files are byte-identical to build/three.module.min.js of that package).

`);
w(read(path.join(LIC, 'three-r160.LICENSE.txt')) + '\n');
w(`1.3  mp4-muxer 5.2.2  (vendor/mp4-muxer.min.js, UMD build)
     Used by: the Master MP4 export helper (syntech-export.js).
     Copyright (c) 2023 Vanilagy.  Licence: MIT.
     Source: https://github.com/Vanilagy/mp4-muxer  (npm: mp4-muxer@5.2.2)

`);
w(read(path.join(LIC, 'mp4-muxer-5.2.2.LICENSE.txt')) + '\n');
w(`1.4  MediaPipe  (vendor/mediapipe/)
     Licence of the code and wasm: Apache License 2.0 (full text below).
     Copyright holder: Google (the npm packages name "mediapipe@google.com" /
     "mhays@google.com" as author and carry no separate copyright line; the file
     selfie_segmentation.js additionally carries "Copyright The Closure Library
     Authors. SPDX-License-Identifier: Apache-2.0").
     The npm packages ship no NOTICE file.
       - @mediapipe/selfie_segmentation 0.1.1675465747  (vendor/mediapipe/selfie_segmentation/:
         selfie_segmentation.js, *_solution_*_wasm_bin.js/.wasm/.data, .binarypb,
         selfie_segmentation.tflite, selfie_segmentation_landscape.tflite)
         https://www.npmjs.com/package/@mediapipe/selfie_segmentation
       - @mediapipe/tasks-vision 0.10.3  (vendor/mediapipe/tasks-vision/:
         vision_bundle.mjs, wasm/vision_wasm_internal.js/.wasm)
         https://www.npmjs.com/package/@mediapipe/tasks-vision
       Source repository: https://github.com/google-ai-edge/mediapipe
     The WebAssembly binaries are compiled from MediaPipe together with other
     open-source libraries (e.g. TensorFlow Lite, XNNPACK); those libraries'
     notices are not itemised in the npm packages; see the MediaPipe repository
     (https://github.com/google-ai-edge/mediapipe) for the build's dependency list.

     Model files (Google-published; Apache License 2.0 per Google's own model
     cards, https://storage.googleapis.com/mediapipe-assets/ ):
       - tasks-vision/face_landmarker.task  (BlazeFace short-range face detector,
         Face Mesh V2 landmarks, Blendshape V2)
         "MediaPipe BlazeFace Model Card (Short Range).pdf",
         "Model Card MediaPipe Face Mesh V2.pdf", "Model Card Blendshape V2.pdf"
       - tasks-vision/hand_landmarker.task  (palm detector + hand landmarks)
         "Model Card Hand Tracking (Lite_Full) with Fairness Oct 2021.pdf"
       - tasks-vision/pose_landmarker_lite.task  (BlazePose GHUM)
         "Model Card BlazePose GHUM 3D.pdf"
       - selfie_segmentation/selfie_segmentation.tflite, selfie_segmentation_landscape.tflite
         and tasks-vision/selfie_segmenter.tflite
         "Model Card MediaPipe Selfie Segmentation.pdf"
     Each of these model cards states "LICENSED UNDER Apache License, Version 2.0".

`);
w(read(path.join(LIC, 'apache-2.0.txt')) + '\n');
w(`     (Apache License 2.0, official text from https://www.apache.org/licenses/LICENSE-2.0.txt)

1.5  Fonts  (vendor/fonts/*.woff2, latin + latin-ext subsets)
     SIL Open Font License 1.1. The fonts are used unmodified as web fonts. Each
     licence file below is the font's own OFL.txt from
     https://github.com/google/fonts (ofl/<font>/OFL.txt). None of them declares a
     Reserved Font Name.
       - Barlow Condensed   https://github.com/jpt/barlow
       - Inter              https://github.com/rsms/inter
       - JetBrains Mono     https://github.com/JetBrains/JetBrainsMono
       - Space Grotesk      https://github.com/floriankarsten/space-grotesk

`);
for (const f of ['barlowcondensed', 'inter', 'jetbrainsmono', 'spacegrotesk']) {
  w(rule('-') + read(path.join(LIC, 'OFL-' + f + '.txt')) + '\n');
}

// ── 2 / 3. npm ──────────────────────────────────────────────────────────────
npmSection('2. NPM PACKAGES IN THE WEB APP BUNDLE  (dist/assets/*.js, *.css)', NPM_WEB,
  'Licence texts copied from node_modules/<package>/LICENSE*.');
npmSection('3. NPM PACKAGES IN THE DESKTOP APP\'S BUILT-IN SERVER  (dist-desktop/main.cjs)', NPM_DESKTOP,
  'express, the Google Gen AI client and their dependencies, bundled by esbuild.\nLicence texts copied from node_modules/<package>/LICENSE*.');

// ── 4. electron ─────────────────────────────────────────────────────────────
w(rule('=') + '4. ELECTRON AND CHROMIUM  (desktop app only)\n' + rule('=') + `
The desktop app is built on Electron (https://www.electronjs.org, MIT licence,
Copyright (c) Electron contributors, Copyright (c) 2013-2020 GitHub Inc.) which embeds Chromium and
many other third-party components. Their full licence texts ship with the app
(Windows and Linux: next to the application executable; macOS: inside
VFX SYNTECH.app/Contents/):
  LICENSE.electron.txt   (Electron's licence)
  LICENSES.chromium.html (notices of Chromium and its dependencies)
`);

fs.writeFileSync(path.join(ROOT, 'public/THIRD-PARTY-NOTICES.txt'), out);
fs.writeFileSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.txt'), out);
console.log('written', out.length, 'bytes;', NPM_WEB.length, 'web +', NPM_DESKTOP.length, 'desktop packages');
