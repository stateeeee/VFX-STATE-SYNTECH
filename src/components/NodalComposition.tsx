import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { ModuleId } from '../types';

/* ═══════════════════════════════════════════════════════════════
   NODAL COMPOSITION — the AI Lab's wiring surface (03-SPEC-SHELL §6).

   INPUT (right port only) → effect nodes (left in / right out) →
   OUTPUT (left port only). Wires are dragged: press a port, drag to
   a compatible port, release to connect. Grabbing a connected port
   picks the wire up — release it in the void (or back where it
   started) to disconnect, on another port to rewire. A node not on
   the complete INPUT→OUTPUT path ghosts at ~50% and leaves the
   chain. Chain order IS the wiring order; the shell owns the state
   and the ChainLab rack mirrors it both ways.
   ═══════════════════════════════════════════════════════════════ */

export interface CompEffect {
  id: ModuleId;
  enabled: boolean;
}

/** Serial wiring: 'IN' | ModuleId → ModuleId | 'OUT' (one wire per port). */
export type WireMap = Record<string, string>;

export interface EffectMeta {
  name: string;
  short: string;
  color: string; // node accent
}

// per-effect node accent colours, echoing the reference composition graph
export const EFFECT_META: Record<ModuleId, EffectMeta> = {
  blob_tracker: { name: 'BLOB TRACKER', short: 'Vertex displacement', color: '#e0913f' },
  blob_reveal: { name: 'BLOB REVEAL', short: 'Negative-mask reveal', color: '#c65b9c' },
  anamorphic_lab: { name: 'ANAMORPHIC LAB', short: 'Lens flare stretch', color: '#5bb0c4' },
  analog: { name: 'ANALOG', short: 'CRT / sync jitter', color: '#6ea8e0' },
  bokeh: { name: 'BOKEH', short: 'Depth-of-field disks', color: '#9b6fd0' },
};

const INPUT_COLOR = '#57bf8a';
const OUTPUT_COLOR = '#8b5cf6';
// keep a stable rack order so nodes don't reshuffle when rewired
const RACK_ORDER: ModuleId[] = ['blob_tracker', 'blob_reveal', 'anamorphic_lab', 'analog', 'bokeh'];
// Add Node menu is strictly alphabetical by display name (decision #6)
const MENU_ORDER: ModuleId[] = ['analog', 'anamorphic_lab', 'blob_reveal', 'blob_tracker', 'bokeh'];

interface PortSpec {
  key: string; // `${side}:${node}`
  node: string; // 'IN' | 'OUT' | ModuleId
  side: 'in' | 'out';
  x: number;
  y: number;
  color: string;
}

interface DragState {
  /** the wire end that stays put */
  fixed: PortSpec;
  /** which port side the floating end may land on */
  need: 'in' | 'out';
  /** from-key of the wire being picked up (hidden while dragging), if any */
  original: string | null;
  x: number;
  y: number;
  moved: boolean;
}

interface NodalCompositionProps {
  isDayMode: boolean;
  effects: CompEffect[];
  wires: WireMap;
  source: { name: string } | null;
  /** commit a wire from an out-port to an in-port (replaces occupied ports) */
  onConnect: (from: string, to: string) => void;
  /** remove the wire that starts at this out-port */
  onDisconnect: (from: string) => void;
  /** + Add Node → add an effect and wire it before OUTPUT */
  onAddEffect: (id: ModuleId) => void;
  /** remove an effect node from the graph entirely */
  onRemoveEffect: (id: ModuleId) => void;
  /** click a node body → jump into the AI Lab (the real engine) */
  onOpenLab: () => void;
  /** click the INPUT node → pick the source video */
  onPickSource: () => void;
  isStreaming?: boolean;
}

