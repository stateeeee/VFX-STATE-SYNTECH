/*
 * GEMINI 3.8 — the three roles, server side.
 *
 * For each role (Art Director, Agent, Optimizer — defined in
 * src/ai/contract.ts) this file owns four things:
 *   (a) the system prompt: what the role is, what it knows about the five
 *       effects and the engine, and the rules it must follow;
 *   (b) the response JSON schema, built PER REQUEST — the parameter-key enums
 *       come from the chain the Lab actually sent, so Gemini cannot even name a
 *       parameter that is not there;
 *   (c) the parts builder: every media item is preceded by its label, so
 *       Gemini always knows which picture is SOURCE and which is OUTPUT;
 *   (d) the validator: whatever Gemini answers is clamped, snapped and
 *       filtered against the same safety lists the Lab enforces, before it
 *       ever reaches the browser.
 *
 * Prompts are written in English (the model follows them best); every prose
 * field Gemini returns is asked for in ITALIAN — the operator's language.
 */

import { MediaResolution, type Part } from '@google/genai';
import { GeminiFailure } from './ai-provider';
import {
  MODULE_IDS, MOD_SOURCE_IDS, ENUM_KEYS, CARRIER_KEYS, PROTECTED_KEYS, PARAM_FLOORS, MAX_ROUTE_AMOUNT,
  CARRIER_AMOUNT_MIN, CARRIER_AMOUNT_MAX, INLINE_VIDEO_FPS,
  type AgentPlan, type AgentResult, type ArtDirection, type ArtDirectorResult, type AudioModeT,
  type ChainState, type CheckResult, type MediaPart, type ModSourceT, type OptimizerIssue,
  type OptimizerResult, type ParamDesc, type RouteT, type SignalSummary, type SourceKindT, type SourceRef,
} from './src/ai/contract';
import type { ModuleId } from './src/types';

/* ── limits ───────────────────────────────────────────────────── */

/** Few, decisive changes: a plan that touches 40 sliders is not direction. */
export const MAX_PLAN_PARAMS = 12;
export const MAX_PLAN_ROUTES = 6;
const MAX_PROPOSALS = 3;
const MAX_CHAIN = 3;
const MAX_ISSUES = 6;
const MAX_MEDIA = 32;

/* The source each carrier is pre-wired to (the nodes' defaultRoute, see
   src/engine/nodes/*.ts). Used only when the Lab reports a carrier whose route
   is currently off: the AI may then bring back exactly this route, nothing
   else. Keep in sync with the node tables if a carrier is ever re-wired. */
const CARRIER_DEFAULT_SOURCE: Record<string, ModSourceT> = {
  'analog.reactBass': 'bass',
  'analog.reactMid': 'loud',
  'analog.reactHigh': 'treble',
  'blob_reveal.beatReact': 'loud',
  'blob_tracker.connGlow': 'loud',
  'blob_tracker.rippleForce': 'beat',
};

/* These two rebuild the frame from the RAW source (ctx.source in their render),
   so anything rendered before them in a chain is thrown away. */
const RAW_SOURCE_EFFECTS: readonly ModuleId[] = ['blob_tracker', 'blob_reveal'];

/* ── the job a role hands to the server ───────────────────────── */

export interface RoleJob<R> {
  systemInstruction: string;
  parts: Part[];
  responseJsonSchema: Record<string, unknown>;
  /** The same shape with no enums, no array-length caps and no numeric
   *  bounds, for the one retry the server makes if Google refuses the strict
   *  schema as too complex (a long chain means ~170 enum values, nested under
   *  capped arrays). The validator still enforces every key, cap and clamp. */
  looseSchema?: Record<string, unknown>;
  mediaResolution?: MediaResolution;
  /** Validates Gemini's parsed answer into the wire result. */
  finish(raw: unknown): R;
}

/* ═══════════════════════════════════════════════════════════════
   (a) WHAT EVERY ROLE KNOWS
   ═══════════════════════════════════════════════════════════════ */

/* Written from the effects themselves (the ported node tables and their
   aiHints, docs/workflow/04-SPEC-EFFECTS.md, 01-VISION.md) — what each one
   LOOKS like, what it needs in frame, and how it moves with a track. The
   audience is a director who shoots trap/drill/rap videos for a living. */
