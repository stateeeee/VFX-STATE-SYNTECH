# HANDOFF — VFX Syntech (paste as the first message of the new chat)

> Use this when you open a **fresh session** with the finished app attached, to continue with
> "make it even more premium + add the missing functionality". It bootstraps Claude with full
> context and zero ramp-up. Edit the 〔…〕 bits to reflect what's actually true by then.

---

## Paste-ready handoff prompt

```
CONTEXT — VFX Syntech ("Created by State")
A browser-based, AI-assisted, node-based, audio/video-reactive VFX compositor.
Stack: React 19 + TypeScript + Vite 6 + Tailwind CSS v4 (@theme + CSS vars) + lucide-react +
react-resizable-panels + motion (Framer). Backend: Express + @google/genai (Gemini). Effects are
partly iframe HTML/WebGL apps (public/effects/*) and partly a native WebGL "SynEngine" chain.

DESIGN SYSTEM (read these first):
- design/01-DESIGN-AUDIT.md — full teardown of the look.
- design/06-COMPONENT-STYLE-MAP.md — where every visual element lives.
- Token source of truth: the :root { --syn-* } block in src/index.css (aliased to Tailwind
  gold-*/ink-*/violet-400 via @theme; the canvas graph reads the same vars). Restyle token-first.

WHAT'S DONE:
- The premium restyle to 〔direction, e.g. "D3 Liquid Obsidian"〕 is complete: retokenized palette
  with a real elevation ladder, tokenized day mode, 〔type scale / motion / depth〕, and all shell
  components restyled. Both night + day themes work; data-testid attributes untouched.

WHAT'S STILL PLACEHOLDER (by design — was never wired):
- The right "Effects Library" panel: search box is static; cards are 〔now styled but〕 not wired
  to filter/drag/preview.
- Some right-panel effects and node behaviors are visual-only (no function yet).
- 〔anything else true at that point〕

WHAT I WANT NOW:
〔e.g. "1) Wire the Effects Library: search filter + drag-a-card-to-the-graph to add a node +
live mini-preview. 2) Implement the <X> effect for real. 3) One more polish pass on <screen>."〕

RULES:
- Keep it token-first; don't reintroduce hardcoded colors.
- Don't break functionality, routing, the engine, exports, or data-testid hooks.
- Keep both themes + responsiveness working.
- Run `npm run dev` and screenshot to verify each change; `npm run lint` (tsc --noEmit) stays clean.
- Ask me before any architecturally significant change.

Start by reading design/01-DESIGN-AUDIT.md and design/06-COMPONENT-STYLE-MAP.md, then propose a
short plan before coding.
```

---

## Quick facts to keep handy (so you don't have to dig)
- **Run:** `npm install` → `npm run dev` (tsx server.ts, port 3000). Needs `GEMINI_API_KEY` in
  `.env` for the AI endpoints (falls back to offline presets without it — the UI still works).
- **Lint:** `npm run lint` = `tsc --noEmit`. **Build:** `npm run build`.
- **Branch:** development happens on `claude/loving-curie-evn1k5` (per the repo's workflow).
- **Key files:** `src/App.tsx` (shell/topbar/sidebar/right panel), `src/components/*`
  (`VfxCanvas` = constellation graph, `NodalComposition` = SVG node editor, `AiDirector` = Gemini
  panel, `ChainLab` = AI Lab, `EffectHost` = iframe wrapper), `src/index.css` (tokens), `server.ts`
  (Gemini endpoints).
- **Effects registry:** `src/effects-registry.ts` (5 effects: blob_tracker, analog, blob_reveal,
  bokeh, anamorphic_lab).
- **Effect iframes** have their own CSS world (iridescent, Barlow Condensed) — restyle only if asked.

## Where the design kit lives
Everything is under `design/`: the audit, the brief, the aesthetic directions, the reference-image
guide, the implementation playbook, the component map, and the Gemini analysis kit
(`design/gemini/`). Start from `design/README.md` if in doubt.