export default function NodalComposition({
  isDayMode,
  effects,
  wires,
  source,
  onConnect,
  onDisconnect,
  onAddEffect,
  onRemoveEffect,
  onOpenLab,
  onPickSource,
  isStreaming,
}: NodalCompositionProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ w: 640, h: 300 });
  const [addOpen, setAddOpen] = useState(false);
  const [hoverPort, setHoverPort] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

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
  const missing = MENU_ORDER.filter((id) => !effects.some((e) => e.id === id));

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

  /* ── ports ── */
  const ports: PortSpec[] = [
    { key: 'out:IN', node: 'IN', side: 'out', x: inX + IN_W, y: midY, color: INPUT_COLOR },
    { key: 'in:OUT', node: 'OUT', side: 'in', x: outX, y: midY, color: OUTPUT_COLOR },
    ...ordered.flatMap((id, i): PortSpec[] => {
      const cy = fxRow(i) + FX_H / 2;
      const color = EFFECT_META[id].color;
      return [
        { key: `in:${id}`, node: id, side: 'in', x: fxX, y: cy, color },
        { key: `out:${id}`, node: id, side: 'out', x: fxX + FX_W, y: cy, color },
      ];
    }),
  ];
  const portByKey = (key: string) => ports.find((p) => p.key === key);
  const wireOfIn = (node: string) => Object.keys(wires).find((k) => wires[k] === node) ?? null;

  const bez = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  const toSvg = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  };

  /* ── drag-wire gesture (press port → drag → release on target) ── */
  const beginDrag = (port: PortSpec, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const { x, y } = toSvg(e.clientX, e.clientY);
    if (port.side === 'out' && wires[port.node]) {
      // re-aim this port's wire at a new destination (void = disconnect)
      setDrag({ fixed: port, need: 'in', original: port.node, x, y, moved: false });
    } else if (port.side === 'in' && wireOfIn(port.node)) {
      // pick up the in end: the out end stays fixed
      const from = wireOfIn(port.node)!;
      const fixed = portByKey(`out:${from}`);
      if (fixed) setDrag({ fixed, need: 'in', original: from, x, y, moved: false });
    } else {
      // start a new wire from this empty port
      setDrag({ fixed: port, need: port.side === 'out' ? 'in' : 'out', original: null, x, y, moved: false });
    }
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const { x, y } = toSvg(e.clientX, e.clientY);
      setDrag((d) => (d ? { ...d, x, y, moved: d.moved || Math.hypot(x - d.x, y - d.y) > 6 } : d));
    };
    const onUp = (e: MouseEvent) => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      const { x, y } = toSvg(e.clientX, e.clientY);
      // nearest compatible port within reach (port sides enforced here)
      let best: PortSpec | null = null;
      let bestDist = 20;
      for (const p of ports) {
        if (p.side !== d.need || p.node === d.fixed.node) continue;
        const dist = Math.hypot(p.x - x, p.y - y);
        if (dist < bestDist) { bestDist = dist; best = p; }
      }
      if (best) {
        const from = d.need === 'in' ? d.fixed.node : best.node;
        const to = d.need === 'in' ? best.node : d.fixed.node;
        if (d.original && d.original !== from) onDisconnect(d.original);
        onConnect(from, to);
      } else if (d.original && d.moved) {
        // released in the void (or back where it started): disconnect
        onDisconnect(d.original);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!drag]);

  const panel = isDayMode ? '#fbfaf7' : 'var(--syn-ink-900)';
  const subInk = isDayMode ? '#8a8578' : '#6b6b78';
  const nodeFill = isDayMode ? '#ffffff' : 'var(--syn-ink-800)';
  const nodeStroke = isDayMode ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)';

  const chainCount = ordered.filter(enabledOf).length;
  const anyEnabled = chainCount > 0;

  const portColor = (p: PortSpec): string => (p.node === 'IN' ? INPUT_COLOR : p.node === 'OUT' ? OUTPUT_COLOR : EFFECT_META[p.node as ModuleId].color);
  const isWired = (p: PortSpec) => (p.side === 'out' ? !!wires[p.node] : !!wireOfIn(p.node));

  const Port = ({ p }: { p: PortSpec }) => {
    const hovered = hoverPort === p.key;
    const wired = isWired(p);
    const targetable = drag ? p.side === drag.need && p.node !== drag.fixed.node : false;
    return (
      <g
        style={{ cursor: 'crosshair' }}
        data-testid={`port-${p.side}-${p.node}`}
        onMouseEnter={() => setHoverPort(p.key)}
        onMouseLeave={() => setHoverPort((h) => (h === p.key ? null : h))}
        onMouseDown={(e) => beginDrag(p, e)}
      >
        {/* generous invisible hit-area */}
        <circle cx={p.x} cy={p.y} r={12} fill="transparent" />
        {targetable && <circle cx={p.x} cy={p.y} r={9} fill="none" stroke={portColor(p)} strokeWidth="1" opacity="0.5" />}
        <circle
          cx={p.x}
          cy={p.y}
          r={hovered || targetable ? 5.5 : 4}
          fill={wired ? portColor(p) : 'transparent'}
          stroke={wired ? '#000000' : portColor(p)}
          strokeWidth={wired ? 1 : 1.4}
        />
        {wired && <circle cx={p.x} cy={p.y} r={1.6} fill="#000000" />}
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
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-[9px] font-mono text-neutral-500 relative">
            <button
            type="button"
            data-testid="nodal-add"
            onClick={() => setAddOpen((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded-md border transition-colors cursor-pointer ${
              isDayMode
                ? 'border-neutral-300 text-neutral-600 hover:border-violet-500/50 hover:text-violet-600'
                : 'border-ink-700 text-neutral-400 hover:border-violet-500/50 hover:text-violet-500'
            }`}
          >
            <Plus className="w-3 h-3" /> Add Node
          </button>
          {addOpen && (
            <div
              data-testid="nodal-add-menu"
              className={`absolute left-0 top-7 z-30 w-52 rounded-lg border p-1.5 shadow-2xl ${
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
        <div className="flex items-center">
          {isStreaming ? (
            <span className={`flex items-center gap-1 text-[8px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded ${isDayMode ? 'bg-green-500/10 text-green-700 border border-green-500/30' : 'bg-green-500/10 text-green-400 border border-green-500/40'}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]" /> Active
            </span>
          ) : (
            <span className={`flex items-center gap-1 text-[8px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded ${isDayMode ? 'bg-neutral-500/10 text-neutral-600 border border-neutral-500/30' : 'bg-neutral-500/10 text-neutral-400 border border-neutral-500/40'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isDayMode ? 'bg-neutral-500/70' : 'bg-neutral-400/80'}`} /> Standby
            </span>
          )}
        </div>
      </div>
      {/* node canvas */}
      <div ref={wrapRef} className="flex-1 min-h-0 relative" onClick={() => setAddOpen(false)}>
        <svg
          ref={svgRef}
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

          {/* ── wires (hidden while their end is being dragged) ── */}
          {Object.entries(wires).map(([from, to]) => {
            if (drag?.original === from) return null;
            const a = portByKey(`out:${from}`);
            const b = portByKey(`in:${to}`);
            if (!a || !b) return null;
            const color = portColor(a);
            return (
              <g key={`wire-${from}`} data-testid={`wire-${from}`}>
                <path d={bez(a.x, a.y, b.x, b.y)} fill="none" stroke={color} strokeWidth="1.8" opacity="0.85" />
                <path d={bez(a.x, a.y, b.x, b.y)} fill="none" stroke={color} strokeWidth="1.8" className="node-flow" opacity="0.9" />
              </g>
            );
          })}

          {/* ── ghost wire while dragging ── */}
          {drag && (
            <path
              d={
                drag.need === 'in'
                  ? bez(drag.fixed.x, drag.fixed.y, drag.x, drag.y)
                  : bez(drag.x, drag.y, drag.fixed.x, drag.fixed.y)
              }
              fill="none"
              stroke={portColor(drag.fixed)}
              strokeWidth="1.6"
              strokeDasharray="5 4"
              opacity="0.7"
            />
          )}

          {/* ── INPUT node (right port only) ── */}
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

          {/* ── OUTPUT node (left port only) ── */}
          <g style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); onOpenLab(); }} data-testid="nodal-output">
            <rect x={outX} y={outY} width={OUT_W} height={OUT_H} rx="10" fill={nodeFill} stroke={OUTPUT_COLOR} strokeWidth="1.3" opacity={anyEnabled ? 1 : 0.55} />
            <rect x={outX + OUT_W - 3.5} y={outY} width="3.5" height={OUT_H} rx="1.5" fill={OUTPUT_COLOR} />
            <circle cx={outX + 16} cy={outY + 17} r="3" fill={OUTPUT_COLOR} />
            <text x={outX + 26} y={outY + 20} fontFamily="var(--syn-font-mono)" fontSize="9.5" fontWeight="700" fill={isDayMode ? '#1a1a1a' : '#f4f2ee'} letterSpacing="0.5">OUTPUT</text>
            <text x={outX + 12} y={outY + 36} fontFamily="var(--syn-font-mono)" fontSize="7.5" fill={subInk}>Main Comp</text>
            <text x={outX + 12} y={outY + 49} fontFamily="var(--syn-font-mono)" fontSize="7" fill={OUTPUT_COLOR} opacity="0.8" data-testid="nodal-chain-count">
              {anyEnabled ? `${chainCount} fx · live` : 'passthrough'}
            </text>
          </g>

          {/* ── effect nodes (ghosted at ~50% when off the chain) ── */}
          {ordered.map((id, i) => {
            const meta = EFFECT_META[id];
            const on = enabledOf(id);
            const y = fxRow(i);
            return (
              <g key={`node-${id}`} data-testid={`nodal-node-${id}`} opacity={on ? 1 : 0.5}>
                <g
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); onOpenLab(); }}
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
                    data-testid={`nodal-state-${id}`}
                  >
                    {on ? 'ACTIVE' : 'BYPASS'}
                  </text>
                </g>

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

          {/* ports drawn last so they sit above nodes & wires */}
          {ports.map((p) => (
            <Port key={p.key} p={p} />
          ))}
        </svg>
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
