import { ModuleId } from './types';

export const EFFECTS_REGISTRY: Record<ModuleId, { iframeSrc?: string }> = {
  blob_tracker: { iframeSrc: '/effects/blob_tracker' },
  analog: { iframeSrc: '/effects/analog' },
  blob_reveal: { iframeSrc: '/effects/blob_reveal' },
  bokeh: { iframeSrc: '/effects/bokeh' },
  anamorphic_lab: { iframeSrc: '/effects/anamorphic_lab' },
  // LAB v2 (2026-10-28): every entry is also a Lab node — the Lab runs this same page in an iframe
  // (labFrameSrc) and chains it through window.SynLab (public/effects/shared/syn-lab.js)
  invisible: { iframeSrc: '/effects/invisible' },
  time_machine: { iframeSrc: '/effects/time_machine' },
  quadtree: { iframeSrc: '/effects/quadtree' },
  pointcloud: { iframeSrc: '/effects/pointcloud' },
  painting: { iframeSrc: '/effects/painting' }
};

/** The page a Lab node loads: the standalone effect itself (its index.html, so relative assets resolve). */
export const labFrameSrc = (id: ModuleId): string => `${EFFECTS_REGISTRY[id]?.iframeSrc ?? `/effects/${id}`}/index.html`;

export const hasRealEffect = (id: ModuleId): boolean => {
  return !!EFFECTS_REGISTRY[id]?.iframeSrc;
};
