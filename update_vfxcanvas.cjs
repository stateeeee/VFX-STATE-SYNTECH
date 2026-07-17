const fs = require('fs');

let code = fs.readFileSync('src/components/VfxCanvas.tsx', 'utf8');

// Remove border and background fallback
code = code.replace(
  'className="relative w-full h-full min-h-[300px] border border-gold-800/40 bg-ink-900 overflow-hidden rounded-md gold-glow-border"',
  'className="relative w-full h-full min-h-[300px] overflow-hidden"'
);

// Swap purple to gold
code = code.replace(/#b98ff0/g, '#e0b451');
code = code.replace(/#a882ff/g, '#e0b451');
code = code.replace(/#9060eb/g, '#c89a37');
code = code.replace(/#d1beff/g, '#f4e9b0');
code = code.replace(/168, 130, 255/g, '224, 180, 81');

fs.writeFileSync('src/components/VfxCanvas.tsx', code);
