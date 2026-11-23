/* VFX SYNTECH — SynExport: MP4-only export for every effect (docs/workflow/10-EXPORT-MASTER.md).
 *
 * Two ways out, both MP4, both at the full resolution of the effect's canvas:
 *
 *  A. render(opts) — OFFLINE, "like Premiere", for a VIDEO FILE source. Every source frame becomes
 *     exactly one output frame, at the source's exact frame rate (read from the MP4/MOV boxes:
 *     23.976 … 240, 29.97 stays 30000/1001), however slow the effect draws:
 *       1. frame rate + frame count from moov → trak[vide] → mdhd + stts (moov at the start or at the
 *          end of the file, 64-bit sizes); other containers: estimated with requestVideoFrameCallback;
 *       2. for each frame i: seek the <video> to the frame centre (i+0.5)/fps, wait until that frame is
 *          decoded (rVFC; mediaTime checked, re-seek once when the wrong frame is presented), call the
 *          effect's getFrame(i, t), encode the returned canvas region with WebCodecs at the exact
 *          timestamp i·den/num;
 *       3. the source's own audio, trimmed to the video: AAC in MP4/MOV is COPIED packet for packet
 *          (lossless, audioCodec 'aac (copy)'; edit-list priming handled); anything else is decoded
 *          from the file (not recorded) and re-encoded AAC-LC 320k → Opus 256k (warned) → none;
 *       3b. colour: every frame goes through a GPU pass to Y'CbCr BT.709 LIMITED range 4:2:0, tagged
 *          bt709/bt709/bt709 tv (what Premiere / Resolve / QuickTime expect); no WebGL2 → the
 *          browser's RGB path (full range), reported in result.colour;
 *       4. mp4-muxer (vendored, loaded on first use); streamed to disk when the File System Access API
 *          is there (the save dialog opens FIRST, inside the click), else in memory + <a download>.
 *     The size is NEVER reduced: the codec + level are chosen for the native W×H @ fps
 *     (H.264 High up to level 6.2 → HEVC → AV1 → VP9); if no encoder of this machine accepts it the
 *     render stops with an error that says so (no file, no silent downscale).
 *
 *  B. recordLive(opts) — REALTIME, for live sources (webcam / camera / image / Lab stream), which
 *     cannot be re-read. Each presented canvas frame is encoded by WebCodecs with its real time on
 *     a 1/fps grid; audio from a MediaStream via MediaStreamTrackProcessor + AudioEncoder. Without
 *     WebCodecs: MediaRecorder with an MP4 mimeType. Never WebM.
 *
 * ── ADAPTER CONTRACT (what an effect provides; see attach() below for the one-call version) ──
 *   getFrame(i, tSec) → Promise<{canvas, sx?, sy?, sw?, sh?}> | {…}
 *       Called after the <video> shows source frame i. Draw THAT frame with the effect's own render
 *       code and the live parameters, synchronously, using tSec = i/fps as the effect's clock (grain,
 *       breathing, flare animation follow media time, not wall time). Await anything the frame needs
 *       first (e.g. a segmentation mask of this frame). Return the canvas and, optionally, the region
 *       to encode (a letterbox crop). The canvas must still hold the picture when getFrame resolves
 *       (WebGL: preserveDrawingBuffer, or draw + return in the same task).
 *   prepare() / finish(result)   (render opts; attach: beforeRender / afterRender)
 *       prepare runs after the save dialog, before frame 0: stop the live loop from drawing (keep its
 *       rAF alive but idle), pause the video, size the canvas to the FULL source resolution.
 *       finish ALWAYS runs (success / stop / error): restore canvas size, time, play state, live loop.
 *   The live loop's clock and its interval-driven analysers (motion, flare…) must not run on wall
 *   time during a render: the adapter calls them itself at media cadence inside getFrame.
 *
 *   Audio-reactive effects: a real AnalyserNode is silent during a render (the video is paused and
 *   seeked) → swap it for  an = await SynExport.offlineAnalyser({ file, fftSize, smoothingTimeConstant,
 *   minDecibels, maxDecibels })  and call an.setTime(t) in getFrame before the effect reads it
 *   (same read API as AnalyserNode; see offlineAnalyser below).
 *
 * window.SynExport = { isSupported, probeFps, render, recordLive, attach, encoderFor, offlineAnalyser,
 *   decodeFileAudio, snapRate }   (render / recordLive also accept limitedRange:false → browser RGB path)
 * window.__synExportLast = last result: success {filename, codec, audioCodec, width, height, fps, num,
 *   den, frames, bytes, seconds, …} | {stopped:true} | {error:'…'}.  window.__synExportBusy (attach).
 * Including this file changes nothing until an effect calls it.
 */
