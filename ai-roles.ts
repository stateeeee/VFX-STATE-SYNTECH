/*
 * GEMINI 3.8 — the three roles, server side.
 *
 * For each role (Art Director, Agent, Optimizer — defined in
 * src/ai/contract.ts) this file owns four things:
 *   (a) the system prompt: what the role is, what it knows about the ten
 *       effects and the Lab, and the rules it must follow;
 *   (b) the response JSON schema, built PER REQUEST and kept SIMPLE: Google
 *       refuses a schema it finds too complex (big key enums, arrays with
 *       length limits nested under other arrays, numeric bounds) with a bare
 *       400 INVALID_ARGUMENT. The Agent's key enum comes from the chain the
 *       Lab sent, and only while it is short (ENUM_KEY_LIMIT); the
 *       Optimizer's fixes carry no enum and no bound at all;
 *   (c) the parts builder: every media item is preceded by its label, so
 *       Gemini always knows which picture is SOURCE and which is OUTPUT;
 *   (d) the validator: whatever Gemini answers is clamped, snapped and
 *       filtered against the chain table and the safety lists, before it
 *       ever reaches the browser — whatever the schema did or did not say.
 *
 * LAB v2 (2026-10-28): the Lab is a chain of the REAL effect pages in
 * iframes, each fed the previous one's output. A parameter is one control of
 * an effect's own panel ('<ModuleId>.<SynLabParam.key>'), grouped by panel
 * section. There are no signal routes any more: an effect moves with the
 * music through its own analyser and its own reactive controls.
 *
 * Prompts are written in English (the model follows them best); every prose
 * field Gemini returns is asked for in ITALIAN — the operator's language.
 */

import { MediaResolution, type Part } from '@google/genai';
import { GeminiFailure, testHookBaseUrl } from './ai-provider';
import {
  MODULE_IDS, PARAM_FLOORS, PARAM_KEY_PATTERN, LOCKED_GROUPS, LOCKED_CONTROL_PATTERN, INLINE_VIDEO_FPS,
  type AgentPlan, type AgentResult, type ArtDirection, type ArtDirectorResult, type AudioModeT,
  type ChainState, type CheckResult, type MediaPart, type OptimizerIssue,
  type OptimizerResult, type ParamDesc, type SignalSummary, type SourceKindT, type SourceRef,
} from './src/ai/contract';
import type { ModuleId } from './src/types';

/* ── limits ───────────────────────────────────────────────────── */

/** Few, decisive changes: a plan that touches 40 sliders is not direction. */
export const MAX_PLAN_PARAMS = 12;
/** The Agent's schema names the allowed keys in an enum only up to this many
 *  (a one-effect chain, or two small ones). Past it the key is a plain
 *  string: the chain table lists every key, the validator drops the rest. A
 *  three-effect iframe chain exposes 150+ controls — an enum that size is
 *  what makes Google refuse a schema. */
export const ENUM_KEY_LIMIT = 60;
const MAX_PROPOSALS = 3;
const MAX_CHAIN = 3;
const MAX_ISSUES = 6;
const MAX_MEDIA = 32;
/** Bounds what a misbehaving Lab can put into one prompt. */
const MAX_CHAIN_PARAMS = 600;
const MAX_ENUM_OPTIONS = 64;

const KEY_RE = new RegExp(`^${PARAM_KEY_PATTERN}$`);
const LOCKED_CONTROL_RE = new RegExp(LOCKED_CONTROL_PATTERN, 'i');

export interface RoleJob<R> {
  systemInstruction: string;
  parts: Part[];
  responseJsonSchema: Record<string, unknown>;
  /** The same shape with no enums, no array-length caps and no numeric
   *  bounds, for the one retry the server makes if Google refuses the strict
   *  schema (a 400 naming the schema, a bare 400 INVALID_ARGUMENT, or a bare
   *  500 — see ai-provider.ts looseRetryReason). The validator still enforces
   *  every key, cap and clamp. */
  looseSchema?: Record<string, unknown>;
  mediaResolution?: MediaResolution;
  /** Validates Gemini's parsed answer into the wire result. */
  finish(raw: unknown): R;
}

/* ═══════════════════════════════════════════════════════════════
   (a) WHAT EVERY ROLE KNOWS
   ═══════════════════════════════════════════════════════════════ */

/* Written from the effect pages themselves (public/effects/<id>/index.html:
   their panel sections and what each draws), docs/workflow/04-SPEC-EFFECTS.md
   and 01-VISION.md — what each one LOOKS like, what it needs in frame, and
   whether and how it moves with a track. The audience is a director who
   shoots trap/drill/rap videos for a living. */