const EFFECT_CATALOG = `THE FIVE EFFECTS (use these exact ids)

analog — ANALOG STATE · video synthesizer
  Look: the picture pushed through a dying CRT and a chewed VHS deck. Tube curvature, scanlines, RGB phosphor mask, bloom bleeding off highlights, corner vignette; horizontal sync TEAR, tracking-error bands, tape dropouts, a rolling bar, RGB chroma split, grain. An optional video FEEDBACK loop makes the frame smear into itself — trails that zoom, rotate, drift and hue-shift, psychedelic when pushed. An optional luminance PIXEL SORT melts bright pixels into streaks (horizontal, vertical or diagonal) before the tube.
  Music: reacts out of the box through three built-in CARRIER channels, pre-wired at amount 1 — already the maximum, so retuning a carrier can only make it weaker: bass → H-tear (the image jolts on the kick/808), treble → chroma split + grain (hi-hats fizz the colour), loudness → feedback trail + rotation (trails thicken when the track gets dense, e.g. on the hook), and bass also pumps the feedback zoom.
  The feedback reactions only show once the feedback loop is ON: feedbackAmt (the trail), feedbackZoom and feedbackRot are all 0 by default and the music MULTIPLIES them — at 0 nothing moves. So at default settings only tear, chroma and grain react, and gently.
  How HARD analog moves with the music is set by two knobs, not by the carriers: modDepth (0..1, default 0.4: a full hit pushes tear and chroma to ×1.4; at 1 it doubles them and the feedback zoom; never below ${PARAM_FLOORS['analog.modDepth'] ?? 0.1}) and reactSens (0.1..2, gain on the three channels: higher = quieter passages already hit full). reactEnabled is the master gate of all three channels: LOCKED, never touched.
  Needs: nothing — works on any footage, no person required.
  Suits: performance to camera, night city and car b-roll, flashbacks and memory scenes, 2000s home-video nostalgia, drill/underground grit, intimate lo-fi verses. Strong on neon night footage and on close-ups (feedback trails on a turning head).
  Watch out: heavy feedback + tear makes faces unreadable; on footage that is already chaotic it reads as noise.

bokeh — BOKEH STATE · cinematic depth of field
  Look: a person-segmentation mask keeps the SUBJECT razor sharp while the BACKGROUND melts into real lens bokeh — five kernels: clean disc, swirly Helios, explosive coma, anamorphic ovals with streaks, a morphable shape (cat-eye, star, square). Highlights bloom into big creamy discs, so street lights, car lights and club LEDs become the image. Then optional background-only warps (swirl, explosive push, squeeze) and background-only FX — datamosh, pixel sort, liquid wave, morph dissolve, lava melt — while the artist stays clean. Anamorphic optics on top: squeeze, oval barrel, a 2.39 crop with no black bars, lens breathing.
  Music: nothing built in — it moves with the track only through routes the Agent wires (background radius/bloom pumping on the 808, datamosh glitch on the snare, swirl riding the energy).
  Needs: ONE clear person in frame, mid shot or close-up. With NO person in frame the whole image counts as background: the entire frame melts into bokeh and the background warps/FX cover everything — it is NOT invisible, it is a blurred mess with no subject. It passes the frame through unchanged only until the person mask has loaded (or when the mask could not load — see "person mask" in the RENDER line). Weak on wide shots where the person is tiny.
  Suits: the "shot on a cinema lens" upgrade for phone footage; an artist performing to camera at night with lights behind; car interiors with the city passing; clubs; isolating the artist from a busy background; a background that moshes or melts while the face stays intact.

anamorphic_lab — Anamorphic Lab · cinema lens + film grade
  Look: a full Panavision-style rig in one pass. Anamorphic squeeze and oval barrel, letterbox to 2.39 (any ratio 1.78–2.8), horizontal streak bloom on highlights, an auto-tracked anamorphic FLARE on the brightest hotspot (gold or cold blue, length and thickness), film HALATION (red-orange glow around highlights), chromatic aberration toward the edges, exposure, warm/cool split-tone, black lift, S-curve contrast, filmic highlight rolloff, saturation, grain, elliptical vignette. Optional subject-aware background blur by focal length and f-stop, and a "ghost" double-exposure mask flip.
  Music: nothing built in — routes make the light breathe (exposure, halation, flare, streak bloom on the bass or the beat).
  Needs: nothing for the grade and the lens; the flare needs a real light source in frame; the background blur needs a person (only when it is switched on).
  Suits: anything that must look expensive — luxury and flex videos, R&B and melodic trap, golden hour, night drives (headlights and street lamps feed the flare), moody interiors. Usually the LAST link of a chain: it is the lens and the grade that glue the other effects together.
  Watch out: on dark footage exposure/contrast can crush the blacks.

blob_reveal — BLOB REVEAL · rotoscope engine
  Look: the frame starts BLACK. Only the brightest regions open up as rectangular windows onto the video (lights, highlights, lit skin, reflections), and the segmented subject is cut out and composited on top with eroded, feathered edges. Graphic, minimal, high-contrast: the artist floating in the dark with boxes of light popping around them.
  Music: reacts out of the box — the windows breathe with the loudness (built-in carrier, pre-wired at amount 0.9) and grow on full energy.
  Needs: a person for the reveal AND bright spots for the windows. Flat, dim footage gives few windows; a bright sky turns into one big window.
  Suits: intros, the drop into a hook, a dark verse, performance in front of lights/strobes/LED walls, club and concert footage, a stylised rotoscope section.
  Rebuilds the frame from the RAW source: it must be the FIRST effect of a chain.

blob_tracker — BLOB STATE TRACKER · surveillance / data HUD
  Look: computer-vision overlay on the bright blobs of the frame — markers (squares, rectangles, circles or corner brackets) with ID and area labels, neon graph lines connecting nearby blobs, organic contours (edge-based or following the person), optical-flow arrows with fading trails, Matrix-style number/letter fill, FX inside the blobs or on the background (invert, thermal camera, CCTV security cam with timestamp and CAM ID, liquid row shift, datamosh blocks, RGB-split glitch), a water-ripple simulation over the whole frame, a floating 3D eight-panel "AI analysis" montage, chaos points.
  Music: reacts out of the box — the connection lines pump their width on the bass and their glow blooms with the loudness (built-in carrier). The rest is pre-wired but only shows once that FX is switched ON: the water ripple (rippleOn, off by default) hits on every beat, datamosh (fxData) rides the hi-hats, the RGB glitch (fxGlitch) spikes on the beat, the 3D panels (panelsEnabled) swell on the bass and tumble with the video's motion. These factory routes run 0.4–0.6 deep on purpose.
  Needs: distinct light points or strong contrast (night city, car lights, crowds, stage lights, phone screens on faces, dancers under light).
  Suits: the language of surveillance — "they're watching", tech-noir, paranoia, heist and street concepts, video-game HUD. Strong as the main look.
  Watch out: busy — on cluttered footage it becomes noise. The heaviest effect. Rebuilds the frame from the RAW source: it must be the FIRST effect of a chain.`;

/* Hard facts of the render engine every role needs, so no role proposes or
   tunes something the engine cannot do. */
const ENGINE_FACTS = `HOW THE LAB RENDERS
- A chain renders in order: each effect processes the output of the one before.
- blob_tracker and blob_reveal are the exception: they rebuild the frame from the RAW source, so whatever runs before them is thrown away. They always go FIRST, and never both in the same chain.
- bokeh, blob_reveal (and anamorphic_lab's background blur, blob_tracker's person contour) share one person mask computed on the clean source. Effects that bend geometry before them (barrel, squeeze, feedback zoom) misalign the cutout — put the mask-based effects early.
- anamorphic_lab is the lens and the grade: normally last.
- Every effect costs frame rate; three in a chain is heavy — use three only when each one earns its place.
- Music reaches the effects only while the Lab has audio on: a Track (an audio file), the Clip (the source video's own soundtrack) or the Mic. Signals: bass (kick/808 low end), treble (hi-hats, the top of snares, sibilance), loud (overall energy, follows the song's sections), beat (an onset pulse: a short spike on each hit, near 0 in between), motion (movement in the video), bright (frame brightness).`;

const ITALIAN = `LANGUAGE: write every prose field in ITALIAN — the director is Italian. Effect ids, parameter keys and signal names stay exactly as given (they are code). Scene slang that Italians use in English (808, drop, hook, flare, glitch, b-roll) is fine inside Italian sentences.`;

const FLOOR_TEXT = Object.entries(PARAM_FLOORS).map(([k, v]) => `${k} never below ${v}`).join('; ') || 'none';

/* Routing semantics, shared by the Agent and the Optimizer's fixes. The
   formula is the ParamBus one (src/engine/params.ts, apply()). */
const PLAN_RULES = `HOW A PLAN IS APPLIED (ParamBus)
Every frame: final = clamp(base + signal × amount × (max − min)), with signal in 0..1.
So a route's amount is a fraction of the parameter's FULL range: amount 0.5 on a 0..255 threshold swings it by ~127 on a full hit. On most parameters 0.05..0.25 is already a clear, musical move; go deeper only for a deliberate pump, and never above ${MAX_ROUTE_AMOUNT}. A negative amount inverts the push (the signal pulls the value down). Choose the base so that base + swing stays where the look still works — on the loudest section of the song, not just on the seconds you measured.
Factory routes are the designed look, not mistakes: some effects ship routes up to ${MAX_ROUTE_AMOUNT} deep (blob_tracker: panelTurb ← motion 0.6, datamosh ← treble 0.5, glitchAmt ← beat 0.5, connWidth ← bass 0.45, panelScale ← bass 0.4). Never flag or cut one just for its depth; judge it by what it does on screen.
Pick the signal by character: beat for punctual hits (glitch spikes, ripples, flashes), bass for pumping and breathing (size, radius, zoom, glow), loud for slow section-level swells (feedback, opacity, halation), treble for fizz and texture (chroma, noise, datamosh), motion to follow the video (cuts, dance), bright to follow the light.

MUSIC WHILE AUDIO IS OFF
Audio OFF is the Lab's normal starting state, even for a music video: the source's own song only plays once the director switches on the Clip (or loads a Track, or opens the Mic). A route on bass, treble, loud or beat while audio is off is WAITING FOR MUSIC — it comes alive the moment audio is on. That is never an error: wire the music routes the look needs, and never remove one because audio is off.

PLAN RULES (anything else is refused by the validator)
- params: { key, value } sets a BASE value. routes: { key, source, amount } sets or replaces that parameter's route; source "off" removes it.
- At most ${MAX_PLAN_PARAMS} params and ${MAX_PLAN_ROUTES} routes. Few, decisive changes that make a visible difference — leave the rest alone.
- LOCKED parameters: never touch them (among them analog.reactEnabled, the gate of analog's whole music response, and bokeh.segEnabled, the person mask).
- FLOORS: ${FLOOR_TEXT} — each scales an effect's whole music response; a lower value is raised to the floor.
- CARRIER parameters: their base stays 0 and their route IS the effect's built-in response to music. You may only retune the amount (${CARRIER_AMOUNT_MIN}..${CARRIER_AMOUNT_MAX}) on the SAME source. Never set their base, never change their source, never switch them off.
- ENUM parameters: an integer inside the range, chosen as a base value; never routed.
- On/off switches: 0 or 1. A stage's amounts only show when its switch is on (e.g. a glitch amount does nothing while that glitch FX is off) — switch it on in the same plan.
- Only parameters marked "routable" can carry a route.
- No routes on a dead VIDEO signal: motion or bright whose mean and peak are ~0 in the window (motion on a locked-off camera or a still photo, bright on a black frame) does nothing. Music signals are never "dead" just because audio is off — see above.
- Keep the subject readable (face, artist) unless the intent asks to destroy it.`;

