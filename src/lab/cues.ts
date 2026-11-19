/*
 * CUES — the pure half of the Lab's beat-synced cue timeline (the CUES
 * section of src/ai/contract.ts). No DOM, no state: ChainLab's engine and
 * lane call these, and they run in node for the unit checks.
 *
 * The rule the whole timeline follows: the state at time t is the baseline
 * (each cued control's value before the timeline was installed) overlaid with
 * every cue whose `at` <= t, in order.
 */

import type { BeatGrid, Cue, SongSection } from '../ai/contract';

/** a cue at `at` is active from `at - CUE_EPS` on (float times read back from a <video>) */
export const CUE_EPS = 1e-3;
/** at most this many bar lines on the track (a long song shows every 2nd / 4th … bar) */
export const MAX_BAR_LINES = 64;
/** a stretch whose song energy is at least this (relative to the loudest) is drawn hot (amber) */
export const HOT_ENERGY = 0.8;

/** Index of the cue active at `t` (the last one with at <= t), -1 before the first. Binary search. */
export function activeCueIndex(t: number, cues: readonly Cue[]): number {
  let lo = 0, hi = cues.length - 1, ans = -1;
  const x = t + CUE_EPS;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].at <= x) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** The value of every cued key at the cue index `index` (-1 = the baseline alone). */
export function stateAtIndex(index: number, baseline: ReadonlyMap<string, number>, cues: readonly Cue[]): Map<string, number> {
  const out = new Map(baseline);
  for (let i = 0; i <= index && i < cues.length; i++) for (const p of cues[i].params) out.set(p.key, p.value);
  return out;
}

/** The value of every cued key at time `t`: the baseline overlaid with every cue at <= t, in order. */
export function stateAt(t: number, baseline: ReadonlyMap<string, number>, cues: readonly Cue[]): Map<string, number> {
  return stateAtIndex(activeCueIndex(t, cues), baseline, cues);
}

export const beatPeriod = (grid: BeatGrid) => 60 / grid.bpm;

/** The beat nearest to `t` on the grid (constant tempo), kept inside [0, duration]. */
export function snapToBeat(t: number, grid: BeatGrid | null | undefined): number {
  if (!grid || !(grid.bpm > 0) || !Number.isFinite(t)) return t;
  const p = beatPeriod(grid);
  let s = grid.firstBeat + Math.round((t - grid.firstBeat) / p) * p;
  if (s < 0) s += p * Math.ceil(-s / p - 1e-9);
  if (grid.duration > 0 && s > grid.duration) s -= p * Math.ceil((s - grid.duration) / p - 1e-9);
  return Math.max(0, Math.round(s * 1000) / 1000);
}

/** Bar-line times in [0, duration] (every beatsPerBar beats from firstDownbeat, reaching back to 0),
 *  thinned to every 2nd / 4th … bar so that at most `max` lines are drawn. */
export function barLines(grid: BeatGrid | null | undefined, duration: number, max = MAX_BAR_LINES): number[] {
  if (!grid || !(grid.bpm > 0) || !(duration > 0)) return [];
  const bar = beatPeriod(grid) * Math.max(1, Math.round(grid.beatsPerBar) || 4);
  const first = grid.firstDownbeat - Math.floor(grid.firstDownbeat / bar + 1e-9) * bar; // the earliest bar line >= 0
  const count = Math.floor((duration - first) / bar) + 1;
  if (!(count > 0)) return [];
  let every = 1;
  while (count / every > max) every *= 2;
  const out: number[] = [];
  for (let i = 0; i < count; i += every) {
    const t = first + i * bar;
    if (t > 1e-6 && t < duration - 1e-6) out.push(t);
  }
  return out;
}

/** The song's mean energy over [a, b] (sections weighted by overlap), null without sections. */
export function energyOver(sections: readonly SongSection[] | null | undefined, a: number, b: number): number | null {
  if (!sections || !sections.length || !(b > a)) return null;
  let w = 0, e = 0;
  for (const s of sections) {
    const o = Math.min(b, s.end) - Math.max(a, s.start);
    if (o > 0) { w += o; e += o * s.energy; }
  }
  return w > 0 ? e / w : null;
}

/** One block of the lane: the stretch from a cue to the next cue with another label. */
export interface CueSegment {
  label: string;
  start: number;
  end: number;
  /** index of its first and last cue */
  first: number;
  last: number;
  /** the song's energy over the stretch (0..1), null when unknown */
  energy: number | null;
  /** a high-energy stretch: drawn amber */
  hot: boolean;
}

/** labels that read as a high-energy moment when the song's energy says nothing (no grid, or no contrast) */
const HOT_LABEL = /\b(drop|climax|peak)\b/i;
/** a song whose quietest section is at least this loud (relative) has no energy contrast to draw */
const CONTRAST_BELOW = 0.6;

/** The lane's blocks: consecutive cues with the same label merged, each running to the next block
 *  (the last one to `duration`). Hot = song energy >= HOT_ENERGY when the song has quiet and loud
 *  stretches; otherwise (no grid, or one even loudness throughout) a DROP-like label. */
export function buildSegments(cues: readonly Cue[], duration: number, grid?: BeatGrid | null): CueSegment[] {
  const out: CueSegment[] = [];
  const norm = (s: string) => s.trim().toUpperCase();
  cues.forEach((c, i) => {
    const prev = out[out.length - 1];
    if (prev && norm(prev.label) === norm(c.label)) { prev.last = i; return; }
    if (prev) prev.end = c.at;
    out.push({ label: c.label, start: c.at, end: duration, first: i, last: i, energy: null, hot: false });
  });
  const secs = grid?.sections ?? [];
  const contrast = secs.length > 1 && Math.min(...secs.map((x) => x.energy)) < CONTRAST_BELOW;
  for (const s of out) {
    if (!(s.end > s.start)) s.end = s.start;
    s.energy = contrast ? energyOver(secs, s.start, s.end) : null;
    s.hot = s.energy != null ? s.energy >= HOT_ENERGY : HOT_LABEL.test(s.label);
  }
  return out;
}

/** m:ss (whole seconds, floored): 32.4 → "0:32", 75 → "1:15" */
export function fmtCueTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const s = Math.floor(t + 1e-6);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A BeatGrid from outside (the panel / the server) made safe to draw, or null when it is not one. */
export function sanitizeGrid(g: unknown): BeatGrid | null {
  if (!g || typeof g !== 'object') return null;
  const o = g as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const bpm = num(o.bpm, NaN);
  if (!(bpm >= 30 && bpm <= 300)) return null;
  const duration = Math.max(0, num(o.duration, 0));
  const firstBeat = num(o.firstBeat, 0);
  const sections: SongSection[] = Array.isArray(o.sections)
    ? (o.sections as unknown[]).flatMap((s) => {
        const r = s as Record<string, unknown> | null;
        if (!r) return [];
        const start = num(r.start, NaN), end = num(r.end, NaN);
        if (!(end > start)) return [];
        return [{ start, end, energy: Math.min(1, Math.max(0, num(r.energy, 0))) }];
      })
    : [];
  return {
    bpm,
    firstBeat,
    beatsPerBar: Math.min(12, Math.max(1, Math.round(num(o.beatsPerBar, 4)))),
    firstDownbeat: num(o.firstDownbeat, firstBeat),
    duration,
    sections,
    confidence: Math.min(1, Math.max(0, num(o.confidence, 0))),
  };
}
