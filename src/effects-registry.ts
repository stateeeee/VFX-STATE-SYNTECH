import { ModuleId } from './types';

export const EFFECTS_REGISTRY: Record<ModuleId, { iframeSrc?: string }> = {
  blob_tracker: { iframeSrc: '/effects/blob_tracker' },
  analog: { iframeSrc: '/effects/analog' },
  blob_reveal: { iframeSrc: '/effects/blob_reveal' },
  bokeh: { iframeSrc: '/effects/bokeh' },
  anamorphic_lab: { iframeSrc: '/effects/anamorphic_lab' },
  // standalone-only for now (no SynEngine / Lab port yet): they open full-screen from the effect cards
  invisible: { iframeSrc: '/effects/invisible' },
  time_machine: { iframeSrc: '/effects/time_machine' },
  quadtree: { iframeSrc: '/effects/quadtree' },
  pointcloud: { iframeSrc: '/effects/pointcloud' }
};

export const hasRealEffect = (id: ModuleId): boolean => {
  return !!EFFECTS_REGISTRY[id]?.iframeSrc;
};