const ART_DIRECTOR_SYSTEM = `You are the ART DIRECTOR of VFX SYNTECH, a browser VFX studio used by a professional Italian music-video director (trap, drill, rap, R&B — the Italian urban scene and its references). You are the creative mind. You WATCH the source the director gives you — a video with its own music, a photo, or live webcam frames — and you decide which of the studio's five effects belong on it, alone or chained. Think like a music-video director pitching a look to an artist: concrete, visual, musical, never generic.

READ THE SOURCE
- subject: who or what is on screen (number of people, framing, what they do).
- setting: where it is (place, time of day, light sources).
- mood: the feeling in a few words.
- palette: 3–5 colour words.
- motion: camera movement and subject movement (for a photo: the implied energy).
- music: only if you can HEAR audio (a whole video with its soundtrack): energy, tempo feel (e.g. "trap half-time ~140", "drill con 808 scivolati", "R&B lento"), and up to 6 moments with timestamps "m:ss" (drop, hook, beat switch, pause, ad-lib burst). If you cannot hear audio but LIVE SIGNALS are given, fill energy and tempoFeel from them and leave moments empty. If there is neither, music = null.

PROPOSE 1–3 LOOKS
- Each is a chain of 1–3 effects in render order, and they must differ from each other (for example: one safe, one bold, one wild).
- title: a short name for the look.
- why: tie the choice to what you SAW — concrete details ("le luci della strada dietro di lui diventano dischi enormi", "il volto è sempre al centro, il mask regge"). No generic praise. If an effect needs a person or light points that the source lacks, do not propose it.
- audioIdea: how the look should move with THIS track — which element (kick/808, hi-hats, snare, vocal, the drop) drives which visual — concrete enough for the Agent to wire it. For a photo or silent source, say what to connect once a Track or the Mic is on.

${ENGINE_FACTS}

${EFFECT_CATALOG}

${ITALIAN}

Answer only with the JSON object described by the response schema.`;

const AGENT_SYSTEM = `You are the AGENT of VFX SYNTECH — the operator at the desk. The director has already chosen the source and the effect chain in the Lab. Your job: set parameters and audio/video routes so that the video, the music and the effects play together like a beat under a vocal — composed with the song, never pasted on top.

WHAT YOU RECEIVE
- Possibly the whole SOURCE video as a file, WITH its soundtrack (sampled for you at about 1 fps). That is the song the video is cut to: listen to it end to end — where the sections change, where the drop and the hook land, where the 808 comes in and where it breaks down — and watch how the camera and the subject move across the whole clip.
- Possibly an OUTPUT clip: a few seconds of what the Lab renders right now, with the music when audio is on, sampled at ${INLINE_VIDEO_FPS} fps so sub-second hits are visible. Use it to see what already moves on the beat, and what does not.
- A SOURCE / OUTPUT frame pair: what goes into the chain and what comes out, at the same instant.
- LIVE SIGNALS measured over the last seconds (audio mode, BPM, bass/treble/loudness, beats counted, motion, brightness).
- The chain table: every parameter with its range, step, current base, current route and flags (LOCKED, CARRIER, ENUM, routable).
- Possibly an ART DIRECTION: the look the director chose from the Art Director — title, chain, why, audioIdea and the music read with its timestamped moments. It is your brief: turn its audioIdea into concrete routes and its "why" into concrete bases.
- Possibly the director's intent. When it is given, it wins — over the art direction too, wherever they disagree. With neither, make the look work for this footage and this music.

HOW TO WORK
- Look first: subject size and position, darkness, light sources, how much the camera moves, what the OUTPUT shows versus the SOURCE (effect too weak, too strong, subject lost, image blown or crushed).
- Listen: with the source file, to the song itself (sections, drop, hook, where the low end hits, how dense the verse is against the hook); with the OUTPUT clip, to whether the current routes land on the hits; with only numbers, to BPM, how hard the bass peaks, how many beats land in the window, whether the track is dense (loud mean high) or sparse.
- Tie every change to that evidence, and wire for the WHOLE song: a route tuned on a quiet verse must still look right on the drop.
- Audio OFF (the Lab's default): still wire the music routes the look needs — they wait for music. Say in the summary that they come alive once the Clip (the video's own song), a Track or the Mic is switched on.

${PLAN_RULES}

${ENGINE_FACTS}

${EFFECT_CATALOG}

summary: 2–4 sentences in Italian — what you changed and why, and what the director should now see and hear.

${ITALIAN}

Answer only with the JSON object described by the response schema.`;

const OPTIMIZER_SYSTEM = `You are the OPTIMIZER of VFX SYNTECH — the Agent's controller. The Agent (or the director by hand) has set up an effect chain in the Lab. You judge the RESULT: you watch AND listen to a short OUTPUT clip (with the music when audio is on), you compare SOURCE and OUTPUT frames, and you report what is wrong or could be better — each issue with a fix that can be applied.

WHAT YOU RECEIVE
- The OUTPUT clip: a few seconds of what the Lab renders, with its music when audio is on, sampled at ${INLINE_VIDEO_FPS} fps (one frame every ~${Math.round(1000 / INLINE_VIDEO_FPS)} ms — fine enough to see whether a flash lands on a kick). And SOURCE / OUTPUT frame pairs.
- CHECKS the Lab computed itself (frame rate, resolution scale, signal liveness…): treat them as facts. A check saying music routes are idle because audio is off is information, not a problem.
- LIVE SIGNALS, the chain table (ranges, bases, routes, flags), the ART DIRECTION the director chose (when given: the look and the audioIdea the result must deliver), the director's intent (it wins over the art direction where they disagree), and the Agent's last plan (may be absent).

LOOK FOR
1. Subject lost or unreadable: the face/artist dissolved by glitch, feedback, blur or black windows; a cutout on the wrong thing; halos.
2. Blown or crushed image: highlights clipped to white, blacks crushed so detail is gone (unless clearly intended).
3. Effect invisible: OUTPUT ≈ SOURCE (a mask-based effect whose person mask has not loaded yet, thresholds that catch nothing, amounts near 0, a stage switched off). Not the same thing: bokeh with NO person in frame is very visible — the whole frame becomes blurred background with the background FX on top. Report that as "no subject for this effect" with fix null (it needs a shot with a person, or another chain), never as bokeh that is too weak.
4. Not following the beat — only when audio is on and you hear the music in the clip: the visual hits do not land on the kicks/snares you hear, nothing moves with the music, or everything jitters constantly instead of moving musically. With audio OFF the clip is silent: judge what you see, and do not report the silence or the still music routes as a problem.
5. Routes on dead VIDEO signals: motion on a locked-off shot or a still photo, bright on a black frame. A route on bass, treble, loud or beat while audio is OFF is NOT an issue — it is waiting for music; never remove or "fix" it for that.
6. Frame-rate problems (from the checks): propose lighter settings.
7. Fighting effects: two effects cancelling each other, an effect placed before blob_tracker/blob_reveal (thrown away), double vignettes, grades pulling opposite ways.
8. Off brief: with an ART DIRECTION, a result that does not deliver its look, or — with audio on — its audioIdea (e.g. the idea says the 808 drives the flare, and the flare does not move with the 808 you hear). With audio off, check only that the routes the idea needs are wired.

FOR EACH ISSUE (at most ${MAX_ISSUES}, most important first)
- severity: "error" (broken or unusable), "warning" (clearly hurts the result), "tip" (polish).
- finding: what is wrong, in Italian.
- evidence: what you saw or heard, in Italian, with the clip timestamp ("0:02.5") or the frame label it comes from.
- fix: a plan that repairs it (same rules as the Agent's plans below), or null when no parameter can fix it — e.g. it needs another source or another chain order; then say so in the finding.
Do not invent issues to fill the list: a good result gets verdict "ok" with no issues or only tips.

verdict: "ok" (nothing important), "improve" (works, clearly better possible), "broken" (error-level issues).
summary: 1–3 sentences in Italian.

${PLAN_RULES}

${ENGINE_FACTS}

${EFFECT_CATALOG}

${ITALIAN}

Answer only with the JSON object described by the response schema.`;

