/*
 * BEAT GRID — the INPUT video's own soundtrack, analysed in the browser
 * (LabHandle.beatGrid, the CUES section of src/ai/contract.ts).
 *
 *   analyzeBeatGrid(src)   fetch the file → decodeAudioData at 22.05 kHz →
 *                          beatGridFromPcm. null: no soundtrack, a decode
 *                          error, silence, or aborted.
 *   beatGridFromPcm(...)   the analysis itself, on raw PCM (pure TS: runs in
 *                          node too, which is how it is unit-tested).
 *
 * The method, in order:
 *  1. Band energies per 10 ms hop — one pass over the samples through four
 *     biquads (low = 2× low-pass 150 Hz: kicks / 808s; mid = band-pass 700 Hz;
 *     high = high-pass 4 kHz: hats), channels mixed down on the fly. No
 *     per-sample allocation; the pass yields to the event loop every ~12 ms.
 *  2. Onset envelope = log-compressed energy flux per band, the low band
 *     weighted most, minus its local mean (±0.2 s), half-wave rectified.
 *  3. Tempo = the best comb of the envelope's autocorrelation (lags P, 2P,
 *     3P, 4P) over 70–180 BPM. An octave pair whose weaker reading still
 *     scores ≥ OCTAVE_AMBIGUOUS of the stronger is ambiguous: the reading in
 *     120–175 wins (trap / drill: 130–160 double time vs 65–80 half time).
 *  4. Fine tempo + beat phase = the candidate (±1.5 % of the coarse tempo,
 *     0.01 BPM steps) whose circular phase histogram of the envelope is the
 *     most peaked: over a whole song a wrong tempo smears the onsets.
 *  5. Downbeat = the beat class (k mod 4) with the most low-band energy in
 *     its first ~80 ms (a tie goes to the class the music starts on).
 *  6. Sections = bar-level loudness (dB) + low-band share, a novelty curve
 *     (left vs right window means) peak-picked into 2–8 bar-aligned stretches
 *     (one, when the song never really changes); energy = each stretch's RMS
 *     relative to the loudest one. Files above MAX_UPLOAD_BYTES are not read.
 */

import { MAX_UPLOAD_BYTES, type BeatGrid, type SongSection } from '../ai/contract';

/** decodeAudioData resamples to the context rate: 22.05 kHz keeps everything up to 11 kHz */
const DECODE_RATE = 22050;
const HOP_SEC = 0.01;
const BPM_MIN = 70;
const BPM_MAX = 180;
/** the preferred octave when two readings are ambiguous */
const PREF_LO = 120;
const PREF_HI = 175;
/** an octave partner scoring at least this share of the best reading makes the octave ambiguous */
const OCTAVE_AMBIGUOUS = 0.6;
const BEATS_PER_BAR = 4;
const MIN_SECONDS = 3;
const MAX_SECTIONS = 8;
const PHASE_BINS = 96;
/** onset frame → audible attack (measured on generated clips with known beat times, see the report) */
const ONSET_LAG_SEC = 0.003;
/** a beat estimated up to this much before 0 is taken as the beat at 0 */
const WRAP_SEC = 0.03;
/** below this novelty (≈ 0.7 dB, or a 6 % shift of the low-band share) a song is one section */
const MIN_NOVELTY = 0.12;
/** samples per slice of the band pass between two yields to the event loop */
const SLICE = 1 << 16;
const YIELD_MS = 12;

const round = (v: number, d: number) => { const k = 10 ** d; return Math.round(v * k) / k; };
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const aborted = (s?: AbortSignal) => !!s && s.aborted;
const tick = () => new Promise<void>((r) => { setTimeout(r, 0); });
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

type AudioCtxCtor = new (channels: number, length: number, rate: number) => OfflineAudioContext;

/**
 * The INPUT's soundtrack → its beat grid. `src` is the file (Blob) or an object
 * URL. Never throws: any failure (no audio track, an undecodable file, a silent
 * track, an abort) resolves null.
 */
