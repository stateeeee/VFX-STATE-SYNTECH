/* ParamBus — manual/auto control matrix (Phase 3, PLAN §4.4).
 *
 * Bases live here (the sliders edit them); a routed signal is layered on
 * top at the start of every frame:
 *     final = clamp(base + signal × amount × paramRange)
 * and pushed into the node with setParam, so node.getParam always reads
 * the live (possibly modulated) value. serialize/restore round-trip the
 * whole state for chain presets.
 */

import { EngineNode } from './SynEngine';

export type ModSource = 'bass' | 'treble' | 'loud' | 'beat' | 'motion' | 'bright';
export const MOD_SOURCES: ModSource[] = ['bass', 'treble', 'loud', 'beat', 'motion', 'bright'];

export interface ModSettings {
  source: ModSource;
  amount: number; // -1..1
}

export interface ParamBusState {
  [key: string]: { base: number; mod: ModSettings | null };
}

export type Signals = Record<ModSource, number>;

export class ParamBus {
  state: ParamBusState = {};

  /** Seed bases from the nodes' current numeric params (existing entries win). */
  snapshot(chain: EngineNode[]): void {
    chain.forEach((node) => {
      node.params.forEach((p) => {
        if (p.type !== 'number') return;
        const key = `${node.id}.${p.key}`;
        if (!this.state[key]) {
          const cur = Number(node.getParam(p.key));
          this.state[key] = { base: isNaN(cur) ? Number(p.value) || 0 : cur, mod: null };
        }
      });
    });
  }

  /** Per frame: push base + routed signal into every numeric param. */
  apply(chain: EngineNode[], signals: Signals): void {
    chain.forEach((node) => {
      node.params.forEach((p) => {
        if (p.type !== 'number') return;
        const st = this.state[`${node.id}.${p.key}`];
        if (!st) return;
        let v = st.base;
        if (st.mod) {
          const s = Number(signals[st.mod.source] ?? 0);
          const range = (p.max ?? 1) - (p.min ?? 0);
          v += s * st.mod.amount * range;
        }
        const lo = p.min ?? -Infinity;
        const hi = p.max ?? Infinity;
        node.setParam(p.key, Math.max(lo, Math.min(hi, v)));
      });
    });
  }

  serialize(): ParamBusState {
    return JSON.parse(JSON.stringify(this.state));
  }

  restore(data: ParamBusState, chain: EngineNode[]): void {
    this.state = data ? JSON.parse(JSON.stringify(data)) : {};
    this.snapshot(chain); // fill anything the preset didn't cover
  }

  getBase(node: EngineNode, key: string): number {
    return this.state[`${node.id}.${key}`]?.base ?? 0;
  }

  setBase(node: EngineNode, key: string, value: number): void {
    const k = `${node.id}.${key}`;
    if (!this.state[k]) this.state[k] = { base: value, mod: null };
    else this.state[k].base = value;
  }

  getMod(node: EngineNode, key: string): ModSettings | null {
    return this.state[`${node.id}.${key}`]?.mod || null;
  }

  setMod(node: EngineNode, key: string, mod: ModSettings | null): void {
    const k = `${node.id}.${key}`;
    if (!this.state[k]) this.state[k] = { base: 0, mod };
    else this.state[k].mod = mod;
  }
}
