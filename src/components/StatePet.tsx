/* STATE PET — the 3D mascot that lives in the cage's bottom-right opening.
 *
 * Idle: it floats (bob + a slow sway). Hover: it spins a full turn, scales up
 * and keeps looking at the cursor; click makes it jump and turn. Press and hold
 * and it follows the mouse anywhere in the app (it is only a translate of its own
 * small canvas); let go and it springs back to its home in the opening, keeping
 * the speed it was thrown with. Leave it alone and it floats again.
 *
 * Cost: three.js is already in the main bundle (blob_tracker uses it); the 1.5 MB
 * mesh and the texture are fetched AFTER first paint (requestIdleCallback), the render loop idles at 30 fps and only runs at full rate while the
 * pet is being touched or is still settling, and it stops entirely while the
 * hero is fullscreen or the tab is hidden. The cage's frame-cost contract
 * (one image, nothing animated on top of the hero) is untouched: the pet is its
 * own small canvas.
 *
 * Mesh: public/assets/pet/state_pet.bin, flattened from the Meshy OBJ by
 * tools/pet/build-pet.cjs. Texture: public/assets/pet/state_pet.webp.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { HOLES } from '../cage/cage';

const MESH_URL = '/assets/pet/state_pet.bin';
const TEX_URL = '/assets/pet/state_pet.webp';

/** The opening's largest inscribed circle (measured from the artwork): the pet is
 *  centred on it and sized from it, so it follows the cage's stretch like every
 *  other section. The cage image's own ratio is 1.679:1. */
const SPOT = HOLES.paletteCircle;
const CAGE_RATIO = 1.679;
/** Figure height as a multiple of the circle's diameter, and the canvas side as a
 *  multiple of the figure height (room to float, spin and pop out of the hole). */
const PET_PER_DIAMETER = 0.8;
const CANVAS_PER_PET = 1.5;
/** Springs that bring a dragged pet home (stiffness, damping ratio < 1 = a little bounce). */
const HOME_K = 38;
const HOME_ZETA = 0.6;

const petPx = `min(${(2 * SPOT.r * PET_PER_DIAMETER * 100).toFixed(4)}vw, ${(2 * SPOT.r * CAGE_RATIO * PET_PER_DIAMETER * 100).toFixed(4)}vh)`;
const sidePx = `calc(${petPx} * ${CANVAS_PER_PET})`;

