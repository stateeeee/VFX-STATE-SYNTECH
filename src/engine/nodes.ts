import { EngineNode, NodeRenderContext } from './SynEngine';
import { ParamSchema } from '../bridge/types';

class DummyNode implements EngineNode {
  enabled = true;
  params: ParamSchema[] = [];
  constructor(public id: string, public name: string) {}
  setParam(key: string, value: unknown): void {}
  getParam(key: string): unknown { return 0; }
  init(gl: WebGL2RenderingContext): void {}
  resize(width: number, height: number): void {}
  render(ctx: NodeRenderContext): WebGLTexture { return ctx.inputTex; }
  dispose() {}
}

export const NODE_FACTORY: Record<string, () => EngineNode> = {
  blob_tracker: () => new DummyNode('blob_tracker', 'Blob Tracker'),
  analog: () => new DummyNode('analog', 'Analog'),
  blob_reveal: () => new DummyNode('blob_reveal', 'Blob Reveal'),
  bokeh: () => new DummyNode('bokeh', 'Bokeh'),
  anamorphic_lab: () => new DummyNode('anamorphic_lab', 'Anamorphic Lab')
};
