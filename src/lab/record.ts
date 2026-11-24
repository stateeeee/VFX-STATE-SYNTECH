/*
 * LAB RECORDING — the chain's OUTPUT is a MediaStream (the last node's
 * canvas.captureStream()), shown by the Lab in a <video>. Both readers here
 * read that <video>: every presented frame is drawn into a canvas of a FIXED
 * size the recorder owns, so an effect resizing its canvas mid-take (a window
 * resize, the export's enlarged frame) never reaches the encoder.
 *
 *   recordVideoClip  a short webm for Gemini (≤ 640 px, LabHandle.recordOutputClip)
 *   OutputTap        the frame the Master's realtime MP4 take (SynExport.recordLive) records, at the
 *                    OUTPUT's native size
 */

import type { MediaPart } from '../ai/contract';
import { blobToBase64 } from '../ai/capture';

type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (h: number) => void;
};

/** Draws `video` into `canvas` on every presented frame (rAF fallback), letterboxed on black. */
function frameCopier(video: HTMLVideoElement, canvas: HTMLCanvasElement): { stop(): void; draw(): void } {
  const g = canvas.getContext('2d');
  const v = video as RvfcVideo;
  let handle = 0;
  let raf = 0;
  let live = true;
  const draw = () => {
    if (!g) return;
    const W = canvas.width;
    const H = canvas.height;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const sw = video.videoWidth;
    const sh = video.videoHeight;
    if (!sw || !sh || video.readyState < 2) return;
    const k = Math.min(W / sw, H / sh);
    const dw = sw * k;
    const dh = sh * k;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
  };
  const onFrame = () => {
    if (!live) return;
    draw();
    handle = v.requestVideoFrameCallback!(onFrame);
  };
  const onRaf = () => {
    if (!live) return;
    draw();
    raf = requestAnimationFrame(onRaf);
  };
  if (typeof v.requestVideoFrameCallback === 'function') handle = v.requestVideoFrameCallback(onFrame);
  else raf = requestAnimationFrame(onRaf);
  draw();
  return {
    draw,
    stop: () => {
      live = false;
      if (handle && typeof v.cancelVideoFrameCallback === 'function') v.cancelVideoFrameCallback(handle);
      cancelAnimationFrame(raf);
    },
  };
}

const CLIP_MIMES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const pick = (list: string[]): string | null => {
  if (typeof MediaRecorder === 'undefined') return null;
  return list.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) ?? null;
};

/** A short OUTPUT clip (webm, ≤ 640×360 / 360×640) with the given audio, as a MediaPart. */
export async function recordVideoClip(video: HTMLVideoElement, audio: MediaStream | null, sec: number, label: string): Promise<MediaPart | null> {
  const mime = pick(CLIP_MIMES);
  if (!mime || !video.videoWidth || !video.videoHeight) return null;
  const ms = Math.min(30, Math.max(0.5, Number.isFinite(sec) ? sec : 4)) * 1000;
  const portrait = video.videoHeight > video.videoWidth;
  const proxy = document.createElement('canvas');
  proxy.width = portrait ? 360 : 640;
  proxy.height = portrait ? 640 : 360;
  const copier = frameCopier(video, proxy);
  let stream: MediaStream | null = null;
  const clones: MediaStreamTrack[] = [];
  let timer = 0;
  try {
    stream = proxy.captureStream(30);
    audio?.getAudioTracks().forEach((t) => {
      if (t.readyState !== 'live') return;
      const c = t.clone();
      clones.push(c);
      stream!.addTrack(c);
    });
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_200_000, audioBitsPerSecond: 128_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise<void>((resolve) => { rec.onstop = () => resolve(); rec.onerror = () => resolve(); });
    rec.start(250);
    await new Promise<void>((resolve) => { timer = window.setTimeout(resolve, ms); });
    if (rec.state !== 'inactive') rec.stop();
    await Promise.race([stopped, new Promise<void>((resolve) => { timer = window.setTimeout(resolve, 3000); })]);
    const type = mime.split(';')[0];
    const blob = new Blob(chunks, { type });
    if (!blob.size) return null;
    const data = await blobToBase64(blob);
    return data ? { mimeType: type, data, label } : null;
  } catch {
    return null;
  } finally {
    copier.stop();
    window.clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    clones.forEach((t) => t.stop());
    proxy.width = proxy.height = 0;
  }
}

/* ── Master export (realtime MP4: webcam / photo INPUT) ───────────────
   The encoder is SynExport.recordLive (WebCodecs H.264 + AAC, MP4 only — never WebM). What this file adds is
   the frame it records: the chain OUTPUT <video> drawn into a canvas that keeps the OUTPUT's NATIVE size
   (even numbers: H.264) for the whole take, so an effect resizing its canvas mid-take never reaches the
   encoder, and nothing is upscaled. */

/** the canvas a take reads: `region()` draws the OUTPUT's current frame into it and returns it */
export class OutputTap {
  readonly width: number;
  readonly height: number;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D | null;

  constructor(private video: HTMLVideoElement) {
    const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
    this.width = even(video.videoWidth || 16);
    this.height = even(video.videoHeight || 9);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.g = this.canvas.getContext('2d');
    this.draw();
  }

  private draw() {
    const g = this.g;
    const v = this.video;
    if (!g) return;
    const sw = v.videoWidth;
    const sh = v.videoHeight;
    if (!sw || !sh || v.readyState < 2) return; // keeps the previous frame
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (sw === W && sh === H) { g.drawImage(v, 0, 0); return; }
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const k = Math.min(W / sw, H / sh);
    g.drawImage(v, (W - sw * k) / 2, (H - sh * k) / 2, sw * k, sh * k);
  }

  region(): HTMLCanvasElement {
    this.draw();
    return this.canvas;
  }

  dispose() { this.canvas.width = this.canvas.height = 0; }
}
