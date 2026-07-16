const fs = require('fs');
let content = fs.readFileSync('src/components/AiDirector.tsx', 'utf8');

// Replace standard colors
content = content.replace(/text-gold-500/g, "${isDayMode ? 'text-[#7b51b7]' : 'text-violet-400'}");
content = content.replace(/bg-gold-500/g, "${isDayMode ? 'bg-[#7b51b7]' : 'bg-violet-500'}");
content = content.replace(/border-gold-500/g, "${isDayMode ? 'border-[#7b51b7]' : 'border-violet-500'}");
content = content.replace(/hover:bg-gold-400/g, "${isDayMode ? 'hover:bg-[#7b51b7]/90' : 'hover:bg-violet-400'}");

// Additional specific replaces
content = content.replace(/text-gold-800/g, "text-[#7b51b7]");
content = content.replace(/text-gold-200/g, "text-violet-200");

// Fix any double interpolation issues like className="w-4 h-4 ${isDayMode...}"
// We need to change className="..." to className={`...`} if there's an interpolation
content = content.replace(/className="([^"]*\$\{isDayMode[^"]*)[^"]*"/g, 'className={`$1`}');

fs.writeFileSync('src/components/AiDirector.tsx', content);
