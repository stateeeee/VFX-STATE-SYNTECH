# VFX Syntech - Visual Restyling Workflow

> Documento operativo consegnato dall'operatore (State), 2026-07-27.
> Vincola OGNI sessione di restyling visivo, di qualunque agente.

## Objective

The goal is to improve ONLY the visual appearance of the application.

This is NOT a redesign.

This is NOT a refactor.

This is NOT a feature update.

The application already works.

Your task is to elevate the visual quality while preserving 100% of the existing functionality.

You are acting as

Senior Product Designer
+
Art Director
+
Frontend Engineer

not as a software refactoring agent.

DO NOT REDESIGN. RESTYLE.

---

# Absolute Rules

Do NOT modify:

- business logic
- React logic
- Typescript logic
- application state
- routing
- node graph logic
- canvas rendering
- shaders
- WebGL
- API calls
- websocket
- event handling
- keyboard shortcuts
- file structure
- project architecture

If a visual improvement requires changing functionality,
DO NOT implement it.

---

# You MAY modify

- CSS
- Tailwind classes
- color palette
- spacing
- typography
- borders
- border radius
- gradients
- shadows
- glow
- overlays
- blur
- opacity
- decorative SVG
- masks
- visual transitions
- animations that do not affect functionality

---

# Workflow

## STEP 1 — Analyze the repository. Produce ANALISI.md. Do not write code. Wait.

## STEP 2 — Analyze the two images (A: current app, B: reference). Produce DESIGN_ANALYSIS.md. Do not modify code. Wait.

## STEP 3 — Produce IMPLEMENTATION_PLAN.md: which components change, which CSS files, expected visual impact, risks. Wait.

## STEP 4 — Implement one area at a time. One commit per area. Never modify everything together.

Suggested order:

1 Top Bar
2 Sidebar
3 Right Panel
4 Bottom Panels
5 Cards
6 Buttons
7 Decorative Elements

---

# Important

The visual reference is NOT intended to be copied literally.
Extract its design language.

NON copiare i colori. Copia:

- profondità
- materiali
- continuità delle superfici
- spessori
- linguaggio organico
- illuminazione
- gerarchia visiva

Priorità, in ordine:

1. Materiale
2. Illuminazione
3. Profondità
4. Forme
5. Texture
6. Colori

La texture è quasi l'ultima cosa.

Do NOT simply apply the texture everywhere.
Avoid repetitive texture tiling.
Avoid noisy decoration.
Avoid visual clutter.
Every decorative element must improve readability.

The application should look like a premium creative software,
not a textured mockup.

---

# Before every implementation

Explain

- why this change improves the design
- which files will be edited
- why no functionality will change

Only then implement.
