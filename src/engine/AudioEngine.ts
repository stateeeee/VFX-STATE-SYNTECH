/* AudioEngine — the audio half of the reactivity backbone (Phase 3).
 *
 * Three exclusive inputs: microphone, a loaded audio file, or the CLIP —
 * the soundtrack of the Lab's own source video (in a music video the
 * music IS in the clip). An AnalyserNode feeds per-frame band levels:
 *   bass / loud / treble ∈ 0..1 (attack/release smoothed),
 *   beat — a decaying pulse fired on bass-energy onsets,
 *   bpm  — median inter-beat estimate (null until stable).
 * beatCount counts every onset since the engine was made, so a caller
 * sampling at a low rate can diff it instead of chasing the pulse.
 * The FileTransport mirrors the underlying <audio> element and is null
 * until a file is loaded — the ChainLab transport bar keys off that.
 *
 * Monitoring (analyser → speakers) is on for file and clip, OFF for the
 * mic: the mic routed to the speakers would feed back into itself. The
 * link used to be made once, on the first file, and never undone — so a
 * mic started after a track went to the speakers; setMonitor() fixes it.
 *
 * getOutputStream() taps the analyser into a MediaStreamDestination (made
 * once, on first ask) so a recorder can carry whatever is being analysed.
 */

export interface FileTransport {
  name: string;
  loop: boolean;
  currentTime: number;
  playing: boolean;
  duration: number;
}

export type AudioMode = 'off' | 'mic' | 'file' | 'clip';

const FFT_SIZE = 2048;
const BEAT_REFRACTORY_MS = 240; // max ~250 BPM
const BPM_MIN_INTERVALS = 4;

export class AudioEngine {
  levels = { bass: 0, loud: 0, treble: 0, beat: 0, bpm: null as number | null };
  transport: FileTransport | null = null;
  mode: AudioMode = 'off';
  active = false;
  /** onsets detected since construction — monotonic, diff it over a window */
  beatCount = 0;

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private freq: Uint8Array | null = null;
  private micStream: MediaStream | null = null;
  private micNode: MediaStreamAudioSourceNode | null = null;
  private fileEl: HTMLAudioElement | null = null;
  private fileNode: MediaElementAudioSourceNode | null = null;
  private fileUrl: string | null = null;
  // clip mode: an audio-only stream cut from video.captureStream()
  private clipStream: MediaStream | null = null;
  private clipNode: MediaStreamAudioSourceNode | null = null;
  private clipEnded: (() => void) | null = null;
  // the tapped element and the src it had — see the source-swap check in tick()
  private clipEl: HTMLVideoElement | null = null;
  private clipSrc = '';
  // analyser → speakers link state (see header) and the recorder tap
  private monitoring = false;
  private outDest: MediaStreamAudioDestinationNode | null = null;

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
    // clip: these tracks belong to OUR captureStream() call — stopping them
    // ends the tap only; the engine's <video> keeps playing untouched
    this.clipNode?.disconnect();
    if (this.clipStream) {
      const ended = this.clipEnded;
      this.clipStream.getTracks().forEach((t) => {
        if (ended) t.removeEventListener('ended', ended);
        t.stop();
      });
    }
    this.clipStream = null;
    this.clipNode = null;
    this.clipEnded = null;
    this.clipEl = null;
  }

  /** analyser → speakers on/off; idempotent (see header) */
  private setMonitor(on: boolean) {
    const ctx = this.ctx;
    const an = this.analyser;
    if (!ctx || !an || on === this.monitoring) return;
    if (on) an.connect(ctx.destination);
    else an.disconnect(ctx.destination);
    this.monitoring = on;
  }

  async startMic(): Promise<void> {
    const ctx = this.ensureCtx();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.disconnectSources();
    this.setMonitor(false); // never the mic to the speakers: feedback
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
    }
    this.setMonitor(true); // file mode is audible
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

  /**
   * Analyse the soundtrack of the Lab's source video. The element stays
   * muted (the engine keeps it so); captureStream() still carries its
   * audio in Chromium, and the analyser → speakers link makes it audible
   * exactly once — no double audio. Never createMediaElementSource: that
   * is a one-per-element lock, and the shell's AudioMeter owns the hero.
   * Throws a readable Error (and leaves the current input running) when
   * the browser cannot tap the element or the clip has no audio track.
   */
  async startClip(video: HTMLVideoElement): Promise<void> {
    const ctx = this.ensureCtx();
    const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
    if (typeof capture !== 'function') throw new Error('This browser cannot tap the clip audio');
    let ms: MediaStream;
    try {
      ms = capture.call(video);
    } catch {
      throw new Error('This browser cannot tap the clip audio');
    }
    // only the sound is wanted — drop the video track right away so the
    // browser does not keep copying frames into a stream nobody reads
    ms.getVideoTracks().forEach((t) => t.stop());
    const tracks = ms.getAudioTracks();
    if (!tracks.length) throw new Error('This clip has no audio track');
    this.disconnectSources();
    const stream = new MediaStream(tracks);
    this.clipStream = stream;
    this.clipNode = ctx.createMediaStreamSource(stream);
    this.clipNode.connect(this.analyser!);
    this.setMonitor(true); // the muted element is heard through the analyser
    // when the Lab swaps its source (a new clip / photo / webcam) the old
    // element is stripped of its src: fall back to off rather than analyse
    // silence. Chromium keeps the captured track 'live' through that, so
    // tick() watches the src; 'ended' covers browsers that do end it.
    const ended = () => { if (this.clipStream === stream) this.stop(); };
    tracks.forEach((t) => t.addEventListener('ended', ended));
    this.clipEnded = ended;
    this.clipEl = video;
    this.clipSrc = video.src;
    this.mode = 'clip';
    this.active = true;
    this.resetBeat();
  }

  /**
   * The analysed audio as a MediaStream — for recording an output clip
   * with its music (file / clip; the mic too). Null while off. The
   * destination is made once and stays tapped; it does not reach the
   * speakers. Callers that need their own lifetime should clone tracks.
   */
  getOutputStream(): MediaStream | null {
    if (!this.active || !this.ctx || !this.analyser) return null;
    if (!this.outDest) {
      this.outDest = this.ctx.createMediaStreamDestination();
      this.analyser.connect(this.outDest);
    }
    return this.outDest.stream;
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
    if (this.clipEl && this.clipEl.src !== this.clipSrc) {
      this.stop(); // the clip's element lost (or changed) its source
      return this.levels;
    }
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
      this.beatCount++;
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
