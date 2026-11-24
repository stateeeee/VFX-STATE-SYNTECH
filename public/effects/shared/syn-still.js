/* VFX SYNTECH — SynStill: PNG · JPEG · PDF export of a loaded PHOTO, for every effect.
 *
 * WHY (operator request): a photo run through an effect must come out as a real still image at the
 * photo's NATIVE resolution, at maximum quality, never compressed lossy beyond what the format forces:
 *   - PNG  : our OWN writer (not canvas.toBlob — a 2D canvas stores premultiplied alpha and loses the
 *            precision of low-alpha pixels). 8-bit, colour type 6 (RGBA, real transparency) or 2 (RGB),
 *            sRGB chunk, per-row adaptive filter (min sum of absolute signed bytes), zlib via
 *            CompressionStream('deflate'), streamed in row batches (8K needs no extra full copies),
 *            IDAT split in <= 4 MB chunks. Lossless.
 *   - JPEG : canvas.toBlob('image/jpeg', 1.0) — in Chromium quality 1.0 = 4:4:4 chroma sampling and
 *            all-ones quantisation tables, the maximum the format allows. Canvas must be opaque.
 *   - PDF  : our OWN minimal PDF 1.4 writer, lossless: one page, the pixels as a /DeviceRGB 8-bit
 *            FlateDecode image with PNG predictors (/Predictor 15), /Interpolate false, plus an /SMask
 *            (DeviceGray alpha) when the photo has transparency. 1 px = 1 pt (scaled down only when the
 *            long side would exceed 14400 pt; the image keeps every pixel).
 *   - Native resolution: nothing is ever downscaled; too big for the browser canvas → a clear error.
 *
 * Effects compute their output from the photo flattened over BLACK; the photo's own alpha is read
 * separately (readAlpha) and re-applied (compose) so a transparent PNG stays transparent.
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
 *   exportStill({format, render, alphaSource, alphaRect, filename, useFilePicker, signal, onStatus}) → Promise<result>
 *        result {format, filename, width, height, alpha, bytes, seconds} | {error} | {cancelled:true};
 *        also stored in window.__synStillLast.
 *   attach(cfg) → {busy(), run(format)}   adds the PNG · JPEG · PDF button row after cfg.anchorEl.
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
  function encodeJPEG(canvas) {
    return new Promise(function (res, rej) {
      try {
        canvas.toBlob(function (b) { b ? res(b) : rej(new Error('JPEG encode failed (canvas too large for this browser?)')); }, 'image/jpeg', 1.0);
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
  async function exportStill(o) {
    var t0 = performance.now(), fmt = o.format, t = TYPES[fmt];
    var status = typeof o.onStatus === 'function' ? o.onStatus : function () {};
    function done(r) { window.__synStillLast = r; return r; }
    if (!t) return done({ error: 'unknown format ' + fmt });
    var filename = o.filename || ('still' + t.ext);
    try {
      var handle = null;
      if (o.useFilePicker !== false) {
        handle = await pickFile(filename, fmt);       /* first: still inside the click's user activation */
        if (handle === 'cancel') return done({ cancelled: true });
        if (handle && handle.name) filename = handle.name;
      }
      checkAbort(o.signal);
      status('rendering\u2026');
      var r = await o.render();
      if (!r || !r.canvas) return done({ error: 'nothing to export (no canvas returned)' });
      var cv = r.canvas;
      var sx = r.sx || 0, sy = r.sy || 0, sw = r.sw || cv.width, sh = r.sh || cv.height;
      if (sw > MAX_SIDE || sh > MAX_SIDE || sw * sh > MAX_AREA)
        return done({ error: 'image ' + sw + '\u00d7' + sh + ' is larger than this browser can handle (' + MAX_SIDE + ' px side / ' + Math.round(MAX_AREA / 1e6) + ' MP) \u2014 nothing was saved; the size is never reduced' });
      /* copy right now (same task): a WebGL canvas may lose its buffer later */
      var oc = document.createElement('canvas'); oc.width = sw; oc.height = sh;
      var ox = oc.getContext('2d', { willReadFrequently: fmt !== 'jpeg' });
      if (!ox || oc.width !== sw || oc.height !== sh) return done({ error: 'could not allocate a ' + sw + '\u00d7' + sh + ' canvas' });
      ox.fillStyle = '#000'; ox.fillRect(0, 0, sw, sh);
      ox.drawImage(cv, sx, sy, sw, sh, 0, 0, sw, sh);
      var blob, hasAlpha = false;
      if (fmt === 'jpeg') {
        status('encoding JPEG q100\u2026');
        blob = await encodeJPEG(oc);
      } else {
        var px = ox.getImageData(0, 0, sw, sh).data;
        oc.width = 0;
        var al = null;
        if (o.alphaSource) {
          status('reading transparency\u2026');
          /* where the photo sits in the exported region: the render's own alphaRect (e.g. between letterbox
             bars), else the caller's alphaRect(w, h), else the whole region */
          var rect = r.alphaRect || (typeof o.alphaRect === 'function' ? o.alphaRect(sw, sh) : null);
          al = await readAlpha(o.alphaSource, sw, sh, rect || undefined);
        }
        if (al) { px = compose(px, al, { unpremultiply: true }); hasAlpha = true; }
        checkAbort(o.signal);
        var eo = { alpha: hasAlpha, signal: o.signal, onProgress: function (f) { status('encoding ' + fmt.toUpperCase() + ' ' + Math.round(f * 100) + '%'); } };
        blob = fmt === 'png' ? await encodePNG(px, sw, sh, eo) : await encodePDF(px, sw, sh, eo);
        px = null;
      }
      oc.width = 0;
      status('saving\u2026');
      await save(blob, filename, handle);
      return done({ format: fmt, filename: filename, width: sw, height: sh, alpha: hasAlpha, bytes: blob.size,
        seconds: Math.round((performance.now() - t0) / 100) / 10 });
    } catch (e) {
      if (e && e.name === 'AbortError') return done({ cancelled: true });
      return done({ error: (e && e.message) || String(e) });
    }
  }

  /* ───────────────────────── attach ───────────────────────── */
  function attach(cfg) {
    var anchor = typeof cfg.anchorEl === 'string' ? document.getElementById(cfg.anchorEl) : cfg.anchorEl;
    if (!anchor || !anchor.parentNode) return { busy: function () { return false; }, run: function () {} };
    var toast = typeof cfg.toast === 'function' ? cfg.toast : function () {};
    var label = cfg.label || 'VFX';
    var running = false;
    function base(name) { return String(name || 'image').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_').slice(0, 60) || 'image'; }
    function status(t) { if (cfg.statusId) { var s = document.getElementById(cfg.statusId); if (s) s.textContent = t; } }
    function call(fn) { if (typeof fn === 'function') { try { return fn.apply(null, [].slice.call(arguments, 1)); } catch (e) { console.error(e); } } }
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

    async function run(format) {
      if (running) { toast('still export already running\u2026', 2500); return; }
      if (window.__synExportBusy) { toast('an MP4 export is running \u2014 stop it or wait', 2500); return; }
      if (!TYPES[format]) return;
      if (!(typeof cfg.hasStill === 'function' && cfg.hasStill())) { toast('PNG / JPEG / PDF need a photo \u2014 for video use RENDER MP4', 4000); return; }
      running = true; window.__synStillBusy = true; setBtns(true);
      var result = null;
      try {
        var file = call(cfg.getStillFile);
        var filename = base(call(cfg.sourceName)) + '_' + base(label).toUpperCase() + TYPES[format].ext;
        result = await exportStill({
          format: format, filename: filename, useFilePicker: cfg.useFilePicker !== false,
          alphaSource: file || null,
          alphaRect: typeof cfg.alphaRect === 'function' ? cfg.alphaRect : null,
          render: async function () { await call(cfg.beforeStill); return await cfg.renderStill(); },
          onStatus: status
        });
        if (result.cancelled) { status('save cancelled'); }
        else if (result.error) { status('\u2715 ' + result.error); toast('\u26a0 ' + format.toUpperCase() + ': ' + result.error, 6000); }
        else {
          var mode = format === 'jpeg' ? 'RGB \u00b7 q100 4:4:4' : (result.alpha ? 'RGBA (transparent)' : 'RGB');
          var msg = '\u2713 ' + result.filename + ' \u00b7 ' + result.width + '\u00d7' + result.height + ' \u00b7 ' + mode + ' \u00b7 ' + (result.bytes / 1048576).toFixed(1) + ' MB';
          status(msg); toast(msg, 5000);
        }
      } catch (e) {
        result = { error: (e && e.message) || String(e) };
        window.__synStillLast = result;
        status('\u2715 ' + result.error); toast('\u26a0 ' + format.toUpperCase() + ': ' + result.error, 6000);
      } finally {
        running = false; window.__synStillBusy = false; setBtns(false);
        call(cfg.afterStill, result);
      }
    }
    return { busy: function () { return running; }, run: run };
  }

  window.SynStill = { encodePNG: encodePNG, encodeJPEG: encodeJPEG, encodePDF: encodePDF, readAlpha: readAlpha, compose: compose,
    pickFile: pickFile, save: save, exportStill: exportStill, attach: attach };
})();
