/* VFX SYNTECH — Master Quality chain exporter (Phase 9).
 *
 * Deterministic offline render → H.264/MP4 via WebCodecs + mp4-muxer.
 * ChainLab's runMasterExport() loads this after mp4-muxer.min.js and calls
 * SyntechExport.exportMasterQuality({ video, fps, getFrame, filename, onProgress }).
 *
 * The caller owns the engine: on each getFrame() it advances a synthetic clock
 * and returns engine.canvas (rendered deterministically at native res). This
 * exporter seeks the SOURCE video frame-by-frame, renders each via getFrame(),
 * encodes it, and muxes to a fast-start MP4 the browser downloads.
 *
 * v1 is video-only (audio muxing is a follow-up — the muxer already supports an
 * audio track). Preferred codec is universal H.264 (avc); if the machine has no
 * H.264 encoder it falls back to AV1 then VP9 (both play in-MP4 in modern
 * browsers). If no video encoder at all is available the export throws and the
 * button reports it (a capability of the operator's machine, not a bug).
 */
(function () {
  'use strict';

  function isSupported() {
    return typeof window.VideoEncoder === 'function' &&
      typeof window.VideoFrame === 'function' &&
      !!(window.Mp4Muxer && window.Mp4Muxer.Muxer && window.Mp4Muxer.ArrayBufferTarget);
  }

  // Codec preference: universal H.264 (avc) first — the level must cover the
  // resolution, so bigger frames get a higher level — then AV1 and VP9 as
  // fallbacks for machines WITHOUT an H.264 encoder (both play in-MP4 in modern
  // browsers). isConfigSupported() picks the first the encoder actually accepts.
  function codecCandidates(width, height) {
    var px = width * height, avc = [];
    if (px > 1920 * 1080) avc.push('avc1.640034', 'avc1.640033'); // High@5.2/5.1
    if (px > 1280 * 720) avc.push('avc1.640028');                 // High@4.0
    avc.push('avc1.64001f', 'avc1.4d0028', 'avc1.42e01f');        // High@3.1 / Main / Baseline
    var list = [];
    avc.forEach(function (c) { list.push({ enc: c, mux: 'avc', label: 'H.264', avc: true }); });
    list.push({ enc: 'av01.0.08M.08', mux: 'av1', label: 'AV1' });
    list.push({ enc: 'av01.0.04M.08', mux: 'av1', label: 'AV1' });
    list.push({ enc: 'vp09.00.41.08', mux: 'vp9', label: 'VP9' });
    list.push({ enc: 'vp09.00.10.08', mux: 'vp9', label: 'VP9' });
    return list;
  }

  async function pickCodec(width, height, bitrate, fps) {
    var cands = codecCandidates(width, height);
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      try {
        var cfg = { codec: c.enc, width: width, height: height, bitrate: bitrate, framerate: fps };
        if (c.avc) cfg.avc = { format: 'avc' };
        var r = await window.VideoEncoder.isConfigSupported(cfg);
        if (r && r.supported) return c;
      } catch (e) { /* try next */ }
    }
    return null;
  }

  function download(buffer, filename) {
    var blob = new Blob([buffer], { type: 'video/mp4' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  function seekTo(video, t) {
    return new Promise(function (res) {
      var done = false;
      var on = function () { if (done) return; done = true; video.removeEventListener('seeked', on); res(); };
      video.addEventListener('seeked', on);
      // clamp just inside the duration so the last frame always resolves
      video.currentTime = Math.max(0, Math.min(t, (video.duration || 0) - 1e-3));
      setTimeout(on, 2000); // safety: some encodes have no cue points
    });
  }

  // let the encoder drain so the queue can't grow unbounded at high res
  function drain(encoder, max) {
    return new Promise(function (res) {
      (function tick() {
        if (encoder.encodeQueueSize <= max) return res();
        setTimeout(tick, 4);
      })();
    });
  }

  async function exportMasterQuality(opts) {
    if (!isSupported()) throw new Error('WebCodecs / Mp4Muxer not available in this browser');
    var video = opts.video;
    var fps = opts.fps || 30;
    var getFrame = opts.getFrame;
    var filename = opts.filename || ('vfx_chain_' + Date.now() + '.mp4');
    var onProgress = opts.onProgress || function () {};
    if (typeof getFrame !== 'function') throw new Error('exportMasterQuality: getFrame required');
    if (!video || !isFinite(video.duration) || !video.duration) throw new Error('exportMasterQuality: a video source with a finite duration is required');

    var frameDurUs = Math.round(1e6 / fps);
    var total = Math.max(1, Math.round(video.duration * fps));

    var muxer = null, encoder = null, width = 0, height = 0, codecStr = '';
    var encoderError = null;

    onProgress(0, total, 'render');
    for (var i = 0; i < total; i++) {
      if (encoderError) throw encoderError;
      await seekTo(video, i / fps);
      var canvas = await getFrame();
      if (i === 0) {
        width = canvas.width; height = canvas.height;
        if (!width || !height) throw new Error('exportMasterQuality: engine canvas has zero size');
        var bitrate = Math.min(60000000, Math.max(4000000, Math.round(width * height * fps * 0.14)));
        var codec = await pickCodec(width, height, bitrate, fps);
        if (!codec) throw new Error('no supported video encoder for ' + width + 'x' + height);
        codecStr = codec.label;
        var target = new window.Mp4Muxer.ArrayBufferTarget();
        muxer = new window.Mp4Muxer.Muxer({
          target: target,
          video: { codec: codec.mux, width: width, height: height, frameRate: fps },
          fastStart: 'in-memory',
          firstTimestampBehavior: 'offset',
        });
        muxer._target = target;
        encoder = new window.VideoEncoder({
          output: function (chunk, meta) { muxer.addVideoChunk(chunk, meta); },
          error: function (e) { encoderError = e; },
        });
        var encCfg = { codec: codec.enc, width: width, height: height, bitrate: bitrate, framerate: fps };
        if (codec.avc) encCfg.avc = { format: 'avc' };
        encoder.configure(encCfg);
      }
      var frame = new window.VideoFrame(canvas, { timestamp: i * frameDurUs, duration: frameDurUs });
      encoder.encode(frame, { keyFrame: (i % (fps * 2)) === 0 });
      frame.close();
      onProgress(i + 1, total, 'encode');
      if (encoder.encodeQueueSize > fps) await drain(encoder, (fps / 2) | 0);
    }

    onProgress(total, total, 'finalize');
    await encoder.flush();
    encoder.close();
    if (encoderError) throw encoderError;
    muxer.finalize();
    download(muxer._target.buffer, filename);
    return { filename: filename, codec: codecStr, audio: false };
  }

  window.SyntechExport = { isSupported: isSupported, exportMasterQuality: exportMasterQuality };
})();