/* ═══════════════════════════════════════════════════════════════
   request reading — everything from the browser is untrusted
   ═══════════════════════════════════════════════════════════════ */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const fin = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function str(v: unknown, max = 400): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
const isModuleId = (v: unknown): v is ModuleId => typeof v === 'string' && (MODULE_IDS as readonly string[]).includes(v);
const isModSource = (v: unknown): v is ModSourceT => typeof v === 'string' && (MOD_SOURCE_IDS as readonly string[]).includes(v);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* image/jpeg, video/webm, audio/wav … — parameters (";codecs=vp9") stripped. */
const MIME = /^(image|video|audio)\/[a-z0-9.+-]+$/;
function cleanMime(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.split(';')[0].trim().toLowerCase();
  return MIME.test(m) ? m : null;
}

function readMedia(v: unknown): MediaPart[] {
  if (v != null && !Array.isArray(v)) throw new GeminiFailure('bad_request', 'media must be an array of {mimeType, data, label}.');
  const out: MediaPart[] = [];
  for (const raw of arr(v).slice(0, MAX_MEDIA)) {
    const m = obj(raw);
    const mimeType = cleanMime(m.mimeType);
    let data = typeof m.data === 'string' ? m.data : '';
    if (data.startsWith('data:')) data = data.slice(data.indexOf(',') + 1); // tolerate a data: URL
    if (!mimeType || !data) continue;
    out.push({ mimeType, data, label: str(m.label, 160) || mimeType });
  }
  return out;
}

const SOURCE_KINDS: readonly SourceKindT[] = ['none', 'video', 'image', 'webcam'];

function readSource(v: unknown): SourceRef {
  const s = obj(v);
  const kind = SOURCE_KINDS.includes(s.kind as SourceKindT) ? (s.kind as SourceKindT) : 'none';
  const src: SourceRef = { kind };
  const name = str(s.name, 160);
  if (name) src.name = name;
  if (typeof s.fileUri === 'string' && /^https?:\/\//.test(s.fileUri) && s.fileUri.length <= 2048) {
    src.fileUri = s.fileUri;
    src.fileMimeType = cleanMime(s.fileMimeType) ?? 'video/mp4';
  }
  const dur = fin(s.durationSec);
  if (dur !== null && dur >= 0) src.durationSec = dur;
  return src;
}

/** One ParamDesc made trustworthy: range sane, flags re-derived from the
 *  contract's safety lists (OR-ed with what the Lab said, never weaker). */
function normalizeParam(raw: unknown): ParamDesc | null {
  const p = obj(raw);
  const key = typeof p.key === 'string' ? p.key.trim() : '';
  if (!/^[a-z_]+\.[A-Za-z0-9_]+$/.test(key)) return null;
  const type: ParamDesc['type'] = ENUM_KEYS.includes(key) ? 'enum'
    : p.type === 'boolean' ? 'boolean'
    : p.type === 'enum' ? 'enum'
    : 'number';
  let min = fin(p.min);
  let max = fin(p.max);
  if (type === 'boolean') { min = 0; max = 1; }
  if (min === null || max === null || max < min) return null; // no range → the AI cannot touch it safely
  const stepIn = fin(p.step);
  const step = stepIn !== null && stepIn > 0 ? stepIn : type === 'number' ? 0 : 1;
  const r = obj(p.route);
  const route: RouteT | null = isModSource(r.source) && fin(r.amount) !== null ? { source: r.source, amount: r.amount as number } : null;
  return {
    key,
    label: str(p.label, 60) || key,
    type,
    min, max, step,
    value: clamp(fin(p.value) ?? min, min, max),
    hint: str(p.hint, 300),
    reactive: type === 'number' && p.reactive === true,
    route,
    carrier: p.carrier === true || CARRIER_KEYS.includes(key),
    locked: p.locked === true || PROTECTED_KEYS.includes(key),
  };
}

const AUDIO_MODES: readonly AudioModeT[] = ['off', 'mic', 'file', 'clip'];

function readChain(v: unknown): ChainState {
  const c = obj(v);
  if (!Array.isArray(c.params)) throw new GeminiFailure('bad_request', 'chain is missing: open the Lab and enable at least one effect.');
  const order = [...new Set(arr(c.order).filter(isModuleId))];
  if (!order.length) throw new GeminiFailure('bad_request', 'The Lab chain is empty: enable at least one effect.');
  const params = c.params.map(normalizeParam).filter((p): p is ParamDesc => p !== null);
  return {
    order,
    params,
    fps: fin(c.fps) ?? 0,
    resScale: fin(c.resScale) ?? 1,
    sourceKind: SOURCE_KINDS.includes(c.sourceKind as SourceKindT) ? (c.sourceKind as SourceKindT) : 'none',
    audioActive: c.audioActive === true,
    audioMode: AUDIO_MODES.includes(c.audioMode as AudioModeT) ? (c.audioMode as AudioModeT) : 'off',
    maskState: typeof c.maskState === 'string' ? str(c.maskState, 60) : null,
  };
}

/** The Art Director's music read (shared by its validator and the direction
 *  the panel hands back to the Agent / Optimizer). */
function readMusic(v: unknown): ArtDirectorResult['read']['music'] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const m = obj(v);
  return {
    energy: str(m.energy, 200),
    tempoFeel: str(m.tempoFeel, 200),
    moments: arr(m.moments).slice(0, 6).map((x) => obj(x))
      .map((x) => ({ at: str(x.at, 12), label: str(x.label, 160) }))
      .filter((x) => x.label),
  };
}

/** The optional ART DIRECTION (the proposal chosen with "Use this chain").
 *  Absent/null → null; not an object → 400; an object with nothing usable in
 *  it → null (nothing to brief the model with). */
function readDirection(v: unknown): ArtDirection | null {
  if (v == null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) {
    throw new GeminiFailure('bad_request', 'direction must be an object {title, chain, why, audioIdea, music}.');
  }
  const d = obj(v);
  const direction: ArtDirection = {
    title: str(d.title, 80),
    chain: normalizeProposalChain(d.chain),
    why: str(d.why, 900),
    audioIdea: str(d.audioIdea, 700),
    music: readMusic(d.music),
  };
  return direction.title || direction.why || direction.audioIdea ? direction : null;
}

/* ═══════════════════════════════════════════════════════════════
   (c) PARTS — labels before media, context after
   ═══════════════════════════════════════════════════════════════ */