const EFFECT_CATALOG = `THE TEN EFFECTS (use these exact ids)

analog — ANALOG STATE · video synthesizer
  Look: the picture pushed through a dying CRT and a chewed VHS deck. Tube curvature, scanlines, RGB phosphor mask, bloom, vignette; horizontal sync TEAR, tracking bands, dropouts, chroma split, grain (Analog Glitch, CRT Monitor). A video FEEDBACK loop (Feedback Loop) smears the frame into itself — trails that zoom, rotate and hue-shift, psychedelic when pushed. A luminance PIXEL SORT (Pixel Sort) melts bright pixels into streaks.
  Music: its Reactive section (Engine on/off, Sensitivity, Mod Depth) drives tear and feedback zoom on the low end, the feedback trail and rotation on the mids, chroma and grain on the highs. The feedback reactions only show once the feedback amounts are above 0. Mod Depth sets how hard the music pushes (never below its floor).
  Needs: nothing — any footage. Suits: performance to camera, night city and car b-roll, flashbacks, 2000s home-video nostalgia, drill grit, lo-fi verses.
  Watch out: heavy feedback + tear makes faces unreadable; on chaotic footage it reads as noise.

anamorphic_lab — ANAMORPHIC · cinema lens + film grade
  Look: a Panavision-style rig: squeeze and oval barrel, letterbox to 2.39, horizontal streak bloom, an anamorphic FLARE on the brightest hotspot, film HALATION, chromatic aberration, exposure, colour temperature, split-tone, contrast, highlight rolloff, saturation, grain, vignette; optional subject-aware background blur and a "ghost" double exposure.
  Music: no audio reaction of its own — it does not move with the track.
  Needs: nothing for the grade; the flare needs a real light source in frame; the background blur needs a person. Suits: anything that must look expensive — luxury/flex, R&B and melodic trap, golden hour, night drives. Usually the LAST link: the lens and the grade that glue a chain together.
  Watch out: on dark footage exposure/contrast crush the blacks. Its Compare A|B split is locked.

blob_reveal — BLOB REVEAL · rotoscope engine
  Look: the frame starts BLACK; only the brightest regions open as rectangular windows onto the picture, and the segmented person is cut out and composited on top with feathered edges. Graphic, minimal, high-contrast: the artist floating in the dark with boxes of light popping around them.
  Music: its Audio Reactive section (beat detection: Sensitivity, Min Gap) makes the windows breathe and pop on the hits.
  Needs: a person for the cutout AND bright spots for the windows. Suits: intros, the drop into a hook, a dark verse, strobes and LED walls, club footage.

blob_tracker — BLOB TRACKER · surveillance / data HUD
  Look: computer-vision overlay on the bright blobs — markers with ID/area labels, neon lines connecting nearby blobs, contours, optical-flow arrows, Matrix-style text fill, FX inside the blobs or on the background (invert, thermal, CCTV with timestamp, datamosh, RGB glitch), a water-ripple simulation, a floating 3D eight-panel "AI analysis" montage.
  Music: its Audio Reactive section (AR on, sources, bands) pumps lines, glow, ripples and glitches on the track; Video Reactive follows motion, light, cuts.
  Needs: distinct light points or strong contrast. Suits: surveillance, tech-noir, paranoia, heist and street concepts, video-game HUD.
  Watch out: busy — on cluttered footage it becomes noise; the heaviest effect.

bokeh — BOKEH STATE · cinematic depth of field
  Look: a person mask keeps the SUBJECT sharp while the BACKGROUND melts into lens bokeh (disc, swirly Helios, coma, anamorphic ovals, morphable shapes); highlights become big creamy discs; optional background-only warps and FX (datamosh, pixel sort, liquid, melt) while the artist stays clean; anamorphic optics.
  Music: no audio reaction of its own.
  Needs: ONE clear person, mid shot or close-up. With no person the whole frame counts as background and melts. Suits: the "cinema lens" upgrade for phone footage, artist at night with lights behind, car interiors, clubs.

invisible — INVISIBLE STATE · person cloak
  Look: the person becomes invisible — the background plate (learned over time, or captured) is painted over them, leaving a shimmering, refracting "predator" outline whose edge can be clean or chaotic.
  Music: no audio reaction of its own.
  Needs: a person and a mostly LOCKED-OFF camera (the plate is the empty background; a moving camera smears it). Suits: ghost / absence concepts, the artist vanishing on a beat cut, surreal performance.

time_machine — TIME MACHINE · temporal displacement
  Look: every pixel shows a different moment of the past — a time map (from luminance or another map mode: contrast, bias, blur, invert) decides how many frames back each region is, so moving subjects smear, stretch and echo through time (slit-scan, time ribbons); black/white offsets and a mix control the depth.
  Music: its Reactive section (Engine, Sensitivity, Mod Depth) pushes the displacement with the track.
  Needs: MOTION — on a still shot or photo it shows almost nothing. Suits: dance, car and crowd shots, hypnotic slow sections, the drop.

quadtree — QUADTREE · recursive subdivision
  Look: the frame is cut into a quadtree of flat-colour cells — big blocks where the image is flat, tiny cells on detail and edges (threshold, max depth, samples, acuity); optional cell borders and cell shapes; a mix with the original.
  Music: its Reactive section (Engine, Sensitivity, Mod Depth) makes the subdivision pulse with the track.
  Needs: nothing. Suits: digital/glitch art, graphic covers, transitions, tech concepts. Watch out: destroys faces at low depth.

pointcloud — POINTCLOUD · the video as 3D points
  Look: the frame becomes a cloud of points in 3D space, displaced in depth by brightness, with a slowly drifting camera, point size, brightness, noise and bloom.
  Music: no audio reaction of its own.
  Needs: contrast (bright subjects on dark backgrounds read best). Suits: dreamy, cosmic, data-visual sections, intros and outros. Watch out: the subject's features dissolve into dots.

painting — PAINTING STYLES · painterly filters
  Look: the video repainted in a style — WATERCOLOR, OIL (impasto, light), TEMPERA, POINTILLISM (dots), IMPRESSIONISM (strokes, swirl), EXPRESSIONISM (energy, contrast) — with per-style parameters and colour controls. The paint switch must be ON for any style to show.
  Music: no audio reaction of its own.
  Needs: nothing. Suits: art-film moments, memories, romantic or melancholic tracks, covers.`;

/* Hard facts of the Lab every role needs, so no role proposes or tunes
   something the Lab cannot do. */
