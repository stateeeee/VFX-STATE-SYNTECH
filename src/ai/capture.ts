/*
 * CAPTURE — the pixels and sound the Gemini panel sends.
 *
 * Every function here runs once, on a button press (D10): nothing samples
 * in the background — the phase-3 BPM canary notices stolen frames — and
 * everything a call makes (hidden <video>, proxy canvas, stream tracks,
 * rAF, timers) is released before it returns, success or not. "Nothing to
 * capture" is a null or an empty list, never a throw, so a role can go
 * ahead with whatever media it did get.
 *
 *   blobToBase64       Blob → RAW base64 (MediaPart.data has no data: prefix)
 *   elementToJpeg      one still of a <video> / <img> / <canvas>, long side ≤ maxSide
 *   sampleVideoFrames  n stills spread over a video URL, read through a hidden
 *                      <video> of its own — the hero element is never seeked
 *   recordClip         a short webm of a canvas (the Lab output) with an
 *                      optional audio stream (the music being analysed)
 */

import type { MediaPart } from './contract';

/** a seek that has not landed by now is skipped, not waited on */
const SEEK_TIMEOUT_MS = 4000;
/** metadata of a local object URL arrives in milliseconds; this is generous */
const LOAD_TIMEOUT_MS = 8000;
/** frames are a sketch of the whole video, not a flipbook: hard ceiling */
const MAX_SAMPLES = 32;
/** samples avoid the very start/end (fades, black slates, encoder warm-up) */
const EDGE_FRAC = 0.03;

/** the output clip: a fixed pixel budget, turned to match the source */
const CLIP_LONG = 640;
const CLIP_SHORT = 360;
const CLIP_FPS = 30;
const CLIP_VIDEO_BPS = 1_200_000;
const CLIP_AUDIO_BPS = 128_000;
const CLIP_MIMES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

/* ── small helpers ───────────────────────────────────────────── */

export function blobToBase64(b: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      // "data:<mime>;base64,<payload>" — keep only the payload
      const s = typeof r.result === 'string' ? r.result : '';
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : '');
    };
    r.onerror = () => reject(r.error ?? new Error('blob read failed'));
    r.readAsDataURL(b);
  });
}

/** canvas → Blob; null instead of a throw (a tainted canvas throws in toBlob) */
function canvasToBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    try {
      c.toBlob((b) => resolve(b), type, quality);
    } catch {
      resolve(null);
    }
  });
}

/** drawable size of a source; 0×0 while it has no frame to give */
function sizeOf(el: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): { w: number; h: number } {
  if (el instanceof HTMLVideoElement) {
    return el.readyState >= 2 ? { w: el.videoWidth, h: el.videoHeight } : { w: 0, h: 0 };
  }
  if (el instanceof HTMLImageElement) {
    return el.complete ? { w: el.naturalWidth, h: el.naturalHeight } : { w: 0, h: 0 };
  }
  return { w: el.width, h: el.height };
}

/**
 * Resolves true when `event` fires (or `ready()` already holds), false on
 * the element's 'error' or after `ms`. Listeners never outlive the wait.
 */
function waitFor(el: HTMLMediaElement, event: string, ms: number, ready?: () => boolean): Promise<boolean> {
  if (ready?.()) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let timer = 0;
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      el.removeEventListener(event, onEvent);
      el.removeEventListener('error', onError);
      resolve(ok);
    };
    const onEvent = () => finish(true);
    const onError = () => finish(false);
    el.addEventListener(event, onEvent);
    el.addEventListener('error', onError);
    timer = window.setTimeout(() => finish(false), ms);
  });
}

/* ── one still ───────────────────────────────────────────────── */

/**
 * One JPEG of a video's current frame, a photo, or a canvas (the Lab's
 * WebGL output keeps its drawing buffer, so it reads back between frames).
 * Long side ≤ maxSide, never upscaled. Null for a source with no pixels
 * yet, or one the browser will not let us read (cross-origin taint).
 */
