/* VFX SYNTECH — SynStill: PNG · JPEG · PDF export of a loaded PHOTO, for every effect.
 *
 * WHY (operator request): a photo run through an effect must come out as a real still image at the
 * photo's NATIVE resolution, at maximum quality, never compressed lossy beyond what the format forces:
 *   - PNG  : our OWN writer (not canvas.toBlob — a 2D canvas stores premultiplied alpha and loses the
 *            precision of low-alpha pixels). 8-bit, colour type 6 (RGBA, real transparency) or 2 (RGB),
 *            sRGB chunk, per-row adaptive filter (min sum of absolute signed bytes), zlib via
 *            CompressionStream('deflate'), streamed in row batches (8K needs no extra full copies),
 *            IDAT split in <= 4 MB chunks. Lossless.
 *   - JPEG : canvas.toBlob('image/jpeg', q) with q = max(0.05, QUALITY/100) of the EXPORT panel (2026-11-28; at 100
 *            q = 1.0 = in Chromium 4:4:4 chroma sampling and all-ones quantisation tables, the maximum the format
 *            allows). Canvas must be opaque.
 *   - PDF  : our OWN minimal PDF 1.4 writer, lossless: one page, the pixels as a /DeviceRGB 8-bit
 *            FlateDecode image with PNG predictors (/Predictor 15), /Interpolate false, plus an /SMask
 *            (DeviceGray alpha) when the photo has transparency. 1 px = 1 pt (scaled down only when the
 *            long side would exceed 14400 pt; the image keeps every pixel).
 *   - Native resolution: nothing is ever downscaled; too big for the browser canvas → a clear error.
 *
 * Effects compute their output from the photo flattened over BLACK. ALPHA v2 (2026-11-28, docs/workflow/13-EXPORT-PANEL.md
 * §3): A = max(M, U) — M = the effect's geometric matte (SynFx.matte, optional) or the photo's own alpha, U = the light
 * the effect added outside the silhouette (maxRGB above a noise floor, "Unmult") — colour = C / A (combineAlpha).
 * An opaque photo stays an RGB PNG. Video / webcam: PNG · JPEG · PDF of the CURRENT frame (attach).
 *
 * SynFx.matte(alphaSrc, i, t) → region   (optional, per effect; called right after frame(src, i, t), before end())
 *   alphaSrc: a canvas of src's size, RGB = the source's alpha, opaque (makeAlphaSource). Draw it with EXACTLY the
 *   geometry of the last frame() (same warps, point positions, crop, letterbox, blur, blocks) but with colour, grain,
 *   noise and added light OFF; return the same region shape as frame(). Its R channel is M. frame() may also return
 *   unmult:false (no U: the effect paints its own background).
 *
 * API  (window.SynStill)
 *   encodePNG(rgba, w, h, {alpha, signal?, onProgress?(frac)}) → Promise<Blob>   alpha=false → RGB, A dropped
 *   encodeJPEG(canvas, signal?) → Promise<Blob>                                   canvas must be opaque
 *   encodePDF(rgba, w, h, {alpha, signal?, onProgress?}) → Promise<Blob>
 *   readAlpha(source: File|Blob|ImageBitmap|HTMLImageElement, w, h, rect?{x,y,w,h}) → Promise<Uint8Array|null>
 *        photo alpha resampled to w×h with the image in rect (default full frame, outside = 255);
 *        null when the photo is fully opaque.
 *   compose(rgbaOpaque, alpha, {unpremultiply=true}) → Uint8ClampedArray  (writes into the input when it is
 *        a Uint8ClampedArray, else into a copy); see composePixels() for the formula.
 *   pickFile(filename, format) → Promise<FileSystemFileHandle | null | 'cancel'>   call FIRST inside the click
 *   save(blob, filename, handle?) → Promise<void>      handle → file; else <a download>
 *   exportStill({format, render, matte?, alphaSource, alphaRect, jpegQuality?, filename, useFilePicker, signal, onStatus})
 *        → Promise<result>  result {format, filename, width, height, alpha, alphaMode 'matte'|'source'|'none', bytes,
 *        jpegQuality?, seconds} | {error} | {cancelled:true}; also stored in window.__synStillLast.
 *   combineAlpha(c:ImageData, m:ImageData|Uint8Array|null, {floor=6, unmult=true, gate=true, inPlace}) → {data, width,
 *        height, hasAlpha}   PURE: C + M → straight-alpha RGBA (the Lab chains nodes with it)
 *   makeAlphaSource(img|canvas|bitmap|Uint8Array plane, w?, h?) → canvas (RGB = alpha, opaque): SynFx.matte's input
 *   jpegQuality(q0to100) → 0.05…1
 *   attach(cfg) → controller {busy(), run(format), linkExport(ctl), onState(fn), owner()} — adds the PNG · JPEG · PDF
 *        row after cfg.anchorEl and hands the controller to the EXPORT panel (syn-panel.js), which takes the buttons over.
 *   Tests: window.__synExportNoPicker = true → no save dialog, <a download> (same switch as SynExport).
 */
