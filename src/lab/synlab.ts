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

export interface SynLabState { hasSource: boolean; external: boolean; fps: number }

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