export async function elementToJpeg(
  el: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  maxSide: number,
  label: string,
  quality = 0.8,
): Promise<MediaPart | null> {
  let c: HTMLCanvasElement | null = null;
  try {
    const { w, h } = sizeOf(el);
    if (!w || !h) return null;
    const k = maxSide > 0 ? Math.min(1, maxSide / Math.max(w, h)) : 1;
    const tw = Math.max(1, Math.round(w * k));
    const th = Math.max(1, Math.round(h * k));
    c = document.createElement('canvas');
    c.width = tw;
    c.height = th;
    const c2 = c.getContext('2d');
    if (!c2) return null;
    // JPEG has no alpha: say what transparent pixels become (black, like the engine's clear)
    c2.fillStyle = '#000';
    c2.fillRect(0, 0, tw, th);
    c2.imageSmoothingEnabled = true;
    c2.imageSmoothingQuality = 'high';
    c2.drawImage(el, 0, 0, tw, th);
    const blob = await canvasToBlob(c, 'image/jpeg', quality);
    if (!blob || !blob.size) return null;
    const data = await blobToBase64(blob);
    return data ? { mimeType: 'image/jpeg', data, label } : null;
  } catch {
    return null;
  } finally {
    if (c) c.width = c.height = 0; // drop the backing store now, not at GC
  }
}

/* ── stills spread over a video ──────────────────────────────── */

/** n times across [3%, 97%] of the duration; a single sample takes the middle */
function spreadTimes(n: number, dur: number): number[] {
  if (n === 1) return [dur * 0.5];
  const lo = dur * EDGE_FRAC;
  const hi = dur * (1 - EDGE_FRAC);
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
}

/* A MediaRecorder webm (or a stream-cut file) can report Infinity until
   the end has been seen: a seek far past the end makes the browser find
   it. 0 when it still cannot tell. */
async function probeDuration(v: HTMLVideoElement): Promise<number> {
  if (isFinite(v.duration) && v.duration > 0) return v.duration;
  const found = waitFor(v, 'durationchange', SEEK_TIMEOUT_MS, () => isFinite(v.duration) && v.duration > 0);
  try {
    v.currentTime = 1e7;
  } catch {
    return 0;
  }
  await found;
  // let the probe seek settle, or its late 'seeked' would be taken for the next one's
  if (v.seeking) await waitFor(v, 'seeked', SEEK_TIMEOUT_MS);
  return isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
}

/** seek and wait until the frame at t can be drawn; false = skip this one */
async function seekTo(v: HTMLVideoElement, t: number): Promise<boolean> {
  if (Math.abs(v.currentTime - t) > 1e-3 || v.seeking) {
    const landed = waitFor(v, 'seeked', SEEK_TIMEOUT_MS);
    try {
      v.currentTime = t;
    } catch {
      return false;
    }
    if (!(await landed)) return false;
  }
  // 'seeked' normally means the frame is decoded; a slow decoder gets a moment more
  return waitFor(v, 'loadeddata', 1500, () => v.readyState >= 2);
}

/**
 * n JPEG stills spread evenly over the video at `url` (an object URL the
 * caller owns — not revoked here), labelled `${labelPrefix} at 12.0s`.
 * Reads through a detached, muted <video> made for the occasion, so the
 * hero and the Lab elements keep their playhead, their audio graph and
 * their frame rate. Frames that fail to seek in time are skipped; the
 * result may hold fewer than n, or none.
 */
