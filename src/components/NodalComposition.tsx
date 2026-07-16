import React, { useLayoutEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { ModuleId } from '../types';

/* ═══════════════════════════════════════════════════════════════
   NODAL COMPOSITION — the dashboard shortcut into the AI Lab.

   The chosen source video (video + audio) is the INPUT node; every
   effect the operator adds appears as a node wired from the input,
   and a final OUTPUT node ("Main Composition") is the base video
   with the effects applied. Clicking the connection port where an
   edge meets a node detaches it: the effect is deactivated and its
   node ghosts out. Re-clicking re-attaches it exactly as it was.

   It is a live mirror of the composition state owned by the shell,
   so opening the AI Lab loads the very same source + enabled chain.
   ═══════════════════════════════════════════════════════════════ */

export interface CompEffect {
  id: ModuleId;
  enabled: boolean;
}

export interface EffectMeta {
  name: string;
  short: string;
  color: string; // node accent
}

// per-effect node accent colours — harmonized to the D1 "warm metals" signal
// palette (design/03-AESTHETIC-DIRECTIONS.md). Kept as constants here; a future
// pass can read them from the --syn-node-* tokens for a one-block re-skin.
export const EFFECT_META: Record<ModuleId, EffectMeta> = {
  blob_tracker: { name: 'BLOB TRACKER', short: 'Vertex displacement', color: '#e6b24a' },
  blob_reveal: { name: 'BLOB REVEAL', short: 'Negative-mask reveal', color: '#c98a5a' },
  anamorphic_lab: { name: 'ANAMORPHIC LAB', short: 'Lens flare stretch', color: '#b8b0a0' },
  analog: { name: 'ANALOG', short: 'CRT / sync jitter', color: '#8a94a8' },
  bokeh: { name: 'BOKEH', short: 'Depth-of-field disks', color: '#a98cc8' },
};

const INPUT_COLOR = '#6fae86';
const OUTPUT_COLOR = '#e6b24a';
// keep a stable rack order so nodes don't reshuffle when toggled
const RACK_ORDER: ModuleId[] = ['blob_tracker', 'blob_reveal', 'anamorphic_lab', 'analog', 'bokeh'];

interface NodalCompositionProps {
  isDayMode: boolean;
  effects: CompEffect[];
  source: { name: string } | null;
  /** port click on the node boundary → deactivate / reactivate the effect */
  onToggleEffect: (id: ModuleId) => void;
  /** + Add Node → add an effect to the composition */
  onAddEffect: (id: ModuleId) => void;
  /** remove an effect node from the composition entirely */
  onRemoveEffect: (id: ModuleId) => void;
  /** click a node body → jump into the AI Lab (the real engine) */
  onOpenLab: () => void;
  /** click the INPUT node → pick the source video */
  onPickSource: () => void;
}

export default function NodalComposition({
  isDayMode,
  effects,
  source,
  onToggleEffect,
  onAddEffect,
  onRemoveEffect,
  onOpenLab,
  onPickSource,
}: NodalCompositionProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 640, h: 300 });
  const [addOpen, setAddOpen] = useState(false);
  const [hoverPort, setHoverPort] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.max(360, r.width), h: Math.max(180, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // effects in stable rack order (present ones only)
  const ordered = RACK_ORDER.filter((id) => effects.some((e) => e.id === id));
  const enabledOf = (id: ModuleId) => effects.find((e) => e.id === id)?.enabled ?? false;
  const missing = RACK_ORDER.filter((id) => !effects.some((e) => e.id === id));

  /* ── layout in SVG user units; the viewBox scales to the panel ── */
  const PAD = 18;
  const IN_W = 128;
  const IN_H = 62;
  const OUT_W = 128;
  const OUT_H = 62;
  const FX_W = 150;
  const FX_H = 50;
  const FX_GAP = 16;
  const rows = Math.max(1, ordered.length);
  const stackH = rows * FX_H + (rows - 1) * FX_GAP;
  const H = Math.max(size.h, stackH + PAD * 2 + 8);
  const W = Math.max(size.w, 560);
  const midY = H / 2;

  const inX = PAD;
  const inY = midY - IN_H / 2;
  const outX = W - PAD - OUT_W;
  const outY = midY - OUT_H / 2;
  const fxX = (W - FX_W) / 2;
  const stackTop = midY - stackH / 2;

  const fxRow = (i: number) => stackTop + i * (FX_H + FX_GAP);

  // right-edge anchor on input, left-edge anchor on output, per effect fan-out
  const inAnchorY = (i: number) => {
    if (rows === 1) return midY;
    const spread = Math.min(IN_H - 12, stackH);
    return midY - spread / 2 + (i / (rows - 1)) * spread;
  };
  const outAnchorY = inAnchorY;

  const bez = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  const panel = isDayMode ? '#fbfaf7' : 'var(--syn-ink-900)';
  const subInk = isDayMode ? '#8a8578' : '#6b6b78';
  const nodeFill = isDayMode ? '#ffffff' : 'var(--syn-ink-800)';
  const nodeStroke = isDayMode ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)';

  const anyEnabled = ordered.some((id) => enabledOf(id));

  const Port = ({ id, x, y, color, active }: { id: string; x: number; y: number; color: string; active: boolean }) => {
    const key = id;
    const hovered = hoverPort === key;
    const fx = id.split(':')[1] as ModuleId;
    return (
      <g
        style={{ cursor: 'pointer' }}
        data-testid={`port-${id.replace(':', '-')}`}
        onMouseEnter={() => setHoverPort(key)}
        onMouseLeave={() => setHoverPort((h) => (h === key ? null : h))}
        onClick={(e) => { e.stopPropagation(); onToggleEffect(fx); }}
      >
        {/* generous invisible hit-area */}
        <circle cx={x} cy={y} r={11} fill="transparent" />
        <circle
          cx={x}
          cy={y}
          r={hovered ? 5.5 : 4}
          fill={active ? color : 'transparent'}
          stroke={active ? '#000000' : color}
          strokeWidth={active ? 1 : 1.4}
        />
        {active && <circle cx={x} cy={y} r={1.6} fill="#000000" />}
      </g>
    );
  };

  return (
    <div
      className={`w-full h-full rounded-2xl border flex flex-col relative overflow-hidden ${
        isDayMode ? 'border-neutral-200' : 'border-ink-700/60'
      }`}
      style={{ background: panel }}
    >
      {/* header */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2 shrink-0 z-10">
        <span className="font-mono text-[10px] tracking-[0.28em] text-gold-500 uppercase font-bold">
          AI Lab Nodes
        </span>
        <div className="flex items-center gap-3 text-[9px] font-mono text-neutral-500 relative">
          <button
            type="button"
            data-testid="nodal-add"
            onClick={() => setAddOpen((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded-md border transition-colors cursor-pointer ${
              isDayMode
                ? 'border-neutral-300 text-neutral-600 hover:border-gold-500/50 hover:text-gold-600'
                : 'border-ink-700 text-neutral-400 hover:border-gold-500/50 hover:text-gold-500'
            }`}
          >
            <Plus className="w-3 h-3" /> Add Node
          </button>

          {addOpen && (
            <div
              data-testid="nodal-add-menu"
              className={`absolute right-0 top-7 z-30 w-52 rounded-lg border p-1.5 shadow-2xl ${
                isDayMode ? 'bg-white border-neutral-200' : 'bg-ink-850 border-ink-700'
              }`}
            >
              {missing.length === 0 ? (
                <div className="px-2 py-2 font-mono text-[9px] text-neutral-500">All effects are in the graph.</div>
              ) : (
                missing.map((id) => (
                  <button
                    key={id}
                    type="button"
                    data-testid={`nodal-add-${id}`}
                    onClick={() => { onAddEffect(id); setAddOpen(false); }}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left font-mono text-[10px] transition-colors ${
                      isDayMode ? 'hover:bg-neutral-100 text-neutral-700' : 'hover:bg-white/5 text-neutral-300'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: EFFECT_META[id].color }} />
                    {EFFECT_META[id].name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* node canvas */}
      <div ref={wrapRef} className="flex-1 min-h-0 relative" onClick={() => setAddOpen(false)}>
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          data-testid="nodal-svg"
        >
          <defs>
            <pattern id="nodal-grid" width="26" height="26" patternUnits="userSpaceOnUse">
              <path d="M 26 0 L 0 0 0 26" fill="none" stroke={isDayMode ? '#efece4' : 'rgba(255,255,255,0.025)'} strokeWidth="1" />
            </pattern>
          </defs>
          <rect x="0" y="0" width={W} height={H} fill="url(#nodal-grid)" />

          {/* ── connectors (hidden when the effect is detached) ── */}
          {ordered.map((id, i) => {
            const on = enabledOf(id);
            if (!on) return null;
            const color = EFFECT_META[id].color;
            const y = fxRow(i) + FX_H / 2;
            const inP = { x: inX + IN_W, y: inAnchorY(i) };
            const fxL = { x: fxX, y };
            const fxR = { x: fxX + FX_W, y };
            const outP = { x: outX, y: outAnchorY(i) };
            return (
              <g key={`edge-${id}`}>
                <path d={bez(inP.x, inP.y, fxL.x, fxL.y)} fill="none" stroke={color} strokeWidth="1.8" opacity="0.85" />
                <path d={bez(inP.x, inP.y, fxL.x, fxL.y)} fill="none" stroke={color} strokeWidth="1.8" className="node-flow" opacity="0.9" />
                <path d={bez(fxR.x, fxR.y, outP.x, outP.y)} fill="none" stroke={color} strokeWidth="1.8" opacity="0.85" />
                <path d={bez(fxR.x, fxR.y, outP.x, outP.y)} fill="none" stroke={color} strokeWidth="1.8" className="node-flow" opacity="0.9" />
              </g>
            );
          })}

          {/* ── INPUT node ── */}
          <g style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); onPickSource(); }} data-testid="nodal-input">
            <rect x={inX} y={inY} width={IN_W} height={IN_H} rx="10" fill={nodeFill} stroke={INPUT_COLOR} strokeWidth="1.3" />
            <rect x={inX} y={inY} width="3.5" height={IN_H} rx="1.5" fill={INPUT_COLOR} />
            <circle cx={inX + 16} cy={inY + 17} r="3" fill={INPUT_COLOR} />
            <text x={inX + 26} y={inY + 20} fontFamily="var(--syn-font-mono)" fontSize="9.5" fontWeight="700" fill={isDayMode ? '#1a1a1a' : '#f4f2ee'} letterSpacing="0.5">INPUT</text>
            <text x={inX + 12} y={inY + 36} fontFamily="var(--syn-font-mono)" fontSize="7.5" fill={subInk}>
              {source ? truncate(source.name, 18) : 'Click to load source'}
            </text>
            {/* mini waveform to signal video + audio */}
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((b) => (
              <rect
                key={b}
                x={inX + 12 + b * 6}
                y={inY + IN_H - 12}
                width="3"
                height={source ? 3 + ((b * 5) % 8) : 2}
                rx="1"
                fill={INPUT_COLOR}
                opacity={source ? 0.85 : 0.3}
              />
            ))}
          </g>

          {/* ── OUTPUT node ── */}
          <g style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); onOpenLab(); }} data-testid="nodal-output">
            <rect x={outX} y={outY} width={OUT_W} height={OUT_H} rx="10" fill={nodeFill} stroke={OUTPUT_COLOR} strokeWidth="1.3" opacity={anyEnabled ? 1 : 0.55} />
            <rect x={outX + OUT_W - 3.5} y={outY} width="3.5" height={OUT_H} rx="1.5" fill={OUTPUT_COLOR} />
            <circle cx={outX + 16} cy={outY + 17} r="3" fill={OUTPUT_COLOR} />
            <text x={outX + 26} y={outY + 20} fontFamily="var(--syn-font-mono)" fontSize="9.5" fontWeight="700" fill={isDayMode ? '#1a1a1a' : '#f4f2ee'} letterSpacing="0.5">OUTPUT</text>
            <text x={outX + 12} y={outY + 36} fontFamily="var(--syn-font-mono)" fontSize="7.5" fill={subInk}>Main Comp</text>
            <text x={outX + 12} y={outY + 49} fontFamily="var(--syn-font-mono)" fontSize="7" fill={OUTPUT_COLOR} opacity="0.8">
              {anyEnabled ? `${ordered.filter(enabledOf).length} fx · live` : 'passthrough'}
            </text>
          </g>

          {/* ── effect nodes ── */}
          {ordered.map((id, i) => {
            const meta = EFFECT_META[id];
            const on = enabledOf(id);
            const y = fxRow(i);
            const cy = y + FX_H / 2;
            return (
              <g key={`node-${id}`} data-testid={`nodal-node-${id}`}>
                <g
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); onOpenLab(); }}
                  opacity={on ? 1 : 0.45}
                >
                  <rect
                    x={fxX}
                    y={y}
                    width={FX_W}
                    height={FX_H}
                    rx="9"
                    fill={nodeFill}
                    stroke={on ? meta.color : nodeStroke}
                    strokeWidth={on ? 1.3 : 1}
                    strokeDasharray={on ? '0' : '4 3'}
                  />
                  <rect x={fxX} y={y} width="3.5" height={FX_H} rx="1.5" fill={meta.color} opacity={on ? 1 : 0.5} />
                  <text x={fxX + 14} y={y + 21} fontFamily="var(--syn-font-mono)" fontSize="9.5" fontWeight="700" fill={isDayMode ? '#1a1a1a' : '#f4f2ee'} letterSpacing="0.4">
                    {meta.name}
                  </text>
                  <text x={fxX + 14} y={y + 36} fontFamily="var(--syn-font-mono)" fontSize="7.5" fill={subInk}>
                    {meta.short}
                  </text>
                  <text
                    x={fxX + FX_W - 12}
                    y={y + 15}
                    textAnchor="end"
                    fontFamily="var(--syn-font-mono)"
                    fontSize="6.5"
                    fontWeight="700"
                    letterSpacing="1"
                    fill={on ? meta.color : subInk}
                  >
                    {on ? 'ACTIVE' : 'BYPASS'}
                  </text>
                </g>

                {/* detach/reattach ports where edges meet the squares */}
                <Port id={`inL:${id}`} x={fxX} y={cy} color={meta.color} active={on} />
                <Port id={`outR:${id}`} x={fxX + FX_W} y={cy} color={meta.color} active={on} />
                <Port id={`inA:${id}`} x={inX + IN_W} y={inAnchorY(i)} color={meta.color} active={on} />
                <Port id={`outA:${id}`} x={outX} y={outAnchorY(i)} color={meta.color} active={on} />

                {/* remove-from-graph affordance */}
                <g
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); onRemoveEffect(id); }}
                  onMouseEnter={() => setHoverPort(`rm:${id}`)}
                  onMouseLeave={() => setHoverPort((h) => (h === `rm:${id}` ? null : h))}
                >
                  <circle cx={fxX + FX_W - 11} cy={y + FX_H - 12} r="7" fill="transparent" />
                  <text
                    x={fxX + FX_W - 11}
                    y={y + FX_H - 9}
                    textAnchor="middle"
                    fontFamily="var(--syn-font-mono)"
                    fontSize="9"
                    fill={hoverPort === `rm:${id}` ? '#e0554b' : subInk}
                  >
                    ✕
                  </text>
                </g>
              </g>
            );
          })}
        </svg>

        {/* empty state */}
        {ordered.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none px-4 text-center">
            <span className="font-mono text-[10px] tracking-[0.25em] text-gold-500/80 uppercase font-bold">Empty composition</span>
            <span className="font-mono text-[9px] text-neutral-500 max-w-[240px] leading-relaxed">
              Add an effect node — it wires from the source input to the output. This is your shortcut into the AI Lab.
            </span>
          </div>
        )}


      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
