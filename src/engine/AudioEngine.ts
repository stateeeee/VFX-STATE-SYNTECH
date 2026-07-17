/* AudioEngine — the audio half of the reactivity backbone (Phase 3).
 *
 * Two exclusive inputs: microphone or a loaded audio file (audible through
 * the speakers). An AnalyserNode feeds per-frame band levels:
 *   bass / loud / treble ∈ 0..1 (attack/release smoothed),
 *   beat — a decaying pulse fired on bass-energy onsets,
 *   bpm  — median inter-beat estimate (null until stable).
 * The FileTransport mirrors the underlying <audio> element and is null
 * until a file is loaded — the ChainLab transport bar keys off that.
 */

export interface FileTransport {
  name: string;
  loop: boolean;
  currentTime: number;
  playing: boolean;
  duration: number;
}

export type AudioMode = 'off' | 'mic' | 'file';

const FFT_SIZE = 2048;
const BEAT_REFRACTORY_MS = 240; // max ~250 BPM
const BPM_MIN_INTERVALS = 4;

export class AudioEngine {
  levels = { bass: 0, loud: 0, treble: 0, beat: 0, bpm: null as number | null };
  transport: FileTransport | null = null;
  mode: AudioMode = 'off';
  active = false;

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private freq: Uint8Array | null = null;
  private micStream: MediaStream | null = null;
  private micNode: MediaStreamAudioSourceNode | null = null;
  private fileEl: HTMLAudioElement | null = null;
  private fileNode: MediaElementAudioSourceNode | null = null;
  private fileUrl: string | null = null;

  // beat / bpm tracking
  private bassAvg = 0;
  private lastBeatAt = 0;
  private beatGaps: number[] = [];

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = FFT_SIZE;
      this.analyser.smoothingTimeConstant = 0.5;
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private disconnectSources() {
    this.micNode?.disconnect();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.micNode = null;
    if (this.fileEl) this.fileEl.pause();
    this.fileNode?.disconnect();
    this.transport = null;
  }

  async startMic(): Promise<void> {
    const ctx = this.ensureCtx();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.disconnectSources();
    this.micStream = stream;
    this.micNode = ctx.createMediaStreamSource(stream);
    this.micNode.connect(this.analyser!);
    this.mode = 'mic';
    this.active = true;
    this.resetBeat();
  }

  async startFile(file: File): Promise<void> {
    const ctx = this.ensureCtx();
    this.disconnectSources();
    if (!this.fileEl) {
      // a MediaElementAudioSourceNode can be created once per element — reuse both
      this.fileEl = new Audio();
      this.fileEl.crossOrigin = 'anonymous';
      this.fileNode = ctx.createMediaElementSource(this.fileEl);
      this.analyser!.connect(ctx.destination); // file mode is audible
    }
    this.fileNode!.connect(this.analyser!);
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = URL.createObjectURL(file);
    this.fileEl.src = this.fileUrl;
    this.fileEl.loop = true;
    await this.fileEl.play();
    this.transport = {
      name: file.name,
      loop: true,
      currentTime: 0,
      playing: true,
      duration: 0,
    };
    this.mode = 'file';
    this.active = true;
    this.resetBeat();
  }

  togglePlay(): void {
    const el = this.fileEl;
    if (!el || !this.transport) return;
    if (el.paused) void el.play();
    else el.pause();
  }

  setLoop(loop: boolean): void {
    if (this.fileEl) this.fileEl.loop = loop;
    if (this.transport) this.transport.loop = loop;
  }

  seek(time: number): void {
    if (this.fileEl) this.fileEl.currentTime = time;
  }

  stop(): void {
    this.disconnectSources();
    this.mode = 'off';
    this.active = false;
    this.levels.bass = this.levels.loud = this.levels.treble = this.levels.beat = 0;
    this.resetBeat();
  }

  private resetBeat() {
    this.bassAvg = 0;
    this.lastBeatAt = 0;
    this.beatGaps = [];
    this.levels.bpm = null;
  }

  /** Called once per engine frame; returns the smoothed levels. */
  tick(now: number): typeof this.levels {
    const an = this.analyser;
    if (!an || !this.active || !this.freq) return this.levels;
    if (this.transport && this.fileEl) {
      this.transport.currentTime = this.fileEl.currentTime;
      this.transport.duration = isFinite(this.fileEl.duration) ? this.fileEl.duration : 0;
      this.transport.playing = !this.fileEl.paused;
      this.transport.loop = this.fileEl.loop;
    }
    an.getByteFrequencyData(this.freq as Uint8Array<ArrayBuffer>);
    const sr = this.ctx!.sampleRate;
    const hzPerBin = sr / FFT_SIZE;
    const avg = (loHz: number, hiHz: number) => {
      const lo = Math.max(0, Math.floor(loHz / hzPerBin));
      const hi = Math.min(this.freq!.length - 1, Math.ceil(hiHz / hzPerBin));
      let sum = 0;
      for (let i = lo; i <= hi; i++) sum += this.freq![i];
      return sum / ((hi - lo + 1) * 255);
    };
    const bassRaw = Math.min(1, avg(20, 250) * 1.25);
    const loudRaw = Math.min(1, avg(20, 12000) * 1.6);
    const trebRaw = Math.min(1, avg(4000, 12000) * 2.2);
    const smooth = (cur: number, target: number) =>
      cur + (target - cur) * (target > cur ? 0.4 : 0.12);
    this.levels.bass = smooth(this.levels.bass, bassRaw);
    this.levels.loud = smooth(this.levels.loud, loudRaw);
    this.levels.treble = smooth(this.levels.treble, trebRaw);

    // beat: bass onset against its own running average
    this.bassAvg += (bassRaw - this.bassAvg) * 0.04;
    const flux = bassRaw - this.bassAvg;
    if (flux > 0.1 && bassRaw > 0.15 && now - this.lastBeatAt > BEAT_REFRACTORY_MS) {
      if (this.lastBeatAt > 0) {
        const gap = now - this.lastBeatAt;
        if (gap >= 240 && gap <= 2000) {
          this.beatGaps.push(gap);
          if (this.beatGaps.length > 16) this.beatGaps.shift();
        }
      }
      this.lastBeatAt = now;
      this.levels.beat = 1;
    } else {
      this.levels.beat *= 0.88;
      if (this.levels.beat < 0.02) this.levels.beat = 0;
    }
    if (this.beatGaps.length >= BPM_MIN_INTERVALS) {
      const sorted = [...this.beatGaps].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      let bpm = 60000 / median;
      while (bpm < 60) bpm *= 2;
      while (bpm > 200) bpm /= 2;
      this.levels.bpm = Math.round(bpm);
    }
    return this.levels;
  }
}
