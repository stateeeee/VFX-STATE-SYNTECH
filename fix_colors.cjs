const fs = require('fs');
let content = fs.readFileSync('src/components/AiDirector.tsx', 'utf8');

// The header lines:
// 56:            {mode === 'art_director' ? <Lightbulb className="w-4 h-4 text-gold-500" /> : 
// 57:             mode === 'agent' ? <Bot className="w-4 h-4 text-gold-500" /> :
// 58:             mode === 'optimizer' ? <Settings className="w-4 h-4 text-gold-500" /> :
// 61:          <h2 className={`text-[11px] tracking-[0.22em] font-mono uppercase font-bold ${!mode ? (isDayMode ? 'text-[#7b51b7]' : 'text-violet-400') : 'text-gold-500'}`}>

content = content.replace(/className="w-4 h-4 text-gold-500"/g, "className={`w-4 h-4 ${isDayMode ? 'text-[#7b51b7]' : 'text-violet-400'}`}");
content = content.replace(/text-gold-500'}/, "text-violet-400'}"); // for line 61

// other classes:
content = content.replace(/className="w-3 h-3 text-gold-500"/g, "className={`w-3 h-3 ${isDayMode ? 'text-[#7b51b7]' : 'text-violet-400'}`}");
content = content.replace(/className="font-mono text-\[10px\] font-bold tracking-widest uppercase text-gold-500"/g, "className={`font-mono text-[10px] font-bold tracking-widest uppercase ${isDayMode ? 'text-[#7b51b7]' : 'text-violet-400'}`}");
content = content.replace(/className="flex items-center gap-2 text-gold-500\/80"/g, "className={`flex items-center gap-2 ${isDayMode ? 'text-[#7b51b7]/80' : 'text-violet-400/80'}`}");

// line 258 & 259
content = content.replace(/hover:border-gold-500\/40 hover:bg-gold-500\/5 text-neutral-700/g, "hover:border-[#7b51b7]/40 hover:bg-[#7b51b7]/5 text-neutral-700");
content = content.replace(/hover:border-gold-500\/40 hover:bg-gold-500\/\[0\.06\] text-neutral-300/g, "hover:border-violet-400/40 hover:bg-violet-400/[0.06] text-neutral-300");

// line 261
content = content.replace(/className="w-3 h-3 text-gold-500 shrink-0 mt-\[1px\]"/g, "className={`w-3 h-3 shrink-0 mt-[1px] ${isDayMode ? 'text-[#7b51b7]' : 'text-violet-400'}`}");

// line 274
content = content.replace(/hover:text-gold-500/g, "${isDayMode ? 'hover:text-[#7b51b7]' : 'hover:text-violet-400'}");

// line 285 & 413
content = content.replace(/bg-gold-500\/10 border-gold-500\/30 text-gold-800/g, "bg-[#7b51b7]/10 border-[#7b51b7]/30 text-[#7b51b7]");
content = content.replace(/bg-gold-500\/10 border-gold-500\/30 text-gold-200/g, "bg-violet-400/10 border-violet-400/30 text-violet-200");

// line 303 & 324 & 446
content = content.replace(/className="w-full px-3 py-2 bg-gold-500 text-black/g, "className={`w-full px-3 py-2 ${isDayMode ? 'bg-[#7b51b7]' : 'bg-violet-500'} text-white");
content = content.replace(/className="px-3 bg-gold-500 text-black/g, "className={`px-3 ${isDayMode ? 'bg-[#7b51b7]' : 'bg-violet-500'} text-white");
content = content.replace(/hover:bg-gold-400/g, "${isDayMode ? 'hover:bg-[#7b51b7]/90' : 'hover:bg-violet-400'}");
// Add closing backtick for the modified className strings that didn't have it before
content = content.replace(/disabled:opacity-40"/g, "disabled:opacity-40`}");
content = content.replace(/disabled:opacity-30"/g, "disabled:opacity-30`}");

// line 318 & 440
content = content.replace(/focus:border-gold-500\/60/g, "focus:border-[#7b51b7]/60' : 'bg-black/40 border border-ink-700/70 text-white focus:outline-none focus:border-violet-500/60");
content = content.replace(/focus:border-violet-500\/60 placeholder-neutral-600/g, "focus:border-violet-500/60 placeholder-neutral-600"); // keep as is, just the replace above did the job
// Wait, replacing 'focus:border-gold-500/60' will mess it up since there are two in the ternary. Let's fix that specific line manually.
// Actually let's use standard node to fix this properly.

fs.writeFileSync('src/components/AiDirector.tsx', content);
