/*
 * LAB RECORDING — the chain's OUTPUT is a MediaStream (the last node's
 * canvas.captureStream()), shown by the Lab in a <video>. Both recorders here
 * read that <video>: every presented frame is drawn into a canvas of a FIXED
 * size the recorder owns, so an effect resizing its canvas mid-take (a window
 * resize, the export's enlarged frame) never reaches the encoder.
 *
 *   recordVideoClip  a short webm for Gemini (≤ 640 px, LabHandle.recordOutputClip)
 *   MasterRecorder   the Master export: realtime, MP4 (H.264 + AAC) when the
 *                    browser's MediaRecorder can, else WebM
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

/* ── Master export ─────────────────────────────────────────────── */

/** MP4 first (Chromium ≥ 126 muxes H.264 + AAC in MediaRecorder), WebM otherwise. */
const MASTER_MIMES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1.4d0028,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
/** the video-only variants, for a take with no audio track */
const MASTER_MIMES_SILENT = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1.4d0028',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export const pickMasterMime = (withAudio: boolean): string | null => pick(withAudio ? MASTER_MIMES : MASTER_MIMES_SILENT);

export interface MasterResult { blob: Blob; mime: string; ext: 'mp4' | 'webm'; width: number; height: number; audio: boolean }

/**
 * Realtime recorder of the Lab OUTPUT <video> (+ the Lab audio). The frame is
 * `width` wide, its height follows the output's aspect (even numbers: H.264).
 */
export class MasterRecorder {
  readonly width: number;
  readonly height: number;
  readonly mime: string;
  readonly hasAudio: boolean;
  private canvas: HTMLCanvasElement;
  private copier: { stop(): void; draw(): void };
  private stream: MediaStream;
  private clones: MediaStreamTrack[] = [];
  private rec: MediaRecorder;
  private chunks: Blob[] = [];
  private stopped: Promise<void>;

  constructor(video: HTMLVideoElement, audio: MediaStream | null, width = 1920) {
    const sw = video.videoWidth || 16;
    const sh = video.videoHeight || 9;
    const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
    this.width = even(width);
    this.height = even((width * sh) / sw);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    const liveAudio = audio?.getAudioTracks().filter((t) => t.readyState === 'live') ?? [];
    this.hasAudio = liveAudio.length > 0;
    /* pick the format BEFORE anything starts, so a throw leaves nothing running */
    const mime = pickMasterMime(this.hasAudio);
    if (!mime) throw new Error('this browser cannot record video (no MediaRecorder format)');
    this.mime = mime;
    this.copier = frameCopier(video, this.canvas);
    this.stream = this.canvas.captureStream(30);
    liveAudio.forEach((t) => {
      const c = t.clone();
      this.clones.push(c);
      this.stream.addTrack(c);
    });
    try {
      // ~12 Mbps at 1080p: a master, not a preview
      this.rec = new MediaRecorder(this.stream, {
        mimeType: mime,
        videoBitsPerSecond: Math.round(12_000_000 * ((this.width * this.height) / (1920 * 1080))),
        audioBitsPerSecond: 192_000,
      });
    } catch (e) {
      this.copier.stop();
      this.stream.getTracks().forEach((t) => t.stop());
      throw e;
    }
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.stopped = new Promise<void>((resolve) => { this.rec.onstop = () => resolve(); this.rec.onerror = () => resolve(); });
  }

  start(): void {
    this.copier.draw();
    this.rec.start(1000);
  }

  /** ends the take; `keep` false discards it (STOP / an error) */
  async finish(keep: boolean): Promise<MasterResult | null> {
    try {
      if (this.rec.state !== 'inactive') this.rec.stop();
      let t = 0;
      await Promise.race([this.stopped, new Promise<void>((r) => { t = window.setTimeout(r, 5000); })]);
      window.clearTimeout(t);
    } finally {
      this.copier.stop();
      this.stream.getTracks().forEach((tr) => tr.stop());
      this.clones.forEach((tr) => tr.stop());
      this.canvas.width = this.canvas.height = 0;
    }
    if (!keep) return null;
    const type = this.mime.split(';')[0];
    const blob = new Blob(this.chunks, { type });
    if (!blob.size) return null;
    return { blob, mime: this.mime, ext: type === 'video/mp4' ? 'mp4' : 'webm', width: this.width, height: this.height, audio: this.hasAudio };
  }
}
