const fs = require('fs');

let code = fs.readFileSync('src/components/NodalComposition.tsx', 'utf8');

// 1. Add isStreaming to NodalCompositionProps
code = code.replace(
  '  onPickSource: () => void;\n}',
  '  onPickSource: () => void;\n  isStreaming?: boolean;\n}'
);

// 2. Add isStreaming to destructuring
code = code.replace(
  '  onPickSource,\n}: NodalCompositionProps)',
  '  onPickSource,\n  isStreaming,\n}: NodalCompositionProps)'
);

// 3. Change OUTPUT_COLOR to violet
code = code.replace(
  "const OUTPUT_COLOR = '#e0b451';",
  "const OUTPUT_COLOR = '#8b5cf6';"
);

// 4. Update the header to swap Add Node to the left, and add Standby on the right
const headerRegex = /\{\/\* header \*\/\}[\s\S]*?\{\/\* node canvas \*\/\}/;
const newHeader = `{/* header */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2 shrink-0 z-10">
        <div className="flex items-center gap-3 text-[9px] font-mono text-neutral-500 relative">
          <button
            type="button"
            data-testid="nodal-add"
            onClick={() => setAddOpen((v) => !v)}
            className={\`flex items-center gap-1 px-2 py-1 rounded-md border transition-colors cursor-pointer \${
              isDayMode
                ? 'border-neutral-300 text-neutral-600 hover:border-violet-500/50 hover:text-violet-600'
                : 'border-ink-700 text-neutral-400 hover:border-violet-500/50 hover:text-violet-500'
            }\`}
          >
            <Plus className="w-3 h-3" /> Add Node
          </button>
          {addOpen && (
            <div
              data-testid="nodal-add-menu"
              className={\`absolute left-0 top-7 z-30 w-52 rounded-lg border p-1.5 shadow-2xl \${
                isDayMode ? 'bg-white border-neutral-200' : 'bg-ink-850 border-ink-700'
              }\`}
            >
              {missing.length === 0 ? (
                <div className="px-2 py-2 font-mono text-[9px] text-neutral-500">All effects are in the graph.</div>
              ) : (
                missing.map((id) => (
                  <button
                    key={id}
                    type="button"
                    data-testid={\`nodal-add-\${id}\`}
                    onClick={() => { onAddEffect(id); setAddOpen(false); }}
                    className={\`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left font-mono text-[10px] transition-colors \${
                      isDayMode ? 'hover:bg-neutral-100 text-neutral-700' : 'hover:bg-white/5 text-neutral-300'
                    }\`}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: EFFECT_META[id].color }} />
                    {EFFECT_META[id].name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <div className="flex items-center">
          {isStreaming ? (
            <span className={\`flex items-center gap-1 text-[8px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded \${isDayMode ? 'bg-green-500/10 text-green-700 border border-green-500/30' : 'bg-green-500/10 text-green-400 border border-green-500/40'}\`}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]" /> Active
            </span>
          ) : (
            <span className={\`flex items-center gap-1 text-[8px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded \${isDayMode ? 'bg-neutral-500/10 text-neutral-600 border border-neutral-500/30' : 'bg-neutral-500/10 text-neutral-400 border border-neutral-500/40'}\`}>
              <span className={\`w-1.5 h-1.5 rounded-full \${isDayMode ? 'bg-neutral-500/70' : 'bg-neutral-400/80'}\`} /> Standby
            </span>
          )}
        </div>
      </div>
      {/* node canvas */}`;

code = code.replace(headerRegex, newHeader);

fs.writeFileSync('src/components/NodalComposition.tsx', code);