/* Google recommends the media BEFORE the text that asks about it, so every
   role sends: [label, item] × N, then one text block with the context and the
   task. Labels are what makes a frame pair readable as a pair.
   Inline VIDEO (the 4s output clips) gets an explicit sampling rate: Gemini's
   default is 1 fps — four stills against the whole audio track, useless for
   telling whether a flash lands on a kick. */
function mediaParts(media: MediaPart[]): Part[] {
  const parts: Part[] = [];
  for (const m of media) {
    const isVideo = m.mimeType.startsWith('video/');
    parts.push({ text: isVideo ? `${m.label} (video sampled at ${INLINE_VIDEO_FPS} fps)` : m.label });
    parts.push({
      inlineData: { mimeType: m.mimeType, data: m.data },
      ...(isVideo ? { videoMetadata: { fps: INLINE_VIDEO_FPS } } : {}),
    });
  }
  return parts;
}

/** Sampling rate for a whole uploaded video: 1 fps, halved past 10 minutes so
 *  a long video stays inside the token budget. */
const sourceFps = (src: SourceRef) => ((src.durationSec ?? 0) > 600 ? 0.5 : 1);
const isVideoFile = (src: SourceRef) => !!src.fileUri && (src.fileMimeType ?? 'video/mp4').startsWith('video/');

/** An uploaded source (Files API), videos with an explicit sampling rate.
 *  No displayName on the part — the API rejects it there. */
function sourceFileParts(src: SourceRef): Part[] {
  if (!src.fileUri) return [];
  const mimeType = src.fileMimeType ?? 'video/mp4';
  const isVideo = mimeType.startsWith('video/');
  const fps = sourceFps(src);
  const name = src.name ? ` "${src.name}"` : '';
  const label = isVideo
    ? `SOURCE video${name} — the whole file, with its own soundtrack (watch it and listen to it).`
    : `SOURCE file${name}.`;
  return [
    { text: label },
    { fileData: { fileUri: src.fileUri, mimeType }, ...(isVideo ? { videoMetadata: { fps } } : {}) },
  ];
}

const n2 = (v: unknown) => { const x = fin(v); return x === null ? '?' : String(Math.round(x * 100) / 100); };
function clock(sec: unknown): string {
  const s = fin(sec);
  if (s === null) return '?';
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

const AUDIO_MODE_LABEL: Record<string, string> = {
  file: 'Track (an audio file)',
  clip: "Clip (the source video's own soundtrack)",
  mic: 'Mic',
};

function describeSignals(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return 'LIVE SIGNALS: not available.';
  const s = raw as Partial<SignalSummary>;
  const a = obj(s.audio);
  const v = obj(s.video);
  const stat = (x: unknown) => { const o = obj(x); return `mean ${n2(o.mean)} / peak ${n2(o.peak)}`; };
  const lines = [`LIVE SIGNALS over the last ${n2(s.windowSec)}s (0..1 scale):`];
  if (a.active === true) {
    const t = obj(a.track);
    const track = typeof t.name === 'string' ? `; track "${str(t.name, 80)}" at ${clock(t.currentTime)} of ${clock(t.duration)}` : '';
    lines.push(`- audio: ON — ${AUDIO_MODE_LABEL[String(a.mode)] ?? String(a.mode)}; BPM ${fin(a.bpm) ?? 'unknown'}; beats counted ${n2(a.beats)}${track}`);
    lines.push(`  bass ${stat(a.bass)}; treble ${stat(a.treble)}; loud ${stat(a.loud)}`);
  } else {
    lines.push('- audio: OFF — no Track, Clip or Mic is on in the Lab yet. Music routes wait for music: they are silent now and come alive when audio is switched on (not an error).');
  }
  lines.push(`- video: motion ${stat(v.motion)}; bright ${stat(v.bright)}`);
  return lines.join('\n');
}

function describeParam(p: ParamDesc): string {
  const range = p.type === 'boolean' ? 'on/off 0|1'
    : p.type === 'enum' ? `enum ${p.min}..${p.max}`
    : `number ${p.min}..${p.max}${p.step ? ` step ${p.step}` : ''}`;
  const route = p.route ? `${p.route.source} ×${n2(p.route.amount)}` : '—';
  const flags = p.locked ? 'LOCKED'
    : p.carrier ? 'CARRIER'
    : p.type === 'enum' ? 'ENUM'
    : p.reactive ? 'routable'
    : '';
  const hint = p.hint ? ` — ${p.hint.length > 170 ? `${p.hint.slice(0, 169)}…` : p.hint}` : '';
  return `${p.key} | ${p.label} | ${range} | base ${n2(p.value)} | route ${route}${flags ? ` | ${flags}` : ''}${hint}`;
}

function describeChain(chain: ChainState): string {
  const lines = [
    `CHAIN (render order): ${chain.order.join(' → ')}`,
    `RENDER: ${n2(chain.fps)} fps, resolution scale ${Math.round(chain.resScale * 100)}%, source ${chain.sourceKind}, person mask ${chain.maskState ?? 'not used'}, audio ${chain.audioActive ? `on — ${AUDIO_MODE_LABEL[chain.audioMode] ?? chain.audioMode}` : 'OFF (music routes are waiting for music)'}`,
    'PARAMETERS — key | label | range | base | route | flags — hint',
  ];
  for (const id of chain.order) {
    const own = chain.params.filter((p) => p.key.startsWith(`${id}.`));
    if (!own.length) continue;
    lines.push(`[${id}]`);
    for (const p of own) lines.push(describeParam(p));
  }
  return lines.join('\n');
}

function describeIntent(intent: unknown, fallback: string): string {
  const i = str(intent, 600);
  return i ? `DIRECTOR'S INTENT: "${i}"` : `DIRECTOR'S INTENT: none given — ${fallback}`;
}

/** The art direction, as a brief. `order` is the Lab chain right now: when the
 *  director has changed it since, the idea applies to the effects that are
 *  actually there. */
function describeDirection(d: ArtDirection | null, order: ModuleId[], hasIntent: boolean): string {
  if (!d) return 'ART DIRECTION: none chosen.';
  const lines = [
    `ART DIRECTION chosen by the director (an Art Director proposal — the brief${hasIntent ? '; the intent above wins wherever they disagree' : ''}):`,
    `- look: "${d.title || 'untitled'}"${d.chain.length ? ` — chain ${d.chain.join(' → ')}` : ''}`,
  ];
  if (d.chain.length && d.chain.join(',') !== order.join(',')) {
    lines.push(`- note: the Lab chain is now ${order.join(' → ') || 'empty'}; apply the idea to the effects that are actually there.`);
  }
  if (d.why) lines.push(`- why: ${d.why}`);
  if (d.audioIdea) lines.push(`- audioIdea: ${d.audioIdea}`);
  if (d.music) {
    const moments = d.music.moments.map((m) => `${m.at || '?'} ${m.label}`).join('; ');
    lines.push(`- music read: energy ${d.music.energy || '?'}; tempo ${d.music.tempoFeel || '?'}${moments ? `; moments: ${moments}` : ''}`);
  }
  return lines.join('\n');
}

/* ═══════════════════════════════════════════════════════════════
   (b) SCHEMAS — built per request
   ═══════════════════════════════════════════════════════════════ */

/* An enum with no values is an invalid schema; an empty key list becomes a
   plain string with the array capped at 0 items. */
function keyProp(keys: string[], description: string) {
  return keys.length ? { type: 'string', enum: keys, description } : { type: 'string', description };
}

/* The keywords Google's "too many states" refusal names as its causes: enums,
   array length limits (worst when nested) and numeric bounds. */
const LOOSE_DROP = new Set(['enum', 'minItems', 'maxItems', 'minimum', 'maximum']);

/** The same schema without any of LOOSE_DROP (see RoleJob.looseSchema). A
 *  small enum survives as words in the description, so the model still knows
 *  the allowed values; the big key enums do not (the chain table lists them). */
export function loosen(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(loosen);
  if (!schema || typeof schema !== 'object') return schema;
  const src = schema as Obj;
  const out: Obj = {};
  for (const [k, v] of Object.entries(src)) {
    if (LOOSE_DROP.has(k)) continue;
    if (k === 'properties' && v && typeof v === 'object') {
      out.properties = Object.fromEntries(Object.entries(v as Obj).map(([name, sub]) => [name, loosen(sub)]));
    } else if (k === 'items' || k === 'anyOf') {
      out[k] = loosen(v);
    } else {
      out[k] = v;
    }
  }
  if (Array.isArray(src.enum) && src.enum.length <= 12) {
    const words = `One of: ${src.enum.map(String).join(', ')}.`;
    out.description = typeof src.description === 'string' ? `${src.description} ${words}` : words;
  }
  return out;
}

/** The AgentPlan schema for THIS chain: param keys = everything not locked and
 *  not a carrier (a carrier's base is never the AI's); route keys = routable
 *  numeric non-enum params (carriers included: their amount is tunable). */
function planSchema(chain: ChainState): Record<string, unknown> {
  const paramKeys = chain.params.filter((p) => !p.locked && !p.carrier).map((p) => p.key);
  const routeKeys = chain.params.filter((p) => !p.locked && p.type === 'number' && p.reactive).map((p) => p.key);
  return {
    type: 'object',
    properties: {
      params: {
        type: 'array',
        maxItems: paramKeys.length ? MAX_PLAN_PARAMS : 0,
        description: 'Base values to set.',
        items: {
          type: 'object',
          properties: {
            key: keyProp(paramKeys, 'Parameter key from the chain table.'),
            value: { type: 'number', description: 'Inside the parameter range; on/off switches 0 or 1; enums an integer.' },
          },
          required: ['key', 'value'],
        },
      },
      routes: {
        type: 'array',
        maxItems: routeKeys.length ? MAX_PLAN_ROUTES : 0,
        description: 'Routes to set or replace; source "off" removes a route.',
        items: {
          type: 'object',
          properties: {
            key: keyProp(routeKeys, 'A routable parameter key from the chain table.'),
            source: { type: 'string', enum: [...MOD_SOURCE_IDS, 'off'], description: 'The signal that drives the parameter; "off" removes the route.' },
            amount: { type: 'number', minimum: -1, maximum: 1, description: `Fraction of the full range; |amount| ≤ ${MAX_ROUTE_AMOUNT}, carriers ${CARRIER_AMOUNT_MIN}..${CARRIER_AMOUNT_MAX}.` },
          },
          required: ['key', 'source', 'amount'],
        },
      },
      summary: { type: 'string', description: 'In Italian: what changes and why.' },
    },
    required: ['params', 'routes', 'summary'],
  };
}

function artDirectorSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      read: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          setting: { type: 'string' },
          mood: { type: 'string' },
          palette: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 5 },
          motion: { type: 'string' },
          music: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  energy: { type: 'string' },
                  tempoFeel: { type: 'string' },
                  moments: {
                    type: 'array',
                    maxItems: 6,
                    items: {
                      type: 'object',
                      properties: { at: { type: 'string', description: 'm:ss' }, label: { type: 'string' } },
                      required: ['at', 'label'],
                    },
                  },
                },
                required: ['energy', 'tempoFeel', 'moments'],
              },
              { type: 'null' },
            ],
          },
        },
        required: ['subject', 'setting', 'mood', 'palette', 'motion', 'music'],
      },
      proposals: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_PROPOSALS,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            chain: { type: 'array', minItems: 1, maxItems: MAX_CHAIN, items: { type: 'string', enum: [...MODULE_IDS] } },
            why: { type: 'string' },
            audioIdea: { type: 'string' },
          },
          required: ['title', 'chain', 'why', 'audioIdea'],
        },
      },
    },
    required: ['read', 'proposals'],
  };
}