export async function analyzeBeatGrid(src: Blob | string, signal?: AbortSignal): Promise<BeatGrid | null> {
  try {
    // the file itself (a Blob, or the object URL's): above MAX_UPLOAD_BYTES it is not read at all
    let file: Blob;
    if (typeof src === 'string') {
      const res = await fetch(src, { signal });
      if (!res.ok) return null;
      file = await res.blob();
    } else {
      file = src;
    }
    if (!file.size || file.size > MAX_UPLOAD_BYTES || aborted(signal)) return null;
    let bytes: ArrayBuffer | null = await file.arrayBuffer();
    if (aborted(signal) || !bytes || !bytes.byteLength) return null;
    const g = globalThis as unknown as { OfflineAudioContext?: AudioCtxCtor; webkitOfflineAudioContext?: AudioCtxCtor };
    const Ctx = g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx(1, 1, DECODE_RATE);
    let buf: AudioBuffer | null = await ctx.decodeAudioData(bytes); // detaches `bytes`
    bytes = null;
    if (aborted(signal) || !buf || !buf.length || !buf.numberOfChannels) return null;
    const channels: Float32Array[] = [];
    for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
    const rate = buf.sampleRate;
    buf = null;
    const grid = await beatGridFromPcm(channels, rate, signal);
    channels.length = 0; // the decoded PCM goes with the last reference
    return grid;
  } catch {
    return null;
  }
}

interface Bq { b0: number; b1: number; b2: number; a1: number; a2: number }
/** RBJ cookbook biquad, normalised (a0 = 1); bp = constant 0 dB peak gain */
function biquad(type: 'lp' | 'hp' | 'bp', f0: number, q: number, rate: number): Bq {
  const w = (2 * Math.PI * Math.min(f0, rate * 0.45)) / rate;
  const cw = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  let b0: number, b1: number, b2: number;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
  else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
  else { b0 = al; b1 = 0; b2 = -al; }
  const a0 = 1 + al;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cw) / a0, a2: (1 - al) / a0 };
}

interface Bands { all: Float32Array; low: Float32Array; mid: Float32Array; high: Float32Array; n: number; hop: number; fps: number }

/** step 1: per-hop energy of the full signal and of the three bands (one pass, no allocation per sample) */
async function bandEnergies(ch: Float32Array[], rate: number, signal?: AbortSignal): Promise<Bands | null> {
  const len = ch[0].length;
  const hop = Math.max(1, Math.round(rate * HOP_SEC));
  const n = Math.floor(len / hop);
  if (n < 8) return null;
  const all = new Float32Array(n), low = new Float32Array(n), mid = new Float32Array(n), high = new Float32Array(n);
  const L1 = biquad('lp', 150, 0.7071, rate), L2 = biquad('lp', 150, 0.7071, rate);
  const M = biquad('bp', 700, 0.8, rate), H = biquad('hp', 4000, 0.7071, rate);
  // filter state (transposed direct form II), kept across slices
  let l1a = 0, l1b = 0, l2a = 0, l2b = 0, ma = 0, mb = 0, ha = 0, hb = 0;
  let eA = 0, eL = 0, eM = 0, eH = 0, k = 0, f = 0;
  let dn = 1e-20; // alternating ±1e-20 keeps the filter states out of denormals in digital silence
  const nch = ch.length;
  const c0 = ch[0], c1 = nch > 1 ? ch[1] : ch[0];
  const inv = 1 / nch;
  const end = n * hop;
  let t0 = now();
  for (let s0 = 0; s0 < end; s0 += SLICE) {
    const s1 = Math.min(end, s0 + SLICE);
    for (let i = s0; i < s1; i++) {
      let x: number;
      if (nch === 1) x = c0[i];
      else if (nch === 2) x = (c0[i] + c1[i]) * 0.5;
      else { x = 0; for (let c = 0; c < nch; c++) x += ch[c][i]; x *= inv; }
      dn = -dn;
      x += dn;
      eA += x * x;
      let y = L1.b0 * x + l1a; l1a = L1.b1 * x - L1.a1 * y + l1b; l1b = L1.b2 * x - L1.a2 * y;
      const yl = L2.b0 * y + l2a; l2a = L2.b1 * y - L2.a1 * yl + l2b; l2b = L2.b2 * y - L2.a2 * yl;
      eL += yl * yl;
      y = M.b0 * x + ma; ma = M.b1 * x - M.a1 * y + mb; mb = M.b2 * x - M.a2 * y;
      eM += y * y;
      y = H.b0 * x + ha; ha = H.b1 * x - H.a1 * y + hb; hb = H.b2 * x - H.a2 * y;
      eH += y * y;
      if (++k === hop) {
        all[f] = eA; low[f] = eL; mid[f] = eM; high[f] = eH;
        f++; k = 0; eA = eL = eM = eH = 0;
      }
    }
    if (now() - t0 > YIELD_MS) {
      await tick();
      if (aborted(signal)) return null;
      t0 = now();
    }
  }
  return { all, low, mid, high, n, hop, fps: rate / hop };
}

