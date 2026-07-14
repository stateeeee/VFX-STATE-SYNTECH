import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowDown, ArrowUp, Camera, Diamond, Film, Link2, Mic, Music, Pause, Play as PlayIcon, Power, Repeat, Save, Sparkle, Trash2 } from 'lucide-react';
import { SynEngine, EngineNode } from '../engine/SynEngine';
import { NODE_FACTORY } from '../engine/nodes';
import { AudioEngine, FileTransport } from '../engine/AudioEngine';
import { VideoAnalyzer } from '../engine/VideoAnalyzer';
import { PersonMask, PersonMaskState } from '../engine/PersonMask';
import { ParamBus, MOD_SOURCES, ModSource, ParamBusState } from '../engine/params';
import { ModuleId } from '../types';

interface ChainLabProps {
  isDayMode: boolean;
  onBack: () => void;
  /**
   * Effects to start enabled, in chain order — set when the chain was
   * created by linking nodes on the brain graph. The remaining effects
   * are still added to the rack, just bypassed.
   */
  initialChain?: ModuleId[];
  /** name of a saved chain preset to load on mount (Projects nav) */
  initialPreset?: string;
  /**
   * Source video shared with the dashboard's Nodal Composition. When set,
   * the lab loads this exact source; picking a new video here lifts it back
   * up through onSourcePicked so the dashboard preview + INPUT node follow.
   */
  initialSource?: { url: string; name: string } | null;
  onSourcePicked?: (file: File) => void;
}

// default rack order: trackers first, lens/grade passes last
const RACK_ORDER: ModuleId[] = ['blob_tracker', 'blob_reveal', 'bokeh', 'analog', 'anamorphic_lab'];
const DEFAULT_ENABLED: ModuleId[] = ['blob_tracker', 'analog'];

/** a saved chain: rack order + enabled set + bases/routes + boolean params */
interface ChainPreset {
  name: string;
  savedAt: number;
  order: ModuleId[];
  enabled: ModuleId[];
  bools: Record<string, number>;
  bus: ParamBusState;
}

const PRESETS_KEY = 'syntech.chainPresets';

const readPresets = (): ChainPreset[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
};

/**
 * AI LAB — the native SynEngine surface (PLAN.md phase 5):
 * one WebGL context, all five effects composed in series on the same
 * frame. This is the capability the iframe architecture cannot provide.
 */