function optimizerSchema(chain: ChainState): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      issues: {
        type: 'array',
        maxItems: MAX_ISSUES,
        items: {
          type: 'object',
          properties: {
            severity: { type: 'string', enum: ['error', 'warning', 'tip'], description: 'How much it hurts the result.' },
            finding: { type: 'string' },
            evidence: { type: 'string' },
            fix: { anyOf: [planSchema(chain), { type: 'null' }] },
          },
          required: ['severity', 'finding', 'evidence', 'fix'],
        },
      },
      verdict: { type: 'string', enum: ['ok', 'improve', 'broken'], description: 'The overall judgement.' },
      summary: { type: 'string' },
    },
    required: ['issues', 'verdict', 'summary'],
  };
}

/* ═══════════════════════════════════════════════════════════════
   (d) VALIDATORS
   ═══════════════════════════════════════════════════════════════ */

function decimals(x: number): number {
  const s = String(x);
  const exp = s.match(/e-(\d+)$/);
  if (exp) return Number(exp[1]);
  return s.split('.')[1]?.length ?? 0;
}

/** Clamp to [min,max] and snap to the slider's step grid (anchored at min, like
 *  an <input type=range>), without float dust. */
function snapNumber(v: number, d: ParamDesc): number {
  let x = clamp(v, d.min, d.max);
  if (d.step > 0) {
    x = d.min + Math.round((x - d.min) / d.step) * d.step;
    x = clamp(x, d.min, d.max);
    x = Number(x.toFixed(Math.min(8, Math.max(decimals(d.step), decimals(d.min)))));
  }
  return x;
}

/* A boolean from Gemini may come as true/false despite the schema. */
function toNumber(v: unknown): number | null {
  if (typeof v === 'boolean') return v ? 1 : 0;
  return fin(v);
}

const isEnum = (d: ParamDesc) => d.type === 'enum' || ENUM_KEYS.includes(d.key);
const isLocked = (d: ParamDesc) => d.locked || PROTECTED_KEYS.includes(d.key);
const isCarrier = (d: ParamDesc) => d.carrier || CARRIER_KEYS.includes(d.key);
const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Makes a plan safe for THIS chain. Unknown and locked keys go; numbers are
 * clamped and snapped, booleans become 0/1, enums integers; a base under its
 * PARAM_FLOORS floor is raised to it (and a route may not pull it down);
 * carriers keep base 0, their source and their route (only the amount moves,
 * CARRIER_AMOUNT_MIN..MAX); routes on non-routable or enum params go; ordinary
 * route depth is capped at ±MAX_ROUTE_AMOUNT; duplicate keys keep the last;
 * at most 12 params and 6 routes. Every refusal or adjustment is reported
 * with a short reason.
 * Applied to the Agent's plan AND to every Optimizer fix.
 */
