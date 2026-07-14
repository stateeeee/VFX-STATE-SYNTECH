import React, { useRef, useEffect, useState } from 'react';
import { ModuleConfig, ModuleId, SignalSource } from '../types';

interface VfxCanvasProps {
  activeModule: ModuleId;
  setActiveModule: (id: ModuleId) => void;
  /** Invoked on hub-node click; the shell opens the real effect if one exists */
  onModuleOpen?: (id: ModuleId) => void;
  modules: ModuleConfig[];
  signalSource: SignalSource;
  isStreaming: boolean;
  isDayMode?: boolean;
  /** Current signal chain built by linking hub nodes (PLAN.md phase 5) */
  chain?: ModuleId[];
  /** Drag released from one hub onto another: link them into the chain */
  onChainLink?: (from: ModuleId, to: ModuleId) => void;
  /** Open the Ai Lab with the current chain */
  onChainOpen?: () => void;
  onChainClear?: () => void;
}

interface GraphNode {
  id: string;
  moduleId?: ModuleId; // If it's a primary hub node
  label?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  size: number;
  baseSize: number;
  color: string;
  glow: string;
  pulseSpeed: number;
  pulsePhase: number;
}

interface GraphEdge {
  source: number; // Index of source node
  target: number; // Index of target node
  activeColor: string;
  inactiveColor: string;
}

