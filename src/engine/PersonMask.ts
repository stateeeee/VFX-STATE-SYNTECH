export type PersonMaskState = 'off' | 'ready' | 'loading';
export class PersonMask {
  state: PersonMaskState = 'off';
  ready: boolean = false;
  maskCanvas: HTMLCanvasElement | null = null;
  dispose() {}
  enable() { this.state = 'ready'; this.ready = true; this.maskCanvas = document.createElement('canvas'); }
  tick(source: any, now: number) {}
}