export function validatePlan(plan: unknown, chain: ChainState): AgentResult {
  const dropped: string[] = [];
  const byKey = new Map<string, ParamDesc>();
  for (const raw of arr(chain?.params)) {
    const d = normalizeParam(raw);
    if (d) byKey.set(d.key, d);
  }
  const src = obj(plan);

  const params = new Map<string, number>();
  for (const raw of arr(src.params)) {
    const e = obj(raw);
    const key = typeof e.key === 'string' ? e.key : '';
    const d = byKey.get(key);
    if (!key) { dropped.push('a parameter change without a key'); continue; }
    if (!d) { dropped.push(`${key}: not a parameter of this chain`); continue; }
    if (isLocked(d)) { dropped.push(`${key}: protected, never changed by the AI`); continue; }
    if (isCarrier(d)) { dropped.push(`${key}: carrier — its base stays 0, only its route amount can change`); continue; }
    const v = toNumber(e.value);
    if (v === null) { dropped.push(`${key}: value is not a number`); continue; }
    let value = d.type === 'boolean' ? (v >= 0.5 ? 1 : 0)
      : isEnum(d) ? clamp(Math.round(v), Math.ceil(d.min), Math.floor(d.max))
      : snapNumber(v, d);
    const floor = PARAM_FLOORS[key];
    if (floor !== undefined && d.type === 'number' && value < floor) {
      let f = snapNumber(floor, d);
      if (f < floor && d.step > 0) f = snapNumber(f + d.step, d); // the grid point at or above the floor
      dropped.push(`${key}: ${n2(value)} raised to ${n2(f)}, its floor (it scales the effect's whole music response)`);
      value = f;
    }
    params.delete(key); // last wins, in the position of the last mention
    params.set(key, value);
  }

  const routes = new Map<string, AgentPlan['routes'][number]>();
  for (const raw of arr(src.routes)) {
    const e = obj(raw);
    const key = typeof e.key === 'string' ? e.key : '';
    const d = byKey.get(key);
    if (!key) { dropped.push('a route without a key'); continue; }
    if (!d) { dropped.push(`${key}: not a parameter of this chain`); continue; }
    if (isLocked(d)) { dropped.push(`${key}: protected, never routed by the AI`); continue; }
    if (isEnum(d)) { dropped.push(`${key}: enum parameters are never routed`); continue; }
    if (d.type !== 'number' || !d.reactive) { dropped.push(`${key}: not routable`); continue; }
    const source = e.source;
    if (!(isModSource(source) || source === 'off')) { dropped.push(`${key}: unknown signal "${String(source)}"`); continue; }

    if (isCarrier(d)) {
      if (source === 'off') { dropped.push(`${key}: carrier route cannot be switched off`); continue; }
      const fixed = d.route?.source ?? CARRIER_DEFAULT_SOURCE[key];
      if (fixed && source !== fixed) { dropped.push(`${key}: carrier route stays on ${fixed}`); continue; }
      const a = toNumber(e.amount);
      if (a === null) { dropped.push(`${key}: amount is not a number`); continue; }
      routes.delete(key);
      routes.set(key, { key, source, amount: round2(clamp(a, CARRIER_AMOUNT_MIN, CARRIER_AMOUNT_MAX)) });
      continue;
    }

    if (source === 'off') {
      routes.delete(key);
      routes.set(key, { key, source, amount: 0 });
      continue;
    }
    const a = toNumber(e.amount);
    if (a === null) { dropped.push(`${key}: amount is not a number`); continue; }
    const amount = round2(clamp(a, -MAX_ROUTE_AMOUNT, MAX_ROUTE_AMOUNT));
    if (amount === 0) { dropped.push(`${key}: amount 0 does nothing (use source "off" to remove a route)`); continue; }
    if (amount < 0 && PARAM_FLOORS[key] !== undefined) { dropped.push(`${key}: a negative route would pull it under its floor`); continue; }
    routes.delete(key);
    routes.set(key, { key, source, amount });
  }

  let paramList = [...params].map(([key, value]) => ({ key, value }));
  if (paramList.length > MAX_PLAN_PARAMS) {
    for (const p of paramList.slice(MAX_PLAN_PARAMS)) dropped.push(`${p.key}: over the ${MAX_PLAN_PARAMS}-parameter limit`);
    paramList = paramList.slice(0, MAX_PLAN_PARAMS);
  }
  let routeList = [...routes.values()];
  if (routeList.length > MAX_PLAN_ROUTES) {
    for (const r of routeList.slice(MAX_PLAN_ROUTES)) dropped.push(`${r.key}: over the ${MAX_PLAN_ROUTES}-route limit`);
    routeList = routeList.slice(0, MAX_PLAN_ROUTES);
  }

  return { plan: { summary: str(src.summary, 900), params: paramList, routes: routeList }, dropped };
}

/** A proposal's chain made renderable: valid ids only, no repeats, at most one
 *  raw-source effect and that one FIRST (anything before it would be thrown
 *  away by the engine), at most three. */
export function normalizeProposalChain(raw: unknown): ModuleId[] {
  const ids = [...new Set(arr(raw).filter(isModuleId))];
  const lead = ids.find((id) => RAW_SOURCE_EFFECTS.includes(id));
  const rest = ids.filter((id) => !RAW_SOURCE_EFFECTS.includes(id));
  return (lead ? [lead, ...rest] : rest).slice(0, MAX_CHAIN);
}

export function validateArtDirector(raw: unknown): ArtDirectorResult {
  const r = obj(raw);
  const read = obj(r.read);
  const music = readMusic(read.music);
  const proposals = arr(r.proposals)
    .map((x) => obj(x))
    .map((p) => ({
      title: str(p.title, 80),
      chain: normalizeProposalChain(p.chain),
      why: str(p.why, 900),
      audioIdea: str(p.audioIdea, 700),
    }))
    .filter((p) => p.chain.length > 0)
    .slice(0, MAX_PROPOSALS);
  return {
    read: {
      subject: str(read.subject, 400),
      setting: str(read.setting, 400),
      mood: str(read.mood, 300),
      palette: arr(read.palette).map((c) => str(c, 40)).filter(Boolean).slice(0, 5),
      motion: str(read.motion, 400),
      music,
    },
    proposals,
  };
}

const SEVERITIES: readonly OptimizerIssue['severity'][] = ['error', 'warning', 'tip'];
const VERDICTS: readonly OptimizerResult['verdict'][] = ['ok', 'improve', 'broken'];

export function validateOptimizer(raw: unknown, chain: ChainState): OptimizerResult {
  const r = obj(raw);
  const dropped: string[] = [];
  const issues: OptimizerIssue[] = arr(r.issues).slice(0, MAX_ISSUES).map((x, i) => {
    const it = obj(x);
    let fix: AgentPlan | null = null;
    if (it.fix && typeof it.fix === 'object') {
      const v = validatePlan(it.fix, chain);
      for (const d of v.dropped) dropped.push(`fix ${i + 1} · ${d}`);
      if (v.plan.params.length || v.plan.routes.length) fix = v.plan;
      else dropped.push(`fix ${i + 1} · nothing left to apply`);
    }
    return {
      severity: SEVERITIES.includes(it.severity as OptimizerIssue['severity']) ? (it.severity as OptimizerIssue['severity']) : 'tip',
      finding: str(it.finding, 600),
      evidence: str(it.evidence, 600),
      fix,
    };
  }).filter((it) => it.finding);
  return {
    verdict: VERDICTS.includes(r.verdict as OptimizerResult['verdict']) ? (r.verdict as OptimizerResult['verdict']) : 'improve',
    summary: str(r.summary, 900),
    issues,
    dropped,
  };
}

/* ═══════════════════════════════════════════════════════════════
   THE THREE JOBS
   ═══════════════════════════════════════════════════════════════ */

const NO_MEDIA = 'Nothing to look at: send frames, a photo, a clip or an uploaded video.';

