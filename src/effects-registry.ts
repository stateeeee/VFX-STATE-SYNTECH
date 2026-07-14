import { ModuleId } from './types';

export const EFFECTS_REGISTRY: Record<ModuleId, { iframeSrc?: string }> = {
  blob_tracker: { iframeSrc: '/effects/blob_tracker' },
  analog: { iframeSrc: '/effects/analog' },
  blob_reveal: { iframeSrc: '/effects/blob_reveal' },
  bokeh: { iframeSrc: '/effects/bokeh' },
  anamorphic_lab: { iframeSrc: '/effects/anamorphic_lab' }
};

export const hasRealEffect = (id: ModuleId): boolean => {
  return !!EFFECTS_REGISTRY[id]?.iframeSrc;
};
