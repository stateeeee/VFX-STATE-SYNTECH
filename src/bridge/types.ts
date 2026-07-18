export interface ParamSchema {
  key: string;
  label: string;
  type: 'number' | 'boolean';
  value: number | boolean;
  min?: number;
  max?: number;
  step?: number;
  aiHint?: string;
  reactive?: boolean;
  /** pre-wired ParamBus route installed when the node first joins the rack
   *  (ports use this to map the original effect's built-in audio response) */
  defaultRoute?: { source: 'bass' | 'treble' | 'loud' | 'beat' | 'motion' | 'bright'; amount: number };
}
export interface EffectTelemetry {
  [key: string]: any;
}
export interface ShellMessage {
  type: string;
  payload: any;
}