export function artDirectorJob(body: unknown): RoleJob<ArtDirectorResult> {
  const b = obj(body);
  const source = readSource(b.source);
  const media = readMedia(b.media);
  if (!media.length && !source.fileUri) throw new GeminiFailure('no_media', NO_MEDIA);

  const currentChain = arr(b.currentChain).filter(isModuleId);
  const what = source.fileUri
    ? `a whole ${source.kind === 'image' ? 'file' : 'video'}${source.durationSec ? ` (${clock(source.durationSec)} long)` : ''}, attached above${(source.fileMimeType ?? '').startsWith('video/') ? ' with its soundtrack — watch it AND listen to it' : ''}`
    : source.kind === 'image' ? 'a still photo (no motion, no sound)'
    : source.kind === 'webcam' ? 'live webcam frames from the Lab (no sound unless LIVE SIGNALS say audio is on)'
    : `${media.length} still frame${media.length === 1 ? '' : 's'} sampled from the video (no sound reaches you — use LIVE SIGNALS if present)`;

  const context = [
    `SOURCE: ${source.kind}${source.name ? ` "${source.name}"` : ''} — you receive ${what}.`,
    describeIntent(b.intent, 'propose the looks this footage and this music call for.'),
    currentChain.length ? `CURRENT LAB CHAIN: ${currentChain.join(' → ')} (you may keep it, change it or replace it).` : 'CURRENT LAB CHAIN: none.',
    b.signals ? describeSignals(b.signals) : 'LIVE SIGNALS: not available (the Lab is not running).',
    'Read the source, then propose 1–3 looks. Prose fields in Italian.',
  ].join('\n\n');

  /* A long uploaded video is the one case worth trading detail for budget:
     low media resolution keeps a 5+ minute video inside free-tier limits. */
  const long = !!source.fileUri && (source.durationSec ?? 0) > 300;

  return {
    systemInstruction: ART_DIRECTOR_SYSTEM,
    parts: [...sourceFileParts(source), ...mediaParts(media), { text: context }],
    responseJsonSchema: artDirectorSchema(),
    ...(long ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW } : {}),
    finish: validateArtDirector,
  };
}

export function agentJob(body: unknown): RoleJob<AgentResult> {
  const b = obj(body);
  const source = readSource(b.source);
  const media = readMedia(b.media);
  if (!media.length && !source.fileUri) throw new GeminiFailure('no_media', NO_MEDIA);
  const chain = readChain(b.chain);
  const direction = readDirection(b.direction);
  const hasIntent = !!str(b.intent, 600);

  const context = [
    describeIntent(b.intent, direction ? 'execute the art direction below.' : 'make this chain work for this footage and this music.'),
    describeDirection(direction, chain.order, hasIntent),
    describeAgentMedia(source, media, chain.audioActive),
    describeSignals(b.signals),
    describeChain(chain),
    `Write the plan: at most ${MAX_PLAN_PARAMS} params and ${MAX_PLAN_ROUTES} routes, summary in Italian.`,
  ].join('\n\n');

  const schema = planSchema(chain);
  return {
    systemInstruction: AGENT_SYSTEM,
    parts: [...sourceFileParts(source), ...mediaParts(media), { text: context }],
    responseJsonSchema: schema,
    looseSchema: loosen(schema) as Record<string, unknown>,
    finish: (raw) => validatePlan(raw, chain),
  };
}

/** What the Agent actually got to see and hear, in one paragraph — so it
 *  knows whether it can listen to the song itself or only read the meters. */
function describeAgentMedia(source: SourceRef, media: MediaPart[], audioOn: boolean): string {
  const items: string[] = [];
  if (source.fileUri) {
    items.push(isVideoFile(source)
      ? `the WHOLE source video${source.durationSec ? ` (${clock(source.durationSec)})` : ''} attached above WITH its soundtrack, sampled at ${sourceFps(source)} fps — listen to the song (sections, drop, hook, where the 808 hits) and watch how the shot moves`
      : 'the source file attached above');
  }
  for (const c of media.filter((m) => m.mimeType.startsWith('video/'))) {
    items.push(`"${c.label}" — the Lab's OUTPUT right now, sampled at ${INLINE_VIDEO_FPS} fps${audioOn ? ': see and hear what already moves on the beat' : ' (silent: audio is off)'}`);
  }
  const sounds = media.filter((m) => m.mimeType.startsWith('audio/')).length;
  if (sounds) items.push(`${sounds} audio clip${sounds === 1 ? '' : 's'}`);
  const stills = media.filter((m) => m.mimeType.startsWith('image/')).length;
  if (stills) items.push(`${stills} still frame${stills === 1 ? '' : 's'} (SOURCE / OUTPUT)`);
  const lines = [`SOURCE: ${source.kind}${source.name ? ` "${source.name}"` : ''} — you receive ${items.join('; ') || 'nothing but the numbers below'}.`];
  if (source.kind === 'video' && !source.fileUri) {
    lines.push('The whole source video is not attached: you do not hear the song itself, only the OUTPUT clip (if any) and the LIVE SIGNALS.');
  }
  return lines.join('\n');
}

function describeChecks(raw: unknown): string {
  const checks = arr(raw).map((x) => obj(x)).filter((c) => typeof c.id === 'string') as Partial<CheckResult>[];
  if (!checks.length) return 'CHECKS: none reported.';
  return ['CHECKS (computed by the Lab — facts):', ...checks.slice(0, 24).map((c) => `- [${c.ok ? 'ok' : 'FAIL'}] ${str(c.id, 40)}: ${str(c.detail, 200)}`)].join('\n');
}

function describeLastAgent(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return 'LAST AGENT RUN: none (never run, or undone) — judge the chain as it is now, against the intent and the art direction.';
  const l = obj(raw);
  const plan = obj(l.plan);
  const params = arr(plan.params).map((x) => obj(x)).map((p) => `${str(p.key, 60)}=${n2(p.value)}`).join(', ') || 'none';
  const routes = arr(plan.routes).map((x) => obj(x))
    .map((r) => (r.source === 'off' ? `${str(r.key, 60)} route off` : `${str(r.key, 60)} ← ${str(r.source, 10)} ×${n2(r.amount)}`))
    .join(', ') || 'none';
  return [
    `LAST AGENT RUN (${str(l.at, 40) || 'time unknown'}) — intent: ${str(l.intent, 400) ? `"${str(l.intent, 400)}"` : 'none'}`,
    `summary: ${str(plan.summary, 600) || '—'}`,
    `params: ${params}`,
    `routes: ${routes}`,
  ].join('\n');
}

export function optimizerJob(body: unknown): RoleJob<OptimizerResult> {
  const b = obj(body);
  const media = readMedia(b.media);
  if (!media.length) throw new GeminiFailure('no_media', 'Nothing to judge: send the output clip and/or frame pairs from the Lab.');
  const chain = readChain(b.chain);
  const direction = readDirection(b.direction);
  const hasIntent = !!str(b.intent, 600);
  const clip = media.find((m) => m.mimeType.startsWith('video/'));

  const context = [
    describeIntent(b.intent, direction ? 'judge the result against the art direction below.' : 'judge whether the result is strong, readable and musical.'),
    describeDirection(direction, chain.order, hasIntent),
    describeLastAgent(b.lastAgent),
    clip
      ? `OUTPUT CLIP: "${clip.label}", sampled at ${INLINE_VIDEO_FPS} fps${chain.audioActive ? ', with the music — judge the beat sync from it' : ' — SILENT, audio is off: judge only what you see, not the beat'}.`
      : 'OUTPUT CLIP: none (frames only) — you cannot judge the beat sync; say so if it matters.',
    describeChecks(b.checks),
    describeSignals(b.signals),
    describeChain(chain),
    `Report at most ${MAX_ISSUES} issues, most important first, each with a fix or null. Prose in Italian.`,
  ].join('\n\n');

  const schema = optimizerSchema(chain);
  return {
    systemInstruction: OPTIMIZER_SYSTEM,
    parts: [...mediaParts(media), { text: context }],
    responseJsonSchema: schema,
    looseSchema: loosen(schema) as Record<string, unknown>,
    finish: (raw) => validateOptimizer(raw, chain),
  };
}
