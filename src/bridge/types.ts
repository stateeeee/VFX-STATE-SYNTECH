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
}
export interface EffectTelemetry {
  [key: string]: any;
}
export interface ShellMessage {
  type: string;
  payload: any;
}