(function () {
  'use strict';
  if (window.SynExport) return;

  var SELF_SRC = (document.currentScript && document.currentScript.src) || '';

  /* ───────────────────────── capability ───────────────────────── */
  function isSupported() {
    return typeof window.VideoEncoder === 'function' && typeof window.VideoFrame === 'function' &&
      typeof window.EncodedVideoChunk === 'function';
  }

  var muxerPromise = null;
  function loadMuxer() {
    if (window.Mp4Muxer && window.Mp4Muxer.Muxer) return Promise.resolve(window.Mp4Muxer);
    if (muxerPromise) return muxerPromise;
    muxerPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = SELF_SRC ? new URL('../vendor/mp4-muxer.min.js', SELF_SRC).href : '../vendor/mp4-muxer.min.js';
      s.onload = function () { window.Mp4Muxer && window.Mp4Muxer.Muxer ? resolve(window.Mp4Muxer) : reject(new Error('mp4-muxer did not load')); };
      s.onerror = function () { muxerPromise = null; reject(new Error('mp4-muxer could not be loaded')); };
      document.head.appendChild(s);
    });
    return muxerPromise;
  }

  /* ───────────────────────── frame rate ───────────────────────── */
  var STD_RATES = [[24000, 1001], [24, 1], [25, 1], [30000, 1001], [30, 1], [48000, 1001], [48, 1], [50, 1],
    [60000, 1001], [60, 1], [90, 1], [100, 1], [120000, 1001], [120, 1], [144, 1], [180, 1], [200, 1],
    [240000, 1001], [240, 1], [300, 1], [12, 1], [15, 1], [20, 1]];
  function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }
  /* Snap a measured rate to the NEAREST standard rational when within 0.03 % (24 and 23.976 are only
     0.1 % apart: both must survive), else keep num/den (reduced). */
  function snapRate(fps, num, den) {
    var best = null, bestErr = 0.0003;
    for (var i = 0; i < STD_RATES.length; i++) {
      var r = STD_RATES[i][0] / STD_RATES[i][1], err = Math.abs(fps - r) / r;
      if (err < bestErr) { bestErr = err; best = STD_RATES[i]; }
    }
    if (best) return { fps: best[0] / best[1], num: best[0], den: best[1] };
    if (num && den && Number.isInteger(num) && Number.isInteger(den)) {
      var g = gcd(num, den); num /= g; den /= g;
      if (num <= 1e6) return { fps: num / den, num: num, den: den };
    }
    var n = Math.round(fps * 1000), d = 1000, g2 = gcd(n, d);
    return { fps: (n / g2) / (d / g2), num: n / g2, den: d / g2 };
  }

  function readSlice(blob, start, len) {
    return blob.slice(start, start + len).arrayBuffer().then(function (b) { return new DataView(b); });
  }
  function u64(dv, o) { return dv.getUint32(o) * 4294967296 + dv.getUint32(o + 4); }
  function fourcc(dv, o) { return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3)); }

  /* Top-level walk with random access: the moov may sit after a multi-GB mdat. */
  async function findTopBox(blob, type) {
    var pos = 0, size = blob.size, guard = 0;
    while (pos + 8 <= size && guard++ < 100000) {
      var h = await readSlice(blob, pos, 16);
      var sz = h.getUint32(0), t = fourcc(h, 4), hdr = 8;
      if (sz === 1) { if (h.byteLength < 16) return null; sz = u64(h, 8); hdr = 16; }
      else if (sz === 0) sz = size - pos;
      if (sz < hdr || !/^[\x20-\x7e]{4}$/.test(t)) return null;     /* not an ISO-BMFF file */
      if (t === type) return { start: pos, size: sz, hdr: hdr };
      pos += sz;
    }
    return null;
  }
  function children(dv, o, end) {
    var out = [];
    while (o + 8 <= end) {
      var sz = dv.getUint32(o), t = fourcc(dv, o + 4), hdr = 8;
      if (sz === 1) { sz = u64(dv, o + 8); hdr = 16; } else if (sz === 0) sz = end - o;
      if (sz < hdr || o + sz > end) break;
      out.push({ type: t, start: o, body: o + hdr, end: o + sz });
      o += sz;
    }
    return out;
  }
  function child(dv, box, type) { var c = children(dv, box.body, box.end); for (var i = 0; i < c.length; i++) if (c[i].type === type) return c[i]; return null; }

  async function probeContainer(blob) {
    var moov = await findTopBox(blob, 'moov');
    if (!moov || moov.size > 256 * 1024 * 1024) return null;
    var dv = await readSlice(blob, moov.start, moov.size);
    var traks = children(dv, moov.hdr, moov.size).filter(function (b) { return b.type === 'trak'; });
    for (var k = 0; k < traks.length; k++) {
      var mdia = child(dv, traks[k], 'mdia'); if (!mdia) continue;
      var hdlr = child(dv, mdia, 'hdlr'); if (!hdlr || fourcc(dv, hdlr.body + 8) !== 'vide') continue;
      var mdhd = child(dv, mdia, 'mdhd'); if (!mdhd) continue;
      var ver = dv.getUint8(mdhd.body);
      var timescale = ver === 1 ? dv.getUint32(mdhd.body + 20) : dv.getUint32(mdhd.body + 12);
      var duration = ver === 1 ? u64(dv, mdhd.body + 24) : dv.getUint32(mdhd.body + 16);
      var minf = child(dv, mdia, 'minf'), stbl = minf && child(dv, minf, 'stbl'), stts = stbl && child(dv, stbl, 'stts');
      if (!stts || !timescale) continue;
      var n = dv.getUint32(stts.body + 4), counts = {}, frames = 0, best = 0, bestN = -1, distinct = 0;
      for (var e = 0; e < n; e++) {
        var c = dv.getUint32(stts.body + 8 + e * 8), d = dv.getUint32(stts.body + 12 + e * 8);
        frames += c;
        if (!d) continue;
        if (!counts[d]) distinct++;
        counts[d] = (counts[d] || 0) + c;
        if (counts[d] > bestN) { bestN = counts[d]; best = d; }
      }
      if (!best || !frames) return null;      /* fragmented MP4 (empty stts): estimate instead */
      var r = snapRate(timescale / best, timescale, best);
      var trackSec = duration / timescale;
      /* edit list (trimmed / `-c copy` cut files): the presented length is the sum of the edits'
         segment_duration (MOVIE timescale, mvhd); stts counts every stored sample, also those the
         edit list hides. media_time (MEDIA timescale) only says where in the media the edit starts. */
      var presentedSec = 0;
      try {
        var edts0 = child(dv, traks[k], 'edts'), elst0 = edts0 && child(dv, edts0, 'elst');
        var mvhd0 = child(dv, { body: moov.hdr, end: moov.size }, 'mvhd');
        if (elst0 && mvhd0) {
          var mv = dv.getUint8(mvhd0.body), movTs = mv === 1 ? dv.getUint32(mvhd0.body + 20) : dv.getUint32(mvhd0.body + 12);
          var ev0 = dv.getUint8(elst0.body), en0 = dv.getUint32(elst0.body + 4), eo0 = elst0.body + 8, segSum = 0, zero = false;
          for (var ei = 0; ei < en0 && movTs; ei++) {
            var seg = ev0 === 1 ? u64(dv, eo0) : dv.getUint32(eo0);
            if (!seg) zero = true;
            segSum += seg; eo0 += ev0 === 1 ? 20 : 12;
          }
          if (movTs && !zero && segSum > 0) presentedSec = segSum / movTs;
        }
      } catch (e) { presentedSec = 0; }
      /* constant rate: the sample count IS the frame count; variable (phones): nominal rate = the most
         common sample delta, frames on that constant grid over the track duration */
      var vfr = distinct > 1 && bestN < frames * 0.98;
      var nFrames = vfr ? Math.max(1, Math.round(trackSec * r.fps)) : frames;
      if (presentedSec > 0) nFrames = Math.max(1, Math.min(nFrames, Math.round(presentedSec * r.fps)));
      return { fps: r.fps, num: r.num, den: r.den, frames: nFrames,
        duration: presentedSec > 0 ? presentedSec : trackSec, vfr: vfr, source: 'container' };
    }
    return null;
  }

  /* ── AAC passthrough: the source's own AAC packets, copied (no re-encode) ──
     trak[soun] → stsd mp4a/esds (AudioSpecificConfig), stts / stsc / stsz / stco|co64, edts/elst.
     → { items:[{data, ts, dur}] (µs), meta:{decoderConfig}, sampleRate, channels } or null (→ re-encode). */
  function readDescLen(dv, o) { var len = 0, n = 0, b; do { b = dv.getUint8(o + n); len = (len << 7) | (b & 0x7f); n++; } while ((b & 0x80) && n < 4); return { len: len, n: n }; }
  function parseEsdsASC(dv, o, end) {
    o += 4;                                               /* fullbox version/flags */
    while (o + 2 <= end) {
      var tag = dv.getUint8(o), L = readDescLen(dv, o + 1), body = o + 1 + L.n;
      if (tag === 0x03) {                                 /* ES_Descriptor: ES_ID(2) flags(1) [+dep(2)] [+url] [+ocr(2)] */
        var fl = dv.getUint8(body + 2), p = body + 3;
        if (fl & 0x80) p += 2;
        if (fl & 0x40) p += 1 + dv.getUint8(p);
        if (fl & 0x20) p += 2;
        o = p; continue;
      }
      if (tag === 0x04) {                                 /* DecoderConfigDescriptor: OTI(1) type(1) buf(3) max(4) avg(4) */
        var oti = dv.getUint8(body);
        if (oti !== 0x40 && oti !== 0x66 && oti !== 0x67 && oti !== 0x68) return null;   /* not AAC */
        o = body + 13; continue;
      }
      if (tag === 0x05) return new Uint8Array(dv.buffer.slice(dv.byteOffset + body, dv.byteOffset + body + L.len));
      o = body + L.len;
    }
    return null;
  }
  function parseASC(asc) {
    var bit = 0, rd = function (n) { var v = 0; for (var i = 0; i < n; i++, bit++) v = (v << 1) | ((asc[bit >> 3] >> (7 - (bit & 7))) & 1); return v; };
    var aot = rd(5); if (aot === 31) aot = 32 + rd(6);
    var fi = rd(4), RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
    var sr = fi === 15 ? rd(24) : RATES[fi];
    var cc = rd(4), ext = 0;
    if (aot === 5 || aot === 29) { var xi = rd(4); ext = xi === 15 ? rd(24) : RATES[xi]; }     /* SBR/PS: output rate */
    return { aot: aot, sampleRate: sr, extRate: ext || 0, channels: cc === 7 ? 8 : cc > 7 ? 0 : cc };
  }
  async function probeAacCopy(blob, videoSec) {
    var moov = await findTopBox(blob, 'moov');
    if (!moov || moov.size > 256 * 1024 * 1024) return null;
    var dv = await readSlice(blob, moov.start, moov.size);
    var traks = children(dv, moov.hdr, moov.size).filter(function (b) { return b.type === 'trak'; });
    for (var k = 0; k < traks.length; k++) {
      var mdia = child(dv, traks[k], 'mdia'); if (!mdia) continue;
      var hdlr = child(dv, mdia, 'hdlr'); if (!hdlr || fourcc(dv, hdlr.body + 8) !== 'soun') continue;
      var mdhd = child(dv, mdia, 'mdhd'), minf = child(dv, mdia, 'minf'), stbl = minf && child(dv, minf, 'stbl');
      if (!mdhd || !stbl) return null;
      var ts = dv.getUint8(mdhd.body) === 1 ? dv.getUint32(mdhd.body + 20) : dv.getUint32(mdhd.body + 12);
      var stsd = child(dv, stbl, 'stsd'), stts = child(dv, stbl, 'stts'), stsc = child(dv, stbl, 'stsc'), stsz = child(dv, stbl, 'stsz');
      var stco = child(dv, stbl, 'stco'), co64 = child(dv, stbl, 'co64');
      if (!stsd || !stts || !stsc || !stsz || !(stco || co64) || !ts) return null;
      var entry = children(dv, stsd.body + 8, stsd.end)[0];
      if (!entry || entry.type !== 'mp4a') return null;
      var esds = null;                                    /* esds sits after the (v0/v1/v2) sample entry fields, maybe inside 'wave' */
      for (var p = entry.body + 28; p + 8 <= entry.end; p++) if (fourcc(dv, p + 4) === 'esds') { esds = { body: p + 8, end: p + dv.getUint32(p) }; break; }
      if (!esds || esds.end > entry.end) return null;
      var asc = parseEsdsASC(dv, esds.body, esds.end); if (!asc || asc.length < 2) return null;
      var info = parseASC(asc), entryCh = dv.getUint16(entry.body + 16);
      var channels = info.aot === 29 ? (entryCh || 2) : (info.channels || entryCh);
      /* sample entry rate from the AudioSpecificConfig (HE-AAC: the SBR output rate); the mdhd
         timescale is only the fallback when the ASC is unparseable */
      var outRate = info.extRate || info.sampleRate || ts;
      if (!channels || channels > 8) return null;
      /* edit list: none, or one plain edit (media_time ≥ 0, rate 1) — anything else → re-encode */
      var mediaStart = 0, edts = child(dv, traks[k], 'edts'), elst = edts && child(dv, edts, 'elst');
      if (elst) {
        var ev = dv.getUint8(elst.body), en = dv.getUint32(elst.body + 4);
        if (en > 1) return null;
        if (en === 1) {
          var eo = elst.body + 8, mt = ev === 1 ? dv.getInt32(eo + 8) * 4294967296 + dv.getUint32(eo + 12) : dv.getInt32(eo + 4);
          var rate = dv.getInt32(eo + (ev === 1 ? 16 : 8));
          if (mt < 0 || rate !== 0x10000) return null;
          mediaStart = mt;
        }
      }
      /* sample table */
      var fixed = dv.getUint32(stsz.body + 4), n = dv.getUint32(stsz.body + 8), sizes = new Uint32Array(n);
      for (var s = 0; s < n; s++) sizes[s] = fixed || dv.getUint32(stsz.body + 12 + s * 4);
      var dts = new Float64Array(n + 1), sIdx = 0, sttsN = dv.getUint32(stts.body + 4), firstDelta = 0;
      for (var e = 0; e < sttsN && sIdx < n; e++) {
        var cnt = dv.getUint32(stts.body + 8 + e * 8), d = dv.getUint32(stts.body + 12 + e * 8);
        if (!firstDelta) firstDelta = d;
        for (var c2 = 0; c2 < cnt && sIdx < n; c2++, sIdx++) dts[sIdx + 1] = dts[sIdx] + d;
      }
      if (sIdx < n || !firstDelta) return null;
      var nChunks = co64 ? dv.getUint32(co64.body + 4) : dv.getUint32(stco.body + 4), chunkOff = new Float64Array(nChunks);
      for (var ci = 0; ci < nChunks; ci++) chunkOff[ci] = co64 ? u64(dv, co64.body + 8 + ci * 8) : dv.getUint32(stco.body + 8 + ci * 4);
      var scN = dv.getUint32(stsc.body + 4), sampleChunk = new Uint32Array(n), sampleOff = new Float64Array(n);
      sIdx = 0;
      for (var r = 0; r < scN; r++) {
        var first = dv.getUint32(stsc.body + 8 + r * 12) - 1, per = dv.getUint32(stsc.body + 12 + r * 12);
        var last = r + 1 < scN ? dv.getUint32(stsc.body + 8 + (r + 1) * 12) - 1 : nChunks;
        for (var ch = first; ch < last && sIdx < n; ch++) {
          var off = chunkOff[ch];
          for (var j = 0; j < per && sIdx < n; j++, sIdx++) { sampleChunk[sIdx] = ch; sampleOff[sIdx] = off; off += sizes[sIdx]; }
        }
      }
      if (sIdx < n) return null;
      /* priming: drop the whole packets the edit list skips (the decoder's own delay then lines up
         source sample 0 with t = 0); trim at the end of the video */
      var drop = Math.min(n, Math.round(mediaStart / firstDelta)), t0 = dts[drop], endUnits = videoSec * ts;
      var keep = []; for (var q = drop; q < n && dts[q] - t0 < endUnits - 1e-6; q++) keep.push(q);
      if (!keep.length) return null;
      /* read chunk by chunk (one slice per chunk run) */
      var items = [], gi = 0;
      while (gi < keep.length) {
        var g0 = gi, cId = sampleChunk[keep[gi]];
        while (gi + 1 < keep.length && sampleChunk[keep[gi + 1]] === cId && keep[gi + 1] === keep[gi] + 1) gi++;
        var a = keep[g0], b = keep[gi], start = sampleOff[a], bytes = sampleOff[b] + sizes[b] - start;
        var buf = new Uint8Array(await blob.slice(start, start + bytes).arrayBuffer());
        for (var x = a; x <= b; x++) {
          var o0 = sampleOff[x] - start;
          items.push({ data: buf.subarray(o0, o0 + sizes[x]), ts: Math.round((dts[x] - t0) * 1e6 / ts), dur: Math.round((dts[x + 1] - dts[x]) * 1e6 / ts) });
        }
        gi++;
      }
      return { items: items, sampleRate: outRate, channels: channels, primingDropped: drop, label: 'aac (copy)',
        meta: { decoderConfig: { codec: 'mp4a.40.' + info.aot, sampleRate: outRate, numberOfChannels: channels, description: asc } } };
    }
    return null;
  }

  /* Does the file carry a sound track the engine could not include? → sample-entry fourcc ('ac-3',
     'ec-3', 'mp4a'…) or null (no soun trak, or not an MP4/MOV: undecidable → no warning). */
  async function probeSoundTrack(blob) {
    var moov = await findTopBox(blob, 'moov');
    if (!moov || moov.size > 256 * 1024 * 1024) return null;
    var dv = await readSlice(blob, moov.start, moov.size);
    var traks = children(dv, moov.hdr, moov.size).filter(function (b) { return b.type === 'trak'; });
    for (var k = 0; k < traks.length; k++) {
      var mdia = child(dv, traks[k], 'mdia'); if (!mdia) continue;
      var hdlr = child(dv, mdia, 'hdlr'); if (!hdlr || fourcc(dv, hdlr.body + 8) !== 'soun') continue;
      var minf = child(dv, mdia, 'minf'), stbl = minf && child(dv, minf, 'stbl'), stsd = stbl && child(dv, stbl, 'stsd');
      var entry = stsd && children(dv, stsd.body + 8, stsd.end)[0];
      return entry ? entry.type.trim() : 'unknown';
    }
    return null;
  }

  function hasRVFC(video) { return typeof video.requestVideoFrameCallback === 'function'; }

  /* Seek and wait until the frame at t is decoded and presented (rVFC), short fallback otherwise. */
  function seekFrame(video, t, aborted) {
    return new Promise(function (resolve) {
      var done = false, seeked = false, meta = null, framed = !hasRVFC(video), handle = 0, fb = 0, poll = 0;
      function finish() {
        if (done) return; done = true;
        clearTimeout(guard); clearTimeout(fb); clearInterval(poll);
        video.removeEventListener('seeked', onSeeked);
        if (handle && !framed && video.cancelVideoFrameCallback) { try { video.cancelVideoFrameCallback(handle); } catch (e) { /* */ } }
        resolve({ meta: meta, viaFrame: !!meta, stalled: !seeked });
      }
      function onSeeked() { seeked = true; if (framed) finish(); else fb = setTimeout(finish, 250); }
      if (!framed) handle = video.requestVideoFrameCallback(function (now, m) { meta = m; framed = true; if (seeked) finish(); });
      video.addEventListener('seeked', onSeeked);
      /* never draw before the seek is really over (a slow software 4K/8K decode can take
         seconds): after 5 s only a missing frame callback is given up on; a seek still in
         flight is waited for up to 120 s, then reported as stalled (render stops, no file) */
      var guard = setTimeout(function () { if (seeked || !video.seeking) finish(); else guard = setTimeout(finish, 115000); }, 5000);
      if (typeof aborted === 'function') poll = setInterval(function () { if (aborted()) finish(); }, 100);   /* STOP is instant */
      video.currentTime = t;
    });
  }

  async function ensureDuration(video) {
    if (isFinite(video.duration) && video.duration > 0) return video.duration;
    await new Promise(function (res) {     /* MediaRecorder WebM: no duration until the end is touched */
      var on = function () { if (isFinite(video.duration)) { video.removeEventListener('durationchange', on); res(); } };
      video.addEventListener('durationchange', on); setTimeout(res, 4000);
      try { video.currentTime = 1e9; } catch (e) { res(); }
    });
    return isFinite(video.duration) ? video.duration : 0;
  }

  /* Fallback: seek in 1 ms steps across a few frames, read the presented mediaTime, snap. */
  async function estimateFps(video) {
    var dur = await ensureDuration(video);
    if (!hasRVFC(video) || !dur) return { fps: 30, num: 30, den: 1, source: 'default' };
    var base = Math.min(0.5, dur * 0.25), seen = [], step = 0.001;
    for (var k = 0; k < 160 && seen.length < 6; k++) {
      var r = await seekFrame(video, Math.min(dur - 0.001, base + k * step));
      if (r.meta && typeof r.meta.mediaTime === 'number') {
        var m = Math.round(r.meta.mediaTime * 1e5) / 1e5;
        if (seen.indexOf(m) < 0) seen.push(m);
      }
      if (k === 20 && seen.length < 2) step = 0.004;   /* slow rates: bigger steps */
    }
    seen.sort(function (a, b) { return a - b; });
    var deltas = [];
    for (var i = 1; i < seen.length; i++) if (seen[i] - seen[i - 1] > 0.0015) deltas.push(seen[i] - seen[i - 1]);
    if (!deltas.length) return { fps: 30, num: 30, den: 1, source: 'default' };
    deltas.sort(function (a, b) { return a - b; });
    var s = snapRate(1 / deltas[Math.floor(deltas.length / 2)]);
    return { fps: s.fps, num: s.num, den: s.den, source: 'estimate' };
  }

  async function probeFps(file, video) {
    var r = null;
    if (file && typeof file.slice === 'function') { try { r = await probeContainer(file); } catch (e) { r = null; } }
    if (r) return r;
    if (!video) return { fps: 30, num: 30, den: 1, source: 'default' };
    return estimateFps(video);
  }

  /* ───────────────────────── codec + level for the NATIVE size ───────────────────────── */
  /* H.264: [level_idc, MaxMBPS, MaxFS (MBs), MaxBR kbit/s for High profile (1.25 × table)] */
  var AVC = [[0x1f, 108000, 3600, 17500], [0x20, 216000, 5120, 25000], [0x28, 245760, 8192, 25000],
    [0x29, 245760, 8192, 62500], [0x2a, 522240, 8704, 62500], [0x32, 589824, 22080, 168750],
    [0x33, 983040, 36864, 300000], [0x34, 2073600, 36864, 300000], [0x3c, 4177920, 139264, 300000],
    [0x3d, 8355840, 139264, 600000], [0x3e, 16711680, 139264, 800000]];
  /* HEVC / AV1 / VP9 share the luma-picture-size / luma-sample-rate ladder:
     [name, MaxLumaPs, MaxLumaSr, hevcLevelIdc, av1SeqLevelIdx, vp9Level] */
  var LADDER = [['4.1', 2228224, 133693440, 123, 9, 41], ['5.0', 8912896, 267386880, 150, 12, 50],
    ['5.1', 8912896, 534773760, 153, 13, 51], ['5.2', 8912896, 1069547520, 156, 14, 52],
    ['6.0', 35651584, 1069547520, 180, 16, 60], ['6.1', 35651584, 2139095040, 183, 17, 61],
    ['6.2', 35651584, 4278190080, 186, 18, 62]];
  function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16); }
  function codecList(w, h, fps, bitrate) {
    var list = [], fs = Math.ceil(w / 16) * Math.ceil(h / 16), mbps = fs * fps, kb = bitrate / 1000;
    /* H.264: every level that covers frame size + MB rate, lowest first (higher bitrate levels kept) */
    for (var i = 0; i < AVC.length; i++) {
      var L = AVC[i];
      if (fs <= L[2] && mbps <= L[1] && Math.sqrt(8 * L[2]) * 16 >= Math.max(w, h))
        list.push({ codec: 'avc1.6400' + hex2(L[0]), mux: 'avc', label: 'H.264 High', bitrateOk: kb <= L[3], extra: { avc: { format: 'avc' } } });
    }
    list.sort(function (a, b) { return (b.bitrateOk - a.bitrateOk); });
    var ps = w * h, sr = ps * fps, maxDim = function (P) { return Math.sqrt(8 * P); };
    var lad = LADDER.filter(function (l) { return ps <= l[1] && sr <= l[2] && Math.max(w, h) <= maxDim(l[1]); });
    lad.forEach(function (l) {
      list.push({ codec: 'hvc1.1.6.L' + l[3] + '.B0', mux: 'hevc', label: 'HEVC Main', extra: { hevc: { format: 'hevc' } } });
      list.push({ codec: 'hvc1.1.6.H' + l[3] + '.B0', mux: 'hevc', label: 'HEVC Main (high tier)', extra: { hevc: { format: 'hevc' } } });
    });
    lad.forEach(function (l) {
      list.push({ codec: 'av01.0.' + (l[4] < 10 ? '0' : '') + l[4] + 'M.08', mux: 'av1', label: 'AV1', extra: {} });
      list.push({ codec: 'av01.0.' + (l[4] < 10 ? '0' : '') + l[4] + 'H.08', mux: 'av1', label: 'AV1 (high tier)', extra: {} });
    });
    lad.forEach(function (l) { list.push({ codec: 'vp09.00.' + l[5] + '.08', mux: 'vp9', label: 'VP9', extra: {} }); });
    return list;
  }
  function bitrateFor(w, h, fps, quality) {
    var bpp = quality === 'high' ? 0.35 : 1.0;
    return Math.round(Math.min(240e6, Math.max(2e6, w * h * fps * bpp)));
  }
  /* The first encoder of this machine that accepts the native W×H @ fps. null = none (never downscale). */
  async function encoderFor(w, h, fps, quality) {
    if (!isSupported()) return null;
    var bitrate = bitrateFor(w, h, fps, quality), list = codecList(w, h, fps, bitrate);
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var variants = [
        Object.assign({ codec: c.codec, width: w, height: h, bitrate: bitrate, framerate: fps, latencyMode: 'quality', bitrateMode: 'variable' }, c.extra),
        Object.assign({ codec: c.codec, width: w, height: h, bitrate: bitrate, framerate: fps }, c.extra)
      ];
      for (var v = 0; v < variants.length; v++) {
        try {
          var r = await window.VideoEncoder.isConfigSupported(variants[v]);
          if (r && r.supported) return { cand: c, config: r.config || variants[v], width: w, height: h, bitrate: bitrate };
        } catch (e) { /* next */ }
      }
    }
    return null;
  }
  function even(n) { n = Math.max(2, Math.round(n)); return n - (n % 2); }
  function noEncoderError(w, h, fps) {
    return new Error('this machine has no video encoder for ' + w + '×' + h + ' at ' + (Math.round(fps * 1000) / 1000) +
      ' fps (tried H.264 High up to level 6.2, HEVC, AV1, VP9) — nothing was saved; the size is never reduced');
  }

  /* ───────────────────────── output target ───────────────────────── */
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 60000);
  }
  /* Ask where to save (must run first, inside the click). → {handle} | {cancelled} | {handle:null} */
  async function askSaveLocation(opts, filename, warnings) {
    if (opts.fileHandle) return { handle: opts.fileHandle, picked: false };
    if (opts.useFilePicker === false || typeof window.showSaveFilePicker !== 'function') return { handle: null };
    try {
      var h = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] });
      return { handle: h, picked: true };
    } catch (e) {
      if (e && e.name === 'AbortError') return { cancelled: true };
      warnings.push('save dialog unavailable (' + (e && e.name) + '): download instead');
      return { handle: null };
    }
  }
  /* mp4-muxer target: streamed to the picked file (moov at the end, chunked writes) or in memory. */
  async function makeTarget(Mux, handle) {
    if (handle) {
      var writable = await handle.createWritable();
      return { writable: writable, target: new Mux.FileSystemWritableFileStreamTarget(writable, { chunkSize: 16 * 1024 * 1024 }), fastStart: false };
    }
    return { writable: null, target: new Mux.ArrayBufferTarget(), fastStart: 'in-memory' };
  }
  async function saveTarget(t, handle, filename) {
    if (t.writable) {
      await t.writable.close(); t.writable = null;
      try { return (await handle.getFile()).size; } catch (e) { return 0; }
    }
    var blob = new Blob([t.target.buffer], { type: 'video/mp4' });
    downloadBlob(blob, filename);
    return blob.size;
  }

  /* ───────────────────────── audio (offline, from the file) ───────────────────────── */
  /* Decoded file audio (48 kHz AudioBuffer | null), cached per file so render() and offlineAnalyser()
     decode once. Key: the Blob itself, else a fingerprint (size + type + first/last 64 KB) — fetch()
     of the same object URL returns a new Blob each time. */
  var decodeCache = {}, decodeCacheFp = {}, MAX_DECODE = 2000 * 1024 * 1024;
  async function fingerprint(blob) {
    var h = 2166136261, a = new Uint8Array(await blob.slice(0, 65536).arrayBuffer()), b = new Uint8Array(await blob.slice(Math.max(0, blob.size - 65536)).arrayBuffer());
    [a, b].forEach(function (u) { for (var i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; } });
    return blob.size + '|' + (blob.type || '') + '|' + h.toString(16);
  }
  function decodeFileAudio(blob, rate) {
    rate = Math.round(rate || 48000);
    if (!blob || typeof blob.arrayBuffer !== 'function') return Promise.resolve(null);
    var wm = decodeCache[rate] || (decodeCache[rate] = new WeakMap());
    if (wm.has(blob)) return wm.get(blob);
    var p = (async function () {
      if (blob.size > MAX_DECODE) return null;
      var fp = null;
      try { fp = (await fingerprint(blob)) + '@' + rate; if (decodeCacheFp[fp]) return decodeCacheFp[fp]; } catch (e) { fp = null; }
      var Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Ctx) return null;
      var job = (async function () {
        try { return await new Ctx(2, rate, rate).decodeAudioData(await blob.arrayBuffer()); }
        catch (e) { return null; }          /* no audio track (or undecodable): silence, no error */
      })();
      if (fp) {                                       /* keep one file (per rate): the operator works on one clip */
        var pre = fp.slice(fp.indexOf('@'));
        Object.keys(decodeCacheFp).forEach(function (k) { if (k.slice(k.indexOf('@')) === pre) delete decodeCacheFp[k]; });
        decodeCacheFp[fp] = job;
      }
      return job;
    })();
    wm.set(blob, p);
    return p;
  }
  async function decodeAudio(blob, seconds, warnings) {
    if (blob && blob.size > MAX_DECODE) { warnings.push('source over 2 GB and not AAC-in-MP4: audio not included (memory)'); return null; }
    var ab = await decodeFileAudio(blob);
    if (!ab || !ab.length) return null;
    var ch = Math.min(2, ab.numberOfChannels), n = Math.min(ab.length, Math.round(seconds * ab.sampleRate));
    var planes = [];
    for (var c = 0; c < ch; c++) planes.push(ab.getChannelData(c).subarray(0, n));
    return { sampleRate: ab.sampleRate, channels: ch, length: n, planes: planes };
  }
  async function pickAudioCodec(sr, ch) {
    if (typeof window.AudioEncoder !== 'function') return null;
    var c = [
      { codec: 'mp4a.40.2', mux: 'aac', label: 'AAC-LC 320k', bitrate: 320000 },
      { codec: 'opus', mux: 'opus', label: 'Opus 256k', bitrate: 256000 }
    ];
    for (var i = 0; i < c.length; i++) {
      var cfg = { codec: c[i].codec, sampleRate: sr, numberOfChannels: ch, bitrate: c[i].bitrate };
      try { var r = await window.AudioEncoder.isConfigSupported(cfg); if (r && r.supported) return { cand: c[i], config: cfg }; } catch (e) { /* next */ }
    }
    return null;
  }
  function planarData(planes, off, n) {
    var ch = planes.length, data = new Float32Array(n * ch);
    for (var c = 0; c < ch; c++) data.set(planes[c].subarray(off, off + n), c * n);
    return data;
  }
  async function encodeAudio(pcm, pick, aborted) {
    var chunks = [], firstMeta = null, err = null;
    var enc = new window.AudioEncoder({
      output: function (chunk, meta) { if (!firstMeta && meta && meta.decoderConfig) firstMeta = meta; chunks.push(chunk); },
      error: function (e) { err = e; }
    });
    enc.configure(pick.config);
    var BLOCK = 4800, sr = pcm.sampleRate, ch = pcm.channels;
    for (var off = 0; off < pcm.length; off += BLOCK) {
      if (err) throw err;
      if (aborted()) { try { enc.close(); } catch (e) { /* */ } return null; }
      var n = Math.min(BLOCK, pcm.length - off);
      var ad = new window.AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round(off * 1e6 / sr), data: planarData(pcm.planes, off, n) });
      enc.encode(ad); ad.close();
      if (enc.encodeQueueSize > 32) await new Promise(function (r) { setTimeout(r, 0); });
    }
    await enc.flush(); enc.close();
    if (err) throw err;
    return { chunks: chunks, meta: firstMeta };
  }

  /* ── Premiere-safe colour: RGB → Y'CbCr BT.709 LIMITED range (16–235 / 16–240), 4:2:0, on the GPU ──
     A small WebGL2 pass writes the I420 planes packed 4 bytes per RGBA texel into one target
     (Y rows, then U, then V: exactly the I420 byte layout), one readPixels, and a VideoFrame
     'I420' tagged bt709/bt709/bt709 fullRange:false. Without WebGL2 (or if it fails) the caller
     falls back to VideoFrame(canvas) (Chrome: full-range, sRGB-tagged). */
  var BT709 = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };
  var YUV_FS = '#version 300 es\n' +
    'precision highp float; precision highp int;\n' +
    'uniform highp sampler2D uSrc; uniform ivec2 uOff; uniform ivec2 uSize; uniform int uWp; uniform int uHp;\n' +
    'out vec4 o;\n' +
    'vec3 px(int x,int y){ x=clamp(x,0,uSize.x-1); y=clamp(y,0,uSize.y-1); return texelFetch(uSrc, ivec2(uOff.x+x, uOff.y+y), 0).rgb; }\n' +
    'const vec3 K=vec3(0.2126,0.7152,0.0722);\n' +
    'float Y(vec3 c){ return (16.0+219.0*dot(c,K))/255.0; }\n' +
    'vec2 C(vec3 c){ float y=dot(c,K); return vec2(128.0+224.0*(c.b-y)/1.8556, 128.0+224.0*(c.r-y)/1.5748)/255.0; }\n' +
    'void main(){\n' +
    '  int tx=int(gl_FragCoord.x), ty=int(gl_FragCoord.y);\n' +
    '  if(ty<uHp){ int x=tx*4; o=vec4(Y(px(x,ty)),Y(px(x+1,ty)),Y(px(x+2,ty)),Y(px(x+3,ty))); return; }\n' +
    '  int r=ty-uHp, q=uHp/4; bool isV=r>=q; if(isV) r-=q;\n' +
    '  int hw=uWp/8; int cy=r*2+(tx>=hw?1:0); int cx0=(tx-(tx>=hw?hw:0))*4;\n' +
    '  vec4 res;\n' +
    '  for(int k=0;k<4;k++){ int cx=cx0+k; vec3 m=(px(2*cx,2*cy)+px(2*cx+1,2*cy)+px(2*cx,2*cy+1)+px(2*cx+1,2*cy+1))*0.25; vec2 cc=C(m); res[k]=isV?cc.y:cc.x; }\n' +
    '  o=res;\n' +
    '}\n';
  function makeYuv(W, H) {
    try {
      var Wp = Math.ceil(W / 8) * 8, Hp = Math.ceil(H / 4) * 4, tw = Wp / 4, th = Hp * 3 / 2;
      var cv = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(tw, th) : document.createElement('canvas');
      cv.width = tw; cv.height = th;
      var gl = cv.getContext('webgl2', { antialias: false, depth: false, stencil: false, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
      if (!gl) return null;
      var maxT = gl.getParameter(gl.MAX_TEXTURE_SIZE), maxR = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
      if (W > maxT || H > maxT || th > maxR) return null;
      var sh = function (t, src) { var x = gl.createShader(t); gl.shaderSource(x, src); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
      var prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){ vec2 p=vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }'));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, YUV_FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      var U = {}; ['uSrc', 'uOff', 'uSize', 'uWp', 'uHp'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
      gl.uniform1i(U.uSrc, 0); gl.uniform2i(U.uSize, W, H); gl.uniform1i(U.uWp, Wp); gl.uniform1i(U.uHp, Hp);
      var tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.viewport(0, 0, tw, th);
      var buf = new Uint8Array(Wp * Hp * 3 / 2);
      var layout = [{ offset: 0, stride: Wp }, { offset: Wp * Hp, stride: Wp / 2 }, { offset: Wp * Hp * 5 / 4, stride: Wp / 2 }];
      return {
        frame: function (src, sx, sy, ts, dur) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
          gl.uniform2i(U.uOff, sx, sy);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          return new window.VideoFrame(buf, { format: 'I420', codedWidth: Wp, codedHeight: Hp, timestamp: ts, duration: dur,
            visibleRect: { x: 0, y: 0, width: W, height: H }, displayWidth: W, displayHeight: H, layout: layout, colorSpace: BT709 });
        },
        destroy: function () { try { gl.getExtension('WEBGL_lose_context').loseContext(); } catch (e) { /* */ } }
      };
    } catch (e) { return null; }
  }

  function makeScratch(w, h) {
    var c = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d', { alpha: false }); x.imageSmoothingQuality = 'high';
    return { canvas: c, ctx: x };
  }
  /* One VideoFrame of the region at the encode size. Limited-range BT.709 I420 through the GPU pass
     (scratchRef.yuv), else RGBA from the canvas (direct when the canvas already is the region). */
  function frameOf(fr, W, H, ts, dur, scratchRef) {
    var cvs = fr.canvas, sx = fr.sx || 0, sy = fr.sy || 0, sw = fr.sw || cvs.width, sh = fr.sh || cvs.height;
    if (sw - W === 1) sw = W;                     /* odd source size: crop the last column / row, never resample */
    if (sh - H === 1) sh = H;
    var exact = sw === W && sh === H;
    if (scratchRef.yuv === undefined) { scratchRef.yuv = scratchRef.noYuv ? null : makeYuv(W, H); }
    if (scratchRef.yuv && exact) {
      try { return scratchRef.yuv.frame(cvs, sx, sy, ts, dur); } catch (e) { scratchRef.yuv.destroy(); scratchRef.yuv = null; scratchRef.yuvFailed = String(e && e.message || e); }
    }
    if (!sx && !sy && exact && cvs.width === W && cvs.height === H)
      return new window.VideoFrame(cvs, { timestamp: ts, duration: dur });
    if (!scratchRef.s || scratchRef.s.canvas.width !== W || scratchRef.s.canvas.height !== H) scratchRef.s = makeScratch(W, H);
    /* 1:1 copy for a crop; a resize only if the effect's canvas changed size mid-way */
    scratchRef.s.ctx.drawImage(cvs, sx, sy, sw, sh, 0, 0, W, H);
    if (scratchRef.yuv) { try { return scratchRef.yuv.frame(scratchRef.s.canvas, 0, 0, ts, dur); } catch (e) { scratchRef.yuv.destroy(); scratchRef.yuv = null; } }
    return new window.VideoFrame(scratchRef.s.canvas, { timestamp: ts, duration: dur });
  }

  /* The encoder's decoderConfig carries the colour tags into the MP4 'colr' box. */
  function tagColour(meta, scratchRef) {
    if (meta && meta.decoderConfig && scratchRef.yuv) meta.decoderConfig.colorSpace = Object.assign({}, BT709);
    return meta;
  }
  function colourLabel(scratchRef, warnings) {
    if (scratchRef.yuv) return 'BT.709 limited range (tv), 4:2:0';
    warnings.push('colour: browser RGB path (full range' + (scratchRef.yuvFailed ? ', GPU conversion failed: ' + scratchRef.yuvFailed : '') + ')');
    return 'browser default (full range)';
  }

  /* ───────────────────────── A. offline render ───────────────────────── */
  async function render(opts) {
    var t0 = performance.now(), warnings = [], result = null;
    var video = opts.video, getFrame = opts.getFrame, quality = opts.quality === 'high' ? 'high' : 'master';
    var filename = opts.filename || ('render_' + Date.now() + '.mp4');
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    var signal = opts.signal || null;
    var aborted = function () { return !!(signal && signal.aborted) || (typeof opts.shouldStop === 'function' && !!opts.shouldStop()); };
    var handle = null, picked = false, tgt = null, encoder = null, prepared = false, ok = false, playGuard = null;
    try {
      if (!isSupported()) throw new Error('WebCodecs is not available in this browser');
      if (!video || typeof getFrame !== 'function') throw new Error('render: video and getFrame are required');

      /* 1. save location FIRST, still inside the click's user activation */
      var loc = await askSaveLocation(opts, filename, warnings);
      if (loc.cancelled) return (result = { stopped: true, cancelled: true });
      handle = loc.handle; picked = !!loc.picked;
      if (handle && handle.name) filename = handle.name;

      var Mux = await loadMuxer();
      onProgress(0, 0, 'probe', {});
      var file = await Promise.resolve(opts.file).catch(function () { return null; });
      if (aborted()) return (result = { stopped: true });

      if (typeof opts.prepare === 'function') { prepared = true; await opts.prepare(); }
      if (!video.paused) video.pause();

      var rate = opts.rate || await probeFps(file, video);
      var dur = await ensureDuration(video);
      var num = rate.num, den = rate.den;
      var total = rate.frames || Math.max(1, Math.round(dur * num / den));
      /* the element's duration is the authority for what is PRESENTED (seeks are in presentation time:
         edit lists / trimmed files hide samples the stts still counts) */
      if (isFinite(video.duration) && video.duration > 0) total = Math.max(1, Math.min(total, Math.round(video.duration * num / den)));
      var tsOf = function (i) { return Math.round(i * 1e6 * den / num); };
      var videoSec = total * den / num;

      /* 2. audio. AAC in MP4/MOV: the source packets are COPIED (lossless). Otherwise decoded from the
         file, re-encoded AAC → Opus before the frames. Either way muxed interleaved with the video. */
      var audio = null, audioCodec = 'none';
      if (opts.audio !== false && file) {
        onProgress(0, total, 'audio', {});
        var copy = null;
        try { copy = await probeAacCopy(file, videoSec); } catch (e) { copy = null; }
        if (copy) {
          audio = { items: copy.items, meta: copy.meta, mux: { codec: 'aac', numberOfChannels: copy.channels, sampleRate: copy.sampleRate }, raw: true };
          audioCodec = copy.label;
        } else {
          var ABORTED = {}, abortPoll = 0;
          var pcm = await Promise.race([decodeAudio(file, videoSec, warnings), new Promise(function (res) {
            abortPoll = setInterval(function () { if (aborted()) res(ABORTED); }, 100);
          })]);
          clearInterval(abortPoll);
          if (pcm === ABORTED) return (result = { stopped: true });
          if (pcm) {
            var audioPick = await pickAudioCodec(pcm.sampleRate, pcm.channels);
            if (!audioPick) warnings.push('no audio encoder on this machine: video without audio');
            else {
              var enc = await encodeAudio(pcm, audioPick, aborted);
              if (!enc) return (result = { stopped: true });
              audio = { items: enc.chunks.map(function (c) { return { chunk: c, ts: c.timestamp }; }), meta: enc.meta, raw: false,
                mux: { codec: audioPick.cand.mux, numberOfChannels: audioPick.config.numberOfChannels, sampleRate: audioPick.config.sampleRate } };
              audioCodec = audioPick.cand.label;
              if (audioPick.cand.mux === 'opus') warnings.push('audio Opus: may not open in Premiere/QuickTime');
            }
          }
        }
      }
      if (!audio && opts.audio !== false && file && !warnings.some(function (x) { return /audio/i.test(x); })) {
        var snd = null;
        try { snd = await probeSoundTrack(file); } catch (e) { snd = null; }
        if (snd) warnings.push('the source audio (' + snd + ') could not be included — the file is silent');
      }
      if (aborted()) return (result = { stopped: true });

      /* 3. frame loop */
      var muxer = null, encErr = null, W = 0, H = 0, scratchRef = { noYuv: opts.limitedRange === false };
      var audioIdx = 0, mismatches = 0, reseeks = 0, rvfcFrames = 0, lastProg = 0;
      var feedAudioUpTo = function (us) {
        if (!audio) return;
        while (audioIdx < audio.items.length && audio.items[audioIdx].ts <= us) {
          var it = audio.items[audioIdx], m = audioIdx === 0 ? audio.meta : undefined;
          if (audio.raw) muxer.addAudioChunkRaw(it.data, 'key', it.ts, it.dur, m);
          else muxer.addAudioChunk(it.chunk, m);
          audioIdx++;
        }
      };
      var guardFixes = 0, onPlay = function () { try { video.pause(); } catch (e) { /* */ } };
      video.addEventListener('play', onPlay); playGuard = onPlay;
      var kfi = Math.max(1, Math.round(num / den));             /* keyframe every ~1 s */
      var lastT = Math.max(0, dur - 0.0005);
      for (var i = 0; i < total; i++) {
        if (aborted()) return (result = { stopped: true });
        if (encErr) throw encErr;
        if (!video.paused) video.pause();
        var f0 = i * den / num, f1 = (i + 1) * den / num;
        var sk = await seekFrame(video, Math.min((i + 0.5) * den / num, lastT), aborted);
        if (aborted()) return (result = { stopped: true });
        if (sk.stalled && video.seeking) throw new Error('the video decoder stalled while seeking frame ' + (i + 1) + ' of ' + total + ' — nothing was saved');
        /* the frame must be decoded before the effect draws it (else effects paint their black
           "no source" frame): wait while the element has no current data, up to 60 s */
        for (var w0 = Date.now(); (video.seeking || video.readyState < 2) && Date.now() - w0 < 60000;) {
          if (aborted()) return (result = { stopped: true });
          await new Promise(function (r) { setTimeout(r, 20); });
        }
        if (video.seeking || video.readyState < 2) throw new Error('the video frame ' + (i + 1) + ' of ' + total + ' never decoded — nothing was saved');
        if (sk.viaFrame && typeof sk.meta.mediaTime === 'number') {
          rvfcFrames++;
          var mt = sk.meta.mediaTime;
          if (mt < f0 - 0.0008 || mt >= f1 - 0.0008) {
            /* wrong frame presented (rounding at very high rates): nudge towards the intended one once */
            reseeks++;
            var nudge = mt < f0 ? Math.min(f0 + (f1 - f0) * 0.85, lastT) : f0 + (f1 - f0) * 0.15;
            sk = await seekFrame(video, nudge, aborted);
            if (aborted()) return (result = { stopped: true });
            mt = sk.meta && sk.meta.mediaTime;
            if (typeof mt === 'number' && (mt < f0 - 0.0008 || mt >= f1 - 0.0008)) mismatches++;
          }
        }
        /* the operator must not move the clip during a render: if currentTime left this frame's
           interval (scrub / loop / play), re-seek once before drawing */
        if (video.currentTime < f0 - 0.002 || video.currentTime >= f1 + 0.002) {
          guardFixes++;
          if (!video.paused) video.pause();
          await seekFrame(video, Math.min((i + 0.5) * den / num, lastT), aborted);
          if (aborted()) return (result = { stopped: true });
          for (var w1 = Date.now(); (video.seeking || video.readyState < 2) && Date.now() - w1 < 60000;) await new Promise(function (r) { setTimeout(r, 20); });
        }
        var fr = await getFrame(i, f0);
        if (aborted()) return (result = { stopped: true });
        if (i === 0) {
          var cw = fr.canvas.width, ch = fr.canvas.height;
          W = even(fr.sw || cw); H = even(fr.sh || ch);
          var choice = await encoderFor(W, H, num / den, quality);
          if (!choice) throw noEncoderError(W, H, num / den);
          tgt = await makeTarget(Mux, handle);
          var muxOpts = { target: tgt.target, fastStart: tgt.fastStart, firstTimestampBehavior: 'strict',
            video: { codec: choice.cand.mux, width: W, height: H, frameRate: num } };
          if (audio) muxOpts.audio = audio.mux;
          muxer = new Mux.Muxer(muxOpts);
          encoder = new window.VideoEncoder({
            output: function (chunk, meta) { try { feedAudioUpTo(chunk.timestamp); muxer.addVideoChunk(chunk, tagColour(meta, scratchRef)); } catch (e) { encErr = e; } },
            error: function (e) { encErr = e; }
          });
          encoder.configure(choice.config);
          result = { filename: filename, codec: choice.cand.label + ' (' + choice.cand.codec + ')', audioCodec: audioCodec,
            width: W, height: H, fps: num / den, num: num, den: den, frames: total, bitrate: choice.bitrate,
            quality: quality, fpsSource: rate.source };
        }
        var ts = tsOf(i), frame = frameOf(fr, W, H, ts, tsOf(i + 1) - ts, scratchRef);
        try { encoder.encode(frame, { keyFrame: i % kfi === 0 }); } finally { frame.close(); }
        while (encoder.encodeQueueSize > 2 && !encErr) await new Promise(function (r) { setTimeout(r, 2); });
        var now = performance.now();
        if (now - lastProg > 200 || i === total - 1) {
          lastProg = now;
          var speed = (i + 1) / ((now - t0) / 1000);
          onProgress(i + 1, total, 'render', { speed: speed, eta: (total - i - 1) / speed, width: W, height: H });
        }
      }

      /* 4. finish */
      onProgress(total, total, 'finalize', {});
      await encoder.flush();
      if (encErr) throw encErr;
      encoder.close(); encoder = null;
      feedAudioUpTo(Infinity);
      muxer.finalize();
      result.bytes = await saveTarget(tgt, handle, filename);
      result.seconds = Math.round((performance.now() - t0) / 100) / 10;
      result.renderFps = Math.round(total / Math.max(0.1, result.seconds) * 100) / 100;
      result.guardReseeks = guardFixes; result.rvfcFrames = rvfcFrames; result.reseeks = reseeks; result.frameMismatches = mismatches;
      result.savedTo = handle ? 'file' : 'download';
      result.colour = colourLabel(scratchRef, warnings);
      result.warnings = warnings;
      ok = true;
      return result;
    } catch (e) {
      result = { error: (e && e.message) || String(e), warnings: warnings };
      return result;
    } finally {
      if (playGuard) { try { video.removeEventListener('play', playGuard); } catch (e) { /* */ } }
      if (encoder) { try { encoder.close(); } catch (e) { /* */ } }
      if (scratchRef && scratchRef.yuv) scratchRef.yuv.destroy();
      if (tgt && tgt.writable) { try { await tgt.writable.abort(); } catch (e) { /* */ } }
      /* stopped / failed: nothing saved — the empty file the save dialog created goes too */
      if (!ok && picked && handle && typeof handle.remove === 'function') { try { await handle.remove(); } catch (e) { /* */ } }
      if (prepared && typeof opts.finish === 'function') { try { await opts.finish(result); } catch (e) { /* */ } }
      window.__synExportLast = result;
    }
  }

  /* ───────────────────────── B. realtime recorder (live sources) ───────────────────────── */
  /* recordLive({canvas | getCanvas() → canvas | {canvas,sx,sy,sw,sh}, fps=60, audioStream?, quality,
       filename, onProgress(sec, info), useFilePicker, fileHandle}) → { stop(): Promise<result>, done }
     Call it synchronously from the click (the save dialog opens first). */
  function recordLive(opts) {
    var stopRequested = false, stopResolve = null, warnings = [];
    var stopP = new Promise(function (r) { stopResolve = r; });
    var fps = Math.max(1, Math.round(opts.fps || 60));
    var quality = opts.quality === 'high' ? 'high' : 'master';
    var filename = opts.filename || ('rec_' + Date.now() + '.mp4');
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    var getRegion = function () {
      var c = typeof opts.getCanvas === 'function' ? opts.getCanvas() : opts.canvas;
      return c && c.canvas ? c : { canvas: c };
    };
    var done = (async function () {
      var t0 = performance.now(), handle = null, picked = false, tgt = null, venc = null, aenc = null, reader = null, ok = false, result = null, rafId = 0, scratchRef = {};
      try {
        var loc = await askSaveLocation(opts, filename, warnings);
        if (loc.cancelled) return (result = { stopped: true, cancelled: true });
        handle = loc.handle; picked = !!loc.picked; if (handle && handle.name) filename = handle.name;
        if (!isSupported()) return (result = await recordWithMediaRecorder(opts, fps, filename, stopP, warnings));
        var Mux = await loadMuxer();
        var r0 = getRegion();
        var W = even(r0.sw || r0.canvas.width), H = even(r0.sh || r0.canvas.height);
        var choice = await encoderFor(W, H, fps, quality);
        if (!choice) throw noEncoderError(W, H, fps);
        /* audio: first AudioData gives rate / channels (needed before the muxer exists) */
        var atrack = opts.audioStream && opts.audioStream.getAudioTracks && opts.audioStream.getAudioTracks()[0];
        var apick = null, firstAD = null;
        if (atrack && typeof window.MediaStreamTrackProcessor === 'function' && typeof window.AudioEncoder === 'function') {
          reader = new window.MediaStreamTrackProcessor({ track: atrack }).readable.getReader();
          var first = await Promise.race([reader.read(), new Promise(function (r) { setTimeout(function () { r(null); }, 1500); })]);
          if (first && first.value) {
            firstAD = first.value;
            apick = await pickAudioCodec(firstAD.sampleRate, Math.min(2, firstAD.numberOfChannels));
            if (!apick) { warnings.push('no audio encoder on this machine: video without audio'); firstAD.close(); firstAD = null; }
            else if (apick.cand.mux === 'opus') warnings.push('audio Opus: may not open in Premiere/QuickTime');
          } else warnings.push('the audio stream sent no data: video without audio');
        } else if (atrack) warnings.push('audio capture (MediaStreamTrackProcessor) unavailable: video without audio');
        if (stopRequested) return (result = { stopped: true });
        tgt = await makeTarget(Mux, handle);
        var muxOpts = { target: tgt.target, fastStart: tgt.fastStart, firstTimestampBehavior: 'strict',
          video: { codec: choice.cand.mux, width: W, height: H, frameRate: fps } };
        if (apick) muxOpts.audio = { codec: apick.cand.mux, numberOfChannels: apick.config.numberOfChannels, sampleRate: apick.config.sampleRate };
        var muxer = new Mux.Muxer(muxOpts), err = null;
        venc = new window.VideoEncoder({ output: function (c, m) { try { muxer.addVideoChunk(c, tagColour(m, scratchRef)); } catch (e) { err = e; } }, error: function (e) { err = e; } });
        venc.configure(choice.config);
        var start = 0, lastIdx = -1, lastKey = -fps, frames = 0, dropped = 0;
        scratchRef.noYuv = opts.limitedRange === false;
        if (!scratchRef.noYuv) {                 /* realtime: keep the GPU colour pass only if it is cheap here */
          var yb = makeYuv(W, H), bt = 0;
          if (yb) {
            try {
              frameOf(r0, W, H, 0, 1, { yuv: yb }).close();          /* warm-up: shader compile + first upload, not timed */
              for (var bi = 0; bi < 3; bi++) { var b0 = performance.now(); frameOf(r0, W, H, 0, 1, { yuv: yb }).close(); bt += performance.now() - b0; }
            }
            catch (e) { bt = Infinity; }
            if (bt / 3 > 0.35 * 1000 / fps) { yb.destroy(); yb = null; warnings.push('colour: the GPU conversion is too slow for realtime here (' + Math.round(bt / 3) + ' ms/frame)'); }
          }
          scratchRef.yuv = yb;
        }
        /* video: one frame per presented canvas frame (rAF after the effect's own draw), on the 1/fps grid */
        var tick = function () {
          if (stopRequested || err) return;
          rafId = requestAnimationFrame(tick);
          if (!start) start = performance.now();           /* the first captured frame is t = 0 */
          var idx = Math.round((performance.now() - start) / 1000 * fps);
          if (idx <= lastIdx) return;
          if (venc.encodeQueueSize > 6) { dropped++; return; }      /* realtime: never block the effect */
          var rg = getRegion(), ts = Math.round(idx * 1e6 / fps);
          var fr; try { fr = frameOf(rg, W, H, ts, Math.round(1e6 / fps), scratchRef); } catch (e) { return; }
          var key = idx - lastKey >= fps; if (key) lastKey = idx;
          try { venc.encode(fr, { keyFrame: key }); } finally { fr.close(); }
          lastIdx = idx; frames++;
          if (frames % 15 === 0) onProgress((performance.now() - start) / 1000, { frames: frames, dropped: dropped, width: W, height: H });
        };
        var audioPump = null;
        if (apick) {
          var ach = apick.config.numberOfChannels, asr = apick.config.sampleRate, aMeta = null, aFirst = true;
          aenc = new window.AudioEncoder({ output: function (c, m) { try { muxer.addAudioChunk(c, aFirst ? (aMeta = m) : undefined); aFirst = false; } catch (e) { err = e; } }, error: function (e) { err = e; } });
          aenc.configure(apick.config);
          var written = 0;
          var encodePlanes = function (planes, n) {
            var ad = new window.AudioData({ format: 'f32-planar', sampleRate: asr, numberOfFrames: n, numberOfChannels: ach, timestamp: Math.round(written * 1e6 / asr), data: planarData(planes, 0, n) });
            aenc.encode(ad); ad.close(); written += n;
          };
          var take = function (ad) {
            if (!start) { ad.close(); return; }            /* audio before the first video frame: not part of the clip */
            var n = ad.numberOfFrames, planes = [];
            for (var c = 0; c < ach; c++) {
              var p = new Float32Array(n);
              try { ad.copyTo(p, { planeIndex: Math.min(c, ad.numberOfChannels - 1), format: 'f32-planar' }); } catch (e) { /* silence */ }
              planes.push(p);
            }
            ad.close();
            /* keep audio on the video clock: pad with silence when the stream lags, drop when it leads */
            var due = Math.round((performance.now() - start) / 1000 * asr) - n;
            if (due - written > asr * 0.1) { var gap = due - written, z = []; for (var k = 0; k < ach; k++) z.push(new Float32Array(gap)); encodePlanes(z, gap); }
            if (written - due > asr * 0.25) return;
            encodePlanes(planes, n);
          };
          take(firstAD); firstAD = null;
          audioPump = (async function () {
            while (!stopRequested) {
              var r = await reader.read();
              if (r.done) break;
              if (stopRequested) { r.value.close(); break; }
              take(r.value);
            }
          })();
        }
        rafId = requestAnimationFrame(tick);
        await stopP;
        cancelAnimationFrame(rafId);
        if (reader) { try { reader.cancel(); } catch (e) { /* */ } }
        if (audioPump) { try { await audioPump; } catch (e) { /* */ } }
        if (err) throw err;
        if (!frames) throw new Error('no frame was recorded');
        await venc.flush(); venc.close(); venc = null;
        if (aenc) { await aenc.flush(); aenc.close(); aenc = null; }
        if (err) throw err;
        muxer.finalize();
        var bytes = await saveTarget(tgt, handle, filename);
        var sec = start ? (performance.now() - start) / 1000 : 0;
        result = { filename: filename, codec: choice.cand.label + ' (' + choice.cand.codec + ')', audioCodec: apick ? apick.cand.label : 'none',
          width: W, height: H, fps: fps, num: fps, den: 1, frames: frames, dropped: dropped, bytes: bytes,
          seconds: Math.round(sec * 10) / 10, realtime: true, savedTo: handle ? 'file' : 'download', colour: colourLabel(scratchRef, warnings), warnings: warnings };
        ok = true;
        return result;
      } catch (e) {
        result = { error: (e && e.message) || String(e), warnings: warnings };
        return result;
      } finally {
        cancelAnimationFrame(rafId);
        if (scratchRef.yuv) scratchRef.yuv.destroy();
        if (venc) { try { venc.close(); } catch (e) { /* */ } }
        if (aenc) { try { aenc.close(); } catch (e) { /* */ } }
        if (reader) { try { reader.cancel(); } catch (e) { /* */ } }
        if (tgt && tgt.writable) { try { await tgt.writable.abort(); } catch (e) { /* */ } }
        if (!ok && picked && handle && typeof handle.remove === 'function') { try { await handle.remove(); } catch (e) { /* */ } }
        window.__synExportLast = result;
      }
    })();
    return {
      stop: function () { stopRequested = true; stopResolve(); return done; },
      done: done
    };
  }

  /* No WebCodecs: MediaRecorder, MP4 only (never WebM). */
  async function recordWithMediaRecorder(opts, fps, filename, stopP, warnings) {
    var mimes = ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.640028', 'video/mp4'];
    var mime = '';
    if (typeof window.MediaRecorder === 'function') for (var i = 0; i < mimes.length; i++) if (MediaRecorder.isTypeSupported(mimes[i])) { mime = mimes[i]; break; }
    if (!mime) throw new Error('this browser can neither encode MP4 with WebCodecs nor record MP4 with MediaRecorder');
    var c = typeof opts.getCanvas === 'function' ? opts.getCanvas() : opts.canvas; c = c && c.canvas ? c.canvas : c;
    var stream = c.captureStream(fps);
    if (opts.audioStream) opts.audioStream.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
    var bps = bitrateFor(c.width, c.height, fps, opts.quality);
    var rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bps }), parts = [];
    rec.ondataavailable = function (e) { if (e.data.size) parts.push(e.data); };
    var t0 = performance.now();
    rec.start(250);
    await stopP;
    await new Promise(function (r) { rec.onstop = r; rec.stop(); });
    var blob = new Blob(parts, { type: 'video/mp4' });
    downloadBlob(blob, filename);
    warnings.push('MediaRecorder fallback (no WebCodecs): realtime encoder, frame rate not guaranteed');
    return { filename: filename, codec: mime, audioCodec: opts.audioStream ? 'MediaRecorder' : 'none', width: c.width, height: c.height,
      fps: fps, num: fps, den: 1, frames: 0, bytes: blob.size, seconds: Math.round((performance.now() - t0) / 100) / 10, realtime: true, warnings: warnings };
  }

  /* ───────────────────────── offline AnalyserNode stand-in ─────────────────────────
     SynExport.offlineAnalyser({ file | audioBuffer, fftSize=2048, smoothingTimeConstant=0.8,
       minDecibels=-100, maxDecibels=-30, sampleRate=48000 }) → Promise<analyser>
     Pass sampleRate = the effect's own AudioContext.sampleRate so bin k means the same Hz as live
     (an AnalyserNode's bin width is sampleRate / fftSize).
     During an offline render the <video> is paused and seeked, so a real AnalyserNode hears nothing.
     This one reads the file's own decoded audio (48 kHz, cached with render()), mixed down to mono the
     way Web Audio does, and follows the Web Audio spec maths: Blackman window, |X[k]|/N, smoothing
     τ·prev + (1−τ)·now, 20·log10, byte = ⌊255/(max−min)·(dB−min)⌋, time domain byte = ⌊128·(1+x)⌋.
       analyser.setTime(tSec)  → the window is the fftSize samples ENDING at tSec. Each setTime (in
                                 increasing order, e.g. once per rendered frame) is one "analysis
                                 step": the first frequency read after it applies smoothing once.
       frequencyBinCount, fftSize, smoothingTimeConstant, minDecibels, maxDecibels, sampleRate, duration
       getByteFrequencyData / getFloatFrequencyData / getByteTimeDomainData / getFloatTimeDomainData
       connect() / disconnect(): no-ops (drop-in for code that wires the node).
     No audio in the source → an analyser of silence (bytes 0 / dB −Infinity / time domain 128). */
  var fftCache = {};
  function fftTables(N) {
    if (fftCache[N]) return fftCache[N];
    var rev = new Uint32Array(N), bits = Math.round(Math.log2(N));
    for (var i = 0; i < N; i++) { var r = 0, x = i; for (var b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
    var cos = new Float64Array(N / 2), sin = new Float64Array(N / 2);
    for (var k = 0; k < N / 2; k++) { cos[k] = Math.cos(2 * Math.PI * k / N); sin[k] = -Math.sin(2 * Math.PI * k / N); }
    var win = new Float64Array(N);
    for (var n = 0; n < N; n++) win[n] = 0.42 - 0.5 * Math.cos(2 * Math.PI * n / N) + 0.08 * Math.cos(4 * Math.PI * n / N);
    return (fftCache[N] = { rev: rev, cos: cos, sin: sin, win: win });
  }
  function fftMag(input, N, out) {           /* out[k] = |FFT(input·blackman)[k]| / N, k < N/2 */
    var T = fftTables(N), re = new Float64Array(N), im = new Float64Array(N);
    for (var i = 0; i < N; i++) re[T.rev[i]] = input[i] * T.win[i];
    for (var size = 2; size <= N; size <<= 1) {
      var half = size >> 1, step = N / size;
      for (var s = 0; s < N; s += size) for (var j = 0; j < half; j++) {
        var c = T.cos[j * step], sn = T.sin[j * step], a = s + j, b = a + half;
        var tr = re[b] * c - im[b] * sn, ti = re[b] * sn + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
    for (var k = 0; k < N / 2; k++) out[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / N;
  }
  function monoMix(ab) {
    if (!ab) return new Float32Array(0);
    var n = ab.length, ch = ab.numberOfChannels, m = new Float32Array(n), c = [];
    for (var i = 0; i < ch; i++) c.push(ab.getChannelData(i));
    if (ch === 1) m.set(c[0]);
    else if (ch === 2) for (var a = 0; a < n; a++) m[a] = 0.5 * (c[0][a] + c[1][a]);
    else if (ch === 4) for (var b = 0; b < n; b++) m[b] = 0.25 * (c[0][b] + c[1][b] + c[2][b] + c[3][b]);
    else if (ch === 6) for (var d = 0; d < n; d++) m[d] = Math.SQRT1_2 * (c[0][d] + c[1][d]) + c[2][d] + 0.5 * (c[4][d] + c[5][d]);
    else for (var e = 0; e < n; e++) { var s2 = 0; for (var k = 0; k < ch; k++) s2 += c[k][e]; m[e] = s2 / ch; }
    return m;
  }
  async function offlineAnalyser(o) {
    o = o || {};
    var ab = o.audioBuffer || (o.file ? await decodeFileAudio(await Promise.resolve(o.file), o.sampleRate) : null);
    var sr = ab ? ab.sampleRate : (o.sampleRate || 48000), mono = monoMix(ab);
    var N = o.fftSize || 2048;
    if (!(N >= 32 && N <= 32768 && (N & (N - 1)) === 0)) throw new Error('offlineAnalyser: fftSize must be a power of two in 32…32768');
    var an = {
      fftSize: N, frequencyBinCount: N / 2, sampleRate: sr, duration: mono.length / sr,
      smoothingTimeConstant: o.smoothingTimeConstant === undefined ? 0.8 : o.smoothingTimeConstant,
      minDecibels: o.minDecibels === undefined ? -100 : o.minDecibels,
      maxDecibels: o.maxDecibels === undefined ? -30 : o.maxDecibels,
      connect: function () {}, disconnect: function () {}
    };
    var end = 0, dirty = true, td = new Float32Array(N), mag = new Float64Array(N / 2), smooth = new Float64Array(N / 2);
    function fillTime() {
      var s0 = end - N;
      for (var i = 0; i < N; i++) { var j = s0 + i; td[i] = j >= 0 && j < mono.length ? mono[j] : 0; }
    }
    function analyse() {                       /* once per setTime: the spec's "current frequency data" */
      if (!dirty) return;
      dirty = false;
      if (an.fftSize !== N) throw new Error('offlineAnalyser: fftSize is fixed at creation');
      fillTime(); fftMag(td, N, mag);
      var tau = Math.min(1, Math.max(0, an.smoothingTimeConstant));
      for (var k = 0; k < N / 2; k++) { var v = tau * smooth[k] + (1 - tau) * mag[k]; smooth[k] = isFinite(v) ? v : 0; }
    }
    an.setTime = function (t) { end = Math.max(0, Math.round(t * sr)); dirty = true; };
    an.getTime = function () { return end / sr; };
    an.getFloatFrequencyData = function (arr) {
      analyse();
      for (var k = 0; k < Math.min(arr.length, N / 2); k++) arr[k] = 20 * Math.log10(smooth[k]);
    };
    an.getByteFrequencyData = function (arr) {
      analyse();
      var lo = an.minDecibels, rng = an.maxDecibels - an.minDecibels;
      for (var k = 0; k < Math.min(arr.length, N / 2); k++) {
        var db = 20 * Math.log10(smooth[k]), b = Math.floor(255 / rng * (db - lo));
        arr[k] = b > 255 ? 255 : (b > 0 ? b : 0);
      }
    };
    an.getFloatTimeDomainData = function (arr) { fillTime(); for (var i = 0; i < Math.min(arr.length, N); i++) arr[i] = td[i]; };
    an.getByteTimeDomainData = function (arr) {
      fillTime();
      for (var i = 0; i < Math.min(arr.length, N); i++) { var b = Math.floor(128 * (1 + td[i])); arr[i] = b > 255 ? 255 : (b > 0 ? b : 0); }
    };
    return an;
  }

  /* ───────────────────────── attach(): the per-effect glue in one call ─────────────────────────
     SynExport.attach({
       label,                       // 'ANAMORPHIC' (file names, messages)
       recBtnId,                    // the effect's REC button: intercepted (capture phase) — video file → offline
                                    //   render, live source → recordLive. The effect's own handler never runs.
       renderBtnId, qualityId, statusId,   // RENDER MP4 button, quality select / [data-q] buttons, status line
       toast(msg, ms),              // the effect's own toast
       hasVideoFile(), getVideo(), getFile() → Blob|Promise<Blob>, sourceName(),
       beforeRender(), getFrame(i, t), afterRender(result),      // see the ADAPTER CONTRACT above
       getLiveCanvas() → canvas | {canvas,sx,sy,sw,sh}, getLiveAudio() → MediaStream|null, liveFps(),
       beforeLive(), afterLive(),   // e.g. full-resolution canvas while recording live
       recUi: { start(kind), progress(kind, pct|sec), stop(kind) },   // the effect's REC visuals
       passThroughRec()             // true → let the click reach the effect's own handler
     }) → { busy(), stop() }
     Tests: window.__synExportNoPicker = true → no save dialog, <a download>. */
  function attach(cfg) {
    var $ = function (id) { return id ? document.getElementById(id) : null; };
    var toast = typeof cfg.toast === 'function' ? cfg.toast : function () {};
    var ui = cfg.recUi || {};
    var job = null;               /* {kind:'render'|'live', ac?, ctl?} */
    var label = cfg.label || 'VFX';
    var renderBtn = $(cfg.renderBtnId), renderLabel = renderBtn ? renderBtn.textContent : 'RENDER MP4';
    var qKey = 'syntech.export.quality';

    /* quality control: <select> or [data-q] buttons (.on = selected) */
    var qEl = $(cfg.qualityId);
    function setQ(q) {
      if (!qEl) return;
      if (qEl.tagName === 'SELECT') qEl.value = q;
      else qEl.querySelectorAll('[data-q]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-q') === q); });
      try { localStorage.setItem(qKey, q); } catch (e) { /* */ }
    }
    function getQ() {
      if (!qEl) return 'master';
      if (qEl.tagName === 'SELECT') return qEl.value === 'high' ? 'high' : 'master';
      var on = qEl.querySelector('[data-q].on');
      return on && on.getAttribute('data-q') === 'high' ? 'high' : 'master';
    }
    if (qEl) {
      if (qEl.tagName === 'SELECT') qEl.addEventListener('change', function () { setQ(getQ()); });
      else qEl.addEventListener('click', function (e) { var b = e.target.closest('[data-q]'); if (b && !job) setQ(b.getAttribute('data-q')); });
      var saved = null; try { saved = localStorage.getItem(qKey); } catch (e) { /* */ }
      setQ(saved === 'high' ? 'high' : 'master');
    }
    function status(t) { var s = $(cfg.statusId); if (s) s.textContent = t; }
    function base(name) { return String(name || 'video').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_').slice(0, 60) || 'video'; }
    function noPicker() { return window.__synExportNoPicker === true; }
    function setBusy(b) { window.__synExportBusy = b; }
    function call(fn) { if (typeof fn === 'function') { try { return fn.apply(null, [].slice.call(arguments, 1)); } catch (e) { console.error(e); } } }
    function fmtT(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

    function describe(r) {
      return r.width + '×' + r.height + ' · ' + (Math.round(r.fps * 1000) / 1000) + ' fps · ' + r.frames + ' fr · ' +
        String(r.codec).split(' (')[0] + (r.audioCodec && r.audioCodec !== 'none' ? ' + ' + r.audioCodec.split(' ')[0] : '') +
        ' · ' + (r.bytes / 1048576).toFixed(1) + ' MB';
    }
    function report(r, kind) {
      if (!r) return;
      if (r.error) { status('✕ ' + r.error); toast('⚠ ' + (kind === 'live' ? 'REC' : 'RENDER') + ': ' + r.error, 6000); return; }
      if (r.stopped) { status(r.cancelled ? 'Cancelled — nothing saved' : 'Stopped — nothing saved'); toast(r.cancelled ? '◯ Cancelled' : '■ Stopped — nothing saved', 2400); return; }
      var w = (r.warnings || []).filter(function (x) { return /audio|Opus|scaled|without audio|fallback/i.test(x); });
      status('✓ ' + describe(r) + (w.length ? ' — ' + w.join('; ') : ''));
      toast('⬇ ' + (kind === 'live' ? 'REC' : 'RENDER') + ' MP4 — ' + describe(r) + (w.length ? ' — ' + w[0] : ''), 5000);
    }

    function startRender() {
      var v = cfg.getVideo(), ac = new AbortController(), q = getQ(), lastToast = 0;
      job = { kind: 'render', ac: ac };
      setBusy(true);
      if (renderBtn) renderBtn.textContent = '■ STOP 0%';
      call(ui.start, 'render');
      status('Preparing ' + (q === 'high' ? 'HIGH' : 'MASTER') + ' render…');
      var p = render({
        video: v, file: cfg.getFile(), quality: q, signal: ac.signal, useFilePicker: !noPicker(),
        filename: base(call(cfg.sourceName)) + '_' + label + '_' + q.toUpperCase() + '.mp4',
        prepare: function () { return cfg.beforeRender && cfg.beforeRender(); },
        getFrame: cfg.getFrame,
        finish: function (r) { return cfg.afterRender && cfg.afterRender(r); },
        onProgress: function (i, total, phase, info) {
          if (phase !== 'render') { status(phase === 'audio' ? 'Decoding audio…' : phase === 'finalize' ? 'Writing MP4…' : 'Reading source…'); return; }
          var pct = Math.floor(i / total * 100);
          if (renderBtn) renderBtn.textContent = '■ STOP ' + pct + '%';
          call(ui.progress, 'render', pct);
          status('Rendering ' + i + '/' + total + ' · ' + info.width + '×' + info.height + ' · ' + info.speed.toFixed(1) + ' fr/s · ETA ' + fmtT(info.eta));
          var now = performance.now();
          if (now - lastToast > 1000) { lastToast = now; toast('● RENDER ' + pct + '% — ' + i + '/' + total, 1600); }
        }
      });
      p.then(function (r) {
        job = null; setBusy(false);
        if (renderBtn) renderBtn.textContent = renderLabel;
        call(ui.stop, 'render');
        report(r, 'render');
      });
    }
    function startLive() {
      var q = getQ(), lc = call(cfg.liveFps);
      call(cfg.beforeLive);
      var ctl = recordLive({
        getCanvas: cfg.getLiveCanvas, fps: lc || 60, audioStream: call(cfg.getLiveAudio) || null, quality: q,
        useFilePicker: !noPicker(), filename: base(call(cfg.sourceName) || 'live') + '_' + label + '_REC.mp4',
        onProgress: function (sec, info) { call(ui.progress, 'live', sec); status('● REC ' + fmtT(sec) + ' · ' + info.width + '×' + info.height + ' · ' + info.frames + ' fr' + (info.dropped ? ' (' + info.dropped + ' dropped)' : '')); }
      });
      job = { kind: 'live', ctl: ctl };
      setBusy(true);
      call(ui.start, 'live');
      status('● REC — MP4');
      ctl.done.then(function (r) {
        job = null; setBusy(false);
        call(cfg.afterLive);
        call(ui.stop, 'live');
        report(r, 'live');
      });
    }
    function stop() {
      if (!job) return;
      if (job.kind === 'render') { job.ac.abort(); status('Stopping…'); }
      else job.ctl.stop();
    }

    if (renderBtn) renderBtn.addEventListener('click', function () {
      if (job) { stop(); return; }
      if (!call(cfg.hasVideoFile)) { toast('RENDER needs a video file — use REC for live sources', 3000); return; }
      if (!isSupported()) { toast('⚠ RENDER needs WebCodecs (Chrome / Edge)', 3500); return; }
      startRender();
    });
    if (cfg.recBtnId) document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('#' + cfg.recBtnId) : null;
      if (!b) return;
      if (!job && call(cfg.passThroughRec)) return;
      e.stopImmediatePropagation(); e.preventDefault();
      if (job) { stop(); return; }
      if (call(cfg.hasVideoFile)) { if (!isSupported()) { toast('⚠ RENDER needs WebCodecs (Chrome / Edge)', 3500); return; } startRender(); }
      else if (call(cfg.hasLiveSource) === false) toast('◯ No active source', 2000);
      else startLive();
    }, true);

    return { busy: function () { return !!job; }, stop: stop, quality: getQ };
  }

  window.SynExport = { isSupported: isSupported, probeFps: probeFps, render: render, recordLive: recordLive, attach: attach,
    offlineAnalyser: offlineAnalyser, decodeFileAudio: decodeFileAudio, _probeAacCopy: probeAacCopy, _makeYuv: makeYuv,
    encoderFor: encoderFor, snapRate: snapRate, _seekFrame: seekFrame, _codecList: codecList };
})();