/** log-compressed, mean-normalised energy flux of one band, added (weighted) into `out` */
function addFlux(e: Float32Array, n: number, w: number, out: Float32Array) {
  let mean = 0;
  for (let i = 0; i < n; i++) mean += e[i];
  mean = mean / n + 1e-12;
  const g = 100 / mean;
  let prev = 0; // the clip starts from silence: a sound already there at 0 is an onset
  for (let i = 0; i < n; i++) {
    const c = Math.log1p(g * e[i]);
    const d = c - prev;
    prev = c;
    if (d > 0) out[i] += w * d;
  }
}

/** linear interpolation into a lag array */
const lagAt = (r: Float64Array, x: number) => {
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= r.length) return 0;
  const fr = x - i;
  return r[i] * (1 - fr) + r[i + 1] * fr;
};

/**
 * The analysis on raw PCM: `channels` at `rate` Hz (any channel count, mixed
 * down). null when too short, silent or aborted.
 */
export async function beatGridFromPcm(channels: Float32Array[], rate: number, signal?: AbortSignal): Promise<BeatGrid | null> {
  if (!channels.length || !channels[0].length || !(rate > 0)) return null;
  const duration = channels[0].length / rate;
  if (duration < MIN_SECONDS) return null;
  const bands = await bandEnergies(channels, rate, signal);
  if (!bands || aborted(signal)) return null;
  const { all, low, mid, high, n, hop, fps } = bands;

  // silence (or near): no grid
  let tot = 0;
  for (let i = 0; i < n; i++) tot += all[i];
  const rms = Math.sqrt(tot / (n * hop));
  if (!(rms > 3e-4)) return null; // −70 dBFS

  /* ── 2. onset envelope ── */
  const raw = new Float32Array(n);
  addFlux(low, n, 1, raw);
  addFlux(mid, n, 0.5, raw);
  addFlux(high, n, 0.3, raw);
  const W = Math.max(2, Math.round(0.2 * fps));
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + raw[i];
  const onset = new Float32Array(n);
  let onsetMax = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - W), b = Math.min(n, i + W + 1);
    const v = raw[i] - (pre[b] - pre[a]) / (b - a);
    if (v > 0) { onset[i] = v; if (v > onsetMax) onsetMax = v; }
  }
  if (!(onsetMax > 0)) return null;
  // a smoothed copy (1-2-3-2-1) for the autocorrelation: wider peaks interpolate better
  const sm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 3 * onset[i];
    if (i > 0) s += 2 * onset[i - 1];
    if (i > 1) s += onset[i - 2];
    if (i + 1 < n) s += 2 * onset[i + 1];
    if (i + 2 < n) s += onset[i + 2];
    sm[i] = s / 9;
  }

  /* ── 3. tempo: comb over the autocorrelation ── */
  const maxLag = Math.min(n - 2, Math.ceil((4 * 60 * fps) / BPM_MIN) + 3);
  if (maxLag < Math.ceil((60 * fps) / BPM_MIN) + 2) return null;
  const acf = new Float64Array(maxLag + 2);
  for (let l = 1; l <= maxLag + 1 && l < n; l++) {
    let s = 0;
    for (let i = 0, m = n - l; i < m; i++) s += sm[i] * sm[i + l];
    acf[l] = s / (n - l);
  }
  if (aborted(signal)) return null;
  const score = (bpm: number) => {
    const P = (60 * fps) / bpm;
    return lagAt(acf, P) + lagAt(acf, 2 * P) + 0.5 * lagAt(acf, 3 * P) + 0.5 * lagAt(acf, 4 * P);
  };
  const STEP = 0.05;
  const curve: number[] = [];
  let best = BPM_MIN, bestS = -1;
  for (let b = BPM_MIN; b <= BPM_MAX + 1e-9; b += STEP) {
    const s = score(b);
    curve.push(s);
    if (s > bestS) { bestS = s; best = b; }
  }
  if (!(bestS > 0)) return null;
  const peakNear = (b: number) => {
    let pb = b, ps = -1;
    for (let x = b * 0.98; x <= b * 1.02; x += STEP) { const s = score(x); if (s > ps) { ps = s; pb = x; } }
    return { b: pb, s: ps };
  };
  // the octave: a partner inside 70–180 that still scores close is ambiguous → 120–175 wins
  const partner = best * 2 <= BPM_MAX ? best * 2 : best / 2 >= BPM_MIN ? best / 2 : 0;
  let coarse = best;
  if (partner) {
    const p = peakNear(partner);
    const inPref = (b: number) => b >= PREF_LO && b <= PREF_HI;
    if (p.s >= OCTAVE_AMBIGUOUS * bestS && inPref(p.b) && !inPref(best)) coarse = p.b;
  }
  const sorted = curve.slice().sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  const cAcf = clamp01((score(coarse) - median) / (score(coarse) + 1e-12));

  /* ── 4. fine tempo + phase: the most peaked circular phase histogram ── */
  const nzIdx: number[] = [];
  const nzVal: number[] = [];
  for (let i = 0; i < n; i++) if (onset[i] > 0) { nzIdx.push(i); nzVal.push(onset[i]); }
  const hist = new Float64Array(PHASE_BINS);
  const smoothMax = () => {
    let m = -1, at = 0;
    for (let j = 0; j < PHASE_BINS; j++) {
      const v = hist[(j + PHASE_BINS - 1) % PHASE_BINS] + 2 * hist[j] + hist[(j + 1) % PHASE_BINS];
      if (v > m) { m = v; at = j; }
    }
    return { m, at };
  };
  const span = Math.max(0.5, coarse * 0.015);
  const cands: { bpm: number; m: number }[] = [];
  let fineBest = -1;
  for (let b = coarse - span; b <= coarse + span + 1e-9; b += 0.01) {
    const inv = PHASE_BINS / ((60 * fps) / b);
    hist.fill(0);
    for (let j = 0; j < nzIdx.length; j++) hist[Math.floor((nzIdx[j] * inv) % PHASE_BINS)] += nzVal[j];
    const { m } = smoothMax();
    cands.push({ bpm: b, m });
    if (m > fineBest) fineBest = m;
  }
  // a short clip leaves a flat top: among the near-best readings keep the one closest to the comb's
  let bpm = coarse, gap = Infinity;
  for (const c of cands) {
    if (c.m >= fineBest * 0.996 && Math.abs(c.bpm - coarse) < gap) { gap = Math.abs(c.bpm - coarse); bpm = c.bpm; }
  }
  bpm = round(bpm, 2);
  const P = (60 * fps) / bpm;
  hist.fill(0);
  {
    const inv = PHASE_BINS / P;
    for (let j = 0; j < nzIdx.length; j++) hist[Math.floor((nzIdx[j] * inv) % PHASE_BINS)] += nzVal[j];
  }
  const { m: hMax, at } = smoothMax();
  let hSum = 0;
  for (let j = 0; j < PHASE_BINS; j++) hSum += hist[j];
  const cPhase = clamp01((hMax / 4 - hSum / PHASE_BINS) / (hMax / 4 + 1e-12));
  // parabolic refinement around the peak bin (on the smoothed histogram)
  const sh = (j: number) => {
    const jj = (j + PHASE_BINS) % PHASE_BINS;
    return hist[(jj + PHASE_BINS - 1) % PHASE_BINS] + 2 * hist[jj] + hist[(jj + 1) % PHASE_BINS];
  };
  const y0 = sh(at - 1), y1 = sh(at), y2 = sh(at + 1);
  const den = y0 - 2 * y1 + y2;
  const delta = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : 0;
  const period = 60 / bpm;
  let phaseSec = (((at + 0.5 + delta) / PHASE_BINS) * P) / fps + ONSET_LAG_SEC;
  phaseSec = ((phaseSec % period) + period) % period; // the earliest beat ≥ 0 …
  if (phaseSec > period - WRAP_SEC) phaseSec = 0; // … a beat a hair before 0 is the beat AT 0, not one a period later

  // the first beat of the music: the grid beat at the first strong onset (silence before it is not a beat)
  let firstOnset = 0;
  const thr = onsetMax * 0.3;
  for (let i = 0; i < n; i++) if (onset[i] >= thr) { firstOnset = i / fps; break; }
  const kFirst = Math.max(0, Math.ceil((firstOnset - phaseSec - period * 0.25) / period));
  const firstBeat = phaseSec + kFirst * period;

  /* ── 5. downbeat: the beat class with the strongest low-band energy (the first ~80 ms of each beat) ── */
  const cls = new Float64Array(BEATS_PER_BAR);
  const win = Math.max(2, Math.round(0.08 * fps));
  for (let k = 0; ; k++) {
    const t = phaseSec + k * period;
    if (t >= duration) break;
    const c = Math.round((t - ONSET_LAG_SEC) * fps);
    let e = 0;
    for (let i = Math.max(0, c - 1); i < Math.min(n, c + win); i++) e += low[i];
    cls[k % BEATS_PER_BAR] += e;
  }
  let c1 = kFirst % BEATS_PER_BAR, c1v = -1, c2v = -1;
  for (let j = 0; j < BEATS_PER_BAR; j++) {
    if (cls[j] > c1v) { c2v = c1v; c1v = cls[j]; c1 = j; } else if (cls[j] > c2v) c2v = cls[j];
  }
  const downClass = c1v > 1.1 * c2v ? c1 : kFirst % BEATS_PER_BAR; // a tie: the music starts on a downbeat
  let kDown = downClass;
  while (kDown < kFirst) kDown += BEATS_PER_BAR;
  const firstDownbeat = phaseSec + kDown * period;

  /* ── 6. sections ── */
  const sections = sectionsOf(all, low, n, hop, fps, duration, firstDownbeat, period * BEATS_PER_BAR);

  return {
    bpm,
    firstBeat: round(firstBeat, 3),
    beatsPerBar: BEATS_PER_BAR,
    firstDownbeat: round(firstDownbeat, 3),
    duration: round(duration, 3),
    sections,
    confidence: round(clamp01(0.5 * cAcf + 0.5 * cPhase), 2),
  };
}

