/*
 * SYNLAB — the shell's view of one Lab node's `window.SynLab` (LAB v2, 2026-10-28).
 *
 * Every Lab node is the standalone effect (public/effects/<id>/index.html) in a
 * same-origin iframe. The effect side (public/effects/shared/syn-lab.js + one
 * delimited SYNTECH-LAB block per effect) exposes this API synchronously on the
 * iframe's window; the shell never posts messages for the chain itself.
 * Types only + two tiny readers: nothing here holds state.
 */

import type { ModuleId } from '../types';

/** One user-tunable control of an effect's panel (see the contract §1). */
export interface SynLabParam {
  key: string;
  label: string;
  /** the panel section title it lives in */
  group: string;
  type: 'number' | 'boolean' | 'enum';
  min: number;
  max: number;
  step: number;
  value: number;
  options?: string[];
  /** declared by the effect's adapter: never the AI's to change */
  locked?: boolean;
}

/** budget: the frame budget the shell last set (null = native, 0 = paused, >0 = fps cap) */
export interface SynLabState { hasSource: boolean; external: boolean; fps: number; budget?: number | null }

export interface SynLabApi {
  version: number;
  id: string;
  ready: boolean;
  setVideoStream(stream: MediaStream | null): void;
  setAudioStream(stream: MediaStream | null): void;
  outputCanvas(): HTMLCanvasElement | null;
  captureStream(): MediaStream | null;
  params(): SynLabParam[];
  setParam(key: string, value: number): boolean;
  getSettings(): unknown;
  applySettings(s: unknown): void;
  state(): SynLabState;
  /** frame budget (2026-11-05): 0 = paused, >0 = rAF capped at that rate, null = native.
   *  Optional: a stale cached effect page may not have it. */
  setFrameBudget?(fps: number | null): void;
  /** layout (2026-11-19, LAB v3): 'panel' = the effect shows only its panel (full width, natural
   *  height, its own Source section hidden); its canvas area leaves the viewport but keeps
   *  `width × height` CSS px and keeps rendering. 'standalone' = as opened alone. Optional: a stale
   *  cached effect page may not have it. */
  setLayout?(mode: 'panel' | 'standalone', size?: { width: number; height: number }): { mode: string; width: number; height: number };
  layout?(): { mode: string; width: number; height: number };
  /** the panel's height in px in panel mode (0 otherwise) */
  panelHeight?(): number;
}

/** The node's SynLab, once its adapter registered (null while loading, or for an
 *  effect with no Lab link). Never throws: a navigated / torn-down frame reads null. */
export function synLabOf(iframe: HTMLIFrameElement | null | undefined): SynLabApi | null {
  try {
    const api = (iframe?.contentWindow as (Window & { SynLab?: SynLabApi }) | null)?.SynLab;
    return api && api.ready && typeof api.setVideoStream === 'function' ? api : null;
  } catch {
    return null;
  }
}

/** the page a Lab node loads: the standalone effect, in panel-only layout from its first paint
 *  (?synlayout=panel, read by syn-lab.js) */
export const labPanelSrc = (src: string): string => `${src}${src.includes('?') ? '&' : '?'}synlayout=panel`;

/** localStorage key of an effect's saved panel settings (same as EffectHost, 03-SPEC §4). */
export const effectSettingsKey = (id: ModuleId) => `syntech.effectSettings.${id}`;

export function readEffectSettings(id: ModuleId): unknown {
  try {
    const raw = localStorage.getItem(effectSettingsKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // corrupt snapshot or private mode — the effect keeps its defaults
  }
}

/* ── SynFx (2026-11-23, docs/workflow/11-EXPORT-STILLS-LAB.md §2.2) ──────────────────
   The offline, frame-by-frame face of an effect: the same shader / parameters as the live view, but drawn
   for a frame the shell hands in. Used by the Lab's offline MP4 render and its PNG / JPEG / PDF export. */

/** the region of a returned canvas to export (default: the whole canvas) */
export interface SynFxRegion {
  canvas: HTMLCanvasElement;
  sx?: number;
  sy?: number;
  sw?: number;
  sh?: number;
  alphaRect?: { x: number; y: number; w: number; h: number };
}

export interface SynFxApi {
  version: number;
  /** the output size for a w × h input (anamorphic: desqueeze) */
  outSize(w: number, h: number): { w: number; h: number };
  /** stops the live drawing; canvas + render targets at the native size; 'lab' = temporal state reset */
  begin(opts: { mode: 'still' | 'lab'; width: number; height: number; fps?: number; audioFile?: Blob | null }): void | Promise<void>;
  /** draws `src` (width × height) with the effect's look; i = frame index, t = seconds */
  frame(src: HTMLCanvasElement | HTMLImageElement, i: number, t: number): Promise<SynFxRegion> | SynFxRegion;
  /** ALWAYS: restores the live view */
  end(): void | Promise<void>;
}

/** the node's SynFx (null while loading, for a stale cached page without it, or a torn-down frame). Never throws. */
export function synFxOf(iframe: HTMLIFrameElement | null | undefined): SynFxApi | null {
  try {
    const api = (iframe?.contentWindow as (Window & { SynFx?: SynFxApi }) | null)?.SynFx;
    return api && typeof api.begin === 'function' && typeof api.frame === 'function' && typeof api.end === 'function' && typeof api.outSize === 'function' ? api : null;
  } catch {
    return null;
  }
}