export default function ChainLab({ isDayMode, onBack, initialChain, initialPreset, initialSource, onSourcePicked }: ChainLabProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const audioFileRef = useRef<HTMLInputElement | null>(null);
  const engineRef = useRef<SynEngine | null>(null);
  const audioRef = useRef<AudioEngine | null>(null);
  const videoAnRef = useRef<VideoAnalyzer | null>(null);
  const maskRef = useRef<PersonMask | null>(null);
  const busRef = useRef<ParamBus | null>(null);
  if (!audioRef.current) audioRef.current = new AudioEngine();
  if (!videoAnRef.current) videoAnRef.current = new VideoAnalyzer();
  if (!maskRef.current) maskRef.current = new PersonMask();
  if (!busRef.current) busRef.current = new ParamBus();
  const [segState, setSegState] = useState<PersonMaskState>('off');
  const [fps, setFps] = useState(0);
  const [resPct, setResPct] = useState(100);
  const [sourceKind, setSourceKind] = useState<'none' | 'video' | 'webcam'>('none');
  const [error, setError] = useState<string | null>(null);
  const [audioOn, setAudioOn] = useState(false);
  const [transport, setTransport] = useState<FileTransport | null>(null);
  const [signals, setSignals] = useState({ bass: 0, loud: 0, treble: 0, beat: 0, motion: 0, bright: 0, bpm: null as number | null });
  const [presets, setPresets] = useState<ChainPreset[]>(readPresets);
  const [presetName, setPresetName] = useState('');
  // bump to re-read node state after any mutation (params live in the nodes)
  const [, setRev] = useState(0);
  const bump = () => setRev((r) => r + 1);

  useEffect(() => {
    if (!canvasRef.current) return;
    let engine: SynEngine;
    try {
      engine = new SynEngine(canvasRef.current);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const active = initialChain?.length ? initialChain : DEFAULT_ENABLED;
    const rack = [...active, ...RACK_ORDER.filter((id) => !active.includes(id))];
    rack.forEach((id) => {
      const node = NODE_FACTORY[id]();
      node.enabled = active.includes(id);
      engine.addNode(node);
    });
    // manual/auto control matrix (PLAN §4.4): bases live in the bus, audio
    // and video signal offsets are layered on top at the start of every frame
    busRef.current!.snapshot(engine.chain);
    // opened from the Projects nav: restore the requested saved chain
    if (initialPreset) {
      const p = readPresets().find((x) => x.name === initialPreset);
      if (p) applyPresetTo(engine, p);
    }
    engine.beforeFrame = (now) => {
      const lv = audioRef.current!.tick(now);
      const va = videoAnRef.current!;
      va.tick(engine.source);
      // person mask: lazy-loads the first time an enabled node asks for it
      const mask = maskRef.current!;
      const wantsMask = engine.chain.some((n) => n.enabled && Number(n.getParam('segEnabled')) >= 0.5);
      if (wantsMask) mask.enable();
      if (wantsMask && mask.state === 'ready') mask.tick(engine.source as HTMLVideoElement | null, now);
      engine.personMaskSource = wantsMask && mask.ready ? mask.maskCanvas : null;
      busRef.current!.apply(engine.chain, {
        bass: lv.bass, loud: lv.loud, treble: lv.treble, beat: lv.beat,
        motion: va.motion, bright: va.bright,
      });
    };
    engine.onFps = setFps;
    engine.onResScale = (s) => setResPct(Math.round(s * 100));
    engine.start();
    engineRef.current = engine;
    return () => {
      audioRef.current?.stop();
      maskRef.current?.dispose();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Shared source: load the dashboard's chosen video (single load path — the
  // Video button lifts its pick up to the shell, which flows back here).
  const loadedUrlRef = useRef<string | null>(null);
  useEffect(() => {
    const engine = engineRef.current;
    const url = initialSource?.url;
    if (!engine || !url || loadedUrlRef.current === url) return;
    loadedUrlRef.current = url;
    engine.loadVideoUrl(url)
      .then(() => { setSourceKind('video'); setError(null); })
      .catch((e) => setError((e as Error).message));
  }, [initialSource?.url]);

  // low-rate UI mirror of the live signals (meters + modulated readouts)
  useEffect(() => {
    const id = setInterval(() => {
      const lv = audioRef.current!.levels;
      const va = videoAnRef.current!;
      setSignals({ bass: lv.bass, loud: lv.loud, treble: lv.treble, beat: lv.beat, bpm: lv.bpm, motion: va.motion, bright: va.bright });
      setSegState(maskRef.current!.state);
      setTransport(audioRef.current!.transport);
      setAudioOn(audioRef.current!.active);
    }, 150);
    return () => clearInterval(id);
  }, []);

  const toggleAudio = async () => {
    const audio = audioRef.current!;
    if (audio.mode === 'mic') {
      audio.stop(); // zeroes its levels; the signals mirror picks that up
      setAudioOn(false);
      return;
    }
    try {
      await audio.startMic();
      setAudioOn(true);
      setError(null);
    } catch (e) {
      setError('Audio in: ' + (e as Error).message);
    }
  };

  // §10: reactivity from a loaded music track, not just the mic
  const loadAudioFile = async (file: File | null) => {
    if (!file) return;
    try {
      await audioRef.current!.startFile(file);
      setAudioOn(true);
      setError(null);
    } catch (e) {
      setError('Audio file: ' + (e as Error).message);
    }
  };

  /* ── chain presets (decision #9: localStorage is enough for v1) ── */

  const writePresets = (next: ChainPreset[]) => {
    setPresets(next);
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };

  const savePreset = () => {
    const engine = engineRef.current;
    const name = presetName.trim();
    if (!engine || !name) return;
    const bools: Record<string, number> = {};
    engine.chain.forEach((n) => n.params.forEach((p) => {
      if (p.type === 'boolean') bools[`${n.id}.${p.key}`] = Number(n.getParam(p.key));
    }));
    const preset: ChainPreset = {
      name,
      savedAt: Date.now(),
      order: engine.chain.map((n) => n.id as ModuleId),
      enabled: engine.chain.filter((n) => n.enabled).map((n) => n.id as ModuleId),
      bools,
      bus: busRef.current!.serialize(),
    };
    writePresets([...presets.filter((p) => p.name !== name), preset]);
    setPresetName('');
  };

  const applyPresetTo = (engine: SynEngine, preset: ChainPreset) => {
    const byId = new Map(engine.chain.map((n) => [n.id, n]));
    const ordered: EngineNode[] = [];
    preset.order.forEach((id) => {
      const n = byId.get(id);
      if (n) { ordered.push(n); byId.delete(id); }
    });
    byId.forEach((n) => ordered.push(n)); // nodes unknown to the preset keep their spot at the tail
    engine.chain = ordered;
    engine.chain.forEach((n) => { n.enabled = preset.enabled.includes(n.id as ModuleId); });
    Object.entries(preset.bools ?? {}).forEach(([k, v]) => {
      const dot = k.indexOf('.');
      engine.chain.find((n) => n.id === k.slice(0, dot))?.setParam(k.slice(dot + 1), v);
    });
    busRef.current!.restore(preset.bus, engine.chain);
  };

  const loadPreset = (preset: ChainPreset) => {
    if (!engineRef.current) return;
    applyPresetTo(engineRef.current, preset);
    bump();
  };

  const deletePreset = (name: string) => writePresets(presets.filter((p) => p.name !== name));

  /* ── Gemini pilots the native chain: the whole rack is exposed as one
        namespaced ParamSchema (nodeId.param) and the returned preset is
        written back through the ParamBus — same §4.4 contract as manual ── */

  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState('');

  const chainParameters = (): Record<string, { label: string; value: number; min: number; max: number; step: number; hint: string }> => {
    const engine = engineRef.current;
    const out: ReturnType<typeof chainParameters> = {};
    if (!engine) return out;
    engine.chain.forEach((node) => {
      out[`${node.id}.enabled`] = {
        label: `${node.name} — ENABLED`, value: node.enabled ? 1 : 0, min: 0, max: 1, step: 1,
        hint: `(on/off switch) Enables the ${node.name} effect in the chain`,
      };
      node.params.forEach((p) => {
        out[`${node.id}.${p.key}`] = {
          label: `${node.name} — ${p.label}`,
          value: p.type === 'boolean' ? Number(node.getParam(p.key)) : busRef.current!.getBase(node, p.key),
          min: p.min ?? 0, max: p.max ?? 1, step: p.step ?? 1,
          hint: `${p.type === 'boolean' ? '(on/off switch) ' : ''}${p.aiHint ?? ''}`.trim(),
        };
      });
    });
    return out;
  };

  const applyAiPreset = (preset: Record<string, unknown>): number => {
    const engine = engineRef.current;
    if (!engine) return 0;
    let applied = 0;
    Object.entries(preset).forEach(([k, raw]) => {
      const dot = k.indexOf('.');
      if (dot < 1) return;
      const node = engine.chain.find((n) => n.id === k.slice(0, dot));
      const key = k.slice(dot + 1);
      const v = Number(raw);
      if (!node || isNaN(v)) return;
      if (key === 'enabled') { node.enabled = v >= 0.5; applied++; return; }
      const p = node.params.find((x) => x.key === key);
      if (!p) return;
      if (p.type === 'boolean') node.setParam(key, v);
      else busRef.current!.setBase(node, key, Math.max(p.min ?? -Infinity, Math.min(p.max ?? Infinity, v)));
      applied++;
    });
    bump();
    return applied;
  };

  const runAiOptimize = async () => {
    if (aiBusy) return;
    setAiBusy(true);
    setAiMsg('consulting gemini…');
    try {
      const res = await fetch('/api/gemini/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeModule: 'chain', parameters: chainParameters(), prompt: aiPrompt }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const applied = applyAiPreset(data.preset ?? {});
      setAiMsg(applied > 0
        ? `✓ ${applied} parameters set${data.isFallback ? ' (offline preset)' : ''}`
        : '✗ no matching parameters in the reply');
    } catch (e) {
      setAiMsg('✗ ' + (e as Error).message);
    } finally {
      setAiBusy(false);
    }
  };

  const loadVideo = async (file: File | null) => {
    if (!file) return;
    // when embedded in the dashboard, hand the pick to the shell; it becomes
    // the shared source and flows back through initialSource (single path)
    if (onSourcePicked) {
      onSourcePicked(file);
      return;
    }
    if (!engineRef.current) return;
    try {
      await engineRef.current.loadVideoFile(file);
      setSourceKind('video');
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggleWebcam = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.kind === 'webcam') {
      engine.stopSource();
      setSourceKind('none');
      return;
    }
    try {
      await engine.startWebcam();
      setSourceKind('webcam');
      setError(null);
    } catch (e) {
      setError('Webcam: ' + (e as Error).message);
    }
  };

  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

  // Master Quality export of the WHOLE CHAIN: the shared engine
  // (vendor/syntech-export.js) steps the source video frame by frame while
  // SynEngine renders deterministically with a synthetic clock.
  const runMasterExport = async () => {
    const engine = engineRef.current;
    if (!engine || exporting) return;
    const video = engine.source;
    if (engine.kind !== 'video' || !video || !isFinite(video.duration) || !video.duration) {
      setExportMsg('✗ load a video file first');
      return;
    }
    setExporting(true);
    setExportMsg('preparing…');
    try {
      const loadScript = (src: string) =>
        new Promise<void>((res, rej) => {
          if (document.querySelector(`script[src="${src}"]`)) return res();
          const el = document.createElement('script');
          el.src = src;
          el.onload = () => res();
          el.onerror = () => rej(new Error('failed to load ' + src));
          document.head.appendChild(el);
        });
      await loadScript('/effects/vendor/mp4-muxer.min.js');
      await loadScript('/effects/vendor/syntech-export.js');
      const SyntechExport = (window as any).SyntechExport;
      if (!SyntechExport?.isSupported()) throw new Error('WebCodecs not available in this browser');

      engine.stop();
      video.pause();
      // master export always renders at native resolution (§6.4)
      const prevAdaptive = engine.adaptiveRes;
      engine.adaptiveRes = false;
      engine.setResScale(1);
      const t0 = video.currentTime;
      let clock = performance.now();
      try {
        const res = await SyntechExport.exportMasterQuality({
          video,
          fps: 30,
          getFrame: async () => {
            clock += 1000 / 30;
            engine.renderFrame(clock);
            return engine.canvas;
          },
          filename: 'vfx_chain_' + Date.now() + '.mp4',
          onProgress: (done: number, total: number, phase: string) =>
            setExportMsg(`MASTER ${phase.toUpperCase()} ${done}/${total}`),
        });
        setExportMsg(`✓ ${res.filename} (${res.codec}${res.audio ? ' + audio' : ''})`);
      } finally {
        await new Promise<void>((r) => {
          const on = () => { video.removeEventListener('seeked', on); r(); };
          video.addEventListener('seeked', on);
          setTimeout(r, 1500);
          video.currentTime = t0;
        });
        void video.play().catch(() => {});
        engine.adaptiveRes = prevAdaptive;
        engine.start();
      }
    } catch (e) {
      setExportMsg('✗ ' + (e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const chain = engineRef.current?.chain ?? [];

  const nodeCard = (node: EngineNode, idx: number) => (
    <div
      key={node.id}
      className={`border rounded p-3 space-y-2 transition-colors ${
        node.enabled
          ? isDayMode ? 'border-gold-500/50 bg-white' : 'border-gold-500/40 bg-[#0c0c0c]'
          : isDayMode ? 'border-neutral-200 bg-neutral-50 opacity-60' : 'border-white/10 bg-black/40 opacity-60'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[10px] font-extrabold tracking-widest">
          <span className="text-gold-500">{String(idx + 1).padStart(2, '0')}</span>
          <span className={isDayMode ? 'text-neutral-900' : 'text-white'}>{node.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            title="Move up the chain"
            onClick={() => { engineRef.current?.swapNodes(idx, idx - 1); bump(); }}
            disabled={idx === 0}
            className="p-1 rounded border border-gold-500/20 text-gold-500 hover:bg-gold-500/10 disabled:opacity-30 cursor-pointer"
          >
            <ArrowUp className="w-3 h-3" />
          </button>
          <button
            title="Move down the chain"
            onClick={() => { engineRef.current?.swapNodes(idx, idx + 1); bump(); }}
            disabled={idx === chain.length - 1}
            className="p-1 rounded border border-gold-500/20 text-gold-500 hover:bg-gold-500/10 disabled:opacity-30 cursor-pointer"
          >
            <ArrowDown className="w-3 h-3" />
          </button>
          <button
            title={node.enabled ? 'Bypass this node' : 'Enable this node'}
            data-testid={`toggle-${node.id}`}
            onClick={() => { node.enabled = !node.enabled; bump(); }}
            className={`p-1 rounded border cursor-pointer ${
              node.enabled ? 'border-gold-500 bg-gold-500 text-black' : 'border-gold-500/30 text-neutral-500'
            }`}
          >
            <Power className="w-3 h-3" />
          </button>
        </div>
      </div>

      {node.enabled && (
        <div className="space-y-1.5">
          {node.params.map((p) =>
            p.type === 'boolean' ? (
              <label key={p.key} className={`flex items-center justify-between font-mono text-[9px] uppercase tracking-wider cursor-pointer ${isDayMode ? 'text-neutral-600' : 'text-neutral-400'}`}>
                {p.label}
                <input
                  type="checkbox"
                  data-testid={`param-${node.id}-${p.key}`}
                  checked={Number(node.getParam(p.key)) >= 0.5}
                  onChange={(e) => { node.setParam(p.key, e.target.checked ? 1 : 0); bump(); }}
                  className="accent-[var(--syn-accent)]"
                />
              </label>
            ) : (() => {
              const bus = busRef.current!;
              const base = bus.getBase(node, p.key);
              const mod = bus.getMod(node, p.key);
              const dec = (p.step ?? 1) < 1 ? 2 : 0;
              // cycle the route: off → bass → loud → treble → beat → motion → bright → off
              const cycleMod = () => {
                const order: (ModSource | null)[] = [null, ...MOD_SOURCES];
                const next = order[(order.indexOf(mod?.source ?? null) + 1) % order.length];
                bus.setMod(node, p.key, next ? { source: next, amount: mod?.amount ?? 0.5 } : null);
                bump();
              };
              return (
                <div key={p.key} className="space-y-0.5">
                  <div className={`flex justify-between items-center font-mono text-[9px] uppercase tracking-wider ${isDayMode ? 'text-neutral-600' : 'text-neutral-400'}`}>
                    <span>{p.label}</span>
                    <span className="flex items-center gap-1.5">
                      {p.reactive && (
                        <button
                          type="button"
                          title="Audio modulation source (PLAN §4.4: base + audio × amount)"
                          data-testid={`mod-src-${node.id}-${p.key}`}
                          onClick={cycleMod}
                          className={`px-1 rounded border text-[8px] font-bold cursor-pointer ${
                            mod ? 'border-amber-400 bg-amber-400/20 text-amber-400' : 'border-gold-500/25 text-neutral-500 hover:text-gold-500'
                          }`}
                        >
                          {mod ? mod.source.toUpperCase() : '~'}
                        </button>
                      )}
                      <span className="text-gold-500 font-bold">{base.toFixed(dec)}</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    data-testid={`param-${node.id}-${p.key}`}
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    value={base}
                    onChange={(e) => { bus.setBase(node, p.key, parseFloat(e.target.value)); bump(); }}
                    className="w-full h-1 accent-[var(--syn-accent)] cursor-pointer"
                  />
                  {mod && (
                    <div className="flex items-center gap-1.5">
                      <span className={`font-mono text-[8px] uppercase ${isDayMode ? 'text-neutral-500' : 'text-neutral-500'}`}>AMT</span>
                      <input
                        type="range"
                        data-testid={`mod-amt-${node.id}-${p.key}`}
                        min={-1}
                        max={1}
                        step={0.05}
                        value={mod.amount}
                        onChange={(e) => { bus.setMod(node, p.key, { source: mod.source, amount: parseFloat(e.target.value) }); bump(); }}
                        className="flex-1 h-1 accent-amber-400 cursor-pointer"
                      />
                      <span data-testid={`mod-val-${node.id}-${p.key}`} className="font-mono text-[8px] text-amber-400 w-9 text-right">
                        {Number(node.getParam(p.key)).toFixed(dec)}
                      </span>
                    </div>
                  )}
                </div>
              );
            })()
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col flex-1 min-h-[600px]">
      {/* toolbar */}
      <div className={`flex items-center justify-between gap-3 px-4 md:px-6 py-3 border-b transition-colors duration-300 ${isDayMode ? 'border-gold-500/15 bg-[#f7f5f0]' : 'border-gold-500/20 bg-black'}`}>
        <button
          type="button"
          onClick={onBack}
          className={`flex items-center gap-2 font-mono text-[10px] font-bold tracking-[0.2em] uppercase px-3 py-2 rounded border transition-colors cursor-pointer ${isDayMode ? 'border-gold-500/40 text-gold-700 hover:bg-gold-500/10' : 'border-gold-500/30 text-gold-500 hover:bg-gold-500/10'}`}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to console
        </button>
        <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-widest">
          <span className={`flex items-center gap-1.5 font-extrabold ${isDayMode ? 'text-neutral-900' : 'text-white'}`}>
            <Link2 className="w-3 h-3 text-gold-500" />
            AI LAB <span className="text-gold-500">// SYNENGINE</span>
          </span>
          <span className={isDayMode ? 'text-neutral-600' : 'text-neutral-400'}>
            FPS <b className="text-gold-500" data-testid="chain-fps">{fps}</b>
          </span>
          <span
            title="Adaptive internal render resolution (§6): steps down when the frame rate falls under budget"
            className={isDayMode ? 'text-neutral-600' : 'text-neutral-400'}
          >
            RES <b className={resPct < 100 ? 'text-amber-400' : 'text-gold-500'} data-testid="chain-res">{resPct}%</b>
          </span>
          <button
            type="button"
            data-testid="chain-master"
            onClick={runMasterExport}
            disabled={exporting}
            className="flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-widest uppercase px-3 py-1.5 rounded bg-gold-500 text-black hover:bg-gold-400 disabled:opacity-40 cursor-pointer"
          >
            <Diamond className="w-3 h-3" /> Master MP4
          </button>
          {exportMsg && (
            <span data-testid="chain-export-msg" className="text-[9px] text-gold-500 normal-case tracking-normal max-w-56 truncate">{exportMsg}</span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col lg:flex-row min-h-0">
        {/* stage */}
        <div className="flex-1 bg-black flex items-center justify-center p-3 min-h-[320px] relative">
          <canvas ref={canvasRef} data-testid="chain-canvas" className="max-w-full max-h-full border border-gold-500/20" />
          {sourceKind === 'none' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
              <div className="font-mono text-[11px] tracking-[0.3em] text-gold-500 font-bold">NO SIGNAL</div>
              <div className="font-mono text-[9px] tracking-widest text-neutral-500 uppercase">Load a video or start the webcam →</div>
            </div>
          )}
        </div>

        {/* control rail */}
        <div className={`w-full lg:w-72 shrink-0 border-t lg:border-t-0 lg:border-l p-4 space-y-4 overflow-y-auto scrollbar-thin transition-colors ${isDayMode ? 'border-gold-500/15 bg-[#faf9f5]' : 'border-gold-500/15 bg-[#080808]'}`}>
          <div className="space-y-2">
            <div className="font-mono text-[9px] font-extrabold tracking-widest text-gold-500 uppercase border-b border-gold-500/15 pb-1">Source</div>
            <div className="flex gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-1.5 font-mono text-[9px] font-bold tracking-wider uppercase px-2 py-2 rounded border border-gold-500/30 text-gold-500 hover:bg-gold-500/10 cursor-pointer"
              >
                <Film className="w-3 h-3" /> Video
              </button>
              <button
                onClick={toggleWebcam}
                className={`flex-1 flex items-center justify-center gap-1.5 font-mono text-[9px] font-bold tracking-wider uppercase px-2 py-2 rounded border cursor-pointer ${sourceKind === 'webcam' ? 'border-gold-500 bg-gold-500 text-black' : 'border-gold-500/30 text-gold-500 hover:bg-gold-500/10'}`}
              >
                <Camera className="w-3 h-3" /> {sourceKind === 'webcam' ? 'Stop' : 'Webcam'}
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              data-testid="chain-file"
              className="hidden"
              onChange={(e) => loadVideo(e.target.files?.[0] ?? null)}
            />
            <div className="flex gap-2">
              <button
                onClick={toggleAudio}
                data-testid="audio-toggle"
                className={`flex-1 flex items-center justify-center gap-1.5 font-mono text-[9px] font-bold tracking-wider uppercase px-2 py-2 rounded border cursor-pointer ${
                  audioOn && !transport ? 'border-amber-400 bg-amber-400/15 text-amber-400' : 'border-gold-500/30 text-gold-500 hover:bg-gold-500/10'
                }`}
              >
                <Mic className="w-3 h-3" /> {audioOn && !transport ? 'Mic: Live' : 'Mic'}
              </button>
              <button
                onClick={() => audioFileRef.current?.click()}
                data-testid="audio-file-btn"
                className={`flex-1 flex items-center justify-center gap-1.5 font-mono text-[9px] font-bold tracking-wider uppercase px-2 py-2 rounded border cursor-pointer ${
                  transport ? 'border-amber-400 bg-amber-400/15 text-amber-400' : 'border-gold-500/30 text-gold-500 hover:bg-gold-500/10'
                }`}
              >
                <Music className="w-3 h-3" /> Track
              </button>
            </div>
            <input
              ref={audioFileRef}
              type="file"
              accept="audio/*"
              data-testid="audio-file"
              className="hidden"
              onChange={(e) => loadAudioFile(e.target.files?.[0] ?? null)}
            />
            {transport && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => audioRef.current!.togglePlay()}
                    data-testid="audio-playpause"
                    className="p-1 rounded border border-amber-400/40 text-amber-400 hover:bg-amber-400/10 cursor-pointer"
                  >
                    {transport.playing ? <Pause className="w-3 h-3" /> : <PlayIcon className="w-3 h-3" />}
                  </button>
                  <span data-testid="audio-track-name" className={`flex-1 truncate font-mono text-[8px] ${isDayMode ? 'text-neutral-600' : 'text-neutral-400'}`}>{transport.name}</span>
                  <button
                    onClick={() => audioRef.current!.setLoop(!transport.loop)}
                    title="Loop"
                    className={`p-1 rounded border cursor-pointer ${transport.loop ? 'border-amber-400 text-amber-400' : 'border-gold-500/25 text-neutral-500'}`}
                  >
                    <Repeat className="w-3 h-3" />
                  </button>
                </div>
                <input
                  type="range"
                  data-testid="audio-seek"
                  min={0}
                  max={transport.duration || 0}
                  step={0.1}
                  value={transport.currentTime}
                  onChange={(e) => audioRef.current!.seek(parseFloat(e.target.value))}
                  className="w-full h-1 accent-amber-400 cursor-pointer"
                />
              </div>
            )}
            {audioOn && (
              <div className="space-y-1">
                {(['bass', 'loud', 'treble'] as const).map((band) => (
                  <div key={band} className="flex items-center gap-1.5 font-mono text-[8px] uppercase">
                    <span className={`w-9 ${isDayMode ? 'text-neutral-500' : 'text-neutral-500'}`}>{band}</span>
                    <div className={`flex-1 h-1 rounded overflow-hidden ${isDayMode ? 'bg-neutral-200' : 'bg-white/10'}`}>
                      <div className="h-full bg-amber-400 transition-[width] duration-100" style={{ width: `${Math.min(100, Math.round(signals[band] * 100))}%` }} />
                    </div>
                    <span data-testid={`audio-${band}`} className="w-6 text-right text-amber-400">{Math.round(signals[band] * 100)}</span>
                  </div>
                ))}
                <div className="flex items-center gap-1.5 font-mono text-[8px] uppercase">
                  <span className={isDayMode ? 'text-neutral-500' : 'text-neutral-500'}>beat</span>
                  <span
                    className="w-2 h-2 rounded-full bg-amber-400"
                    style={{ opacity: 0.15 + signals.beat * 0.85 }}
                  />
                  <span className={`ml-auto ${isDayMode ? 'text-neutral-500' : 'text-neutral-500'}`}>
                    BPM <b className="text-amber-400">{signals.bpm ?? '--'}</b>
                  </span>
                </div>
              </div>
            )}
            {sourceKind !== 'none' && (
              <div className="space-y-1">
                {(['motion', 'bright'] as const).map((band) => (
                  <div key={band} className="flex items-center gap-1.5 font-mono text-[8px] uppercase">
                    <span className={`w-9 ${isDayMode ? 'text-neutral-500' : 'text-neutral-500'}`}>{band}</span>
                    <div className={`flex-1 h-1 rounded overflow-hidden ${isDayMode ? 'bg-neutral-200' : 'bg-white/10'}`}>
                      <div className="h-full bg-gold-500 transition-[width] duration-100" style={{ width: `${Math.min(100, Math.round(signals[band] * 100))}%` }} />
                    </div>
                    <span data-testid={`signal-${band}`} className="w-6 text-right text-gold-500">{Math.round(signals[band] * 100)}</span>
                  </div>
                ))}
              </div>
            )}
            {(audioOn || sourceKind !== 'none') && (
              <p className={`font-mono text-[8px] leading-relaxed ${isDayMode ? 'text-neutral-500' : 'text-neutral-600'}`}>
                Route any signal onto a reactive parameter with the <b className="text-amber-400">~</b> chip next to its value.
              </p>
            )}
            {segState !== 'off' && (
              <div data-testid="seg-status" className={`font-mono text-[8px] uppercase tracking-widest ${
                segState === 'ready' ? 'text-gold-500' : segState === 'loading' ? 'text-amber-400' : 'text-red-400'
              }`}>
                SEG: {segState === 'ready' ? 'READY' : segState === 'loading' ? 'LOADING MODEL…' : 'UNAVAILABLE'}
              </div>
            )}
            {error && <div className="font-mono text-[9px] text-red-400">{error}</div>}
          </div>

          {/* Gemini drives the whole chain: decision #6 — AI is one of the automations */}
          <div className="space-y-2">
            <div className="font-mono text-[9px] font-extrabold tracking-widest text-gold-500 uppercase border-b border-gold-500/15 pb-1">AI Optimizer</div>
            <div className="flex gap-1.5">
              <input
                type="text"
                data-testid="ai-prompt"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runAiOptimize(); }}
                placeholder="e.g. cinematic VHS nightmare"
                className={`flex-1 min-w-0 font-mono text-[9px] px-2 py-1.5 rounded border bg-transparent outline-none ${
                  isDayMode ? 'border-neutral-300 text-neutral-800 placeholder-neutral-400' : 'border-gold-500/25 text-white placeholder-neutral-600'
                }`}
              />
              <button
                onClick={runAiOptimize}
                data-testid="ai-optimize"
                disabled={aiBusy}
                className="flex items-center gap-1 font-mono text-[9px] font-bold uppercase px-2 py-1.5 rounded bg-gold-500 text-black hover:bg-gold-400 disabled:opacity-40 cursor-pointer"
              >
                <Sparkle className="w-3 h-3" /> Go
              </button>
            </div>
            {aiMsg && <div data-testid="ai-msg" className="font-mono text-[8px] text-gold-500">{aiMsg}</div>}
          </div>

          {/* chain presets: full rack state in localStorage (decision #9) */}
          <div className="space-y-2">
            <div className="font-mono text-[9px] font-extrabold tracking-widest text-gold-500 uppercase border-b border-gold-500/15 pb-1">Presets</div>
            <div className="flex gap-1.5">
              <input
                type="text"
                data-testid="preset-name"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') savePreset(); }}
                placeholder="preset name"
                className={`flex-1 min-w-0 font-mono text-[9px] px-2 py-1.5 rounded border bg-transparent outline-none ${
                  isDayMode ? 'border-neutral-300 text-neutral-800 placeholder-neutral-400' : 'border-gold-500/25 text-white placeholder-neutral-600'
                }`}
              />
              <button
                onClick={savePreset}
                data-testid="preset-save"
                disabled={!presetName.trim()}
                className="flex items-center gap-1 font-mono text-[9px] font-bold uppercase px-2 py-1.5 rounded border border-gold-500/30 text-gold-500 hover:bg-gold-500/10 disabled:opacity-30 cursor-pointer"
              >
                <Save className="w-3 h-3" /> Save
              </button>
            </div>
            {presets.length === 0 && (
              <p className={`font-mono text-[8px] ${isDayMode ? 'text-neutral-400' : 'text-neutral-600'}`}>
                No saved chains yet — the whole rack (order, bypass, params, routes) is stored.
              </p>
            )}
            {presets.map((p) => (
              <div key={p.name} className={`flex items-center gap-1.5 font-mono text-[9px] px-2 py-1.5 rounded border ${isDayMode ? 'border-neutral-200 bg-white' : 'border-white/10 bg-black/40'}`}>
                <span className={`flex-1 truncate ${isDayMode ? 'text-neutral-800' : 'text-white'}`}>{p.name}</span>
                <button
                  onClick={() => loadPreset(p)}
                  data-testid={`preset-load-${p.name}`}
                  className="px-1.5 py-0.5 rounded bg-gold-500 text-black font-bold uppercase text-[8px] hover:bg-gold-400 cursor-pointer"
                >
                  Load
                </button>
                <button
                  onClick={() => deletePreset(p.name)}
                  data-testid={`preset-del-${p.name}`}
                  title="Delete preset"
                  className="p-1 rounded border border-gold-500/20 text-neutral-500 hover:text-red-400 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between font-mono text-[9px] font-extrabold tracking-widest text-gold-500 uppercase border-b border-gold-500/15 pb-1">
              <span>Signal chain</span>
              <span className={isDayMode ? 'text-neutral-500' : 'text-neutral-500'}>SOURCE → {chain.filter((n) => n.enabled).map((n) => n.id.toUpperCase()).join(' → ') || 'OUT'} → OUT</span>
            </div>
            {chain.map((n, i) => nodeCard(n, i))}
          </div>

          <p className={`font-mono text-[8px] leading-relaxed ${isDayMode ? 'text-neutral-500' : 'text-neutral-600'}`}>
            Native SynEngine nodes — one WebGL context, effects composed in series on the same frame.
            The full standalone effects remain available from the library while porting continues.
          </p>
        </div>
      </div>
    </div>
  );
}