const ENGINE_FACTS = `HOW THE LAB RENDERS (an iframe chain)
- The Lab is a chain of the effects' own pages: INPUT → effect 1 → effect 2 → … → OUTPUT. Each effect takes the previous effect's OUTPUT as its video source, exactly as if that were the clip loaded into it. Nothing reaches an effect except what the one before it shows.
- So ORDER matters: effects that must find a person (bokeh, blob_reveal, invisible; anamorphic_lab's background blur) go BEFORE effects that destroy the person's shape (quadtree, pointcloud, painting, heavy analog feedback, time_machine smears) — after them there is no person left to find.
- anamorphic_lab is the lens and the grade: normally last.
- Every effect costs frame rate; three in a chain is heavy — use three only when each one earns its place.
- Music reaches the effects only while the Lab has audio on: a Track (an audio file), the Clip (the source video's own soundtrack) or the Mic. Each effect hears it through its OWN analyser. Only effects with their own reactive section (analog, time_machine, quadtree: Reactive; blob_reveal, blob_tracker: Audio Reactive) move with it; the others (anamorphic_lab, bokeh, invisible, pointcloud, painting) never do — in a chain they are the look the reactive ones play over.`;

const ITALIAN = `LANGUAGE: write every prose field in ITALIAN — the director is Italian. Effect ids, parameter keys and section names stay exactly as given (they are code / panel labels). Scene slang that Italians use in English (808, drop, hook, flare, glitch, b-roll) is fine inside Italian sentences.`;

const FLOOR_TEXT = Object.entries(PARAM_FLOORS).map(([k, v]) => `${k} never below ${v}`).join('; ') || 'none';

/* What a plan is and how it lands, shared by the Agent and the Optimizer's
   fixes. The Lab applies each entry as if the operator moved that control
   in the effect's own panel (SynLab.setParam). */
const PLAN_RULES = `THE CHAIN TABLE
It lists every control of every effect in the chain, grouped by effect and by the effect's own panel SECTION (the names on its panel). Each line: key | label | range | value | flags. Ranges: "number min..max step s"; "on/off 0|1"; "enum 0..n-1" followed by the option labels (value i selects option i).

HOW A PLAN IS APPLIED
Each entry { key, value } moves ONE control of the effect's own panel, exactly as if the director moved it by hand; the effect then behaves as it does standalone. There are NO signal routes: to change how an effect moves with the music, set the controls of its own reactive section (on/off engine, sensitivity, depth, bands…) like any other control. Choose values that still work on the loudest section of the song, not just on the seconds you measured.

MUSIC WHILE AUDIO IS OFF
Audio OFF is the Lab's normal starting state, even for a music video: the source's own song only plays once the director switches on the Clip (or loads a Track, or opens the Mic). An effect's reactive controls set while audio is off are WAITING FOR MUSIC — they come alive the moment audio is on. That is never an error: set them for the music the look needs.

PLAN RULES (anything else is refused by the validator)
- params: { key, value } — the key exactly as in the chain table; the value inside its range (on/off 0 or 1; an enum the option index).
- At most ${MAX_PLAN_PARAMS} params. Few, decisive changes that make a visible difference — leave the rest alone. routes is always an empty list.
- LOCKED controls: never touch them (A/B compare splits, presets and performance pads that rewrite other controls, anything the Lab marks LOCKED).
- FLOORS: ${FLOOR_TEXT} — each scales an effect's whole music response; a lower value is raised to the floor.
- An effect's reactive ENGINE switch: leave it on unless the intent asks that effect to stop moving with the music.
- On/off switches: a section's amounts only show while its switch is on (e.g. a glitch amount does nothing while that glitch is off; painting shows nothing while its paint switch is off) — switch it on in the same plan.
- Keep the subject readable (face, artist) unless the intent asks to destroy it.`;

const ART_DIRECTOR_SYSTEM = `You are the ART DIRECTOR of VFX SYNTECH, a browser VFX studio used by a professional Italian music-video director (trap, drill, rap, R&B — the Italian urban scene and its references). You are the creative mind. You WATCH the source the director gives you — a video with its own music, a photo, or live webcam frames — and you decide which of the studio's ten effects belong on it, alone or chained. Think like a music-video director pitching a look to an artist: concrete, visual, musical, never generic.

READ THE SOURCE
- subject: who or what is on screen (number of people, framing, what they do).
- setting: where it is (place, time of day, light sources).
- mood: the feeling in a few words.
- palette: 3–5 colour words.
- motion: camera movement and subject movement (for a photo: the implied energy).
- music: only if you can HEAR audio (a whole video with its soundtrack): energy, tempo feel (e.g. "trap half-time ~140", "drill con 808 scivolati", "R&B lento"), and up to 6 moments with timestamps "m:ss" (drop, hook, beat switch, pause, ad-lib burst). If you cannot hear audio but LIVE SIGNALS are given, fill energy and tempoFeel from them and leave moments empty. If there is neither, music = null.

PROPOSE 1–3 LOOKS
- Each is a chain of 1–3 DIFFERENT effects in render order, and the looks must differ from each other (for example: one safe, one bold, one wild).
- title: a short name for the look.
- why: tie the choice to what you SAW — concrete details ("le luci della strada dietro di lui diventano dischi enormi", "il volto è sempre al centro, il mask regge"). No generic praise. If an effect needs a person, light points, motion or a still camera that the source lacks, do not propose it.
- audioIdea: how the look should move with THIS track — which element (kick/808, hi-hats, snare, vocal, the drop) drives which visual, through the reactive effects of the chain — concrete enough for the Agent to set it. A chain with no reactive effect does not move with the music: then say what the music suggests for the look instead. For a photo or silent source, say what to set once a Track or the Mic is on.

${ENGINE_FACTS}

${EFFECT_CATALOG}

${ITALIAN}

Answer only with the JSON object described by the response schema.`;

