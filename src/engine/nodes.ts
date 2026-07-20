import { EngineNode, NodeRenderContext } from './SynEngine';
import { ParamSchema } from '../bridge/types';
import { AnalogNode } from './nodes/analog';
import { BokehNode } from './nodes/bokeh';
import { AnamorphicLabNode } from './nodes/anamorphic_lab';
import { BlobRevealNode } from './nodes/blob_reveal';
import { BlobTrackerNode } from './nodes/blob_tracker'; // Phase 8: 1:1 port (complete)

/* Pre-port stand-ins: rendering is passthrough until Phases 4–8
 * replace each factory with the real 1:1 EngineNode. Since Phase 3 they DO
 * hold real parameter state, so the ParamBus / AI / preset plumbing runs
 * against the exact interfaces the ports will use. The placeholder schemas
 * below are NOT the effects' real params — each port phase swaps in the
 * full table extracted from the effect HTML. */

class DummyNode implements EngineNode {
  enabled = true;
  params: ParamSchema[];
  private values: Record<string, number> = {};

  constructor(public id: string, public name: string, params: ParamSchema[]) {
    this.params = params;
    params.forEach((p) => { this.values[p.key] = Number(p.value); });
  }

  setParam(key: string, value: unknown): void {
    const v = Number(value);
    if (!isNaN(v)) this.values[key] = v;
  }

  getParam(key: string): unknown {
    return this.values[key] ?? 0;
  }

  init(gl: WebGL2RenderingContext): void {}
  resize(width: number, height: number): void {}
  render(ctx: NodeRenderContext): WebGLTexture { return ctx.inputTex; }
  dispose() {}
}

const placeholder = (segCapable: boolean): ParamSchema[] => [
  {
    key: 'intensity', label: 'Intensity', type: 'number', value: 0.5,
    min: 0, max: 1, step: 0.01, reactive: true,
    aiHint: 'Placeholder overall strength of the effect (real params arrive with the 1:1 port)',
  },
  {
    key: 'mix', label: 'Mix', type: 'number', value: 1,
    min: 0, max: 1, step: 0.01, reactive: true,
    aiHint: 'Placeholder dry/wet blend with the incoming frame',
  },
  ...(segCapable
    ? [{
        key: 'segEnabled', label: 'Person Mask', type: 'boolean' as const, value: 0,
        aiHint: '(on/off switch) Restrict the effect to the segmented person',
      }]
    : []),
];

export const NODE_FACTORY: Record<string, () => EngineNode> = {
  blob_tracker: () => new BlobTrackerNode(), // Phase 8: real 1:1 port
  analog: () => new AnalogNode(), // Phase 4: real 1:1 port

  blob_reveal: () => new BlobRevealNode(), // Phase 7: real 1:1 port
  bokeh: () => new BokehNode(), // Phase 5: real 1:1 port
  anamorphic_lab: () => new AnamorphicLabNode() // Phase 6: real 1:1 port
};