(function () {
  'use strict';
  if (window.SynStill) return;

  var MAX_SIDE = 32767, MAX_AREA = 268435456;       /* Chromium canvas limits */
  var IDAT_MAX = 4 * 1048576;

  /* ───────────────────────── helpers ───────────────────────── */
  function abortErr() { var e = new Error('aborted'); e.name = 'AbortError'; return e; }
  function checkAbort(signal) { if (signal && signal.aborted) throw abortErr(); }
  var yieldCh = null;
  function yieldNow() {
    return new Promise(function (res) {
      if (typeof MessageChannel === 'function') {
        if (!yieldCh) yieldCh = new MessageChannel();
        yieldCh.port1.onmessage = function () { yieldCh.port1.onmessage = null; res(); };
        yieldCh.port2.postMessage(0);
      } else setTimeout(res, 0);
    });
  }
  function u32(v) { return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; }

  var CRC_T = null;
  function crc32(parts) {
    if (!CRC_T) {
      CRC_T = new Uint32Array(256);
      for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); CRC_T[n] = c >>> 0; }
    }
    var crc = 0xFFFFFFFF;
    for (var p = 0; p < parts.length; p++) {
      var d = parts[p];
      for (var i = 0; i < d.length; i++) crc = CRC_T[(crc ^ d[i]) & 255] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function pngChunk(type, data) {
    var t = new Uint8Array([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)]);
    return [new Uint8Array(u32(data.length)), t, data, new Uint8Array(u32(crc32([t, data])))];
  }

  /* ───────────────────────── PNG row filtering + zlib ───────────────────────── */
  var ABS8 = new Uint8Array(256);
  for (var q = 0; q < 256; q++) ABS8[q] = q < 128 ? q : 256 - q;

  /* Filters rows of an image (ch = 1, 3 or 4 channels, taken from an RGBA buffer or an alpha plane) with the
     per-row min-sum-of-abs heuristic and streams them (filter byte + bytes) through a zlib compressor.
     → Uint8Array[] (the compressed zlib stream, in pieces). */
  async function zlibRows(src, w, h, ch, plane, opts) {
    if (typeof CompressionStream !== 'function') throw new Error('this browser has no CompressionStream (needed for PNG / PDF)');
    var signal = opts && opts.signal, onProgress = opts && opts.onProgress;
    var rb = w * ch, bpp = ch;
    var cur = new Uint8Array(rb), prev = new Uint8Array(rb);
    var rowsPer = Math.max(1, Math.min(h, Math.floor(8388608 / (rb + 1))));
    var out = new Uint8Array(rowsPer * (rb + 1));
    var cs = new CompressionStream('deflate');
    var writer = cs.writable.getWriter(), reader = cs.readable.getReader();
    var pieces = [];
    var pump = (async function () {
      for (;;) { var r = await reader.read(); if (r.done) break; pieces.push(r.value); }
    })();
    try {
      for (var y0 = 0; y0 < h; y0 += rowsPer) {
        checkAbort(signal);
        var rows = Math.min(rowsPer, h - y0), o = 0;
        for (var y = y0; y < y0 + rows; y++) {
          /* fetch the row */
          var s = y * w * 4, i;
          if (ch === 4) { for (i = 0; i < rb; i++) cur[i] = src[s + i]; }
          else if (ch === 3) { for (i = 0, s = y * w * 4; i < rb; i += 3, s += 4) { cur[i] = src[s]; cur[i + 1] = src[s + 1]; cur[i + 2] = src[s + 2]; } }
          else if (plane) { for (i = 0, s = y * w + 3 - 3; i < rb; i++, s++) cur[i] = src[s]; }
          else { for (i = 0, s = y * w * 4 + 3; i < rb; i++, s += 4) cur[i] = src[s]; }
          /* score the five filters */
          var s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
          for (i = 0; i < rb; i++) {
            var x = cur[i], a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
            s0 += ABS8[x]; s1 += ABS8[(x - a) & 255]; s2 += ABS8[(x - b) & 255]; s3 += ABS8[(x - ((a + b) >> 1)) & 255];
            var p = a + b - c, pa = p > a ? p - a : a - p, pb = p > b ? p - b : b - p, pc = p > c ? p - c : c - p;
            var pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
            s4 += ABS8[(x - pr) & 255];
          }
          var f = 0, best = s0;
          if (s1 < best) { best = s1; f = 1; } if (s2 < best) { best = s2; f = 2; }
          if (s3 < best) { best = s3; f = 3; } if (s4 < best) { best = s4; f = 4; }
          out[o++] = f;
          if (f === 0) { for (i = 0; i < rb; i++) out[o + i] = cur[i]; }
          else if (f === 1) { for (i = 0; i < rb; i++) out[o + i] = cur[i] - (i >= bpp ? cur[i - bpp] : 0); }
          else if (f === 2) { for (i = 0; i < rb; i++) out[o + i] = cur[i] - prev[i]; }
          else if (f === 3) { for (i = 0; i < rb; i++) out[o + i] = cur[i] - (((i >= bpp ? cur[i - bpp] : 0) + prev[i]) >> 1); }
          else {
            for (i = 0; i < rb; i++) {
              var a2 = i >= bpp ? cur[i - bpp] : 0, b2 = prev[i], c2 = i >= bpp ? prev[i - bpp] : 0;
              var p2 = a2 + b2 - c2, qa = p2 > a2 ? p2 - a2 : a2 - p2, qb = p2 > b2 ? p2 - b2 : b2 - p2, qc = p2 > c2 ? p2 - c2 : c2 - p2;
              out[o + i] = cur[i] - ((qa <= qb && qa <= qc) ? a2 : (qb <= qc ? b2 : c2));
            }
          }
          o += rb;
          var t = prev; prev = cur; cur = t;
        }
        /* the compressor takes its own copy of the chunk, so `out` can be reused */
        await writer.write(out.slice(0, o));
        if (onProgress) onProgress(Math.min(1, (y0 + rows) / h));
        await yieldNow();
      }
      await writer.close();
      await pump;
    } catch (e) {
      try { await writer.abort(e); } catch (e2) { /* */ }
      try { await pump; } catch (e3) { /* */ }
      throw e;
    }
    return pieces;
  }

  function totalLen(pieces) { var n = 0; for (var i = 0; i < pieces.length; i++) n += pieces[i].length; return n; }
  function joinPieces(pieces) {
    var all = new Uint8Array(totalLen(pieces)), o = 0;
    for (var i = 0; i < pieces.length; i++) { all.set(pieces[i], o); o += pieces[i].length; }
    return all;
  }

  /* ───────────────────────── encodePNG ───────────────────────── */
  async function encodePNG(rgba, w, h, opts) {
    opts = opts || {};
    w = w | 0; h = h | 0;
    if (!(w > 0 && h > 0)) throw new Error('encodePNG: bad size');
    if (rgba.length < w * h * 4) throw new Error('encodePNG: buffer too small');
    var alpha = !!opts.alpha;
    var pieces = await zlibRows(rgba, w, h, alpha ? 4 : 3, false, opts);
    var z = joinPieces(pieces); pieces = null;
    var ihdr = new Uint8Array(13);
    ihdr.set(u32(w), 0); ihdr.set(u32(h), 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    var parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
    parts = parts.concat(pngChunk('IHDR', ihdr));
    parts = parts.concat(pngChunk('sRGB', new Uint8Array([0])));
    parts = parts.concat(pngChunk('pHYs', new Uint8Array([0, 0, 0x0B, 0x13, 0, 0, 0x0B, 0x13, 1])));   /* 2835 px/m = 72 dpi */
    for (var o = 0; o < z.length; o += IDAT_MAX) parts = parts.concat(pngChunk('IDAT', z.subarray(o, Math.min(z.length, o + IDAT_MAX))));
    parts = parts.concat(pngChunk('IEND', new Uint8Array(0)));
    return new Blob(parts, { type: 'image/png' });
  }

  /* ───────────────────────── encodeJPEG ───────────────────────── */
  /* quality: 0…1 (default 1.0 = 4:4:4, all-ones quantisation in Chromium); jpegQuality(q 0…100) maps the panel's QUALITY */
  function jpegQuality(q) { q = Number(q); if (!isFinite(q)) q = 100; return Math.max(0.05, Math.min(1, q / 100)); }
  function encodeJPEG(canvas, quality) {
    var jq = typeof quality === 'number' && isFinite(quality) ? Math.max(0.05, Math.min(1, quality)) : 1.0;
    return new Promise(function (res, rej) {
      try {
        canvas.toBlob(function (b) { b ? res(b) : rej(new Error('JPEG encode failed (canvas too large for this browser?)')); }, 'image/jpeg', jq);
      } catch (e) { rej(e); }
    });
  }

  /* ───────────────────────── encodePDF ───────────────────────── */
  async function encodePDF(rgba, w, h, opts) {
    opts = opts || {};
    w = w | 0; h = h | 0;
    if (!(w > 0 && h > 0)) throw new Error('encodePDF: bad size');
    if (rgba.length < w * h * 4) throw new Error('encodePDF: buffer too small');
    var hasA = false;
    if (opts.alpha) { for (var i = 3, n = w * h * 4; i < n; i += 4) if (rgba[i] !== 255) { hasA = true; break; } }
    var prog = opts.onProgress;
    var o1 = { signal: opts.signal, onProgress: prog ? function (f) { prog(f * (hasA ? 0.7 : 1)); } : null };
    var rgbZ = await zlibRows(rgba, w, h, 3, false, o1);
    var aZ = null;
    if (hasA) aZ = await zlibRows(rgba, w, h, 1, false, { signal: opts.signal, onProgress: prog ? function (f) { prog(0.7 + 0.3 * f); } : null });

    var enc = new TextEncoder();
    var scale = Math.max(w, h) > 14400 ? 14400 / Math.max(w, h) : 1;
    var PW = Math.round(w * scale * 1000) / 1000, PH = Math.round(h * scale * 1000) / 1000;
    var nowD = new Date();
    function p2(v) { return (v < 10 ? '0' : '') + v; }
    var date = 'D:' + nowD.getUTCFullYear() + p2(nowD.getUTCMonth() + 1) + p2(nowD.getUTCDate()) + p2(nowD.getUTCHours()) + p2(nowD.getUTCMinutes()) + p2(nowD.getUTCSeconds()) + 'Z';

    var parts = [], pos = 0, offs = {};
    function add(x) { var u = typeof x === 'string' ? enc.encode(x) : x; parts.push(u); pos += u.length; }
    function obj(num, dictText, streamPieces) {
      offs[num] = pos;
      if (!streamPieces) { add(num + ' 0 obj\n' + dictText + '\nendobj\n'); return; }
      var len = totalLen(streamPieces);
      add(num + ' 0 obj\n' + dictText.replace('%LEN%', String(len)) + '\nstream\n');
      for (var k = 0; k < streamPieces.length; k++) add(streamPieces[k]);
      add('\nendstream\nendobj\n');
    }
    add('%PDF-1.4\n'); add(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>');
    var content = enc.encode('q ' + PW + ' 0 0 ' + PH + ' 0 0 cm /Im0 Do Q');
    obj(4, '<< /Length %LEN% >>', [content]);
    obj(5, '<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate false' +
      (hasA ? ' /SMask 6 0 R' : '') + ' /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ' + w + ' >> /Length %LEN% >>', rgbZ);
    rgbZ = null;
    if (hasA) { obj(6, '<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' /ColorSpace /DeviceGray /BitsPerComponent 8 /Interpolate false' +
      ' /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 1 /BitsPerComponent 8 /Columns ' + w + ' >> /Length %LEN% >>', aZ); aZ = null; }
    /* objects are numbered without gaps: no SMask → the Info dictionary is object 6 */
    var infoN = hasA ? 7 : 6;
    obj(infoN, '<< /Producer (VFX SYNTECH) /Creator (VFX SYNTECH) /CreationDate (' + date + ') >>');
    var xrefPos = pos, nObj = infoN + 1, x = 'xref\n0 ' + nObj + '\n0000000000 65535 f \n';
    for (var k = 1; k < nObj; k++) x += ('0000000000' + offs[k]).slice(-10) + ' 00000 n \n';
    add(x + 'trailer\n<< /Size ' + nObj + ' /Root 1 0 R /Info ' + infoN + ' 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');
    return new Blob(parts, { type: 'application/pdf' });
  }

  /* ───────────────────────── alpha ───────────────────────── */
  async function readAlpha(source, w, h, rect) {
    w = w | 0; h = h | 0;
    var bmp = null, own = false;
    if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) bmp = source;
    else if (source instanceof Blob) { bmp = await createImageBitmap(source, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); own = true; }
    else { bmp = await createImageBitmap(source, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); own = true; }
    try {
      var r = rect || { x: 0, y: 0, w: w, h: h };
      var rx = Math.max(0, Math.round(r.x)), ry = Math.max(0, Math.round(r.y));
      var rw = Math.min(w - rx, Math.round(r.w)), rh = Math.min(h - ry, Math.round(r.h));
      if (rw <= 0 || rh <= 0) return null;
      var cv = document.createElement('canvas'); cv.width = rw; cv.height = rh;
      var cx = cv.getContext('2d', { willReadFrequently: true });
      cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
      cx.clearRect(0, 0, rw, rh);
      cx.drawImage(bmp, 0, 0, bmp.width, bmp.height, 0, 0, rw, rh);
      var d = cx.getImageData(0, 0, rw, rh).data;
      var al = new Uint8Array(w * h); al.fill(255);
      var any = false;
      for (var y = 0; y < rh; y++) {
        var o = (ry + y) * w + rx, s = y * rw * 4 + 3;
        for (var x = 0; x < rw; x++, s += 4) { var a = d[s]; al[o + x] = a; if (a !== 255) any = true; }
      }
      cv.width = 0;
      return any ? al : null;
    } finally { if (own && bmp.close) bmp.close(); }
  }

  /* compose: the effect output (RGBA, computed from the photo flattened over BLACK, so rgb = c\u00b7a/255) +
     the photo's alpha plane → final straight-alpha RGBA.
       a = 0           → rgb' = 0
       otherwise       → rgb' = min(255, round(rgb \u00b7 255 / max(a, 16)))     (unpremultiply; the floor of 16
                         stops near-transparent pixels from amplifying noise into bright speckles)
       unpremultiply=false → rgb kept, only alpha replaced. */
  function composePixels(rgba, alpha, unpremultiply) {
    var n = alpha.length;
    for (var i = 0, o = 0; i < n; i++, o += 4) {
      var a = alpha[i];
      if (unpremultiply) {
        if (a === 0) { rgba[o] = 0; rgba[o + 1] = 0; rgba[o + 2] = 0; }
        else if (a !== 255) {
          var d = a < 16 ? 16 : a;
          var v;
          v = Math.round(rgba[o] * 255 / d); rgba[o] = v > 255 ? 255 : v;
          v = Math.round(rgba[o + 1] * 255 / d); rgba[o + 1] = v > 255 ? 255 : v;
          v = Math.round(rgba[o + 2] * 255 / d); rgba[o + 2] = v > 255 ? 255 : v;
        }
      }
      rgba[o + 3] = a;
    }
    return rgba;
  }
  function compose(rgbaOpaque, alpha, opts) {
    var un = !(opts && opts.unpremultiply === false);
    var buf = rgbaOpaque instanceof Uint8ClampedArray ? rgbaOpaque : new Uint8ClampedArray(rgbaOpaque);
    return composePixels(buf, alpha, un);
  }

  /* ── ALPHA v2 (docs/workflow/13-EXPORT-PANEL.md §3) ──
     combineAlpha(c, m, opts) → {data, width, height, hasAlpha}       PURE (no DOM): the effect's colour + its matte → RGBA.
       c     ImageData | {data, width, height}: C = SynFx.frame's picture, opaque, computed over BLACK (premultiplied).
       m     the geometric alpha M: ImageData | {data, width, height} (R channel; = SynFx.matte's output) |
             Uint8Array plane of width·height bytes (e.g. readAlpha's source alpha) | null (= 255, opaque geometry).
       opts  floor (6): noise floor of U in 0…255;  unmult (true): false = no U (an effect that paints its own
             background, or SynFx.frame returned unmult:false);  gate (true): U only where the 3×3 mean of maxRGB is
             above the floor too (no veil from grain on black);  inPlace (false): write into c.data.
       Per pixel: U = 0 when maxRGB(C) ≤ floor, else (maxRGB − floor) · 255 / (255 − floor)   (After Effects "Unmult":
       light the effect added outside the silhouette — glow, HUD, points — survives, semi-transparent; the soft ramp
       above the floor keeps grain on black from becoming a veil and has no step);
       A = max(M, U);  colour = C · 255 / max(A, 16) (de-premultiplied, clamped; A = 0 → black);  hasAlpha = some A < 255.
     makeAlphaSource(src, w?, h?) → canvas w×h (default the source's size), RGB = the source's alpha, A = 255 (opaque):
       what SynFx.matte(alphaSrc, i, t) receives. src: an image / bitmap / canvas (drawn at w×h) or a Uint8Array alpha
       plane of w·h bytes. Synchronous. */
  function combineAlpha(c, m, opts) {
    opts = opts || {};
    var w = c.width | 0, h = c.height | 0, n = w * h, cd = c.data;
    if (!(n > 0) || !cd || cd.length < n * 4) throw new Error('combineAlpha: bad colour image');
    var out = opts.inPlace ? cd : new Uint8ClampedArray(cd);
    var floor = opts.floor === undefined ? 6 : Math.max(0, Math.min(254, opts.floor | 0)), un = opts.unmult !== false;
    var md = null, ms = 1;
    if (m) {
      if (m.data) { md = m.data; ms = 4; if ((m.width | 0) !== w || (m.height | 0) !== h) throw new Error('combineAlpha: matte ' + m.width + '×' + m.height + ' ≠ colour ' + w + '×' + h); }
      else { md = m; if (md.length < n) throw new Error('combineAlpha: alpha plane too small'); }
    }
    var LUT = new Uint8Array(256), k = 255 / (255 - floor);
    for (var v = 0; v < 256; v++) LUT[v] = v > floor ? Math.min(255, Math.round((v - floor) * k)) : 0;
    /* spatial gate: U only where the 3×3 MEAN of maxRGB is above the floor too — a lone grain / noise speckle on black
       is not light the effect added (measured: ANALOG's grain on black reaches 15/255 on single pixels, its 3×3 mean
       stays ≤ 4), while a 1-px HUD line (mean ≥ 85) or a single bright point (mean ≥ floor) keeps its full U */
    var gate = null;
    if (un && opts.gate !== false) {
      var mxp = new Uint8Array(n), x0, y0;
      for (var p = 0, q4 = 0; p < n; p++, q4 += 4) { var r0 = cd[q4], g0 = cd[q4 + 1], b0 = cd[q4 + 2]; mxp[p] = r0 > g0 ? (r0 > b0 ? r0 : b0) : (g0 > b0 ? g0 : b0); }
      var hs = new Uint16Array(n);                        /* horizontal 3-sums */
      for (y0 = 0; y0 < h; y0++) {
        var ro = y0 * w;
        for (x0 = 0; x0 < w; x0++) hs[ro + x0] = mxp[ro + x0] + mxp[ro + (x0 > 0 ? x0 - 1 : 0)] + mxp[ro + (x0 < w - 1 ? x0 + 1 : w - 1)];
      }
      gate = new Uint8Array(n); var lim = floor * 9;
      for (y0 = 0; y0 < h; y0++) {
        var up = (y0 > 0 ? y0 - 1 : 0) * w, dn = (y0 < h - 1 ? y0 + 1 : h - 1) * w, mid = y0 * w;
        for (x0 = 0; x0 < w; x0++) gate[mid + x0] = hs[up + x0] + hs[mid + x0] + hs[dn + x0] > lim ? 1 : 0;
      }
      mxp = null; hs = null;
    }
    var any = false;
    for (var i = 0, o = 0, mo = 0; i < n; i++, o += 4, mo += ms) {
      var r = out[o], g = out[o + 1], b = out[o + 2];
      var M = md ? md[mo] : 255, A = M;
      if (un && A < 255 && (!gate || gate[i])) { var mx = r > g ? (r > b ? r : b) : (g > b ? g : b), U = LUT[mx]; if (U > A) A = U; }
      if (A === 0) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; any = true; }
      else if (A !== 255) {
        var d = A < 16 ? 16 : A, x;
        x = Math.round(r * 255 / d); out[o] = x > 255 ? 255 : x;
        x = Math.round(g * 255 / d); out[o + 1] = x > 255 ? 255 : x;
        x = Math.round(b * 255 / d); out[o + 2] = x > 255 ? 255 : x;
        any = true;
      }
      out[o + 3] = A;
    }
    return { data: out, width: w, height: h, hasAlpha: any };
  }
  function makeAlphaSource(src, w, h) {
    var plane = src && !src.getContext && typeof src.length === 'number' && !src.width;
    w = (w || (plane ? 0 : (src.naturalWidth || src.videoWidth || src.width))) | 0;
    h = (h || (plane ? 0 : (src.naturalHeight || src.videoHeight || src.height))) | 0;
    if (!(w > 0 && h > 0)) throw new Error('makeAlphaSource: no size');
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var cx = cv.getContext('2d', { willReadFrequently: true });
    var id;
    if (plane) {
      if (src.length < w * h) throw new Error('makeAlphaSource: alpha plane too small');
      id = cx.createImageData(w, h);
      for (var i = 0, o = 0; i < w * h; i++, o += 4) { var a = src[i]; id.data[o] = a; id.data[o + 1] = a; id.data[o + 2] = a; id.data[o + 3] = 255; }
    } else {
      cx.clearRect(0, 0, w, h);
      cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
      cx.drawImage(src, 0, 0, w, h);
      id = cx.getImageData(0, 0, w, h);
      for (var j = 0, p = 0; j < w * h; j++, p += 4) { var b = id.data[p + 3]; id.data[p] = b; id.data[p + 1] = b; id.data[p + 2] = b; id.data[p + 3] = 255; }
    }
    cx.putImageData(id, 0, 0);
    return cv;
  }

  /* ───────────────────────── saving ───────────────────────── */
  var TYPES = {
    png: { mime: 'image/png', ext: '.png', desc: 'PNG image' },
    jpeg: { mime: 'image/jpeg', ext: '.jpg', desc: 'JPEG image' },
    pdf: { mime: 'application/pdf', ext: '.pdf', desc: 'PDF document' }
  };
  function noPicker() { return window.__synExportNoPicker === true; }
  async function pickFile(filename, format) {
    var t = TYPES[format];
    if (!t || noPicker() || typeof window.showSaveFilePicker !== 'function') return null;
    try {
      var acc = {}; acc[t.mime] = [t.ext];
      return await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: t.desc, accept: acc }] });
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancel';
      return null;
    }
  }
  async function save(blob, filename, handle) {
    if (handle && handle !== 'cancel') {
      var w = await handle.createWritable();
      try { await w.write(blob); } catch (e) { try { await w.abort(); } catch (e2) { /* */ } throw e; }
      await w.close();
      return;
    }
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 60000);
  }

  /* ───────────────────────── exportStill ───────────────────────── */
  /* o: {format, render() → region, matte?(alphaSrc) → region, alphaSource?, alphaRect?(w,h), jpegQuality? (0…1),
         filename, useFilePicker, signal, onStatus}
     Transparency (PNG / PDF, only when the alphaSource photo HAS transparency; an opaque photo → RGB as before):
       C = the render's region (over black); M = o.matte(alphaSrc)'s region R channel when o.matte is given
       (alphaSrc = makeAlphaSource of the photo's alpha at its native size), else the photo's alpha placed with
       alphaRect (outside = 255: letterbox bars stay opaque); combineAlpha(C, M, {unmult: region.unmult !== false}). */
  async function exportStill(o) {
    var t0 = performance.now(), fmt = o.format, t = TYPES[fmt];
    var status = typeof o.onStatus === 'function' ? o.onStatus : function () {};
    function done(r) { window.__synStillLast = r; return r; }
    if (!t) return done({ error: 'unknown format ' + fmt });
    var filename = o.filename || ('still' + t.ext);
    var bmp = null;
    try {
      var handle = null;
      if (o.useFilePicker !== false) {
        handle = await pickFile(filename, fmt);       /* first: still inside the click's user activation */
        if (handle === 'cancel') return done({ cancelled: true });
        if (handle && handle.name) filename = handle.name;
      }
      checkAbort(o.signal);
      status('rendering…');
      var r = await o.render();
      if (!r || !r.canvas) return done({ error: 'nothing to export (no canvas returned)' });
      var cv = r.canvas;
      var sx = r.sx || 0, sy = r.sy || 0, sw = r.sw || cv.width, sh = r.sh || cv.height;
      if (sw > MAX_SIDE || sh > MAX_SIDE || sw * sh > MAX_AREA)
        return done({ error: 'image ' + sw + '×' + sh + ' is larger than this browser can handle (' + MAX_SIDE + ' px side / ' + Math.round(MAX_AREA / 1e6) + ' MP) — nothing was saved; the size is never reduced' });
      /* copy right now (same task): a WebGL canvas may lose its buffer later */
      var oc = document.createElement('canvas'); oc.width = sw; oc.height = sh;
      var ox = oc.getContext('2d', { willReadFrequently: fmt !== 'jpeg' });
      if (!ox || oc.width !== sw || oc.height !== sh) return done({ error: 'could not allocate a ' + sw + '×' + sh + ' canvas' });
      ox.fillStyle = '#000'; ox.fillRect(0, 0, sw, sh);
      ox.drawImage(cv, sx, sy, sw, sh, 0, 0, sw, sh);
      var blob, hasAlpha = false, alphaMode = 'none';
      if (fmt === 'jpeg') {
        var jq = typeof o.jpegQuality === 'number' ? o.jpegQuality : 1.0;
        status('encoding JPEG q' + Math.round(jq * 100) + '…');
        blob = await encodeJPEG(oc, jq);
      } else {
        var cImg = ox.getImageData(0, 0, sw, sh);
        var mImg = null, plane = null, srcAlpha = null;
        if (o.alphaSource) {
          status('reading transparency…');
          bmp = await createImageBitmap(o.alphaSource, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
          srcAlpha = await readAlpha(bmp, bmp.width, bmp.height);          /* null = the photo is opaque */
        }
        if (srcAlpha && typeof o.matte === 'function') {
          var mr = await o.matte(makeAlphaSource(srcAlpha, bmp.width, bmp.height));
          if (mr && mr.canvas) {
            /* read in this task too; the matte region is scaled to the colour region only if they disagree */
            var mc = document.createElement('canvas'); mc.width = sw; mc.height = sh;
            var mx = mc.getContext('2d', { willReadFrequently: true });
            mx.fillStyle = '#000'; mx.fillRect(0, 0, sw, sh);
            mx.drawImage(mr.canvas, mr.sx || 0, mr.sy || 0, mr.sw || mr.canvas.width, mr.sh || mr.canvas.height, 0, 0, sw, sh);
            mImg = mx.getImageData(0, 0, sw, sh); mc.width = 0;
            alphaMode = 'matte';
          }
        }
        if (srcAlpha && !mImg) {
          /* no SynFx.matte: the photo's own alpha where the photo sits in the region (the render's alphaRect, e.g.
             between letterbox bars, else the caller's alphaRect(w, h), else the whole region) */
          var rect = r.alphaRect || (typeof o.alphaRect === 'function' ? o.alphaRect(sw, sh) : null);
          plane = await readAlpha(bmp, sw, sh, rect || undefined);
          alphaMode = 'source';
        }
        if (srcAlpha) {
          var comb = combineAlpha(cImg, mImg || plane, { inPlace: true, unmult: r.unmult !== false });
          hasAlpha = comb.hasAlpha;
        }
        var px = cImg.data;
        oc.width = 0;
        checkAbort(o.signal);
        var eo = { alpha: hasAlpha, signal: o.signal, onProgress: function (f) { status('encoding ' + fmt.toUpperCase() + ' ' + Math.round(f * 100) + '%'); } };
        blob = fmt === 'png' ? await encodePNG(px, sw, sh, eo) : await encodePDF(px, sw, sh, eo);
        px = null; cImg = null; mImg = null;
      }
      oc.width = 0;
      status('saving…');
      await save(blob, filename, handle);
      return done({ format: fmt, filename: filename, width: sw, height: sh, alpha: hasAlpha, alphaMode: alphaMode, bytes: blob.size,
        jpegQuality: fmt === 'jpeg' ? (typeof o.jpegQuality === 'number' ? o.jpegQuality : 1.0) : undefined,
        seconds: Math.round((performance.now() - t0) / 100) / 10 });
    } catch (e) {
      if (e && e.name === 'AbortError') return done({ cancelled: true });
      return done({ error: (e && e.message) || String(e) });
    } finally { if (bmp && bmp.close) bmp.close(); }
  }

  /* ───────────────────────── quality + panel (shared with syn-export.js through window globals) ───────────────────────── */
  var SELF_SRC = (document.currentScript && document.currentScript.src) || '';
  function storedQuality() {
    if (window.SynPanel && typeof window.SynPanel.quality === 'function') { try { return window.SynPanel.quality(); } catch (e) { /* */ } }
    try {
      var v = localStorage.getItem('syntech.export.q');
      if (v !== null && v !== '' && isFinite(Number(v))) return Math.max(0, Math.min(100, Math.round(Number(v))));
      return localStorage.getItem('syntech.export.quality') === 'high' ? 60 : 100;
    } catch (e) { return 100; }
  }
  function registerPanel(kind, ctl, cfg) {
    (window.__synPanelQ = window.__synPanelQ || []).push({ kind: kind, ctl: ctl, cfg: cfg });
    if (window.SynPanel && typeof window.SynPanel._drain === 'function') { window.SynPanel._drain(); return; }
    if (window.__synPanelLoading) return;
    window.__synPanelLoading = true;
    var sc = document.createElement('script');
    sc.src = SELF_SRC ? new URL('syn-panel.js', SELF_SRC).href : '../shared/syn-panel.js';
    sc.onerror = function () { window.__synPanelLoading = false; };
    (document.head || document.documentElement).appendChild(sc);
  }

  /* ───────────────────────── attach ───────────────────────── */
  /* attach(cfg) → controller {busy(), run(format), linkExport(exportController), onState(fn), owner()}
     cfg: label, anchorEl, buttonClass, toast(msg, ms), statusId, hasStill(), getStillFile() → File | image,
          sourceName(), beforeStill(), renderStill() → region, afterStill(result), alphaRect?(w, h), panel? (false = no panel)
     run(format) — PNG / JPEG / PDF:
       PHOTO (cfg.hasStill()): the effect's still at the photo's native size (before/render/afterStill); alpha v2 —
         M from window.SynFx.matte(alphaSrc, i, t) when the effect defines it (i, t = those of its last frame()),
         else the photo's alpha; U from the colour (exportStill). JPEG quality = max(0.05, QUALITY/100).
       VIDEO FILE / WEBCAM (the linked SynExport controller's source(): video or live): the CURRENT frame, opaque, at
         the video's native size — captured synchronously in the click (drawImage of the <video>), then drawn by
         SynFx in 'still' mode (begin({mode:'still', width, height}) → frame(capture) → end()), exactly like a photo
         of that frame. No <video> picture (or no SynFx): the effect's live canvas as it is. */
  function attach(cfg) {
    var anchor = typeof cfg.anchorEl === 'string' ? document.getElementById(cfg.anchorEl) : cfg.anchorEl;
    if (!anchor || !anchor.parentNode) return { busy: function () { return false; }, run: function () {}, linkExport: function () {}, onState: function () {}, owner: function () { return null; } };
    var rawToast = typeof cfg.toast === 'function' ? cfg.toast : function () {};
    /* through the panel: when the effect's toast is not visible (hidden status line) the panel shows its own */
    var toast = function (m, ms) { var P = window.SynPanel; if (P && typeof P.toastVia === 'function') P.toastVia(rawToast, m, ms); else rawToast(m, ms); };
    var label = cfg.label || 'VFX';
    var running = null, exportCtl = null, stateFns = [];
    function base(name) { return String(name || 'image').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_').slice(0, 60) || 'image'; }
    function status(t) { if (cfg.statusId) { var s = document.getElementById(cfg.statusId); if (s) s.textContent = t; } }
    function call(fn) { if (typeof fn === 'function') { try { return fn.apply(null, [].slice.call(arguments, 1)); } catch (e) { console.error(e); } } }
    function emit(text) {
      var st = { owner: running, text: running ? (text || null) : null };
      stateFns.forEach(function (fn) { try { fn(st); } catch (e) { console.error(e); } });
    }
    function setBtns(b) {
      row.querySelectorAll('button').forEach(function (x) { x.style.opacity = b ? '0.6' : ''; x.setAttribute('aria-busy', b ? 'true' : 'false'); });
    }

    var row = document.createElement('div');
    row.id = 'syn-still-row';
    row.style.cssText = 'display:flex;gap:6px;margin-top:6px';
    [['png', 'PNG'], ['jpeg', 'JPEG'], ['pdf', 'PDF']].forEach(function (f) {
      var b = document.createElement('button');
      b.type = 'button'; b.id = 'syn-still-' + f[0]; b.setAttribute('data-still', f[0]);
      b.className = (cfg.buttonClass ? cfg.buttonClass + ' ' : '') + 'syn-still-btn';
      b.style.flex = '1'; b.textContent = f[1];
      b.addEventListener('click', function () { run(f[0]); });
      row.appendChild(b);
    });
    anchor.parentNode.insertBefore(row, anchor.nextSibling);

    /* the current frame of a video / webcam, captured NOW (synchronously, inside the click) at its native size */
    function captureFrame() {
      var src = exportCtl && typeof exportCtl.source === 'function' ? exportCtl.source() : null;
      if (!src || (src.kind !== 'video' && src.kind !== 'live')) return null;
      var v = src.video, c = document.createElement('canvas');
      if (v && v.videoWidth > 0 && v.videoHeight > 0) {
        c.width = v.videoWidth; c.height = v.videoHeight;
        var cap = { canvas: c, kind: src.kind, fromVideo: true, t: v.currentTime || 0, ready: null };
        if (v.readyState >= 2) c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        else cap.ready = (async function () {      /* between two frames (a loop / seek): the next decoded one, ≤ 3 s */
          for (var t0 = performance.now(); v.readyState < 2 && performance.now() - t0 < 3000;) await new Promise(function (r) { setTimeout(r, 20); });
          if (v.readyState < 2) throw new Error('the video frame is not decoded yet \u2014 try again');
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          cap.t = v.currentTime || 0;
        })();
        return cap;
      }
      var g = exportCtl.cfg && typeof exportCtl.cfg.getLiveCanvas === 'function' ? call(exportCtl.cfg.getLiveCanvas) : null;
      if (g && !g.canvas) g = { canvas: g };
      if (!g || !g.canvas || !g.canvas.width) return null;
      var sw = g.sw || g.canvas.width, sh = g.sh || g.canvas.height;
      c.width = sw; c.height = sh;
      c.getContext('2d').drawImage(g.canvas, g.sx || 0, g.sy || 0, sw, sh, 0, 0, sw, sh);
      return { canvas: c, kind: src.kind, fromVideo: false, t: 0, ready: null };
    }

    async function run(format) {
      if (running) { toast('still export already running…', 2500); return; }
      if (window.__synExportBusy || (exportCtl && typeof exportCtl.owner === 'function' && exportCtl.owner())) { toast('an MP4 export is running — stop it or wait', 2500); return; }
      if (!TYPES[format]) return;
      var photo = !!(typeof cfg.hasStill === 'function' && cfg.hasStill());
      var cap = photo ? null : captureFrame();        /* synchronous: the frame the operator is looking at */
      if (!photo && !cap) { toast('PNG / JPEG / PDF need a photo, a video or the webcam', 4000); return; }
      running = format; window.__synStillBusy = true; setBtns(true); emit('WRITING…');
      var result = null, fx = window.SynFx, origFrame = null, last = { i: 0, t: 0 }, began = false;
      var q = storedQuality();
      try {
        var filename;
        if (photo) {
          var file = call(cfg.getStillFile);
          filename = base(call(cfg.sourceName)) + '_' + base(label).toUpperCase() + TYPES[format].ext;
          var useMatte = !!(fx && typeof fx.matte === 'function' && typeof fx.frame === 'function');
          if (useMatte) {                               /* remember i, t of the last frame() for matte() */
            origFrame = fx.frame;
            fx.frame = function (s, i, t) { last.i = i; last.t = t; return origFrame.apply(fx, arguments); };
          }
          result = await exportStill({
            format: format, filename: filename, useFilePicker: cfg.useFilePicker !== false,
            alphaSource: file || null, jpegQuality: jpegQuality(q),
            alphaRect: typeof cfg.alphaRect === 'function' ? cfg.alphaRect : null,
            render: async function () { await call(cfg.beforeStill); return await cfg.renderStill(); },
            matte: useMatte ? function (alphaSrc) { return fx.matte(alphaSrc, last.i, last.t); } : null,
            onStatus: status
          });
        } else {
          var nm = exportCtl && exportCtl.cfg ? call(exportCtl.cfg.sourceName) : '';
          filename = base(nm || (cap.kind === 'live' ? 'live' : 'frame')) + '_' + base(label).toUpperCase() + TYPES[format].ext;
          var useFx = !!(cap.fromVideo && fx && typeof fx.begin === 'function');
          result = await exportStill({
            format: format, filename: filename, useFilePicker: cfg.useFilePicker !== false,
            alphaSource: null, jpegQuality: jpegQuality(q),
            render: async function () {
              if (cap.ready) await cap.ready;
              if (!useFx) return { canvas: cap.canvas };
              await fx.begin({ mode: 'still', width: cap.canvas.width, height: cap.canvas.height });
              began = true;
              return await fx.frame(cap.canvas, 0, cap.t);
            },
            onStatus: status
          });
        }
        if (result.cancelled) { status('save cancelled'); }
        else if (result.error) { status('✕ ' + result.error); toast('⚠ ' + format.toUpperCase() + ': ' + result.error, 6000); }
        else {
          var mode = format === 'jpeg' ? 'RGB · q' + Math.round((result.jpegQuality || 1) * 100) + (result.jpegQuality >= 1 ? ' 4:4:4' : '') : (result.alpha ? 'RGBA (transparent)' : 'RGB');
          var msg = '✓ ' + result.filename + ' · ' + result.width + '×' + result.height + ' · ' + mode + ' · ' + (result.bytes / 1048576).toFixed(1) + ' MB';
          status(msg); toast(msg, 5000);
        }
      } catch (e) {
        result = { error: (e && e.message) || String(e) };
        window.__synStillLast = result;
        status('✕ ' + result.error); toast('⚠ ' + format.toUpperCase() + ': ' + result.error, 6000);
      } finally {
        if (origFrame) fx.frame = origFrame;
        if (began) { try { await fx.end(); } catch (e) { console.error(e); } }
        if (cap) cap.canvas.width = 0;
        running = null; window.__synStillBusy = false; setBtns(false);
        if (photo) call(cfg.afterStill, result);
        emit(null);
      }
    }
    var ctl = {
      busy: function () { return !!running; }, run: run, owner: function () { return running; },
      linkExport: function (c) { exportCtl = c || null; },
      onState: function (fn) { if (typeof fn === 'function') stateFns.push(fn); },
      notify: function (m, ms) { toast(m, ms); },
      cfg: cfg, row: row
    };
    if (cfg.panel !== false) registerPanel('still', ctl, cfg);
    return ctl;
  }

  window.SynStill = { encodePNG: encodePNG, encodeJPEG: encodeJPEG, encodePDF: encodePDF, readAlpha: readAlpha, compose: compose,
    combineAlpha: combineAlpha, makeAlphaSource: makeAlphaSource, jpegQuality: jpegQuality,
    pickFile: pickFile, save: save, exportStill: exportStill, attach: attach };
})();
