"""Temporary VfxCanvas edits used ONLY to photograph the brain graph as the
operator approved it. Apply, take the preview, then `git checkout` the file —
these are preview edits, not the implementation.

    python3 tools/frame/graph-preview-patch.py
    NODE_PATH=/opt/node22/lib/node_modules node tools/frame/preview-frame.cjs
    git checkout src/components/VfxCanvas.tsx

What it encodes (all four approved by the operator):
  * the graph moves right      — centre at 0.60 of the width, not 0.50
  * unselected clusters        — violet ONLY, eight shades x their own opacity
  * the SELECTED cluster       — gold AND violet mixed, several tones each
  * white stays reserved       — core + selected module only (already in the app)
"""
import sys

P = 'src/components/VfxCanvas.tsx'
s = open(P).read()
if 'FRAME PREVIEW' in s:
    sys.exit('already patched — git checkout src/components/VfxCanvas.tsx first')

s = s.replace("      const cx = w / 2;\n      const cy = h / 2;",
              "      const cx = w * 0.60;   // FRAME PREVIEW\n      const cy = h / 2;")

palette = """      /* FRAME PREVIEW palettes. Unselected: violet only, eight shades, each node
         carrying its own opacity so the cluster has depth without a second hue.
         Selected: gold and violet mixed, stored on `glow` so the draw path can
         swap families without a second lookup table. */
      const VIOLET_SHADES = ['#4c1d95', '#5b21b6', '#6d28d9', '#7c3aed', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe'];
      const GOLD_SHADES = ['#7a5c12', '#a8801d', '#d4a72c', '#e8c34a', '#f5da7a', '#ffe9a8'];
      const shadeOf = (list: string[], k: number) => {
        const h = list[Math.abs(k) % list.length];
        const a = 0.45 + ((Math.abs(k) * 37) % 55) / 100;
        return `rgba(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}, ${a.toFixed(2)})`;
      };
      const vio = (k: number) => shadeOf(VIOLET_SHADES, k);
      const au = (k: number) => shadeOf(GOLD_SHADES, k);
"""
s = s.replace("      const scale = Math.min(w, h) / 600 * 1.5;", palette + "      const scale = Math.min(w, h) / 600 * 1.5;")

for mid, hue in [('blob_tracker', '#8b5cf6'), ('analog', '#7c3aed'), ('blob_reveal', '#a78bfa'),
                 ('bokeh', '#6d28d9'), ('anamorphic_lab', '#c4b5fd')]:
    s = s.replace("{ id: '%s', label:" % mid, "{ glowHue: '%s', id: '%s', label:" % (hue, mid))
s = s.replace("const hubsConfig: { id: ModuleId; label: string; angle: number; dist: number; color: string; glow: string }[]",
              "const hubsConfig: { glowHue: string; id: ModuleId; label: string; angle: number; dist: number; color: string; glow: string }[]")
s = s.replace("          color: hub.color,\n          glow: hub.glow,", "          color: hub.color,\n          glow: hub.glowHue,")

s = s.replace("""          if (rand < 0.25) {
            // Purple dot (viola)
            nodeColor = '#8b5cf6';
            nodeGlow = '#8b5cf6';
            isPurple = true;
          } else if (rand < 0.65) {""",
"""          const k = i * 13 + s * 7;
          if (rand < 0.92) {
            nodeColor = vio(k);                          // idle cluster
            nodeGlow = s % 2 === 0 ? au(k) : vio(k + 3); // when SELECTED
            isPurple = true;
          } else if (rand < 0.96) {""")

s = s.replace("""          if (node.isPurple) {
            baseColor = isSatelliteOfActive 
              ? (isDayMode ? '#7c3aed' : '#c4b5fd') 
              : '#8b5cf6';
          } else if (isSatelliteOfActive) {
            baseColor = isDayMode ? 'rgba(180, 150, 60, 0.9)' : 'rgba(235, 214, 125, 0.9)';
          }""",
"""          if (isSatelliteOfActive) {
            baseColor = node.glow || 'rgba(235, 214, 125, 0.9)';
          } else if (node.isPurple) {
            baseColor = node.color || '#8b5cf6';
          }""")

s = s.replace("          ctx.fillStyle = isSelectedActive ? (isDayMode ? '#6d28d9' : '#ffffff') : ACCENT;",
              "          ctx.fillStyle = isSelectedActive ? (isDayMode ? '#6d28d9' : '#ffffff') : (node.glow || ACCENT);")

open(P, 'w').write(s)
print('patched %s — remember: git checkout %s when the preview is taken' % (P, P))