const AGENT_SYSTEM = `You are the AGENT of VFX SYNTECH — the operator at the desk. The director has already chosen the source and the effect chain in the Lab. Your job: set the effects' own panel controls so that the video, the music and the effects play together like a beat under a vocal — composed with the song, never pasted on top.

WHAT YOU RECEIVE
- Possibly the whole SOURCE video as a file, WITH its soundtrack (sampled for you at about 1 fps). That is the song the video is cut to: listen to it end to end — where the sections change, where the drop and the hook land, where the 808 comes in and where it breaks down — and watch how the camera and the subject move across the whole clip. If the file is silent (no soundtrack), never invent a song: set the reactive controls the look needs for a Track or the Mic, and say so in the summary.
- Possibly an OUTPUT clip: a few seconds of what the Lab renders right now, with the music when audio is on, sampled at ${INLINE_VIDEO_FPS} fps so sub-second hits are visible. Use it to see what already moves on the beat, and what does not.
- A SOURCE / OUTPUT frame pair: what goes into the chain and what comes out, at the same instant.
- LIVE SIGNALS measured over the last seconds (audio mode, BPM, bass/treble/loudness, beats counted, motion, brightness).
- The chain table: every control of every effect, by panel section, with its range, current value and flags (LOCKED).
- Possibly an ART DIRECTION: the look the director chose from the Art Director — title, chain, why, audioIdea and the music read with its timestamped moments. It is your brief: turn its audioIdea into the reactive effects' controls and its "why" into the look's controls.
- Possibly the director's intent. When it is given, it wins — over the art direction too, wherever they disagree. With neither, make the look work for this footage and this music.

HOW TO WORK
- Look first: subject size and position, darkness, light sources, how much the camera moves, what the OUTPUT shows versus the SOURCE (effect too weak, too strong, subject lost, image blown or crushed).
- Listen: with the source file, to the song itself (sections, drop, hook, where the low end hits, how dense the verse is against the hook); with the OUTPUT clip, to whether the reactive effects land on the hits; with only numbers, to BPM, how hard the bass peaks, how many beats land in the window, whether the track is dense (loud mean high) or sparse.
- Tie every change to that evidence, and set for the WHOLE song: a sensitivity tuned on a quiet verse must still look right on the drop.
- Audio OFF (the Lab's default): still set the reactive controls the look needs — they wait for music. Say in the summary that they come alive once the Clip (the video's own song), a Track or the Mic is switched on.

${PLAN_RULES}

${ENGINE_FACTS}

${EFFECT_CATALOG}

summary: 2–4 sentences in Italian — what you changed and why, and what the director should now see and hear.

${ITALIAN}

Answer only with the JSON object described by the response schema.`;

const OPTIMIZER_SYSTEM = `You are the OPTIMIZER of VFX SYNTECH — the Agent's controller. The Agent (or the director by hand) has set up an effect chain in the Lab. You judge the RESULT: you watch AND listen to a short OUTPUT clip (with the music when audio is on), you compare SOURCE and OUTPUT frames, and you report what is wrong or could be better — each issue with a fix that can be applied.

WHAT YOU RECEIVE
- The OUTPUT clip: a few seconds of what the Lab renders, with its music when audio is on, sampled at ${INLINE_VIDEO_FPS} fps (one frame every ~${Math.round(1000 / INLINE_VIDEO_FPS)} ms — fine enough to see whether a flash lands on a kick). And SOURCE / OUTPUT frame pairs.
- CHECKS the Lab computed itself (frame rate, signal liveness, the OUTPUT's exposure compared to the source…): treat them as facts. A check saying audio is off is information, not a problem.
- LIVE SIGNALS, the chain table (every control by panel section, ranges, values, flags), the ART DIRECTION the director chose (when given: the look and the audioIdea the result must deliver), the director's request to you (when given: what to check or improve — it wins over the art direction where they disagree), and the Agent's last plan (may be absent).

LOOK FOR
1. Subject lost or unreadable: the face/artist dissolved by glitch, feedback, cells, points, paint or black windows; a cutout on the wrong thing; halos.
2. Blown or crushed image, compared to the source: highlights the chain clipped to white, blacks it crushed so detail is gone (unless clearly intended). A SOURCE that is already dark (night, club, a fade from black) or already bright is the footage, not a fault of the chain — judge what the chain did to it, never brighten a dark look the source already has.
3. Effect invisible: OUTPUT ≈ SOURCE (a switch that is off — e.g. painting's paint switch, invisible's cloak —, thresholds that catch nothing, amounts near 0, a person-based effect that finds no person because an earlier effect destroyed it). Not the same thing: bokeh with NO person in frame is very visible — the whole frame becomes blurred background. Report that as "no subject for this effect" with no fix (it needs a shot with a person, or another chain).
4. Not following the beat — only when audio is on and you hear the music in the clip: the reactive effects' hits do not land on the kicks/snares you hear, nothing moves with the music (engine off, sensitivity or depth too low), or everything jitters constantly instead of moving musically (sensitivity or depth too high). With audio OFF the clip is silent: judge what you see, and do not report the silence as a problem. Effects without a reactive section never move with the music — that is not a fault.
5. Motion-based effects on a still source: time_machine on a locked-off shot or a photo shows almost nothing.
6. Frame-rate problems (from the checks): propose lighter settings.
7. Fighting effects: a person-based effect placed after one that destroyed the person, double vignettes, grades pulling opposite ways.
8. Off brief: with an ART DIRECTION, a result that does not deliver its look, or — with audio on — its audioIdea. With audio off, check only that the reactive controls the idea needs are set.

FOR EACH ISSUE (at most ${MAX_ISSUES}, most important first)
- severity: "error" (broken or unusable), "warning" (clearly hurts the result), "tip" (polish).
- finding: what is wrong, in Italian.
- evidence: what you saw or heard, in Italian, with the clip timestamp ("0:02.5") or the frame label it comes from.
- fix: { summary, params } — a plan that repairs it (same rules as the Agent's plans below). When no control can fix it (it needs another source or another chain order), give fix.params = [] and say so in the finding.
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

/* SYNTECH-SECURITY (SRV-09): a source reference is a file this app uploaded —
   a Gemini Files API URI (https://generativelanguage.googleapis.com/…), or one
   of the loopback mock while the GEMINI_BASE_URL test hook is active. Any other
   URL (a YouTube link, someone's server) would make Google fetch it on the
   key's account, around our own upload cap. */
function isFilesApiUri(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 2048) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (u.protocol === 'https:' && u.hostname === 'generativelanguage.googleapis.com' && !u.port) return true;
  const hook = testHookBaseUrl();
  if (!hook) return false;
  try {
    return u.origin === new URL(hook).origin;
  } catch {
    return false;
  }
}

function readSource(v: unknown): SourceRef {
  const s = obj(v);
  const kind = SOURCE_KINDS.includes(s.kind as SourceKindT) ? (s.kind as SourceKindT) : 'none';
  const src: SourceRef = { kind };
  const name = str(s.name, 160);
  if (name) src.name = name;
  if (s.fileUri !== undefined && s.fileUri !== null && s.fileUri !== '') {
    if (!isFilesApiUri(s.fileUri)) {
      throw new GeminiFailure('bad_request', 'source.fileUri must be a file uploaded through this app (Gemini Files API).');
    }
    src.fileUri = s.fileUri;
    src.fileMimeType = cleanMime(s.fileMimeType) ?? 'video/mp4';
  }
  const dur = fin(s.durationSec);
  if (dur !== null && dur >= 0) src.durationSec = dur;
  return src;
}

/** The effect-side half of a key ('analog.sl-modDepth' → 'sl-modDepth'). */
const ownKey = (key: string) => key.slice(key.indexOf('.') + 1);

/** Never the AI's, whatever the Lab said: a LOCKED_GROUPS section (presets,
 *  performance pads, source/export/info) or an A/B compare / fullscreen
 *  control (LOCKED_CONTROL_PATTERN). */
function lockedByContract(key: string, label: string, hint: string): boolean {
  return LOCKED_GROUPS.includes(hint.trim().toLowerCase())
    || LOCKED_CONTROL_RE.test(ownKey(key)) || LOCKED_CONTROL_RE.test(label);
}

/** Enum option labels: strings only, trimmed, at most MAX_ENUM_OPTIONS. */
function readOptions(v: unknown): string[] | null {
  if (!Array.isArray(v) || !v.length) return null;
  const out = v.slice(0, MAX_ENUM_OPTIONS).map((o) => (typeof o === 'string' || typeof o === 'number' ? str(String(o), 40) : ''));
  return out.length ? out.map((o, i) => o || `#${i}`) : null;
}