interface Props {
  isDayMode: boolean;
  /** stop rendering (hero fullscreen) */
  paused?: boolean;
}

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export default function StatePet({ isDayMode, paused = false }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const dayRef = useRef(isDayMode);
  const pausedRef = useRef(paused);
  dayRef.current = isDayMode;
  pausedRef.current = paused;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cleanup = () => {};

    const boot = async () => {
      const [meshBuf, tex] = await Promise.all([
        fetch(MESH_URL).then((r) => { if (!r.ok) throw new Error(`pet mesh ${r.status}`); return r.arrayBuffer(); }),
        new Promise<any>((res, rej) => new THREE.TextureLoader().load(TEX_URL, res, undefined, rej)),
      ]);
      if (disposed) { tex.dispose(); return; }

      /* ── renderer ── */
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;pointer-events:auto;';
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
      renderer.setClearColor(0x000000, 0);
      renderer.outputEncoding = THREE.sRGBEncoding;
      host.appendChild(canvas);

      /* ── mesh (header: u32 vertexCount, u32 indexCount; then pos, normal, uv, u16 indices) ── */
      const head = new Uint32Array(meshBuf, 0, 2);
      const n = head[0], ic = head[1];
      let off = 8;
      const pos = new Float32Array(meshBuf, off, n * 3); off += n * 12;
      const nor = new Float32Array(meshBuf, off, n * 3); off += n * 12;
      const uv = new Float32Array(meshBuf, off, n * 2); off += n * 8;
      const idx = new Uint16Array(meshBuf, off, ic);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingBox();
      const box = geo.boundingBox;
      const size = box.getSize(new THREE.Vector3());
      const mid = box.getCenter(new THREE.Vector3());
      geo.translate(-mid.x, -mid.y, -mid.z);
      const unit = 1 / size.y; // figure is 1 unit tall
      const figW = size.x * unit; // for the hover ellipse

      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      const mat = new THREE.MeshStandardMaterial({
        map: tex, roughness: 0.55, metalness: 0.08,
        emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.22,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.setScalar(unit);
      const pivot = new THREE.Group(); // yaw / pitch / roll / bob / scale live here
      pivot.add(mesh);

      /* ── contact shadow (night: a violet glow; day: a soft dark ellipse) ── */
      const sc = document.createElement('canvas'); sc.width = sc.height = 128;
      const sctx = sc.getContext('2d')!;
      const grd = sctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      sctx.fillStyle = grd; sctx.fillRect(0, 0, 128, 128);
      const shadowTex = new THREE.CanvasTexture(sc);
      const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.5 });
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = -0.56;

      /* ── scene ── */
      const scene = new THREE.Scene();
      scene.add(pivot, shadow);
      scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x3a2a66, 0.9));
      const key = new THREE.DirectionalLight(0xffffff, 1.15); key.position.set(1.6, 2.2, 3); scene.add(key);
      const rim = new THREE.PointLight(0x8b5cf6, 1.6, 8); rim.position.set(-2, 0.6, -1.4); scene.add(rim);
      const FOV = 28;
      const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
      const visH = CANVAS_PER_PET; // world units visible vertically (figure = 1)
      const dist = visH / 2 / Math.tan((FOV / 2) * Math.PI / 180);
      camera.position.set(0, 0.1, dist);
      camera.lookAt(0, 0, 0);

      let cssW = 1, cssH = 1;
      const resize = () => {
        cssW = Math.max(1, host.clientWidth); cssH = Math.max(1, host.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(cssW, cssH, false);
        camera.aspect = cssW / cssH; camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize); ro.observe(host);

      /* ── motion state ── */
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      let yaw = 0, yawV = 0, turns = 0;       // yaw target = turns·2π + look (+ idle sway)
      let pitch = 0, pitchV = 0;
      let lift = 0, liftV = 0;                // click jump
      let grow = 0.001, growV = 0;            // spawn + hover scale
      let hover = false, dragging = false;
      let lookYaw = 0, lookPitch = 0;
      let px = -1, py = -1;                   // pointer in canvas CSS px
      let moved = 0;
      let ox = 0, oy = 0, ovx = 0, ovy = 0;   // offset from home (CSS px) and its velocity
      let ax = 0, ay = 0;                     // offset currently WRITTEN to host.style.transform
      let gx = 0, gy = 0;                     // where in the pet the pointer grabbed it
      let tx = 0, ty = 0;                     // drag target offset
      let busyUntil = 0;                      // stay at full frame rate until then
      let t = 0;

      /* the hit area is an ellipse around the figure's projected centre: it does not
         depend on yaw, so the flat figure going edge-on mid-spin never loses the hover */
      const pxPerUnit = () => cssH / visH;
      const hit = (x: number, y: number) => {
        const u = pxPerUnit();
        const cx = cssW / 2, cy = cssH / 2 - lift * u - Math.sin(t * 1.4) * 0.03 * u;
        const rx = (figW / 2) * u * 1.0, ry = 0.5 * u * 1.04;
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        return dx * dx + dy * dy <= 1;
      };
      const setHover = (h: boolean) => {
        if (h === hover) return;
        hover = h;
        busyUntil = performance.now() + 1500;
        canvas.style.cursor = h ? 'grab' : '';
        if (h && !dragging) {
          const settled = Math.abs(yaw - turns * TAU) < 0.9 && Math.abs(yawV) < 2;
          if (settled && !reduced) turns += 1; // one full turn on entering
        }
        if (!h && !dragging) { turns = Math.round(yaw / TAU); }
      };
      const local = (e: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        px = e.clientX - r.left; py = e.clientY - r.top;
      };
      const onMove = (e: PointerEvent) => {
        local(e);
        if (dragging) {
          moved += Math.abs(e.movementX) + Math.abs(e.movementY);
          tx = e.clientX - gx; ty = e.clientY - gy;
          busyUntil = performance.now() + 1500;
          return;
        }
        setHover(hit(px, py));
        if (hover) {
          const u = pxPerUnit();
          lookYaw = clamp((px - cssW / 2) / (figW / 2 * u), -1, 1) * 0.7;
          lookPitch = clamp((py - cssH / 2) / (0.5 * u), -1, 1) * 0.25;
          busyUntil = performance.now() + 1500;
        }
      };
      const onDown = (e: PointerEvent) => {
        local(e);
        if (!hit(px, py)) return;
        dragging = true; moved = 0;
        gx = e.clientX - ox; gy = e.clientY - oy; tx = ox; ty = oy; // grab it where it is, even mid-flight home
        canvas.setPointerCapture(e.pointerId);   // the drag keeps working outside the canvas, over the whole app
        canvas.style.cursor = 'grabbing';
        turns = Math.round(yaw / TAU);
        busyUntil = performance.now() + 1500;
      };
      const onUp = (e: PointerEvent) => {
        if (!dragging) return;
        dragging = false;
        try { canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
        if (moved < 6 && e.type === 'pointerup') { // a tap: hop and spin (direction = side tapped)
          liftV = 3.2; turns += (px < cssW / 2 ? -1 : 1) * (reduced ? 0 : 1);
        }
        /* let go: the offset spring takes it home, keeping the velocity it was thrown with.
           Refresh hover WITHOUT running the "pointer entered" logic (it would add a spin)
           and never leave a stale cursor. */
        local(e); hover = hit(px, py); canvas.style.cursor = hover ? 'grab' : '';
        busyUntil = performance.now() + 4000;
      };
      const onLeave = () => { px = py = -1; if (!dragging) setHover(false); };
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onUp);
      canvas.addEventListener('lostpointercapture', onUp);
      canvas.addEventListener('pointerleave', onLeave);

      /* ── loop ── */
      let raf = 0, last = performance.now(), acc = 0;
      const sp = { x: 0, v: 0 };              // scratch: no allocation per spring step
      const spring = (x: number, v: number, target: number, k: number, damp: number, h: number) => {
        const a = k * (target - x) - damp * v;
        sp.v = v + a * h; sp.x = x + sp.v * h;
      };
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        if (pausedRef.current || document.hidden) { last = now; return; }
        const busy = now < busyUntil || dragging || hover || ox !== 0 || oy !== 0;
        const elapsed = now - last;
        if (!busy && elapsed < 32) return;       // idle: ~30 fps
        last = now;
        const dt = Math.min(elapsed, 100) / 1000;
        acc += dt;
        /* while held, the pet is exactly where the mouse put it (kept inside the window);
           its speed is measured so it can be thrown */
        if (dragging) {
          const nx = tx, ny = ty;
          const k = Math.min(1, dt / 0.05);
          ovx += ((nx - ox) / Math.max(dt, 0.001) - ovx) * k;
          ovy += ((ny - oy) / Math.max(dt, 0.001) - ovy) * k;
          ox = nx; oy = ny;
        }
        const H = 1 / 120;
        while (acc >= H) {
          acc -= H; t += H;
          const flying = Math.abs(ovx) + Math.abs(ovy) > 40;
          const idleYaw = reduced ? 0 : Math.sin(t * 0.55) * 0.38;
          const idlePitch = reduced ? 0 : Math.sin(t * 0.42 + 1) * 0.06;
          /* travelling: it leans into the motion; otherwise it looks at the cursor or sways */
          const tYaw = turns * TAU + (flying && !reduced ? clamp(ovx / 900, -1, 1) * 0.6 : hover ? lookYaw : idleYaw);
          const tPitch = flying && !reduced ? clamp(ovy / 1500, -1, 1) * 0.2 : hover ? lookPitch : idlePitch;
          spring(yaw, yawV, tYaw, 55, 2 * Math.sqrt(55) * 0.42, H); yaw = sp.x; yawV = sp.v;
          spring(pitch, pitchV, tPitch, 60, 2 * Math.sqrt(60) * 0.8, H); pitch = sp.x; pitchV = sp.v;
          if (!dragging) {                         // home spring
            const zeta = reduced ? 1 : HOME_ZETA;     // reduced motion: critically damped, no bounce
            ovx += -HOME_K * ox * H - 2 * zeta * Math.sqrt(HOME_K) * ovx * H;
            ovy += -HOME_K * oy * H - 2 * zeta * Math.sqrt(HOME_K) * ovy * H;
            ox += ovx * H; oy += ovy * H;
          }
          spring(grow, growV, hover || dragging ? 1.1 : 1, 70, 2 * Math.sqrt(70) * 0.5, H); grow = sp.x; growV = sp.v;
          liftV -= 14 * H; lift += liftV * H;     // gravity for the click hop
          if (lift < 0) { lift = 0; liftV = 0; }
        }
        /* keep the pet's centre inside the window, wherever home is */
        if (dragging || ox !== 0 || oy !== 0) {
          const r = host.getBoundingClientRect();
          const hx = r.left + r.width / 2 - ax, hy = r.top + r.height / 2 - ay, m = r.width * 0.2;
          const cxo = clamp(ox, m - hx, window.innerWidth - m - hx), cyo = clamp(oy, m - hy, window.innerHeight - m - hy);
          if (cxo !== ox) ovx = 0;
          if (cyo !== oy) ovy = 0;
          ox = cxo; oy = cyo;
          if (!dragging && Math.abs(ox) + Math.abs(oy) < 0.3 && Math.abs(ovx) + Math.abs(ovy) < 8) { ox = oy = ovx = ovy = 0; }
          host.style.transform = ox === 0 && oy === 0 ? '' : `translate3d(${ox.toFixed(2)}px,${oy.toFixed(2)}px,0)`;
          ax = ox; ay = oy;
        }
        const bob = reduced ? 0 : Math.sin(t * 1.4) * 0.03 + Math.sin(t * 0.7) * 0.012;
        const y = bob + lift;
        pivot.position.y = y;
        pivot.rotation.set(pitch, yaw, reduced ? 0 : Math.sin(t * 0.9) * 0.025 - clamp(ovx * 0.0004, -0.3, 0.3), 'YXZ');
        pivot.scale.setScalar(Math.max(0.001, grow));
        const h = clamp(1 - y * 1.4, 0.35, 1.2);
        shadow.scale.set(0.7 * h * grow, 0.7 * h * grow, 1);
        const day = dayRef.current;
        shadowMat.color.set(day ? 0x000000 : 0x8b5cf6);
        shadowMat.opacity = (day ? 0.28 : 0.4) * h;
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(frame);
      busyUntil = performance.now() + 2500;       // spawn pop
      host.style.opacity = '1';

      cleanup = () => {
        cancelAnimationFrame(raf); ro.disconnect();
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onUp);
        canvas.removeEventListener('lostpointercapture', onUp);
        canvas.removeEventListener('pointerleave', onLeave);
        geo.dispose(); mat.dispose(); tex.dispose(); shadowTex.dispose(); shadowMat.dispose(); shadow.geometry.dispose();
        renderer.dispose(); renderer.forceContextLoss();
        canvas.remove();
      };
    };

    /* after first paint: the pet must never delay the app's own startup */
    const ric: (cb: () => void) => number = (window as any).requestIdleCallback
      ? (cb) => (window as any).requestIdleCallback(cb, { timeout: 1500 })
      : (cb) => window.setTimeout(cb, 300);
    const handle = ric(() => {
      boot().catch((err) => console.warn('[StatePet] not loaded:', err));
    });

    return () => {
      disposed = true;
      if ((window as any).cancelIdleCallback) (window as any).cancelIdleCallback(handle); else clearTimeout(handle);
      cleanup();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label="STATE pet"
      data-testid="state-pet"
      style={{
        position: 'fixed',
        zIndex: 10, // above the cage (9): it floats in front of the frame, and may brush its rim
        width: sidePx,
        height: sidePx,
        left: `calc(${(SPOT.cx * 100).toFixed(4)}vw - ${sidePx} / 2)`,
        top: `calc(${(SPOT.cy * 100).toFixed(4)}vh - ${sidePx} / 2)`,
        pointerEvents: 'none', // only the canvas (once loaded) takes the pointer
        opacity: 0,
        transition: 'opacity 0.6s ease',
      }}
    />
  );
}
