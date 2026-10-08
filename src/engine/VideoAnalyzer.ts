/* VideoAnalyzer — the video half of the reactivity backbone (Phase 3).
 *
 * Downsamples the engine source to a tiny offscreen canvas (~15 Hz):
 *   motion — mean absolute per-pixel luma difference between frames,
 *   bright — mean luma,
 * both 0..1 and smoothed. No source (or a stalled one) decays to 0.
 * A still photo is measured once per image (its luma cannot change);
 * its motion is 0 by definition and eases there like a stalled video.
 */

const SAMPLE_W = 32;
const SAMPLE_H = 18;
const SAMPLE_MS = 66;

export class VideoAnalyzer {
  motion = 0;
  bright = 0;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private prev: Uint8ClampedArray | null = null;
  private lastAt = 0;
  // the still last measured (element + its URL) and its mean luma
  private stillEl: HTMLImageElement | null = null;
  private stillSrc = '';
  private stillBright = 0;

  tick(source: HTMLVideoElement | HTMLImageElement | null | undefined): void {
    if (source instanceof HTMLImageElement) {
      this.tickStill(source);
      return;
    }
    const v = source instanceof HTMLVideoElement ? source : null;
    if (!v || v.readyState < 2 || !v.videoWidth) {
      this.motion *= 0.9;
      this.bright *= 0.95;
      this.prev = null;
      return;
    }
    const now = performance.now();
    if (now - this.lastAt < SAMPLE_MS) return;
    this.lastAt = now;

    const data = this.sample(v);
    if (!data) return; // tainted or not-yet-decodable frame — keep last values
    const n = SAMPLE_W * SAMPLE_H;
    let lumaSum = 0;
    let diffSum = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const luma = data[o] * 0.2126 + data[o + 1] * 0.7152 + data[o + 2] * 0.0722;
      lumaSum += luma;
      if (this.prev) diffSum += Math.abs(luma - this.prev[i]);
    }
    // reuse a flat luma buffer for the next diff
    const lumas = this.prev && this.prev.length === n ? this.prev : new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      lumas[i] = data[o] * 0.2126 + data[o + 1] * 0.7152 + data[o + 2] * 0.0722;
    }
    const hadPrev = !!this.prev;
    this.prev = lumas;

    const brightRaw = lumaSum / (n * 255);
    const motionRaw = hadPrev ? Math.min(1, (diffSum / (n * 255)) * 6) : 0;
    this.bright += (brightRaw - this.bright) * 0.25;
    this.motion += (motionRaw - this.motion) * (motionRaw > this.motion ? 0.5 : 0.15);
  }

  /* A photo: the same pixels every tick, so the 32×18 readback (a full
     downscale of an up-to-2560px still) runs once per image, then the
     cached luma feeds the usual smoothing at the usual cadence. */
  private tickStill(img: HTMLImageElement): void {
    this.prev = null; // a later video starts its diff afresh
    if (!img.complete || !img.naturalWidth) {
      this.motion *= 0.9;
      this.bright *= 0.95;
      return;
    }
    const now = performance.now();
    if (now - this.lastAt < SAMPLE_MS) return;
    this.lastAt = now;

    const src = img.currentSrc || img.src;
    if (img !== this.stillEl || src !== this.stillSrc) {
      const data = this.sample(img);
      if (!data) return; // tainted — keep last values, retry next tick
      const n = SAMPLE_W * SAMPLE_H;
      let lumaSum = 0;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        lumaSum += data[o] * 0.2126 + data[o + 1] * 0.7152 + data[o + 2] * 0.0722;
      }
      this.stillBright = lumaSum / (n * 255);
      this.stillEl = img;
      this.stillSrc = src;
    }
    this.bright += (this.stillBright - this.bright) * 0.25;
    this.motion += (0 - this.motion) * 0.15;
  }

  /** draws the source into the 32×18 probe; null when it cannot be read */
  private sample(el: HTMLVideoElement | HTMLImageElement): Uint8ClampedArray | null {
    if (!this.ctx) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = SAMPLE_W;
      this.canvas.height = SAMPLE_H;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      if (!this.ctx) return null;
    }
    try {
      this.ctx.drawImage(el, 0, 0, SAMPLE_W, SAMPLE_H);
      return this.ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
    } catch {
      return null;
    }
  }
}