/** One ParamDesc made trustworthy: key shape and effect id checked, range
 *  sane, enum range taken from its options, `locked` OR-ed with the
 *  contract's own locks (never weaker than what the Lab said). The legacy
 *  route fields are always off: the iframe Lab has no routes. */
function normalizeParam(raw: unknown): ParamDesc | null {
  const p = obj(raw);
  const key = typeof p.key === 'string' ? p.key.trim() : '';
  if (!KEY_RE.test(key) || !isModuleId(key.slice(0, key.indexOf('.')))) return null;
  const type: ParamDesc['type'] = p.type === 'boolean' ? 'boolean' : p.type === 'enum' ? 'enum' : 'number';
  const options = type === 'enum' ? readOptions(p.options) : null;
  let min = fin(p.min);
  let max = fin(p.max);
  if (type === 'boolean') { min = 0; max = 1; }
  if (options) { min = 0; max = options.length - 1; }
  if (min === null || max === null || max < min) return null; // no range → the AI cannot touch it safely
  if (type === 'enum') { min = Math.ceil(min); max = Math.floor(max); if (max < min) return null; }
  const stepIn = fin(p.step);
  const step = type === 'number' ? (stepIn !== null && stepIn > 0 ? stepIn : 0) : 1;
  const label = str(p.label, 60) || ownKey(key);
  const hint = str(p.hint, 60);
  return {
    key,
    label,
    type,
    min, max, step,
    value: clamp(fin(p.value) ?? min, min, max),
    hint,
    reactive: false,
    route: null,
    carrier: false,
    locked: p.locked === true || lockedByContract(key, label, hint),
    ...(options ? { options } : {}),
  };
}

const AUDIO_MODES: readonly AudioModeT[] = ['off', 'mic', 'file', 'clip'];

function readChain(v: unknown): ChainState {
  const c = obj(v);
  if (!Array.isArray(c.params)) throw new GeminiFailure('bad_request', 'chain is missing: open the Lab and enable at least one effect.');
  const order = [...new Set(arr(c.order).filter(isModuleId))];
  if (!order.length) throw new GeminiFailure('bad_request', 'The Lab chain is empty: enable at least one effect.');
  const fpsCap = fin(c.fpsCap); // the Lab's frame budget (LAB_FPS), absent from an older client
  /* only the effects of this chain, first mention of a key wins */
  const seen = new Set<string>();
  const params = c.params.slice(0, MAX_CHAIN_PARAMS).map(normalizeParam).filter((p): p is ParamDesc => {
    if (!p || seen.has(p.key) || !order.includes(p.key.slice(0, p.key.indexOf('.')) as ModuleId)) return false;
    seen.add(p.key);
    return true;
  });
  return {
    order,
    params,
    fps: fin(c.fps) ?? 0,
    ...(fpsCap !== null && fpsCap > 0 ? { fpsCap: Math.min(fpsCap, 240) } : {}),
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
    lines.push("- audio: OFF — no Track, Clip or Mic is on in the Lab yet. The effects' music reactions wait for music: they are still now and come alive when audio is switched on (not an error).");
  }
  lines.push(`- video: motion ${stat(v.motion)}; bright ${stat(v.bright)}`);
  return lines.join('\n');
}

/** A number as the chain table shows it: enough digits for its step (a
 *  0..0.02 threshold must not read as 0). */
