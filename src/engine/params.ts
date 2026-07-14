export type ModSource = 'bass' | 'treble' | 'loud' | 'beat' | 'motion' | 'bright';
export const MOD_SOURCES: ModSource[] = ['bass', 'treble', 'loud', 'beat', 'motion', 'bright'];

export interface ModSettings {
  source: ModSource;
  amount: number;
}

export interface ParamBusState {
  [key: string]: { base: number, mod: ModSettings | null };
}
export class ParamBus {
  state: ParamBusState = {};
  snapshot(chain: any[]) {}
  apply(chain: any[], signals: any) {}
  serialize(): ParamBusState { return this.state; }
  restore(data: ParamBusState, chain: any[]) { this.state = data || {}; }
  getBase(node: any, key: string) { return this.state[`${node.id}.${key}`]?.base || 0; }
  setBase(node: any, key: string, value: number) { 
    if (!this.state[`${node.id}.${key}`]) this.state[`${node.id}.${key}`] = { base: value, mod: null };
    else this.state[`${node.id}.${key}`].base = value; 
  }
  getMod(node: any, key: string): ModSettings | null { return this.state[`${node.id}.${key}`]?.mod || null; }
  setMod(node: any, key: string, mod: ModSettings | null) {
    if (!this.state[`${node.id}.${key}`]) this.state[`${node.id}.${key}`] = { base: 0, mod };
    else this.state[`${node.id}.${key}`].mod = mod;
  }
}
