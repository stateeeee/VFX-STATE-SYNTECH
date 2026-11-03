/*
 * LAB PRESETS — a saved chain (localStorage, CLAUDE.md rule 7).
 *
 * v2 (LAB v2, 2026-10-28): the chain order + every node's own panel snapshot,
 * in the exact format the effect's SYNTECH-BRIDGE saves (SynLab.getSettings),
 * so a preset restores each effect as if the operator had set it by hand.
 *
 * v1 (the SynEngine Lab, before 2026-10-28) stored ParamBus bases / routes
 * that mean nothing to the real effects: such a preset still loads its chain
 * ORDER, and the Lab says its effect settings were not restored.
 */

import type { ModuleId } from '../types';
import { MODULE_IDS } from '../ai/contract';

export const PRESETS_KEY = 'syntech.chainPresets';

export interface ChainPresetV2 {
  v: 2;
  name: string;
  chain: ModuleId[];
  settings: Partial<Record<ModuleId, unknown>>;
  savedAt: number;
}

/** what an old (v1) entry may carry — only its order is still meaningful */
interface LegacyPreset {
  name: string;
  savedAt?: number;
  order?: string[];
  enabled?: string[];
}

export type StoredPreset = ChainPresetV2 | LegacyPreset;

const isModule = (id: unknown): id is ModuleId => typeof id === 'string' && (MODULE_IDS as readonly string[]).includes(id);

export const isV2 = (p: StoredPreset): p is ChainPresetV2 => (p as ChainPresetV2).v === 2;

/** the wired order a preset asks for (v1: its enabled effects in rack order) */
export function presetChain(p: StoredPreset): ModuleId[] {
  if (isV2(p)) return (Array.isArray(p.chain) ? p.chain : []).filter(isModule);
  const enabled = Array.isArray(p.enabled) ? p.enabled : [];
  const order = Array.isArray(p.order) ? p.order : enabled;
  return order.filter((id) => enabled.includes(id)).filter(isModule);
}

export function readPresets(): StoredPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((p) => p && typeof p.name === 'string') : [];
  } catch {
    return [];
  }
}

export function writePresets(list: StoredPreset[]): void {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(list)); } catch { /* private mode / quota */ }
}