function num(v: number, step = 0): string {
  if (!Number.isFinite(v)) return '?';
  const d = step > 0 ? Math.min(6, Math.max(decimals(step), 0)) : Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 1 ? 2 : 4;
  return String(Number(v.toFixed(d)));
}

function describeParam(p: ParamDesc): string {
  const range = p.type === 'boolean' ? 'on/off 0|1'
    : p.type === 'enum'
      ? `enum ${p.min}..${p.max}${p.options ? ` (${p.options.map((o, i) => `${i} ${o}`).join(', ')})` : ''}`
      : `number ${num(p.min)}..${num(p.max)}${p.step ? ` step ${num(p.step)}` : ''}`;
  const value = p.type === 'boolean' ? (p.value >= 0.5 ? '1 (on)' : '0 (off)')
    : p.type === 'enum' && p.options?.[p.value] ? `${p.value} (${p.options[p.value]})`
    : num(p.value, p.step);
  return `${p.key} | ${p.label} | ${range} | value ${value}${p.locked ? ' | LOCKED' : ''}`;
}

/** The chain table: per effect, per panel section (in the order the Lab
 *  listed them — the panel's own order). */
function describeChain(chain: ChainState): string {
  const render = [chain.fpsCap ? `${n2(chain.fpsCap)} fps cap (the Lab renders capped at ${n2(chain.fpsCap)} fps), measured ${n2(chain.fps)} fps` : `${n2(chain.fps)} fps`];
  if (chain.resScale < 1) render.push(`resolution scale ${Math.round(chain.resScale * 100)}%`);
  render.push(`source ${chain.sourceKind}`);
  if (chain.maskState) render.push(`person mask ${chain.maskState}`);
  render.push(`audio ${chain.audioActive ? `on — ${AUDIO_MODE_LABEL[chain.audioMode] ?? chain.audioMode}` : "OFF (the effects' music reactions are waiting for music)"}`);
  const lines = [
    `CHAIN (render order): INPUT → ${chain.order.join(' → ')} → OUTPUT`,
    `RENDER: ${render.join(', ')}`,
    'CONTROLS — key | label | range | value | flags, grouped [effect] then — section —',
  ];
  for (const id of chain.order) {
    const own = chain.params.filter((p) => p.key.startsWith(`${id}.`));
    lines.push(`[${id}]${own.length ? '' : ' (no controls reported by the Lab)'}`);
    const sections: string[] = [];
    for (const p of own) if (!sections.includes(p.hint)) sections.push(p.hint);
    for (const sec of sections) {
      lines.push(`— ${sec || 'controls'} —`);
      for (const p of own) if (p.hint === sec) lines.push(describeParam(p));
    }
  }
  return lines.join('\n');
}

function describeIntent(intent: unknown, fallback: string, who = "DIRECTOR'S INTENT"): string {
  const i = str(intent, 600);
  return i ? `${who}: "${i}"` : `${who}: none given — ${fallback}`;
}

/** The art direction, as a brief. `order` is the Lab chain right now: when the
 *  director has changed it since, the idea applies to the effects that are
 *  actually there. */