export default function VfxCanvas({
  activeModule,
  setActiveModule,
  onModuleOpen,
  modules,
  signalSource,
  isStreaming,
  isDayMode = false,
  chain,
  onChainLink,
  onChainOpen,
  onChainClear,
}: VfxCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);

  // Latest callbacks/state, readable from inside the long-lived render loop closure
  const onModuleOpenRef = useRef(onModuleOpen);
  onModuleOpenRef.current = onModuleOpen;
  const onChainLinkRef = useRef(onChainLink);
  onChainLinkRef.current = onChainLink;
  const chainRef = useRef(chain);
  chainRef.current = chain;

  // Mouse coordinates tracking + hub link-drag state (index of drag source hub)
  const mouseRef = useRef({ x: -1000, y: -1000, pressed: false, released: false, downX: 0, downY: 0 });
  const dragFromRef = useRef(-1);

  // Audio state
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [micActive, setMicActive] = useState(false);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);

  // Initialize Microphone Audio Context
  useEffect(() => {
    if (signalSource === 'MIC_AUDIO_03' && isStreaming) {
      const initMic = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamRef.current = stream;

          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          const audioCtx = new AudioContextClass();
          audioContextRef.current = audioCtx;

          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          analyserRef.current = analyser;

          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(analyser);
          sourceRef.current = source;

          setMicActive(true);
          setMicPermissionDenied(false);
        } catch (err) {
          console.warn('Microphone access was dismissed or is not available. Safely falling back to procedural audio generator:', err);
          setMicActive(false);
          setMicPermissionDenied(true);
        }
      };
      initMic();
    } else {
      cleanupMic();
    }

    return () => {
      cleanupMic();
    };
  }, [signalSource, isStreaming]);

  const cleanupMic = () => {
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setMicActive(false);
  };

  // Mouse event handlers for interactive node dots
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    mouseRef.current.x = e.clientX - rect.left;
    mouseRef.current.y = e.clientY - rect.top;
  };

  const handleMouseLeave = () => {
    mouseRef.current.x = -1000;
    mouseRef.current.y = -1000;
    mouseRef.current.pressed = false;
    dragFromRef.current = -1;
  };

  const handleMouseDown = () => {
    mouseRef.current.pressed = true;
    mouseRef.current.downX = mouseRef.current.x;
    mouseRef.current.downY = mouseRef.current.y;
  };

  const handleMouseUp = () => {
    mouseRef.current.pressed = false;
    mouseRef.current.released = true;
  };

  // Canvas drawing loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // design tokens (phase 6 / decision #3): the canvas-drawn graph follows
    // --syn-* just like the DOM, so a re-skin recolors it with no code change
    const hexToRgbStr = (hex: string): string => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
      if (!m) return '212, 175, 55';
      const n = parseInt(m[1], 16);
      return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
    };
    let ACCENT = '#D4AF37';
    let ACCENT_RGB = '212, 175, 55';
    let ACCENT_DIM = '#8a6e2f';
    let ACCENT_DIM_RGB = '138, 110, 47';
    let ACCENT_DEEP = '#513d1e';
    let ACCENT_NIGHT = '#2c200e';
    let BG = '#050505';
    const readTokens = (): boolean => {
      const cs = getComputedStyle(document.documentElement);
      const g = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
      const prev = ACCENT;
      ACCENT = g('--syn-accent', ACCENT);
      ACCENT_RGB = hexToRgbStr(ACCENT);
      ACCENT_DIM = g('--syn-accent-700', ACCENT_DIM);
      ACCENT_DIM_RGB = hexToRgbStr(ACCENT_DIM);
      ACCENT_DEEP = g('--syn-accent-900', ACCENT_DEEP);
      ACCENT_NIGHT = g('--syn-accent-950', ACCENT_NIGHT);
      BG = g('--syn-bg', BG);
      return ACCENT !== prev;
    };
    readTokens();
    const ga = (a: number) => `rgba(${ACCENT_RGB}, ${a})`;
    const gd = (a: number) => `rgba(${ACCENT_DIM_RGB}, ${a})`;

    let width = canvas.width;
    let height = canvas.height;

    // Handle resizing using ResizeObserver
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        canvas.width = w * window.devicePixelRatio;
        canvas.height = h * window.devicePixelRatio;
        width = canvas.width;
        height = canvas.height;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      }
    });

    if (canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement);
    }

    // -------------------------------------------------------------
    // INITIALIZE OBSIDIAN GRAPH VIEW NODE CONSTALLATIONS
    // -------------------------------------------------------------
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    let pulses: {
      sourceIdx: number;
      targetIdx: number;
      progress: number;
      speed: number;
      type: 'core_to_hub' | 'hub_to_sat';
    }[] = [];

    let nodeFlashIntensity = new Float32Array(800);
    let coreSwell = 0;

    const initializeGraph = (w: number, h: number) => {
      nodes.length = 0;
      edges.length = 0;
      pulses = [];
      nodeFlashIntensity.fill(0);
      coreSwell = 0;

      const cx = w / 2;
      const cy = h / 2;

      // Define our 5 main Hubs (representing active modules in the network)
      const hubsConfig: { id: ModuleId; label: string; angle: number; dist: number; color: string; glow: string }[] = [
        { id: 'blob_tracker', label: 'BLOB TRACKER', angle: -Math.PI / 4 - 0.2, dist: 120, color: '#ffffff', glow: ACCENT },
        { id: 'analog', label: 'ANALOG', angle: Math.PI / 4 + 0.1, dist: 130, color: '#ffffff', glow: ACCENT },
        { id: 'blob_reveal', label: 'BLOB REVEAL', angle: Math.PI - 0.5, dist: 140, color: '#ffffff', glow: ACCENT },
        { id: 'bokeh', label: 'BOKEH', angle: -Math.PI / 2 - 0.3, dist: 125, color: '#ffffff', glow: ACCENT },
        { id: 'anamorphic_lab', label: 'ANAMORPHIC LAB', angle: Math.PI + 0.4, dist: 110, color: '#ffffff', glow: ACCENT },
      ];

      // Add central master core node representing the root index.md / Obsidian Vault main core
      const coreIdx = 0;
      nodes.push({
        id: 'system_core',
        label: 'VFX SYNTECH',
        x: cx,
        y: cy,
        vx: 0,
        vy: 0,
        targetX: cx,
        targetY: cy,
        size: 9,
        baseSize: 9,
        color: '#ffffff',
        glow: ACCENT,
        pulseSpeed: 0.02,
        pulsePhase: 0,
      });

      // Create primary hubs
      hubsConfig.forEach((hub, i) => {
        const hx = cx + Math.cos(hub.angle) * hub.dist;
        const hy = cy + Math.sin(hub.angle) * hub.dist;
        const hubIdx = nodes.length;

        nodes.push({
          id: hub.id,
          moduleId: hub.id,
          label: hub.label,
          x: hx + (Math.random() - 0.5) * 50,
          y: hy + (Math.random() - 0.5) * 50,
          vx: 0,
          vy: 0,
          targetX: hx,
          targetY: hy,
          size: 6.5,
          baseSize: 6.5,
          color: hub.color,
          glow: hub.glow,
          pulseSpeed: 0.03 + i * 0.005,
          pulsePhase: Math.random() * Math.PI,
        });

        // Link Hub to Central Core
        edges.push({
          source: coreIdx,
          target: hubIdx,
          activeColor: ga(0.45),
          inactiveColor: ga(0.15),
        });

        // Generate satellite clusters branching out from this hub
        const numSatellites = 14 + Math.floor(Math.random() * 6); // 14 to 20 subnodes per module
        for (let s = 0; s < numSatellites; s++) {
          const satAngle = hub.angle + (Math.random() - 0.5) * (Math.PI / 1.5);
          const satDist = 40 + Math.random() * 75;
          const sx = hx + Math.cos(satAngle) * satDist;
          const sy = hy + Math.sin(satAngle) * satDist;
          const satIdx = nodes.length;

          // Color palette containing Obsidian neon gold, warm amber, soft grey, and white sparkles
          const isGoldSpark = Math.random() > 0.4;
          const nodeColor = isGoldSpark ? ACCENT : ACCENT_DIM;
          const sizeVal = 1.8 + Math.random() * 2.2;

          nodes.push({
            id: `${hub.id}_sat_${s}`,
            x: sx + (Math.random() - 0.5) * 20,
            y: sy + (Math.random() - 0.5) * 20,
            vx: 0,
            vy: 0,
            targetX: sx,
            targetY: sy,
            size: sizeVal,
            baseSize: sizeVal,
            color: nodeColor,
            glow: isGoldSpark ? ACCENT : ga(0.2),
            pulseSpeed: 0.01 + Math.random() * 0.02,
            pulsePhase: Math.random() * Math.PI * 2,
          });

          // Link satellite to its master hub
          edges.push({
            source: hubIdx,
            target: satIdx,
            activeColor: ga(0.35),
            inactiveColor: ga(0.08),
          });

          // Occasional cross-connections between sibling satellites to form organic cluster mesh
          if (s > 0 && Math.random() > 0.75) {
            edges.push({
              source: satIdx,
              target: satIdx - 1,
              activeColor: ga(0.25),
              inactiveColor: ga(0.04),
            });
          }
        }
      });

      // Generate a few rogue/unconnected isolated floating stars for that dynamic galaxy backdrop
      const numRogue = 15;
      for (let r = 0; r < numRogue; r++) {
        const rx = Math.random() * w;
        const ry = Math.random() * h;
        nodes.push({
          id: `rogue_${r}`,
          x: rx,
          y: ry,
          vx: 0,
          vy: 0,
          targetX: rx,
          targetY: ry,
          size: 1.2 + Math.random() * 1.5,
          baseSize: 1.2 + Math.random() * 1.5,
          color: ACCENT_DEEP,
          glow: ga(0.08),
          pulseSpeed: 0.01,
          pulsePhase: Math.random() * Math.PI,
        });
      }
    };

    // Trigger initial setup with reasonable defaults
    initializeGraph(600, 400);

    let frameCount = 0;
    // press edge latch: a link-drag only arms when the press STARTS on a hub
    let pressArmed = false;

    const render = () => {
      frameCount++;
      const w = canvas.width / window.devicePixelRatio;
      const h = canvas.height / window.devicePixelRatio;

      // live re-skin: when the accent token changes, rebuild stored node colors
      if (frameCount % 60 === 0 && readTokens()) {
        initializeGraph(w, h);
      }

      // Recalibrate node targets dynamically if viewport dimensions change dramatically
      if (nodes.length > 0 && Math.abs(nodes[0].targetX - w / 2) > 5) {
        initializeGraph(w, h);
      }

      // Clear with absolute deep pitch obsidian background or clean light warm cream background
      ctx.fillStyle = isDayMode ? '#fbfaf7' : BG;
      ctx.fillRect(0, 0, w, h);

      // Render fine tech grid background to reinforce system blueprints
      ctx.strokeStyle = isDayMode ? '#f0ede6' : '#0d0d0d'; // extremely faint
      ctx.lineWidth = 0.5;
      const gridSize = 40;
      for (let x = 0; x < w; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Check if engine is online
      if (!isStreaming) {
        ctx.fillStyle = isDayMode ? ga(0.05) : ga(0.02);
        for (let i = 0; i < 5; i++) {
          const rh = Math.random() * 3 + 1;
          const ry = Math.random() * h;
          ctx.fillRect(0, ry, w, rh);
        }

        ctx.font = '9px var(--font-mono)';
        ctx.fillStyle = isDayMode ? '#8a6e33' : ACCENT_DEEP;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('ENGINE STANDBY // CONSTALLATION GRAPH SLEEPING', w / 2, h / 2 - 15);
        ctx.fillText('CLICK "INITIALIZE STREAM" TO ACTIVATE OBSIDIAN CHANNELS', w / 2, h / 2 + 5);

        // Standby scoping baseline
        ctx.strokeStyle = isDayMode ? '#c8baa0' : ACCENT_NIGHT;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(30, h / 2);
        for (let x = 30; x < w - 30; x += 1.5) {
          const noise = Math.sin(x * 0.04 + frameCount * 0.015) * 1.2;
          ctx.lineTo(x, h / 2 + noise);
        }
        ctx.stroke();

        animationRef.current = requestAnimationFrame(render);
        return;
      }

      // Read real microphone data or process dynamic simulation levels
      let audioBuffer = new Uint8Array(128);
      if (micActive && analyserRef.current) {
        analyserRef.current.getByteFrequencyData(audioBuffer);
      } else {
        const speedFactor = signalSource === 'GOLD_NOISE_04' ? 0.35 : 0.07;
        for (let i = 0; i < 128; i++) {
          let val = 0;
          if (signalSource === 'GOLD_NOISE_04') {
            val = Math.sin(i * 0.12 + frameCount * speedFactor) * 25 + (Math.random() * 20);
          } else if (signalSource === 'R_INPUT_CHANNEL_02') {
            val = Math.sin(i * 0.06 + frameCount * speedFactor) * 45 + Math.cos(i * 0.15 - frameCount * 0.05) * 15;
          } else {
            val = Math.sin(i * 0.04 + frameCount * speedFactor) * 60 + Math.sin(i * 0.1) * 10;
          }
          audioBuffer[i] = Math.max(0, Math.min(255, val + 50));
        }
      }

      // Music amplitude impact factor
      const amplitudeFactor = (audioBuffer[10] || 0) / 255.0; // 0.0 to 1.0

      // -------------------------------------------------------------
      // CORE HEARTBEAT & ENERGETIC SIGNAL PROPAGATION SYSTEM
      // -------------------------------------------------------------
      // Dynamic organic heartbeat curve: 160 frame cycle (~2.6 seconds)
      const beatPhase = frameCount % 160;
      if (beatPhase < 24) {
        // Smoothly rises to peak over 24 frames using a cosine curve (ease-in-out)
        const t = beatPhase / 24;
        coreSwell = 0.5 - 0.5 * Math.cos(t * Math.PI);
      } else {
        // Slow natural exponential relaxation back to zero
        const t = (beatPhase - 24) / 136;
        coreSwell = Math.exp(-t * 3.8); // very smooth decay
      }

      // Trigger a system-wide heartbeat pulse when the core reaches peak swell
      if (beatPhase === 24) {
        nodes.forEach((n, idx) => {
          if (n.moduleId) { // If it's one of the primary Hubs
            pulses.push({
              sourceIdx: 0,
              targetIdx: idx,
              progress: 0,
              speed: 0.015, // elegant, slow-drifting pulse propagation
              type: 'core_to_hub'
            });
          }
        });
      }

      // Update and propagate energy pulses
      const remainingPulses: typeof pulses = [];
      pulses.forEach((p) => {
        p.progress += p.speed;
        if (p.progress >= 1.0) {
          // Pulse reached its destination
          if (p.type === 'core_to_hub') {
            // High energy arrival: flash the Hub
            nodeFlashIntensity[p.targetIdx] = 1.0;
            // Instantly branch the energy to all its connected satellites
            edges.forEach((e) => {
              if (e.source === p.targetIdx) {
                pulses.push({
                  sourceIdx: e.source,
                  targetIdx: e.target,
                  progress: 0,
                  speed: 0.035, // fast but smooth spread across sub-branches
                  type: 'hub_to_sat'
                });
              }
            });
          } else {
            // Pulse reached satellite sub-branch node: flash it
            nodeFlashIntensity[p.targetIdx] = 1.0;
          }
        } else {
          remainingPulses.push(p);
        }
      });
      pulses = remainingPulses;

      // Decay all node flash intensities smoothly back to baseline (slow decay for soft glow)
      for (let i = 0; i < nodeFlashIntensity.length; i++) {
        nodeFlashIntensity[i] *= 0.94;
      }

      // -------------------------------------------------------------
      // PHYSICAL FORCE-DIRECTED SPRING PHYSICS LOOP
      // -------------------------------------------------------------
      const cx = w / 2;
      const cy = h / 2;

      // Update positions of central nodes
      if (nodes.length > 0) {
        nodes[0].targetX = cx;
        nodes[0].targetY = cy;
      }

      // Gentle force directed spring loop
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];

        // Core drifts slightly on music frequency trigger
        const frequencyVibe = Math.sin(frameCount * 0.08 + i * 0.5) * (amplitudeFactor * 5);

        // 1. Return to base target position using spring tension
        const dx = node.targetX - node.x;
        const dy = node.targetY - node.y;
        node.vx += dx * 0.012;
        node.vy += dy * 0.012;

        // 2. Interactive mouse push / repeller field.
        //    Hubs are click targets: they must not flee entirely, so we apply a weaker force to them.
        const mdx = node.x - mouseRef.current.x;
        const mdy = node.y - mouseRef.current.y;
        const mdist = Math.hypot(mdx, mdy);
        if (mdist < 80) {
          const isHub = !!node.moduleId || node.id === 'system_core';
          const forceMult = isHub ? 0.4 : 1.5;
          const repelForce = (1 - mdist / 80) * forceMult;
          node.vx += (mdx / (mdist || 1)) * repelForce;
          node.vy += (mdy / (mdist || 1)) * repelForce;
           
           
        }

        // 3. Audio vibration
        node.vx += (Math.random() - 0.5) * (amplitudeFactor * 0.8);
        node.vy += (Math.random() - 0.5) * (amplitudeFactor * 0.8);

        // Apply friction
        node.vx *= 0.88;
        node.vy *= 0.88;

        // Step coordinates
        node.x += node.vx;
        node.y += node.vy;

        // Pulsing dynamic node sizes
        const pVal = Math.sin(frameCount * node.pulseSpeed + node.pulsePhase) * 0.35 + 0.65;
        node.size = node.baseSize * (1 + pVal * 0.15 + (amplitudeFactor * 0.35));
      }

      // -------------------------------------------------------------
      // HOVER INTERACTIVE NODE DETECTION
      // -------------------------------------------------------------
      let hoveredNodeIdx = -1;
      let minHoverDist = 32; // maximum interactive click range

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.moduleId) { // Only click primary Module Hubs
          const dist = Math.hypot(node.x - mouseRef.current.x, node.y - mouseRef.current.y);
          if (dist < minHoverDist) {
            minHoverDist = dist;
            hoveredNodeIdx = i;
          }
        }
      }

      // -------------------------------------------------------------
      // HUB LINK-DRAG STATE MACHINE (PLAN.md phase 5: linking two hub
      // nodes on the brain graph creates the effect chain). A press on
      // a hub arms a drag; releasing on another hub links them, while
      // releasing in place (a plain click) opens the effect as before.
      // -------------------------------------------------------------
      if (mouseRef.current.pressed && !pressArmed) {
        pressArmed = true;
        if (hoveredNodeIdx !== -1) dragFromRef.current = hoveredNodeIdx;
      } else if (!mouseRef.current.pressed && pressArmed && !mouseRef.current.released) {
        pressArmed = false;
      }
      if (mouseRef.current.released) {
        const fromIdx = dragFromRef.current;
        if (fromIdx !== -1 && nodes[fromIdx]?.moduleId) {
          const moved = Math.hypot(
            mouseRef.current.x - mouseRef.current.downX,
            mouseRef.current.y - mouseRef.current.downY
          );
          if (hoveredNodeIdx !== -1 && hoveredNodeIdx !== fromIdx && nodes[hoveredNodeIdx].moduleId) {
            onChainLinkRef.current?.(nodes[fromIdx].moduleId!, nodes[hoveredNodeIdx].moduleId!);
          } else if (moved < 6 && hoveredNodeIdx === fromIdx) {
            setActiveModule(nodes[fromIdx].moduleId!);
            onModuleOpenRef.current?.(nodes[fromIdx].moduleId!);
          }
        }
        dragFromRef.current = -1;
        mouseRef.current.released = false;
        pressArmed = false;
      }

      const isLinkDragging = dragFromRef.current !== -1 && mouseRef.current.pressed;
      canvas.style.cursor = isLinkDragging ? 'crosshair' : hoveredNodeIdx !== -1 ? 'pointer' : 'default';

      const activeHubNode = nodes.find((n) => n.moduleId === activeModule);

      // -------------------------------------------------------------
      // DRAW EDGES (THE CONSTALLATION WEB FILAMENTS)
      // -------------------------------------------------------------
      ctx.lineWidth = 0.5;
      edges.forEach((edge) => {
        const srcNode = nodes[edge.source];
        const tgtNode = nodes[edge.target];

        const getHubId = (n: GraphNode): string | undefined => {
          if (n.moduleId) return n.moduleId;
          return ['blob_tracker', 'analog', 'blob_reveal', 'bokeh', 'anamorphic_lab'].find(id => n.id.startsWith(id));
        };

        const srcHubId = getHubId(srcNode);
        const tgtHubId = getHubId(tgtNode);
        const filamentHubId = srcHubId || tgtHubId;

        const isActiveFilament = filamentHubId === activeModule;

        ctx.beginPath();
        ctx.moveTo(srcNode.x, srcNode.y);
        ctx.lineTo(tgtNode.x, tgtNode.y);

        if (isActiveFilament) {
          // Glow filaments bright gold on active module selection
          ctx.strokeStyle = isDayMode ? 'rgba(180, 140, 45, 0.75)' : ga(0.55);
          ctx.lineWidth = 1.0 + (amplitudeFactor * 0.6);
        } else if (filamentHubId) {
          // Other 4 modules have their connections beautifully visible with standard gold filaments
          ctx.strokeStyle = isDayMode ? 'rgba(180, 140, 45, 0.28)' : ga(0.18);
          ctx.lineWidth = 0.65;
        } else {
          // Extremely faint obsidian web structure otherwise
          ctx.strokeStyle = isDayMode ? gd(0.12) : gd(0.06);
          ctx.lineWidth = 0.45;
        }
        ctx.stroke();

        // Pulsing electric signal impulses traversing along the filaments (fade-in and fade-out smoothly, continuous flow)
        if (isActiveFilament) {
          const travelProg = (frameCount % 75) / 75;
          const px = srcNode.x + (tgtNode.x - srcNode.x) * travelProg;
          const py = srcNode.y + (tgtNode.y - srcNode.y) * travelProg;
          const alpha = Math.sin(travelProg * Math.PI); // Smooth organic sine envelope (0 -> 1 -> 0)
          ctx.beginPath();
          ctx.arc(px, py, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = isDayMode ? `rgba(180, 100, 20, ${alpha * 0.95})` : `rgba(255, 255, 255, ${alpha * 0.95})`;
          ctx.fill();
        } else if (filamentHubId) {
          // Desynchronize the ambient signals using a unique offset for each edge index
          const edgeOffset = (edge.source * 17 + edge.target * 31) % 110;
          const travelProg = ((frameCount + edgeOffset) % 110) / 110;
          const px = srcNode.x + (tgtNode.x - srcNode.x) * travelProg;
          const py = srcNode.y + (tgtNode.y - srcNode.y) * travelProg;
          const alpha = Math.sin(travelProg * Math.PI) * 0.5; // Smooth subtle glow
          ctx.beginPath();
          ctx.arc(px, py, 0.85, 0, Math.PI * 2);
          ctx.fillStyle = isDayMode ? `rgba(180, 100, 20, ${alpha})` : ga(alpha);
          ctx.fill();
        }
      });

      // -------------------------------------------------------------
      // DRAW TRAVELING HEARTBEAT PULSES (White center with outer halo, smooth fade transitions)
      // -------------------------------------------------------------
      pulses.forEach((p) => {
        const srcNode = nodes[p.sourceIdx];
        const tgtNode = nodes[p.targetIdx];
        if (!srcNode || !tgtNode) return;

        const px = srcNode.x + (tgtNode.x - srcNode.x) * p.progress;
        const py = srcNode.y + (tgtNode.y - srcNode.y) * p.progress;

        // Smooth fade-in at start, fade-out at end to merge seamlessly
        let pulseAlpha = 1.0;
        if (p.progress < 0.2) {
          pulseAlpha = p.progress / 0.2;
        } else if (p.progress > 0.8) {
          pulseAlpha = (1.0 - p.progress) / 0.2;
        }

        const outerAlpha = (p.type === 'core_to_hub' ? 0.75 : 0.6) * pulseAlpha;
        const innerAlpha = pulseAlpha;

        // Draw outer ring/halo circle
        ctx.strokeStyle = p.type === 'core_to_hub' 
          ? (isDayMode ? `rgba(180, 100, 20, ${outerAlpha})` : `rgba(255, 255, 255, ${outerAlpha})`)
          : ga(outerAlpha);
        ctx.lineWidth = p.type === 'core_to_hub' ? 1.0 : 0.75;
        ctx.beginPath();
        ctx.arc(px, py, p.type === 'core_to_hub' ? 4.5 : 3.0, 0, Math.PI * 2);
        ctx.stroke();

        // Draw solid white inner dot
        ctx.fillStyle = isDayMode ? `rgba(180, 100, 20, ${innerAlpha})` : `rgba(255, 255, 255, ${innerAlpha})`;
        ctx.beginPath();
        ctx.arc(px, py, p.type === 'core_to_hub' ? 1.8 : 1.1, 0, Math.PI * 2);
        ctx.fill();
      });

      // -------------------------------------------------------------
      // DRAW THE SIGNAL CHAIN (bright persistent links between chained
      // hubs, flowing signal dots + arrowheads) AND THE LIVE LINK DRAG
      // -------------------------------------------------------------
      const chainIds = chainRef.current ?? [];
      for (let ci = 0; ci < chainIds.length - 1; ci++) {
        const a = nodes.find((n) => n.moduleId === chainIds[ci]);
        const b = nodes.find((n) => n.moduleId === chainIds[ci + 1]);
        if (!a || !b) continue;
        ctx.save();
        ctx.strokeStyle = isDayMode ? 'rgba(160, 118, 20, 0.9)' : ga(0.9);
        ctx.lineWidth = 1.8;
        ctx.shadowColor = ACCENT;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.shadowBlur = 0;
        // direction arrowhead at 62% of the link
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const axp = a.x + (b.x - a.x) * 0.62;
        const ayp = a.y + (b.y - a.y) * 0.62;
        ctx.fillStyle = isDayMode ? '#a07614' : ACCENT;
        ctx.beginPath();
        ctx.moveTo(axp + Math.cos(ang) * 6, ayp + Math.sin(ang) * 6);
        ctx.lineTo(axp + Math.cos(ang + 2.5) * 5, ayp + Math.sin(ang + 2.5) * 5);
        ctx.lineTo(axp + Math.cos(ang - 2.5) * 5, ayp + Math.sin(ang - 2.5) * 5);
        ctx.closePath();
        ctx.fill();
        // flowing signal dot
        const flow = ((frameCount + ci * 30) % 60) / 60;
        const fx = a.x + (b.x - a.x) * flow;
        const fy = a.y + (b.y - a.y) * flow;
        ctx.fillStyle = isDayMode ? `rgba(120, 80, 10, ${Math.sin(flow * Math.PI)})` : `rgba(255, 255, 255, ${Math.sin(flow * Math.PI)})`;
        ctx.beginPath();
        ctx.arc(fx, fy, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (isLinkDragging) {
        const fromNode = nodes[dragFromRef.current];
        if (fromNode) {
          ctx.save();
          ctx.strokeStyle = isDayMode ? 'rgba(160, 118, 20, 0.85)' : ga(0.85);
          ctx.lineWidth = 1.4;
          ctx.setLineDash([6, 5]);
          ctx.beginPath();
          ctx.moveTo(fromNode.x, fromNode.y);
          ctx.lineTo(mouseRef.current.x, mouseRef.current.y);
          ctx.stroke();
          ctx.setLineDash([]);
          // snap ring on the hovered target hub
          if (hoveredNodeIdx !== -1 && hoveredNodeIdx !== dragFromRef.current) {
            const tgt = nodes[hoveredNodeIdx];
            ctx.strokeStyle = isDayMode ? '#7a6538' : '#ffffff';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.arc(tgt.x, tgt.y, tgt.size + 9, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      // -------------------------------------------------------------
      // DRAW GRAPH NODES (SPARKLES & HUBS)
      // -------------------------------------------------------------
      nodes.forEach((node, i) => {
        const isHub = !!node.moduleId;
        const isSystemCore = node.id === 'system_core';
        const isSelectedActive = node.moduleId === activeModule;
        
        // Highlight active cluster satellites
        const isSatelliteOfActive = node.id.startsWith(activeModule ?? '');
        const flash = nodeFlashIntensity[i] || 0;

        // Dynamic swelling factor based on heartbeats and pulse arrivals
        let drawSize = node.size;
        if (isSystemCore) {
          drawSize = node.size * (1.0 + coreSwell * 0.4); // swell core up to 40%
        } else if (isHub) {
          drawSize = node.size * (1.0 + flash * 0.35); // swell hub up to 35% on arrival
        }

        ctx.save();

        if (isSystemCore) {
          // Central Core Nebula Glow with heartbeat pulse
          const glowSize = 22 + (amplitudeFactor * 15) + (coreSwell * 18);
          const nebGrad = ctx.createRadialGradient(node.x, node.y, 1, node.x, node.y, glowSize);
          nebGrad.addColorStop(0, ga(0.15 + coreSwell * 0.35));
          nebGrad.addColorStop(1, isDayMode ? 'rgba(251, 250, 247, 0)' : 'rgba(5, 5, 5, 0)');
          ctx.fillStyle = nebGrad;
          ctx.beginPath();
          ctx.arc(node.x, node.y, glowSize, 0, Math.PI * 2);
          ctx.fill();

          // Outer reticle halo ring around core (styled like selected module)
          ctx.strokeStyle = isDayMode ? '#7a6538' : '#ffffff';
          ctx.lineWidth = 1.0 + (coreSwell * 0.6);
          ctx.beginPath();
          ctx.arc(node.x, node.y, drawSize + 5 + Math.sin(frameCount * 0.08) * 1.5, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (isHub) {
          const isHovered = hoveredNodeIdx === i;
          // Obsidian Hub Glow with pulse arrival flash
          const glowRad = node.size * (isSelectedActive ? 3.5 : isHovered ? 3.0 : 2.5) + (amplitudeFactor * 6) + (flash * 15);
          const hubGrad = ctx.createRadialGradient(node.x, node.y, 1, node.x, node.y, glowRad);
          hubGrad.addColorStop(0, isSelectedActive 
            ? (isDayMode ? `rgba(180, 140, 45, ${0.45 + flash * 0.35})` : `rgba(255, 255, 255, ${0.45 + flash * 0.35})`)
            : isHovered
            ? (isDayMode ? `rgba(180, 140, 45, 0.35)` : `rgba(255, 255, 255, 0.35)`)
            : ga(0.15 + flash * 0.55)
          );
          hubGrad.addColorStop(1, isDayMode ? 'rgba(251, 250, 247, 0)' : 'rgba(5, 5, 5, 0)');
          
          ctx.fillStyle = hubGrad;
          ctx.beginPath();
          ctx.arc(node.x, node.y, glowRad, 0, Math.PI * 2);
          ctx.fill();

          // Outer reticle halo rings around Hubs (flashes white on pulse arrival or hover)
          ctx.strokeStyle = (isSelectedActive || isHovered || flash > 0.15) ? (isDayMode ? '#7a6538' : '#ffffff') : ga(0.25);
          ctx.lineWidth = (isSelectedActive || isHovered) ? 0.9 : 0.45 + (flash * 0.6);
          ctx.beginPath();
          ctx.arc(node.x, node.y, drawSize + 4 + Math.sin(frameCount * 0.05 + i) * 1.5, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (isSystemCore) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, drawSize, 0, Math.PI * 2);
          ctx.fillStyle = isDayMode ? '#7a6538' : '#ffffff'; // White/dark solid dot
          ctx.fill();
        } else if (isHub) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, drawSize, 0, Math.PI * 2);
          ctx.fillStyle = (isSelectedActive || flash > 0.4) ? (isDayMode ? '#5e4e2b' : '#ffffff') : ACCENT;
          ctx.fill();
        } else {
          // Satellite subnodes - Continuous smooth alpha-blended transition for energy flash (no branch popping!)
          const baseColor = isSatelliteOfActive 
            ? (isDayMode ? 'rgba(180, 150, 60, 0.9)' : 'rgba(235, 214, 125, 0.9)') 
            : (node.color || (isDayMode ? 'rgba(160, 150, 135, 0.55)' : 'rgba(120, 110, 95, 0.45)'));
          
          if (flash > 0.005) {
            // 1. Soft outer energy glow aura (grows and fades continuously with flash)
            const glowSize = drawSize + flash * 5.0;
            ctx.beginPath();
            ctx.arc(node.x, node.y, glowSize, 0, Math.PI * 2);
            ctx.fillStyle = ga(flash * 0.65);
            ctx.fill();

            // 2. Draw standard base color dot
            ctx.beginPath();
            ctx.arc(node.x, node.y, drawSize, 0, Math.PI * 2);
            ctx.fillStyle = baseColor;
            ctx.fill();

            // 3. Highlight white energetic core overlay
            ctx.beginPath();
            ctx.arc(node.x, node.y, drawSize, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${flash})`;
            ctx.fill();
          } else {
            // Draw standard base color dot
            ctx.beginPath();
            ctx.arc(node.x, node.y, drawSize, 0, Math.PI * 2);
            ctx.fillStyle = baseColor;
            ctx.fill();
          }
        }

        // -------------------------------------------------------------
        // NODE TEXT LABELS / LABELS (Draw beautifully in HUD cards)
        // -------------------------------------------------------------
        if (node.label) {
          const isCore = node.id === 'system_core';
          const drawLabel = isCore || isHub || (hoveredNodeIdx === i);

          if (drawLabel) {
            ctx.restore();
            ctx.save();
            
            // Layout placement parameters
            const labelYOffset = isCore ? -16 : 14;
            ctx.font = isCore ? 'bold 10px var(--font-mono)' : 'bold 9px var(--font-mono)';
            ctx.fillStyle = isSelectedActive || isCore ? (isDayMode ? '#000000' : '#ffffff') : ACCENT;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const textWidth = ctx.measureText(node.label).width;
            const padX = 6;
            const padY = 3.5;

            // Draw clean background pill container
            ctx.fillStyle = isDayMode ? 'rgba(255, 255, 255, 0.92)' : 'rgba(5, 5, 5, 0.85)';
            ctx.strokeStyle = isSelectedActive || isCore ? ACCENT : ga(0.4);
            ctx.lineWidth = 0.8;
            
            const rx = node.x - textWidth / 2 - padX;
            const ry = node.y + labelYOffset - 5 - padY;
            const rw = textWidth + padX * 2;
            const rh = 10 + padY * 2;

            ctx.beginPath();
            ctx.roundRect(rx, ry, rw, rh, 3);
            ctx.fill();
            ctx.stroke();

            // Text print
            ctx.fillStyle = isSelectedActive || isCore ? (isDayMode ? '#222222' : '#ffffff') : (isDayMode ? '#7a6538' : ACCENT);
            ctx.fillText(node.label, node.x, node.y + labelYOffset);
          }
        }

        ctx.restore();
      });

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      resizeObserver.disconnect();
    };
  }, [activeModule, modules, signalSource, isStreaming, micActive, isDayMode]);

  return (
    <div
      className="relative w-full h-full min-h-[300px] border border-gold-800/40 bg-[var(--syn-bg)] overflow-hidden rounded-md gold-glow-border"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />

      {/* Signal chain HUD: linking hub nodes builds the chain (phase 5) */}
      {chain && chain.length >= 2 && (
        <div
          data-testid="graph-chain-hud"
          className={`absolute left-1/2 -translate-x-1/2 bottom-3 flex items-center gap-3 px-3 py-2 rounded border font-mono text-[9px] uppercase tracking-widest ${
            isDayMode ? 'bg-white/90 border-gold-500/50 text-neutral-700' : 'bg-black/85 border-gold-500/40 text-neutral-300'
          }`}
        >
          <span className="text-gold-500 font-extrabold">CHAIN</span>
          <span data-testid="graph-chain-label">{chain.map((id) => id.replace(/_/g, ' ').toUpperCase()).join(' → ')}</span>
          <button
            type="button"
            data-testid="graph-chain-open"
            onClick={onChainOpen}
            className="px-2 py-1 rounded bg-gold-500 text-black font-bold hover:bg-gold-400 cursor-pointer"
          >
            Open Ai Lab
          </button>
          <button
            type="button"
            data-testid="graph-chain-clear"
            onClick={onChainClear}
            className="px-2 py-1 rounded border border-gold-500/40 text-gold-500 hover:bg-gold-500/10 cursor-pointer"
          >
            Clear
          </button>
        </div>
      )}

      {micPermissionDenied && signalSource === 'MIC_AUDIO_03' && (
        <div className="absolute inset-x-4 bottom-14 flex items-center gap-2 px-3 py-2 bg-red-950/80 border border-red-900/40 text-red-200 rounded font-mono text-xs">
          <span>⚠️ Access to microphone was denied. Using procedural generator.</span>
        </div>
      )}
    </div>
  );
}