export async function sampleVideoFrames(url: string, n: number, maxSide: number, labelPrefix: string): Promise<MediaPart[]> {
  const count = Math.max(0, Math.min(MAX_SAMPLES, Math.floor(n)));
  const out: MediaPart[] = [];
  if (!url || !count) return out;
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.crossOrigin = 'anonymous'; // harmless for blob: URLs, keeps CORS videos readable
  try {
    v.src = url;
    if (!(await waitFor(v, 'loadedmetadata', LOAD_TIMEOUT_MS, () => v.readyState >= 1))) return out;
    const dur = await probeDuration(v);
    // no duration at all: the first frame is still worth sending
    const times = dur > 0 ? spreadTimes(count, dur) : [0];
    for (const t of times) {
      if (!(await seekTo(v, t))) continue;
      const part = await elementToJpeg(v, maxSide, `${labelPrefix} at ${t.toFixed(1)}s`, 0.8);
      if (part) out.push(part);
    }
  } catch {
    /* keep whatever was captured */
  } finally {
    // release the decoder and the resource now
    v.removeAttribute('src');
    try { v.load(); } catch { /* already gone */ }
  }
  return out;
}

/* ── a short output clip ─────────────────────────────────────── */

function pickClipMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of CLIP_MIMES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch { /* keep looking */ }
  }
  return null;
}

/**
 * Records `sec` seconds of `canvas` (the Lab output) as video/webm, with
 * the live tracks of `audio` (AudioEngine.getOutputStream(): the music
 * being analysed) when given. The canvas is copied every animation frame
 * into a fixed 640×360 proxy — 360×640 for a portrait source — letterboxed
 * so the whole output stays in view: the payload stays small whatever the
 * render size, and adaptive-resolution steps mid-recording do not matter.
 * The caller's audio tracks are cloned, so stopping ours never silences
 * the engine. Null when the browser cannot record or nothing came out.
 */
export async function recordClip(canvas: HTMLCanvasElement, audio: MediaStream | null, sec: number, label: string): Promise<MediaPart | null> {
  const mime = pickClipMime();
  if (!mime || !canvas.width || !canvas.height) return null;
  const ms = Math.min(30, Math.max(0.5, Number.isFinite(sec) ? sec : 4)) * 1000;

  const portrait = canvas.height > canvas.width;
  const proxy = document.createElement('canvas');
  proxy.width = portrait ? CLIP_SHORT : CLIP_LONG;
  proxy.height = portrait ? CLIP_LONG : CLIP_SHORT;
  const p2 = proxy.getContext('2d');
  if (!p2) return null;
  const PW = proxy.width;
  const PH = proxy.height;

  let raf = 0;
  let timer = 0;
  let stream: MediaStream | null = null;
  const clones: MediaStreamTrack[] = [];
  try {
    const copy = () => {
      p2.fillStyle = '#000';
      p2.fillRect(0, 0, PW, PH);
      const sw = canvas.width;
      const sh = canvas.height;
      if (!sw || !sh) return;
      const k = Math.min(PW / sw, PH / sh);
      const dw = sw * k;
      const dh = sh * k;
      p2.drawImage(canvas, (PW - dw) / 2, (PH - dh) / 2, dw, dh);
    };
    copy(); // a first frame before the recorder starts, never a blank lead-in

    stream = proxy.captureStream(CLIP_FPS);
    audio?.getAudioTracks().forEach((t) => {
      if (t.readyState !== 'live') return;
      const c = t.clone();
      clones.push(c);
      stream!.addTrack(c);
    });

    const rec = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: CLIP_VIDEO_BPS,
      audioBitsPerSecond: CLIP_AUDIO_BPS,
    });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.onerror = () => resolve();
    });

    const loop = () => {
      copy();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    rec.start(250);
    await new Promise<void>((resolve) => { timer = window.setTimeout(resolve, ms); });
    if (rec.state !== 'inactive') rec.stop();
    // the final chunk lands just before 'stop'; never hang on a wedged recorder
    await Promise.race([stopped, new Promise<void>((resolve) => { timer = window.setTimeout(resolve, 3000); })]);

    const type = mime.split(';')[0];
    const blob = new Blob(chunks, { type });
    if (!blob.size) return null;
    const data = await blobToBase64(blob);
    return data ? { mimeType: type, data, label } : null;
  } catch {
    return null;
  } finally {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    clones.forEach((t) => t.stop());
    proxy.width = proxy.height = 0;
  }
}
