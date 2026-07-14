export interface FileTransport {
  name: string;
  loop: boolean;
  currentTime: number;
  playing: boolean;
  duration: number;
}
export class AudioEngine {
  levels = { bass: 0, loud: 0, treble: 0, beat: 0, bpm: null as number | null };
  transport: FileTransport = { name: '', loop: false, currentTime: 0, playing: false, duration: 100 };
  mode: string = 'mic';
  active: boolean = false;
  tick(now: number) { return this.levels; }
  stop() { this.active = false; }
  startMic() { this.mode = 'mic'; this.active = true; }
  async startFile(file: File) { this.active = true; this.transport.name = file.name; this.transport.playing = true; }
  togglePlay() { this.active = !this.active; this.transport.playing = this.active; }
  setLoop(l: boolean) { this.transport.loop = l; }
  seek(time: number) { this.transport.currentTime = time; }
}