function describeDirection(d: ArtDirection | null, order: ModuleId[], hasIntent: boolean): string {
  if (!d) return 'ART DIRECTION: none chosen.';
  const lines = [
    `ART DIRECTION chosen by the director (an Art Director proposal — the brief${hasIntent ? "; the director's words above win wherever they disagree" : ''}):`,
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

/* An enum with no values is an invalid schema: an empty key list becomes a
   plain string (the validator refuses whatever comes). */
function keyProp(keys: string[], description: string) {
  return keys.length ? { type: 'string', enum: keys, description } : { type: 'string', description };
}

/* The keywords Google's complexity refusals point at: enums, array length
   limits (worst when nested) and numeric bounds. */
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

/** The keys a plan may name: every control of the chain the AI may touch. */
const planKeys = (chain: ChainState) => chain.params.filter((p) => !isLocked(p)).map((p) => p.key);

/** One { key, value } entry. `keys` null → a plain string key. */
function paramItem(keys: string[] | null): Record<string, unknown> {
  const description = 'A control key exactly as in the chain table.';
  return {
    type: 'object',
    properties: {
      key: keys ? keyProp(keys, description) : { type: 'string', description },
      value: { type: 'number', description: 'Inside the control\'s range; on/off 0 or 1; an enum the option index.' },
    },
    required: ['key', 'value'],
  };
}

/** The Agent's plan for THIS chain, one level deep: the allowed keys as an
 *  enum only up to ENUM_KEY_LIMIT, the one array cap at the top. No routes
 *  field: the validator answers routes [] whatever comes. */
export function planSchema(chain: ChainState): Record<string, unknown> {
  const keys = planKeys(chain);
  return {
    type: 'object',
    properties: {
      params: {
        type: 'array',
        maxItems: keys.length ? MAX_PLAN_PARAMS : 0,
        description: `Controls to set, at most ${MAX_PLAN_PARAMS}.`,
        items: paramItem(keys.length <= ENUM_KEY_LIMIT ? keys : null),
      },
      summary: { type: 'string', description: 'In Italian: what changes and why.' },
    },
    required: ['params', 'summary'],
  };
}

export function artDirectorSchema(): Record<string, unknown> {
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

/** The Optimizer's answer. Kept FLAT on purpose: the fix sits inside an
 *  array of issues, and Google refused the old shape — the whole plan schema
 *  (two key enums of the chain, numeric bounds, array caps) nested under
 *  anyOf[plan, null] inside that array — with a bare 400 "Request contains
 *  an invalid argument.". So the fix has no enum, no bound, no cap and no
 *  anyOf: an empty params list means "no fix"; the validator enforces keys,
 *  ranges and the 12-change cap. */
export function optimizerSchema(): Record<string, unknown> {
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
            fix: {
              type: 'object',
              description: 'The controls that repair it; params [] when no control can.',
              properties: {
                summary: { type: 'string', description: 'In Italian: what the fix changes.' },
                params: { type: 'array', items: paramItem(null) },
              },
              required: ['summary', 'params'],
            },
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

/* A boolean from Gemini may come as true/false despite the schema; an enum
   may come as its option label. */
function toNumber(v: unknown, d?: ParamDesc): number | null {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && d) {
    const t = v.trim().toLowerCase();
    if (d.type === 'boolean' && (t === 'on' || t === 'off')) return t === 'on' ? 1 : 0;
    const i = d.options?.findIndex((o) => o.toLowerCase() === t) ?? -1;
    if (i >= 0) return i;
    const n = Number(t);
    return t && Number.isFinite(n) ? n : null;
  }
  return fin(v);
}

function isLocked(d: ParamDesc): boolean {
  return d.locked || lockedByContract(d.key, d.label, d.hint);
}

/**
 * Makes a plan safe for THIS chain. Unknown and locked keys go; numbers are
 * clamped and snapped to the control's step, booleans become 0/1, enums an
 * option index; a value under its PARAM_FLOORS floor is raised to it;
 * duplicate keys keep the last; at most MAX_PLAN_PARAMS. Routes no longer
 * exist: any route Gemini still sends is refused, and the plan always
 * carries routes [].
 * Every refusal goes to `dropped` ("key: reason"). Every change it KEPT but
 * altered — a value out of its range or under its floor — goes to
 * `adjusted`, one line per kept entry, also "key: reason", so the panel can
 * put each line on its row. Snapping to the step is not an adjustment.
 * Applied to the Agent's plan AND to every Optimizer fix.
 */
export function validatePlan(plan: unknown, chain: ChainState): AgentResult & { adjusted: string[] } {
  const dropped: string[] = [];
  /* key → reason, for the entry that is kept: a later mention of the same
     key replaces the entry, and with it its note. */
  const notes = new Map<string, string>();
  const byKey = new Map<string, ParamDesc>();
  for (const raw of arr(chain?.params)) {
    const d = normalizeParam(raw);
    if (d && !byKey.has(d.key)) byKey.set(d.key, d);
  }
  const src = obj(plan);

  const params = new Map<string, number>();
  for (const raw of arr(src.params)) {
    const e = obj(raw);
    const key = typeof e.key === 'string' ? e.key.trim() : '';
    const d = byKey.get(key);
    if (!key) { dropped.push('a parameter change without a key'); continue; }
    if (!d) { dropped.push(`${key}: not a control of this chain`); continue; }
    if (isLocked(d)) { dropped.push(`${key}: protected, never changed by the AI`); continue; }
    const v = toNumber(e.value, d);
    if (v === null) { dropped.push(`${key}: value is not a number`); continue; }
    let value = d.type === 'boolean' ? (v >= 0.5 ? 1 : 0)
      : d.type === 'enum' ? clamp(Math.round(v), d.min, d.max)
      : snapNumber(v, d);
    let note: string | null = null;
    const asked = d.type === 'enum' ? Math.round(v) : v;
    if (d.type !== 'boolean' && (asked < d.min || asked > d.max) && num(asked, d.step) !== num(value, d.step)) {
      note = `Gemini asked ${num(asked)}, clamped to ${num(value, d.step)} (its range is ${num(d.min)}..${num(d.max)})`;
    }
    const floor = PARAM_FLOORS[key];
    if (floor !== undefined && d.type === 'number' && value < floor) {
      let f = snapNumber(floor, d);
      if (f < floor && d.step > 0) f = snapNumber(f + d.step, d); // the grid point at or above the floor
      /* 0.099 snapped under the floor and raised back to 0.1 is a snap, not news */
      if (n2(v) !== n2(f)) note = `Gemini asked ${num(v)}, raised to its floor ${num(f, d.step)} (it scales the effect's whole music response)`;
      value = f;
    }
    params.delete(key); // last wins, in the position of the last mention
    params.set(key, value);
    if (note) notes.set(key, note);
    else notes.delete(key);
  }

  for (const raw of arr(src.routes)) {
    const key = str(obj(raw).key, 120);
    dropped.push(`${key || 'a route'}: signal routes no longer exist — set the effect's own reactive controls instead`);
  }

  let paramList = [...params].map(([key, value]) => ({ key, value }));
  if (paramList.length > MAX_PLAN_PARAMS) {
    for (const p of paramList.slice(MAX_PLAN_PARAMS)) dropped.push(`${p.key}: over the ${MAX_PLAN_PARAMS}-parameter limit`);
    paramList = paramList.slice(0, MAX_PLAN_PARAMS);
  }

  /* Notes only for what survived the limit, in the order of the rows. */
  const adjusted = paramList.filter((p) => notes.has(p.key)).map((p) => `${p.key}: ${notes.get(p.key)}`);

  return { plan: { summary: str(src.summary, 900), params: paramList, routes: [] }, dropped, adjusted };
}

/** A proposal's chain made renderable: valid ids only, no repeats, at most
 *  three. In the iframe Lab every effect takes the previous one's output as
 *  its source, so any order renders (the prompt says which orders make
 *  sense). */
export function normalizeProposalChain(raw: unknown): ModuleId[] {
  return [...new Set(arr(raw).filter(isModuleId))].slice(0, MAX_CHAIN);
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

/** "fix N" in `dropped` and `adjusted` is the N-th issue of the RETURNED list
 *  (1-based): issues without a finding are removed before numbering, so the
 *  panel can number its cards the same way. */
export function validateOptimizer(raw: unknown, chain: ChainState): OptimizerResult & { adjusted: string[] } {
  const r = obj(raw);
  const dropped: string[] = [];
  const adjusted: string[] = [];
  const issues: OptimizerIssue[] = arr(r.issues)
    .map((x) => obj(x))
    .filter((it) => str(it.finding, 600))
    .slice(0, MAX_ISSUES)
    .map((it, i) => {
      let fix: AgentPlan | null = null;
      const f = it.fix && typeof it.fix === 'object' && !Array.isArray(it.fix) ? obj(it.fix) : null;
      /* params [] (or a legacy null) means "no fix": nothing to refuse */
      if (f && (arr(f.params).length || arr(f.routes).length)) {
        const v = validatePlan(f, chain);
        for (const d of v.dropped) dropped.push(`fix ${i + 1} · ${d}`);
        if (v.plan.params.length) {
          fix = v.plan;
          for (const a of v.adjusted) adjusted.push(`fix ${i + 1} · ${a}`);
        } else dropped.push(`fix ${i + 1} · nothing left to apply`);
      }
      return {
        severity: SEVERITIES.includes(it.severity as OptimizerIssue['severity']) ? (it.severity as OptimizerIssue['severity']) : 'tip',
        finding: str(it.finding, 600),
        evidence: str(it.evidence, 600),
        fix,
      };
    });
  return {
    verdict: VERDICTS.includes(r.verdict as OptimizerResult['verdict']) ? (r.verdict as OptimizerResult['verdict']) : 'improve',
    summary: str(r.summary, 900),
    issues,
    dropped,
    adjusted,
  };
}

/* ═══════════════════════════════════════════════════════════════
   THE THREE JOBS
   ═══════════════════════════════════════════════════════════════ */

const NO_MEDIA = 'Nothing to look at: send frames, a photo, a clip or an uploaded video.';
/* The Agent and the Optimizer work on what the Lab renders: without a single
   frame from it (the Lab has no picture, or a Master export holds the
   capture) Gemini would be paid to tune or judge blind — refuse before the
   call, even when the whole source video is already uploaded. */
const NO_LAB_FRAMES = 'No picture arrived from the Lab (no source in it, or a Master export is running)';

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
    currentChain.length ? `CURRENT LAB CHAIN: ${[...new Set(currentChain)].join(' → ')} (you may keep it, change it or replace it).` : 'CURRENT LAB CHAIN: none.',
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
  if (!media.length) throw new GeminiFailure('no_media', `${NO_LAB_FRAMES}: nothing to tune. Run again when the Lab shows the picture.`);
  const chain = readChain(b.chain);
  const direction = readDirection(b.direction);
  const hasIntent = !!str(b.intent, 600);

  const context = [
    describeIntent(b.intent, direction ? 'execute the art direction below.' : 'make this chain work for this footage and this music.'),
    describeDirection(direction, chain.order, hasIntent),
    describeAgentMedia(source, media, chain.audioActive),
    describeSignals(b.signals),
    describeChain(chain),
    `Write the plan: at most ${MAX_PLAN_PARAMS} params (keys exactly as in the chain table), routes none, summary in Italian.`,
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
      ? `the WHOLE source video${source.durationSec ? ` (${clock(source.durationSec)})` : ''} attached above WITH its soundtrack (if it has one), sampled at ${sourceFps(source)} fps — listen to the song (sections, drop, hook, where the 808 hits) and watch how the shot moves`
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
  if (!raw || typeof raw !== 'object') return 'LAST AGENT RUN: none in effect (never run, undone, or made for a different chain) — judge the chain as it is now, against the intent and the art direction.';
  const l = obj(raw);
  const plan = obj(l.plan);
  const params = arr(plan.params).slice(0, 24).map((x) => obj(x)).map((p) => `${str(p.key, 100)}=${num(fin(p.value) ?? NaN)}`).join(', ') || 'none';
  return [
    `LAST AGENT RUN (${str(l.at, 40) || 'time unknown'}) — intent: ${str(l.intent, 400) ? `"${str(l.intent, 400)}"` : 'none'}`,
    `summary: ${str(plan.summary, 600) || '—'}`,
    `controls set: ${params}`,
  ].join('\n');
}

export function optimizerJob(body: unknown): RoleJob<OptimizerResult> {
  const b = obj(body);
  const media = readMedia(b.media);
  if (!media.length) throw new GeminiFailure('no_media', `${NO_LAB_FRAMES}: nothing to judge. Run again when the Lab shows the picture.`);
  const chain = readChain(b.chain);
  const direction = readDirection(b.direction);
  const hasIntent = !!str(b.intent, 600);
  const clip = media.find((m) => m.mimeType.startsWith('video/'));

  const context = [
    describeIntent(
      b.intent,
      direction ? 'judge the result against the art direction below.' : 'judge whether the result is strong, readable and musical.',
      "DIRECTOR'S REQUEST TO YOU (what to check or improve — it wins over the art direction where they disagree)",
    ),
    describeDirection(direction, chain.order, hasIntent),
    describeLastAgent(b.lastAgent),
    clip
      ? `OUTPUT CLIP: "${clip.label}", sampled at ${INLINE_VIDEO_FPS} fps${chain.audioActive ? ', with the music — judge the beat sync from it' : ' — SILENT, audio is off: judge only what you see, not the beat'}.`
      : 'OUTPUT CLIP: none (frames only) — you cannot judge the beat sync; say so if it matters.',
    describeChecks(b.checks),
    describeSignals(b.signals),
    describeChain(chain),
    `Report at most ${MAX_ISSUES} issues, most important first, each with a fix (params [] when no control can fix it). Prose in Italian.`,
  ].join('\n\n');

  const schema = optimizerSchema();
  return {
    systemInstruction: OPTIMIZER_SYSTEM,
    parts: [...mediaParts(media), { text: context }],
    responseJsonSchema: schema,
    looseSchema: loosen(schema) as Record<string, unknown>,
    finish: (raw) => validateOptimizer(raw, chain),
  };
}