/** step 6: bar features → novelty → 2–8 bar-aligned sections with their relative energy */
function sectionsOf(all: Float32Array, low: Float32Array, n: number, hop: number, fps: number, duration: number, firstDownbeat: number, barLen: number): SongSection[] {
  const whole = (): SongSection[] => [{ start: 0, end: round(duration, 3), energy: 1 }];
  if (!(barLen > 0)) return whole();
  // bar starts reaching back to 0 (a pickup bar before the first downbeat is partial)
  const starts: number[] = [];
  for (let t = firstDownbeat - Math.ceil(firstDownbeat / barLen - 1e-9) * barLen; t < duration - 1e-6; t += barLen) starts.push(Math.max(0, t));
  // less than half a bar at either end goes with its neighbour (a pickup, a fade-out tail)
  if (starts.length > 1 && starts[1] - starts[0] < barLen * 0.5) starts.splice(1, 1);
  if (starts.length > 1 && duration - starts[starts.length - 1] < barLen * 0.5) starts.pop();
  const M = starts.length;
  if (M < 8) return whole();
  const eSum = new Float64Array(M), lSum = new Float64Array(M), cnt = new Float64Array(M);
  for (let m = 0; m < M; m++) {
    const a = Math.floor(starts[m] * fps);
    const b = Math.min(n, Math.floor((m + 1 < M ? starts[m + 1] : duration) * fps));
    for (let i = a; i < b; i++) { eSum[m] += all[i]; lSum[m] += low[i]; }
    cnt[m] = Math.max(1, b - a);
  }
  const db = new Float64Array(M), share = new Float64Array(M);
  for (let m = 0; m < M; m++) {
    db[m] = 10 * Math.log10(eSum[m] / (cnt[m] * hop) + 1e-10);
    share[m] = lSum[m] / (eSum[m] + 1e-12);
  }
  const minBars = M >= 24 ? 4 : 2;
  const nov = new Float64Array(M);
  for (let i = 1; i < M; i++) {
    const w = Math.min(4, i, M - i);
    if (w < 2) continue;
    let dl = 0, dr = 0, sl = 0, sr = 0;
    for (let j = 0; j < w; j++) { dl += db[i - 1 - j]; dr += db[i + j]; sl += share[i - 1 - j]; sr += share[i + j]; }
    nov[i] = Math.abs(dl - dr) / w / 6 + (2 * Math.abs(sl - sr)) / w;
  }
  let novMax = 0;
  for (let i = 0; i < M; i++) if (nov[i] > novMax) novMax = nov[i];
  const thr = Math.max(0.25, novMax * 0.35);
  const peaks: number[] = [];
  for (let i = minBars; i <= M - minBars; i++) {
    if (nov[i] > 0 && nov[i] >= nov[i - 1] && (i + 1 >= M || nov[i] >= nov[i + 1])) peaks.push(i);
  }
  peaks.sort((a, b) => nov[b] - nov[a]);
  const cuts: number[] = [];
  for (const i of peaks) {
    if (cuts.length >= MAX_SECTIONS - 1) break;
    if (nov[i] < (cuts.length ? thr : MIN_NOVELTY)) break; // the first cut only needs a real change, the others a strong one
    if (cuts.every((c) => Math.abs(c - i) >= minBars)) cuts.push(i);
  }
  cuts.sort((a, b) => a - b);
  const edges = [0, ...cuts, M];
  const out: SongSection[] = [];
  let loud = 0;
  const rmsOf: number[] = [];
  for (let s = 0; s + 1 < edges.length; s++) {
    let e = 0, c = 0;
    for (let m = edges[s]; m < edges[s + 1]; m++) { e += eSum[m]; c += cnt[m]; }
    const r = Math.sqrt(e / (c * hop));
    rmsOf.push(r);
    if (r > loud) loud = r;
  }
  for (let s = 0; s + 1 < edges.length; s++) {
    out.push({
      start: round(s === 0 ? 0 : starts[edges[s]], 3),
      end: round(s + 2 === edges.length ? duration : starts[edges[s + 1]], 3),
      energy: round(loud > 0 ? rmsOf[s] / loud : 1, 2),
    });
  }
  return out;
}

/** The grid fitted to the video's own duration (the soundtrack can be a little shorter or longer). */
export function withDuration(grid: BeatGrid, duration: number): BeatGrid {
  if (!(duration > 0) || Math.abs(duration - grid.duration) < 1e-3) return grid;
  const sections = grid.sections.filter((s) => s.start < duration - 1e-3).map((s) => ({ ...s, end: Math.min(s.end, duration) }));
  if (sections.length) sections[sections.length - 1].end = round(duration, 3);
  else sections.push({ start: 0, end: round(duration, 3), energy: 1 });
  return { ...grid, duration: round(duration, 3), sections };
}
