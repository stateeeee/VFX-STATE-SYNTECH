export type ModuleId = 'blob_tracker' | 'analog' | 'blob_reveal' | 'bokeh' | 'anamorphic_lab';
export type ActiveTab = string;
export type SignalSource = string;

export interface ModuleConfig {
  id: ModuleId;
  name: string;
  description: string;
  status: string;
  parameters: Record<string, { label: string, value: number, min: number, max: number, step: number, hint?: string }>;
}
